"""The bedside device (app/device.py): device.yaml, what the device reports,
button presses running their bound Actions, Home Assistant discovery, the
bedside_device adapter, and the API."""
from __future__ import annotations

import json
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.actions import ActionRunner, save_action
from app.adapters.bedside_device import BedsideDeviceAdapter
from app.aggregator import Aggregator
from app.api import router as api_router
from app.device import (
    NUM_BUTTONS,
    ButtonBinding,
    DeviceConfig,
    DeviceState,
    DimmerConfig,
    MqttDeviceLink,
    device_config_payload,
    ha_discovery_messages,
    load_device_config,
    save_device_config,
)
from app.settings import settings
from tests.auth_helpers import bypass_auth
from tests.test_actions import SwitchAdapter, _lamp


@pytest.fixture
def paths(tmp_path, monkeypatch):
    device = tmp_path / "device.yaml"
    actions = tmp_path / "actions.yaml"
    monkeypatch.setattr(settings, "device_config_path", str(device))
    monkeypatch.setattr(settings, "actions_config_path", str(actions))
    return device, actions


@pytest.fixture
def state(monkeypatch):
    """A fresh DeviceState standing in for the module-level one."""
    fresh = DeviceState()
    monkeypatch.setattr("app.device.device_state", fresh)
    monkeypatch.setattr("app.adapters.bedside_device.device_state", fresh)
    monkeypatch.setattr("app.api.device.device_state", fresh)
    return fresh


# --- device.yaml -------------------------------------------------------------

def test_missing_file_means_defaults(paths):
    device, _ = paths
    config = load_device_config(str(device))
    assert config == DeviceConfig()
    assert config.dimmer.bright_lux == 20 and config.dimmer.dark_lux == 2


def test_round_trip_leaves_unbound_buttons_out(paths):
    device, _ = paths
    config = DeviceConfig(dimmer=DimmerConfig(bright_lux=50, dark_lux=5),
                          buttons={1: ButtonBinding(short="desk_lamp"), 2: ButtonBinding()})
    save_device_config(str(device), config)
    loaded = load_device_config(str(device))
    assert loaded == config
    assert list(loaded.buttons) == [1]
    assert "null" not in device.read_text()


def test_a_broken_file_falls_back_to_defaults(paths):
    device, _ = paths
    device.write_text("dimmer: {bright_lux: 1, dark_lux: 5}\n")  # dark above bright
    assert load_device_config(str(device)) == DeviceConfig()


@pytest.mark.parametrize("dimmer", [{"dark_lux": 30}, {"bright_lux": -1}, {"dim_contrast": 256},
                                    {"wake_seconds": 1}])
def test_invalid_dimmer_settings_are_rejected(dimmer):
    with pytest.raises(ValueError):
        DimmerConfig(**dimmer)


@pytest.mark.parametrize("button", [0, NUM_BUTTONS + 1])
def test_buttons_outside_1_to_8_are_rejected(button):
    with pytest.raises(ValueError):
        DeviceConfig(buttons={button: ButtonBinding(short="x")})


def test_the_device_only_gets_the_dimmer():
    config = DeviceConfig(buttons={1: ButtonBinding(short="desk_lamp")})
    assert json.loads(device_config_payload(config)) == {
        "dimmer": {"bright_lux": 20.0, "dark_lux": 2.0, "dim_contrast": 1, "wake_seconds": 15}}


# --- what the device reports ------------------------------------------------------

def _link(paths, state, adapter=None):
    device, actions = paths
    agg = Aggregator(adapters=[adapter or SwitchAdapter()], publisher=None, client=None)
    return MqttDeviceLink(state, ActionRunner(agg, str(actions)), str(device))


async def test_sensors_and_availability_are_recorded(paths, state):
    link = _link(paths, state)
    await link.handle(settings.mqtt_availability_topic, b"online")
    await link.handle(settings.mqtt_sensors_topic,
                      b'{"temperature_c":21.5,"humidity":44,"lux":null,"screen":"off"}')
    assert state.online is True
    assert state.sensors.temperature_c == 21.5 and state.sensors.lux is None
    assert state.sensors_age() < 5

    await link.handle(settings.mqtt_availability_topic, b"offline")
    assert state.online is False


@pytest.mark.parametrize("topic,payload", [
    ("sensors", b"not json"),
    ("sensors", b'{"screen":"blinding"}'),
    ("button", b'{"button":9,"press":"short"}'),
    ("button", b'{"button":1,"press":"double"}'),
])
async def test_malformed_messages_are_dropped(paths, state, topic, payload):
    link = _link(paths, state)
    await link.handle(getattr(settings, f"mqtt_{topic}_topic"), payload)
    assert state.sensors is None and not state.presses


async def test_a_bound_press_runs_its_action(paths, state):
    device, actions = paths
    save_action(str(actions), _lamp())
    save_device_config(str(device), DeviceConfig(buttons={3: ButtonBinding(long="desk_lamp")}))
    adapter = SwitchAdapter()
    link = _link(paths, state, adapter)

    await link.handle(settings.mqtt_button_topic, b'{"button":3,"press":"long"}')

    assert adapter.runs == ["desk_lamp"]
    press = state.presses[0]
    assert (press.button, press.press, press.action, press.ok, press.text) == \
        (3, "long", "desk_lamp", True, "Done")


async def test_an_unbound_press_is_only_recorded(paths, state):
    device, actions = paths
    save_action(str(actions), _lamp())
    save_device_config(str(device), DeviceConfig(buttons={3: ButtonBinding(long="desk_lamp")}))
    adapter = SwitchAdapter()
    link = _link(paths, state, adapter)

    await link.handle(settings.mqtt_button_topic, b'{"button":3,"press":"short"}')

    assert adapter.runs == []
    assert state.presses[0].action is None and state.presses[0].ok is None


async def test_newest_press_first_and_only_the_recent_ones_kept(paths, state):
    link = _link(paths, state)
    for i in range(25):
        await link.handle(settings.mqtt_button_topic,
                          json.dumps({"button": i % 8 + 1, "press": "short"}).encode())
    assert len(state.presses) == 20
    assert state.presses[0].button == 24 % 8 + 1


async def test_publish_config_without_a_connection_says_so(paths, state):
    assert await _link(paths, state).publish_config() is False


# --- Home Assistant discovery ----------------------------------------------------

def test_discovery_announces_three_sensors_and_a_trigger_per_press():
    messages = dict(ha_discovery_messages("homeassistant"))
    sensors = [t for t in messages if "/sensor/" in t]
    triggers = [t for t in messages if "/device_automation/" in t]
    assert len(sensors) == 3 and len(triggers) == NUM_BUTTONS * 2

    temp = json.loads(messages["homeassistant/sensor/bedside_dashboard/temperature_c/config"])
    assert temp["state_topic"] == "bedside/sensors"
    assert temp["value_template"] == "{{ value_json.temperature_c }}"
    assert temp["availability_topic"] == "bedside/availability"
    assert temp["device_class"] == "temperature"


def test_trigger_payloads_match_what_the_firmware_sends_byte_for_byte():
    """HA matches a device trigger's payload exactly — the firmware's
    publishButton() writes `{"button":%u,"press":"%s"}` with no spaces."""
    messages = dict(ha_discovery_messages("homeassistant"))
    trigger = json.loads(
        messages["homeassistant/device_automation/bedside_dashboard/button_5_long/config"])
    assert trigger["payload"] == '{"button":5,"press":"long"}'
    assert trigger["topic"] == "bedside/button"


# --- the bedside_device adapter --------------------------------------------------

async def test_adapter_is_down_until_the_device_reports(state):
    result = await BedsideDeviceAdapter("bedroom").fetch(None)
    assert result.status == "down"
    assert result.context["temperature_c"] is None


async def test_adapter_exposes_the_readings(paths, state):
    link = _link(paths, state)
    await link.handle(settings.mqtt_availability_topic, b"online")
    await link.handle(settings.mqtt_sensors_topic,
                      b'{"temperature_c":20,"humidity":50,"lux":3.5,"screen":"dim"}')
    result = await BedsideDeviceAdapter("bedroom").fetch(None)
    assert result.status == "ok"
    assert result.context["temperature_f"] == 68.0
    assert result.context["lux"] == 3.5 and result.context["screen"] == "dim"
    assert result.detail == "50% humidity"


async def test_adapter_warns_on_a_stale_report(paths, state):
    link = _link(paths, state)
    await link.handle(settings.mqtt_availability_topic, b"online")
    await link.handle(settings.mqtt_sensors_topic, b'{"temperature_c":20}')
    state.sensors_at = time.time() - 600
    result = await BedsideDeviceAdapter("bedroom").fetch(None)
    assert result.status == "warn"
    assert result.context["status_reason"].startswith("No report from the device for 6")


# --- the API ---------------------------------------------------------------------

class _FakeLink:
    def __init__(self) -> None:
        self.published = 0

    async def publish_config(self) -> bool:
        self.published += 1
        return True


def _client(paths):
    test_app = FastAPI()
    bypass_auth(test_app)
    test_app.include_router(api_router)
    test_app.state.device_link = _FakeLink()
    return TestClient(test_app), test_app.state.device_link


def test_api_get_shows_state_config_and_bindable_actions(paths, state):
    _, actions = paths
    save_action(str(actions), _lamp())
    client, _ = _client(paths)
    data = client.get("/api/device").json()
    assert data["online"] is None and data["sensors"] is None
    assert data["config"]["dimmer"]["bright_lux"] == 20
    assert data["actions"] == [{"id": "desk_lamp", "label": "Desk lamp"}]
    assert data["num_buttons"] == NUM_BUTTONS


def test_api_save_writes_the_file_and_sends_it_to_the_device(paths, state):
    device, actions = paths
    save_action(str(actions), _lamp())
    client, link = _client(paths)
    body = {"dimmer": {"bright_lux": 40, "dark_lux": 4, "dim_contrast": 10, "wake_seconds": 30},
            "buttons": {"2": {"short": "desk_lamp"}}}
    resp = client.put("/api/device/config", json=body)
    assert resp.status_code == 200 and resp.json()["sent_to_device"] is True
    assert link.published == 1
    saved = load_device_config(str(device))
    assert saved.dimmer.bright_lux == 40 and saved.binding(2, "short") == "desk_lamp"


def test_api_rejects_unknown_actions_and_bad_thresholds(paths, state):
    client, link = _client(paths)
    resp = client.put("/api/device/config", json={"buttons": {"1": {"short": "nope"}}})
    assert resp.status_code == 400 and "no action named 'nope'" in resp.json()["detail"]
    resp = client.put("/api/device/config", json={"dimmer": {"bright_lux": 1, "dark_lux": 5}})
    assert resp.status_code == 400 and "dark_lux" in resp.json()["detail"]
    assert link.published == 0
