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
from app.api import router as api_router
from app.home_assistant import HomeAssistantLink
from app.settings import settings
from tests.auth_helpers import bypass_auth


class SwitchHA:
    """Pretends to be Home Assistant (app.home_assistant.HomeAssistant):
    one light, toggled by actions."""

    def __init__(self, fail: bool = False, on: bool = False) -> None:
        self.on = on
        self.fail = fail
        self.runs: list[str] = []

    async def states(self, client):
        return {"light.desk": {"entity_id": "light.desk", "state": "on" if self.on else "off"}}

    async def read_states(self, client, entity_ids):
        raise RuntimeError("this one can't check")

    async def aclose(self):
        pass

    async def run_action(self, client, action):
        if self.fail:
            raise RuntimeError("boom")
        self.runs.append(action.id)
        self.on = not self.on
        return "Done"


def _lamp(**overrides) -> ActionConfig:
    return ActionConfig(**{"id": "desk_lamp", "label": "Desk lamp",
                           "service": "light.toggle", "target": "light.desk",
                           "state_template": "{{ states['light.desk'].state }}",
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
    actions_path.write_text("actions:\n  - id: BAD\n    label: x\n"
                            "  - id: ok\n    label: Fine\n")
    assert [a.id for a in load_actions(str(actions_path))] == ["ok"]


def test_an_old_adapter_field_is_ignored_and_dropped_on_the_next_save(actions_path):
    """Actions named the adapter that ran them until 2026-09-29."""
    actions_path.write_text("actions:\n  - id: lamp\n    label: Lamp\n    adapter: home_assistant\n"
                            "    service: light.toggle\n")
    [lamp] = load_actions(str(actions_path))
    save_action(str(actions_path), lamp, replace_id="lamp")
    assert "adapter" not in actions_path.read_text()


# --- the runner ------------------------------------------------------------

def _runner(actions_path, ha):
    return ActionRunner(HomeAssistantLink(ha, None), str(actions_path))


async def test_runner_runs_the_action(actions_path):
    save_action(str(actions_path), _lamp())
    ha = SwitchHA()
    runner = _runner(actions_path, ha)
    outcome = await runner.run("desk_lamp", source="test")
    assert outcome.ok and outcome.text == "Done"
    assert ha.runs == ["desk_lamp"]


async def test_runner_debounces_a_double_press(actions_path):
    save_action(str(actions_path), _lamp())
    ha = SwitchHA()
    runner = _runner(actions_path, ha)
    assert (await runner.run("desk_lamp", source="test")).ok
    second = await runner.run("desk_lamp", source="test")
    assert not second.ok and second.text == "Too soon"
    assert ha.runs == ["desk_lamp"]


async def test_runner_only_runs_actions_in_the_file(actions_path):
    runner = _runner(actions_path, SwitchHA())
    assert (await runner.run("anything", source="test")).text == "Unknown action"


async def test_runner_says_when_home_assistant_isnt_set_up(actions_path):
    save_action(str(actions_path), _lamp())
    runner = _runner(actions_path, None)
    assert (await runner.run("desk_lamp", source="test")).text == "No HA"


async def test_runner_uses_a_connection_saved_since_it_started(actions_path):
    save_action(str(actions_path), _lamp())
    link = HomeAssistantLink(None, None)
    runner = ActionRunner(link, str(actions_path))
    ha = SwitchHA()
    await link.replace(ha)
    assert (await runner.run("desk_lamp", source="test")).ok and ha.runs == ["desk_lamp"]


async def test_runner_reports_a_failure_without_raising(actions_path):
    save_action(str(actions_path), _lamp())
    runner = _runner(actions_path, SwitchHA(fail=True))
    outcome = await runner.run("desk_lamp", source="test")
    assert not outcome.ok and outcome.text == "Failed"


# --- the API ---------------------------------------------------------------

def _client(actions_path, ha=None):
    ha = ha if ha is not None else SwitchHA(on=True)
    link = HomeAssistantLink(ha or None, None)
    test_app = FastAPI()
    bypass_auth(test_app)
    test_app.include_router(api_router)
    test_app.state.home_assistant = link
    test_app.state.action_runner = ActionRunner(link, str(actions_path))
    return TestClient(test_app), ha


def test_api_create_list_update_delete(actions_path):
    client, _ = _client(actions_path)
    body = _lamp().model_dump()
    assert client.post("/api/actions", json=body).status_code == 200

    data = client.get("/api/actions").json()
    assert data["actions"][0]["id"] == "desk_lamp"
    assert data["actions"][0]["resolved_state"] == "on"
    assert data["home_assistant"] == {"set_up": True, "problem": None}
    assert set(data["context"]) == {"device"}  # never every entity: viewers can read this

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
    client, ha = _client(actions_path)
    client.post("/api/actions", json=_lamp().model_dump())
    assert client.post("/api/actions/desk_lamp/run").json() == {"ok": True, "text": "Done"}
    assert ha.runs == ["desk_lamp"]


def test_api_preview_state(actions_path):
    client, _ = _client(actions_path)
    resp = client.post("/api/preview-action-state",
                       json={"state_template": "{{ states['light.desk'].state|upper }}"})
    assert resp.json() == {"rendered": "ON", "state": "ON", "error": None, "problem": None}


def test_api_preview_state_can_use_the_device_readings(actions_path, monkeypatch):
    from app.device import DeviceState, SensorReading
    fresh = DeviceState()
    fresh.sensors = SensorReading(temperature_c=19.0)
    monkeypatch.setattr("app.api.actions.device_state", fresh)
    client, _ = _client(actions_path)
    resp = client.post("/api/preview-action-state", json={"state_template": "{{ device.temperature_c }} C"})
    assert resp.json()["state"] == "19.0 C"


class UnreachableHA(SwitchHA):
    async def states(self, client):
        raise RuntimeError("connect failed to 192.0.2.9")


def test_api_list_says_once_why_states_are_blank(actions_path):
    client, _ = _client(actions_path, UnreachableHA())
    client.post("/api/actions", json=_lamp().model_dump())
    data = client.get("/api/actions").json()
    assert data["home_assistant"]["problem"].startswith("Home Assistant can’t be reached")
    assert "192.0.2.9" not in str(data)  # the raw error names hosts; viewers can read this
    assert (data["actions"][0]["resolved_state"], data["actions"][0]["state_error"]) == (None, None)


def test_api_list_without_home_assistant(actions_path):
    client, _ = _client(actions_path, False)
    assert client.get("/api/actions").json()["home_assistant"] == {
        "set_up": False, "problem": "Home Assistant isn’t set up."}


# --- verify: did it really happen? ---------------------------------------------

class GarageHA:
    """A Home Assistant stand-in with two garage doors that close a couple
    of reads after being told to — or never, when `jammed`."""

    def __init__(self, doors: dict[str, str | None] | None = None, jammed: bool = False,
                 reads_to_close: int = 2) -> None:
        self.doors = doors if doors is not None else {"cover.left": "open", "cover.right": "closed"}
        self.jammed = jammed
        self.reads_to_close = reads_to_close
        self.runs: list[str] = []
        self.reads = 0
        self.fail_reads = 0

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
    return ActionConfig(id="close_garage", label="Close garage",
                        service="cover.close_cover", target="cover.left, cover.right", confirm=True,
                        verify={"entities": ["cover.left", "cover.right"], "state": "closed",
                                "timeout": 5, **verify})


@pytest.fixture(autouse=True)
def fast_verify(monkeypatch):
    monkeypatch.setattr("app.actions.VERIFY_POLL_SECONDS", 0.01)


async def test_verify_waits_for_every_entity_to_reach_the_state(actions_path):
    save_action(str(actions_path), _garage())
    ha = GarageHA()
    runner = _runner(actions_path, ha)
    outcome = await runner.run("close_garage", source="test")
    assert (outcome.ok, outcome.text) == (True, "Done")
    assert ha.runs == ["close_garage"] and ha.doors["cover.left"] == "closed"


async def test_verify_already_passing_sends_nothing(actions_path):
    save_action(str(actions_path), _garage())
    ha = GarageHA(doors={"cover.left": "closed", "cover.right": "closed"})
    runner = _runner(actions_path, ha)
    outcome = await runner.run("close_garage", source="test")
    assert (outcome.ok, outcome.text) == (True, "Already ok")
    assert ha.runs == []


async def test_verify_times_out_when_it_never_happens(actions_path, monkeypatch):
    save_action(str(actions_path), _garage(timeout=1))
    ha = GarageHA(jammed=True)
    runner = _runner(actions_path, ha)
    outcome = await runner.run("close_garage", source="test")
    assert (outcome.ok, outcome.text) == (False, "Timed out")
    assert ha.runs == ["close_garage"]


async def test_verify_fails_straight_away_on_an_unavailable_entity(actions_path):
    save_action(str(actions_path), _garage(timeout=60))
    ha = GarageHA(doors={"cover.left": "open", "cover.right": "unavailable"}, jammed=True)
    runner = _runner(actions_path, ha)
    outcome = await asyncio.wait_for(runner.run("close_garage", source="test"), timeout=5)
    assert (outcome.ok, outcome.text) == (False, "Unavailable")


async def test_verify_rides_out_a_failed_read(actions_path):
    save_action(str(actions_path), _garage())
    ha = GarageHA()
    ha.fail_reads = 2  # the pre-check and the first poll both fail
    runner = _runner(actions_path, ha)
    outcome = await runner.run("close_garage", source="test")
    assert (outcome.ok, outcome.text) == (True, "Done")
    assert ha.runs == ["close_garage"]


async def test_verify_that_can_never_read_its_entities_times_out(actions_path):
    save_action(str(actions_path), _lamp(verify={"entities": ["light.desk"], "state": "on", "timeout": 1}))
    ha = SwitchHA()
    runner = _runner(actions_path, ha)
    outcome = await runner.run("desk_lamp", source="test")
    assert (outcome.ok, outcome.text) == (False, "Timed out")
    assert ha.runs == ["desk_lamp"]


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
