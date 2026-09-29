"""Actions (app/actions.py): the actions.yaml round trip, the runner
(debounce, failures, verify checks), and the API."""
from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.actions import (
    ActionConfig,
    ActionConfigError,
    ActionRunner,
    VerifyConfig,
    delete_action,
    load_actions,
    save_action,
)
from app.adapters.base import Adapter
from app.aggregator import Aggregator
from app.api import router as api_router
from app.models import AdapterResult
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


def test_any_number_can_be_saved(actions_path):
    for i in range(20):
        save_action(str(actions_path), _lamp(id=f"a{i}"))
    assert len(load_actions(str(actions_path))) == 20


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


# --- the runner ------------------------------------------------------------

def _runner(actions_path, adapter):
    agg = Aggregator(adapters=[adapter], client=None)
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


# --- the API ---------------------------------------------------------------

def _client(actions_path, adapter=None):
    adapter = adapter or SwitchAdapter()
    agg = Aggregator(adapters=[adapter], client=None)
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


# --- verify: did it really happen? ---------------------------------------------

class GarageAdapter(Adapter):
    """A Home Assistant stand-in with two garage doors that close a couple
    of reads after being told to — or never, when `jammed`."""

    type_name = "garage"
    action_kinds = ("service",)

    def __init__(self, doors: dict[str, str | None] | None = None, jammed: bool = False,
                 reads_to_close: int = 2) -> None:
        super().__init__("home")
        self.doors = doors if doors is not None else {"cover.left": "open", "cover.right": "closed"}
        self.jammed = jammed
        self.reads_to_close = reads_to_close
        self.runs: list[str] = []
        self.reads = 0
        self.fail_reads = 0

    async def fetch(self, client):
        return AdapterResult(name=self.name, status="ok")

    async def run_action(self, client, action):
        self.runs.append(action.id)
        self.reads_since_run = 0
        return "Done"

    async def read_states(self, client, entity_ids):
        self.reads += 1
        if self.fail_reads:
            self.fail_reads -= 1
            raise RuntimeError("HA hiccup")
        if self.runs and not self.jammed:
            self.reads_since_run += 1
            if self.reads_since_run >= self.reads_to_close:
                self.doors = {e: ("closed" if s == "open" else s) for e, s in self.doors.items()}
        return {e: self.doors.get(e) for e in entity_ids}


def _garage(**verify) -> ActionConfig:
    return ActionConfig(id="close_garage", label="Close garage", adapter="home",
                        service="cover.close_cover", target="cover.left, cover.right", confirm=True,
                        verify={"entities": ["cover.left", "cover.right"], "state": "closed",
                                "timeout": 5, **verify})


@pytest.fixture(autouse=True)
def fast_verify(monkeypatch):
    monkeypatch.setattr("app.actions.VERIFY_POLL_SECONDS", 0.01)


async def test_verify_waits_for_every_entity_to_reach_the_state(actions_path):
    save_action(str(actions_path), _garage())
    adapter = GarageAdapter()
    runner, _ = _runner(actions_path, adapter)
    outcome = await runner.run("close_garage", source="test")
    assert (outcome.ok, outcome.text) == (True, "Done")
    assert adapter.runs == ["close_garage"] and adapter.doors["cover.left"] == "closed"


async def test_verify_already_passing_sends_nothing(actions_path):
    save_action(str(actions_path), _garage())
    adapter = GarageAdapter(doors={"cover.left": "closed", "cover.right": "closed"})
    runner, _ = _runner(actions_path, adapter)
    outcome = await runner.run("close_garage", source="test")
    assert (outcome.ok, outcome.text) == (True, "Already ok")
    assert adapter.runs == []


async def test_verify_times_out_when_it_never_happens(actions_path, monkeypatch):
    save_action(str(actions_path), _garage(timeout=1))
    adapter = GarageAdapter(jammed=True)
    runner, _ = _runner(actions_path, adapter)
    outcome = await runner.run("close_garage", source="test")
    assert (outcome.ok, outcome.text) == (False, "Timed out")
    assert adapter.runs == ["close_garage"]


async def test_verify_fails_straight_away_on_an_unavailable_entity(actions_path):
    save_action(str(actions_path), _garage(timeout=60))
    adapter = GarageAdapter(doors={"cover.left": "open", "cover.right": "unavailable"}, jammed=True)
    runner, _ = _runner(actions_path, adapter)
    outcome = await asyncio.wait_for(runner.run("close_garage", source="test"), timeout=5)
    assert (outcome.ok, outcome.text) == (False, "Unavailable")


async def test_verify_rides_out_a_failed_read(actions_path):
    save_action(str(actions_path), _garage())
    adapter = GarageAdapter()
    adapter.fail_reads = 2  # the pre-check and the first poll both fail
    runner, _ = _runner(actions_path, adapter)
    outcome = await runner.run("close_garage", source="test")
    assert (outcome.ok, outcome.text) == (True, "Done")
    assert adapter.runs == ["close_garage"]


async def test_verify_on_an_adapter_that_cannot_check_times_out(actions_path):
    save_action(str(actions_path), _lamp(verify={"entities": ["light.desk"], "state": "on", "timeout": 1}))
    adapter = SwitchAdapter()
    runner, _ = _runner(actions_path, adapter)
    outcome = await runner.run("desk_lamp", source="test")
    assert (outcome.ok, outcome.text) == (False, "Timed out")
    assert adapter.runs == ["desk_lamp"]


@pytest.mark.parametrize("verify", [
    {"entities": [], "state": "closed"},
    {"entities": ["  "], "state": "closed"},
    {"entities": ["garage door"], "state": "closed"},
    {"entities": ["cover.x"], "state": " "},
    {"entities": ["cover.x"], "state": "closed", "timeout": 0},
    {"entities": ["cover.x"], "state": "closed", "timeout": 301},
])
def test_invalid_verify_checks_are_rejected(verify):
    with pytest.raises(ValueError):
        VerifyConfig.model_validate(verify)


def test_verify_survives_the_round_trip(actions_path):
    save_action(str(actions_path), _garage())
    loaded = load_actions(str(actions_path))[0]
    assert loaded.verify == VerifyConfig(entities=["cover.left", "cover.right"], state="closed", timeout=5)
    save_action(str(actions_path), _lamp())
    assert load_actions(str(actions_path))[1].verify is None
    assert "verify" not in (actions_path.read_text().split("desk_lamp")[1])
