"""The bedside device (app/device.py): device.yaml, what the device reports,
button presses running their bound Actions (with confirm and sounds), Home
Assistant discovery, the bedside_device adapter, and the API."""
from __future__ import annotations

import asyncio
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
    SoundConfig,
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


def test_the_device_gets_the_dimmer_and_sounds_never_the_bindings():
    config = DeviceConfig(buttons={1: ButtonBinding(short="desk_lamp")})
    assert json.loads(device_config_payload(config)) == {
        "dimmer": {"bright_lux": 20.0, "dark_lux": 2.0, "dim_contrast": 1, "wake_seconds": 15},
        "sounds": {"enabled": True, "volume": 80, "dark_volume": 10}}


@pytest.mark.parametrize("sounds", [{"volume": 101}, {"dark_volume": -1}])
def test_invalid_sound_settings_are_rejected(sounds):
    with pytest.raises(ValueError):
        SoundConfig(**sounds)


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


# --- button feedback: confirm and sounds -----------------------------------------

class _FakeMqtt:
    """Stands in for the link's aiomqtt client, recording what it sends."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    async def publish(self, topic, payload, qos=0, retain=False):
        self.sent.append((topic, payload))

    def sounds(self) -> list[str]:
        return [json.loads(p)["sound"] for t, p in self.sent if t == settings.mqtt_sound_topic]


def _connected_link(paths, state, adapter=None):
    link = _link(paths, state, adapter)
    link._client = _FakeMqtt()
    return link, link._client


async def _press(link, button, press="short"):
    await link.handle(settings.mqtt_button_topic, json.dumps({"button": button, "press": press}).encode())


def _bind(paths, binding, **action):
    device, actions = paths
    save_action(str(actions), _lamp(**action))
    save_device_config(str(device), DeviceConfig(buttons={3: binding}))


async def test_a_plain_action_plays_running_then_success(paths, state):
    _bind(paths, ButtonBinding(short="desk_lamp"))
    link, mqtt = _connected_link(paths, state)
    await _press(link, 3)
    assert mqtt.sounds() == ["running", "success"]


async def test_a_failure_is_urgent_so_it_plays_loud_in_the_dark(paths, state):
    _bind(paths, ButtonBinding(short="desk_lamp"))
    link, mqtt = _connected_link(paths, state, SwitchAdapter(fail=True))
    await _press(link, 3)
    assert [json.loads(p) for _, p in mqtt.sent] == [
        {"sound": "running", "urgent": False}, {"sound": "failure", "urgent": True}]


async def test_a_confirm_action_needs_the_same_press_twice(paths, state):
    _bind(paths, ButtonBinding(long="desk_lamp"), confirm=True)
    adapter = SwitchAdapter()
    link, mqtt = _connected_link(paths, state, adapter)

    await _press(link, 3, "long")
    assert adapter.runs == [] and mqtt.sounds() == ["armed"]
    assert state.presses[0].text == "Armed"

    await _press(link, 3, "long")
    assert adapter.runs == ["desk_lamp"]
    assert mqtt.sounds() == ["armed", "running", "success"]
    assert (state.presses[0].ok, state.presses[0].text) == (True, "Done")


@pytest.mark.parametrize("second", [(3, "short"), (4, "long")])
async def test_anything_else_while_armed_cancels_and_does_nothing_more(paths, state, second):
    device, actions = paths
    save_action(str(actions), _lamp(confirm=True))
    save_action(str(actions), _lamp(id="hall_lamp", label="Hall lamp"))
    save_device_config(str(device), DeviceConfig(buttons={
        3: ButtonBinding(short="hall_lamp", long="desk_lamp"), 4: ButtonBinding(long="hall_lamp")}))
    adapter = SwitchAdapter()
    link, mqtt = _connected_link(paths, state, adapter)

    await _press(link, 3, "long")
    await _press(link, *second)
    assert adapter.runs == []  # neither the armed action nor the second press's own
    assert mqtt.sounds() == ["armed", "cancel"]
    assert state.presses[0].text == "Cancelled"

    await _press(link, 3, "long")  # starts over: arms again
    assert mqtt.sounds() == ["armed", "cancel", "armed"]


async def test_an_armed_action_times_out_with_a_blip(paths, state, monkeypatch):
    monkeypatch.setattr("app.device.CONFIRM_SECONDS", 0.05)
    _bind(paths, ButtonBinding(short="desk_lamp"), confirm=True)
    adapter = SwitchAdapter()
    link, mqtt = _connected_link(paths, state, adapter)

    await _press(link, 3)
    await asyncio.sleep(0.2)
    assert mqtt.sounds() == ["armed", "cancel"]

    await _press(link, 3)  # the window closed: this arms again rather than running
    assert adapter.runs == [] and mqtt.sounds() == ["armed", "cancel", "armed"]


async def test_sounds_without_a_connection_are_dropped_quietly(paths, state):
    _bind(paths, ButtonBinding(short="desk_lamp"))
    adapter = SwitchAdapter()
    link = _link(paths, state, adapter)
    await _press(link, 3)
    assert adapter.runs == ["desk_lamp"]
    assert await link.publish_sound("success") is False


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
        self.sounds: list[str] = []
        self.connected = True

    async def publish_config(self) -> bool:
        self.published += 1
        return True

    async def publish_sound(self, sound) -> bool:
        if self.connected:
            self.sounds.append(sound)
        return self.connected


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
    assert data["confirm_seconds"] == 5
    assert data["sounds"] == ["armed", "running", "success", "failure", "cancel"]


def test_api_save_writes_the_file_and_sends_it_to_the_device(paths, state):
    device, actions = paths
    save_action(str(actions), _lamp())
    client, link = _client(paths)
    body = {"dimmer": {"bright_lux": 40, "dark_lux": 4, "dim_contrast": 10, "wake_seconds": 30},
            "sounds": {"enabled": True, "volume": 60, "dark_volume": 0},
            "buttons": {"2": {"short": "desk_lamp"}}}
    resp = client.put("/api/device/config", json=body)
    assert resp.status_code == 200 and resp.json()["sent_to_device"] is True
    assert link.published == 1
    saved = load_device_config(str(device))
    assert saved.dimmer.bright_lux == 40 and saved.binding(2, "short") == "desk_lamp"
    assert saved.sounds == SoundConfig(volume=60, dark_volume=0)


def test_api_rejects_unknown_actions_and_bad_thresholds(paths, state):
    client, link = _client(paths)
    resp = client.put("/api/device/config", json={"buttons": {"1": {"short": "nope"}}})
    assert resp.status_code == 400 and "no action named 'nope'" in resp.json()["detail"]
    resp = client.put("/api/device/config", json={"dimmer": {"bright_lux": 1, "dark_lux": 5}})
    assert resp.status_code == 400 and "dark_lux" in resp.json()["detail"]
    assert link.published == 0


def test_api_plays_a_test_sound(paths, state):
    client, link = _client(paths)
    assert client.post("/api/device/sound", json={"sound": "failure"}).json() == {"sent": True}
    assert link.sounds == ["failure"]
    resp = client.post("/api/device/sound", json={"sound": "fanfare"})
    assert resp.status_code == 400 and link.sounds == ["failure"]
    link.connected = False
    assert client.post("/api/device/sound", json={"sound": "armed"}).status_code == 503
