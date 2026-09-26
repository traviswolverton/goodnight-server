"""Actions (app/actions.py): the actions.yaml round trip, the payload's
`actions` array, the runner (debounce, failures), the MQTT listener's
request/reply, and the API."""
from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.actions import (
    MAX_ACTIONS,
    ActionConfig,
    ActionConfigError,
    ActionRunner,
    delete_action,
    load_actions,
    save_action,
)
from app.adapters.base import Adapter
from app.aggregator import Aggregator
from app.api import router as api_router
from app.models import AdapterResult
from app.mqtt import MqttActionListener
from app.settings import settings
from tests.auth_helpers import bypass_auth


class SwitchAdapter(Adapter):
    """Pretends to be Home Assistant: one light, toggled by actions."""

    type_name = "switch"
    action_kinds = ("service",)

    def __init__(self, name: str = "home", fail: bool = False) -> None:
        super().__init__(name)
        self.on = False
        self.fail = fail
        self.runs: list[str] = []

    async def fetch(self, client):
        return AdapterResult(name=self.name, status="ok",
                             context={"entities": {"light.desk": {"state": "on" if self.on else "off"}}})

    async def run_action(self, client, action):
        if self.fail:
            raise RuntimeError("boom")
        self.runs.append(action.id)
        self.on = not self.on
        return "Done"


def _lamp(**overrides) -> ActionConfig:
    return ActionConfig(**{"id": "desk_lamp", "label": "Desk lamp", "adapter": "home",
                           "service": "light.toggle", "target": "light.desk",
                           "state_template": "{{ adapters.home.entities['light.desk'].state }}",
                           **overrides})


@pytest.fixture
def actions_path(tmp_path, monkeypatch):
    path = tmp_path / "actions.yaml"
    monkeypatch.setattr(settings, "actions_config_path", str(path))
    return path


# --- actions.yaml ----------------------------------------------------------

def test_save_load_round_trip_leaves_defaults_out(actions_path):
    save_action(str(actions_path), _lamp())
    assert load_actions(str(actions_path)) == [_lamp()]
    text = actions_path.read_text()
    assert "confirm" not in text  # default, not written
    assert "kind: service" in text  # always written, so the file reads clearly


def test_save_replaces_in_place_and_can_rename(actions_path):
    save_action(str(actions_path), _lamp())
    save_action(str(actions_path), _lamp(id="fan", label="Fan"))
    save_action(str(actions_path), _lamp(id="lamp", label="Lamp"), replace_id="desk_lamp")
    assert [a.id for a in load_actions(str(actions_path))] == ["lamp", "fan"]


def test_save_refuses_a_duplicate_id(actions_path):
    save_action(str(actions_path), _lamp())
    with pytest.raises(ActionConfigError, match="already exists"):
        save_action(str(actions_path), _lamp())


def test_save_refuses_more_than_the_display_holds(actions_path):
    for i in range(MAX_ACTIONS):
        save_action(str(actions_path), _lamp(id=f"a{i}"))
    with pytest.raises(ActionConfigError, match="at most"):
        save_action(str(actions_path), _lamp(id="one_more"))


def test_delete(actions_path):
    save_action(str(actions_path), _lamp())
    delete_action(str(actions_path), "desk_lamp")
    assert load_actions(str(actions_path)) == []
    with pytest.raises(ActionConfigError):
        delete_action(str(actions_path), "desk_lamp")


@pytest.mark.parametrize("overrides", [{"id": "Desk Lamp"}, {"id": "1lamp"}, {"label": "   "},
                                       {"label": "x" * 24}, {"kind": "reboot"}])
def test_invalid_actions_are_rejected(overrides):
    with pytest.raises(ValueError):
        _lamp(**overrides)


def test_one_bad_entry_does_not_cost_the_rest(actions_path):
    actions_path.write_text("actions:\n  - id: BAD\n    label: x\n    adapter: home\n"
                            "  - id: ok\n    label: Fine\n    adapter: home\n")
    assert [a.id for a in load_actions(str(actions_path))] == ["ok"]


# --- the status payload ----------------------------------------------------

async def test_payload_lists_actions_with_their_rendered_state(actions_path):
    save_action(str(actions_path), _lamp(confirm=True))
    save_action(str(actions_path), _lamp(id="broken", label="Broken", state_template="{{ nope.x }}"))
    agg = Aggregator(adapters=[SwitchAdapter()], publisher=None, client=None)
    payload = await agg.poll_once()
    assert [a.model_dump() for a in payload.actions] == [
        {"id": "desk_lamp", "label": "Desk lamp", "state": "off", "confirm": True},
        {"id": "broken", "label": "Broken", "state": None, "confirm": False},
    ]


async def test_a_long_state_is_cut_to_fit_the_display(actions_path):
    save_action(str(actions_path), _lamp(state_template="{{ 'é' * 20 }}"))
    agg = Aggregator(adapters=[SwitchAdapter()], publisher=None, client=None)
    state = (await agg.poll_once()).actions[0].state
    assert len(state.encode()) <= 11 and state == "é" * 5  # never half a character


# --- the runner ------------------------------------------------------------

def _runner(actions_path, adapter):
    agg = Aggregator(adapters=[adapter], publisher=None, client=None)
    return ActionRunner(agg, str(actions_path)), agg


async def test_runner_runs_the_action_and_asks_for_a_prompt_poll(actions_path):
    save_action(str(actions_path), _lamp())
    adapter = SwitchAdapter()
    runner, agg = _runner(actions_path, adapter)
    outcome = await runner.run("desk_lamp", source="test")
    assert outcome.ok and outcome.text == "Done"
    assert adapter.runs == ["desk_lamp"]
    await asyncio.sleep(1.1)  # request_poll(delay=1.0)
    assert agg._wake_event.is_set()


async def test_runner_debounces_a_double_press(actions_path):
    save_action(str(actions_path), _lamp())
    adapter = SwitchAdapter()
    runner, _ = _runner(actions_path, adapter)
    assert (await runner.run("desk_lamp", source="test")).ok
    second = await runner.run("desk_lamp", source="test")
    assert not second.ok and second.text == "Too soon"
    assert adapter.runs == ["desk_lamp"]


async def test_runner_only_runs_actions_in_the_file(actions_path):
    runner, _ = _runner(actions_path, SwitchAdapter())
    assert (await runner.run("anything", source="test")).text == "Unknown action"


async def test_runner_reports_a_missing_adapter_or_unsupported_kind(actions_path):
    save_action(str(actions_path), _lamp(adapter="gone"))
    save_action(str(actions_path), _lamp(id="event", kind="event"))
    runner, _ = _runner(actions_path, SwitchAdapter())
    assert (await runner.run("desk_lamp", source="test")).text == "No adapter"
    assert (await runner.run("event", source="test")).text == "Not supported"


async def test_runner_reports_a_failure_without_raising(actions_path):
    save_action(str(actions_path), _lamp())
    runner, _ = _runner(actions_path, SwitchAdapter(fail=True))
    outcome = await runner.run("desk_lamp", source="test")
    assert not outcome.ok and outcome.text == "Failed"


# --- the MQTT listener -----------------------------------------------------

async def test_listener_replies_with_the_request_counter(actions_path):
    save_action(str(actions_path), _lamp())
    runner, _ = _runner(actions_path, SwitchAdapter())
    result = await MqttActionListener(runner).handle(b'{"id": "desk_lamp", "req": 42}')
    assert result.model_dump() == {"id": "desk_lamp", "req": 42, "ok": True, "text": "Done"}


@pytest.mark.parametrize("payload", [b"not json", b'{"req": 1}', b'{"id": 5}'])
async def test_listener_ignores_malformed_requests(actions_path, payload):
    runner, _ = _runner(actions_path, SwitchAdapter())
    assert await MqttActionListener(runner).handle(payload) is None


# --- the API ---------------------------------------------------------------

def _client(actions_path, adapter=None):
    adapter = adapter or SwitchAdapter()
    agg = Aggregator(adapters=[adapter], publisher=None, client=None)
    agg.latest_results = {"home": AdapterResult(
        name="home", status="ok", context={"entities": {"light.desk": {"state": "on"}}})}
    test_app = FastAPI()
    bypass_auth(test_app)
    test_app.include_router(api_router)
    test_app.state.aggregator = agg
    test_app.state.action_runner = ActionRunner(agg, str(actions_path))
    return TestClient(test_app), adapter


def test_api_create_list_update_delete(actions_path):
    client, _ = _client(actions_path)
    body = _lamp().model_dump()
    assert client.post("/api/actions", json=body).status_code == 200

    data = client.get("/api/actions").json()
    assert data["actions"][0]["id"] == "desk_lamp"
    assert data["actions"][0]["resolved_state"] == "on"
    assert data["adapters"] == [{"name": "home", "type": "switch", "kinds": ["service"]}]
    assert data["limits"]["max_actions"] == MAX_ACTIONS

    assert client.put("/api/actions/desk_lamp", json={**body, "label": "Lamp"}).status_code == 200
    assert client.get("/api/actions").json()["actions"][0]["label"] == "Lamp"
    assert client.put("/api/actions/nope", json=body).status_code == 404

    assert client.delete("/api/actions/desk_lamp").status_code == 200
    assert client.delete("/api/actions/desk_lamp").status_code == 404


def test_api_rejects_an_invalid_action_with_a_readable_message(actions_path):
    client, _ = _client(actions_path)
    resp = client.post("/api/actions", json={**_lamp().model_dump(), "id": "Bad Id"})
    assert resp.status_code == 400
    assert resp.json()["detail"].startswith("id: id must be lowercase")


def test_api_run_goes_through_the_runner(actions_path):
    client, adapter = _client(actions_path)
    client.post("/api/actions", json=_lamp().model_dump())
    assert client.post("/api/actions/desk_lamp/run").json() == {"ok": True, "text": "Done"}
    assert adapter.runs == ["desk_lamp"]


def test_api_preview_state(actions_path):
    client, _ = _client(actions_path)
    resp = client.post("/api/preview-action-state",
                       json={"state_template": "{{ adapters.home.entities['light.desk'].state|upper }}"})
    assert resp.json() == {"rendered": "ON", "state": "ON", "error": None}
