"""The bedside device itself: its settings, what it last reported, and the
MQTT connection that carries both.

Unlike the rest of this service, which turns homelab data into something
to show, this module is about the hardware on the nightstand:

- **DeviceConfig** (config/device.yaml, edited on the Device page) — the
  screen's dimmer thresholds, sent to the device retained on
  `bedside/config`, and which Action (app/actions.py) each of the 8
  buttons runs on a short or long press.
- **DeviceState** — the latest `bedside/sensors` reading, whether the
  device is online (`bedside/availability`, its MQTT last will), and the
  last few button presses. In memory only: the device re-sends all of it
  within 30 seconds of any restart, and retained messages cover the gap.
- **MqttDeviceLink** — its own broker connection (same reasoning as
  app.mqtt.MqttActionListener: a long-lived receive loop, kept apart from
  status publishing). It also announces the device to Home Assistant via
  MQTT discovery: three sensors, and a device trigger per button and press
  length, so presses can drive HA automations as well as (or instead of)
  server-side Actions.

The device sends only raw presses; which Action a button runs is decided
here, the same "dumb client" split as everywhere else.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import deque
from pathlib import Path
from typing import Literal

import aiomqtt
import yaml
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from app.mqtt import CONNECT_TIMEOUT_SECONDS
from app.settings import settings

logger = logging.getLogger(__name__)

NUM_BUTTONS = 8
PressKind = Literal["short", "long"]


# ---- Config --------------------------------------------------------------

class DimmerConfig(BaseModel):
    """Room light → screen brightness. Mirrors the firmware's DimmerSettings
    (bedside-dashboard-esp32 include/dimmer.h), including its ranges — the
    device clamps too, but rejecting here means the page says why."""

    bright_lux: float = Field(20.0, ge=0, le=65000)
    """At or above this, the screen is at full brightness."""
    dark_lux: float = Field(2.0, ge=0, le=65000)
    """Below this the screen turns off until a control is touched."""
    dim_contrast: int = Field(1, ge=0, le=255)
    """Brightness between the two thresholds, and when woken in the dark."""
    wake_seconds: int = Field(15, ge=3, le=600)
    """How long a touch keeps the screen on in the dark."""

    @model_validator(mode="after")
    def _dark_below_bright(self) -> "DimmerConfig":
        if self.dark_lux > self.bright_lux:
            raise ValueError("dark_lux must not be above bright_lux")
        return self


class ButtonBinding(BaseModel):
    """The Action ids a button runs. None = the press does nothing here
    (it's still recorded, and still reaches Home Assistant)."""

    short: str | None = None
    long: str | None = None


class DeviceConfig(BaseModel):
    dimmer: DimmerConfig = Field(default_factory=DimmerConfig)
    buttons: dict[int, ButtonBinding] = Field(default_factory=dict)

    @field_validator("buttons")
    @classmethod
    def _check_buttons(cls, value: dict[int, ButtonBinding]) -> dict[int, ButtonBinding]:
        for number in value:
            if not 1 <= number <= NUM_BUTTONS:
                raise ValueError(f"buttons are numbered 1-{NUM_BUTTONS}, not {number}")
        # Unbound buttons are left out of the file rather than saved as nulls.
        return {n: b for n, b in sorted(value.items()) if b.short or b.long}

    def binding(self, button: int, press: PressKind) -> str | None:
        entry = self.buttons.get(button)
        return getattr(entry, press) if entry else None


def load_device_config(config_path: str) -> DeviceConfig:
    """Read device.yaml. Missing file = defaults. A broken file also falls
    back to defaults (logged), so a bad hand-edit can't stop the service —
    the dimmer's defaults are safe ones."""
    path = Path(config_path)
    if not path.exists():
        return DeviceConfig()
    try:
        return DeviceConfig.model_validate(yaml.safe_load(path.read_text()) or {})
    except (yaml.YAMLError, ValidationError) as exc:
        logger.error("%s is invalid, using default device settings until it's fixed: %s",
                     config_path, exc)
        return DeviceConfig()


def save_device_config(config_path: str, config: DeviceConfig) -> None:
    path = Path(config_path)
    data = config.model_dump(mode="json", exclude_none=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(yaml.safe_dump(data, sort_keys=False))
    os.replace(tmp, path)


def device_config_payload(config: DeviceConfig) -> str:
    """What the device gets on `bedside/config`: only the dimmer. Button
    bindings never leave the server."""
    return json.dumps({"dimmer": config.dimmer.model_dump()})


# ---- State -----------------------------------------------------------------

class SensorReading(BaseModel):
    """One `bedside/sensors` message. None = that sensor has no reading."""

    temperature_c: float | None = None
    humidity: float | None = None
    lux: float | None = None
    screen: Literal["off", "dim", "full"] | None = None


class ButtonPressMessage(BaseModel):
    """One `bedside/button` message."""

    button: int = Field(ge=1, le=NUM_BUTTONS)
    press: PressKind


class ButtonPress(BaseModel):
    """A press as shown on the Device page."""

    button: int
    press: PressKind
    at: float
    action: str | None = None
    ok: bool | None = None
    text: str | None = None
    """The action's outcome ("Done", "Failed"...), None while it runs or
    when nothing is bound."""


#: How many recent presses the Device page shows.
RECENT_PRESSES = 20


class DeviceState:
    def __init__(self) -> None:
        self.sensors: SensorReading | None = None
        self.sensors_at: float | None = None
        self.online: bool | None = None
        """None until the broker has told us either way."""
        self.presses: deque[ButtonPress] = deque(maxlen=RECENT_PRESSES)
        self.link_connected = False

    def sensors_age(self, now: float | None = None) -> float | None:
        if self.sensors_at is None:
            return None
        return (now if now is not None else time.time()) - self.sensors_at


#: The one device this service talks to. Module-level (not app.state) so the
#: bedside_device adapter, which is built from adapters.yaml and never sees
#: the app, can read it too.
device_state = DeviceState()


# ---- Home Assistant discovery -------------------------------------------------

HA_DEVICE = {
    "identifiers": ["bedside_dashboard"],
    "name": "Bedside Dashboard",
    "manufacturer": "DIY",
    "model": "ESP32 + SSD1306",
}

_HA_SENSORS = [
    # (key in bedside/sensors, name, device_class, unit)
    ("temperature_c", "Temperature", "temperature", "°C"),
    ("humidity", "Humidity", "humidity", "%"),
    ("lux", "Illuminance", "illuminance", "lx"),
]


def ha_discovery_messages(prefix: str) -> list[tuple[str, str]]:
    """(topic, payload) pairs, published retained. Sensors read straight
    from the device's own topics — the server isn't in that path, so they
    keep working while it restarts. A null reading renders as "None",
    which HA's MQTT sensor treats as unknown."""
    messages: list[tuple[str, str]] = []
    for key, name, device_class, unit in _HA_SENSORS:
        messages.append((f"{prefix}/sensor/bedside_dashboard/{key}/config", json.dumps({
            "name": name,
            "unique_id": f"bedside_dashboard_{key}",
            "state_topic": settings.mqtt_sensors_topic,
            "value_template": f"{{{{ value_json.{key} }}}}",
            "device_class": device_class,
            "unit_of_measurement": unit,
            "state_class": "measurement",
            "availability_topic": settings.mqtt_availability_topic,
            "device": HA_DEVICE,
        })))
    # Device triggers match the payload exactly, so these must be
    # byte-for-byte what the firmware sends (main.cpp publishButton).
    for button in range(1, NUM_BUTTONS + 1):
        for press in ("short", "long"):
            messages.append((
                f"{prefix}/device_automation/bedside_dashboard/button_{button}_{press}/config",
                json.dumps({
                    "automation_type": "trigger",
                    "topic": settings.mqtt_button_topic,
                    "payload": f'{{"button":{button},"press":"{press}"}}',
                    "type": f"button_{press}_press",
                    "subtype": f"button_{button}",
                    "device": HA_DEVICE,
                })))
    return messages


# ---- MQTT ---------------------------------------------------------------------

#: Seconds between reconnect attempts while the broker is unreachable.
LINK_RETRY_SECONDS = 5.0


class MqttDeviceLink:
    """Subscribes to what the device reports, publishes what it's told.
    Reconnects on its own — aiomqtt never does (see app/mqtt.py)."""

    def __init__(self, state: DeviceState, runner, config_path: str) -> None:
        self.state = state
        self.runner = runner  # app.actions.ActionRunner
        self.config_path = config_path
        self._client: aiomqtt.Client | None = None
        self._tasks: set[asyncio.Task] = set()

    async def run_forever(self) -> None:
        last_error: str | None = None
        while True:
            try:
                async with aiomqtt.Client(
                    hostname=settings.mqtt_host, port=settings.mqtt_port,
                    username=settings.mqtt_username, password=settings.mqtt_password,
                    timeout=CONNECT_TIMEOUT_SECONDS,
                ) as client:
                    self._client = client
                    self.state.link_connected = True
                    last_error = None
                    for topic in (settings.mqtt_sensors_topic, settings.mqtt_availability_topic,
                                  settings.mqtt_button_topic):
                        await client.subscribe(topic, qos=1)
                    await self.publish_config()
                    await self._publish_discovery(client)
                    logger.info("device link up")
                    async for message in client.messages:
                        self._spawn(self.handle(str(message.topic), message.payload))
            except aiomqtt.MqttError as exc:
                # Once per outage (or change of error), not every retry —
                # like app/mqtt.py.
                if str(exc) != last_error:
                    logger.warning("device link lost the broker (%s), retrying every %ss",
                                   exc, LINK_RETRY_SECONDS)
                last_error = str(exc)
            finally:
                self._client = None
                self.state.link_connected = False
            await asyncio.sleep(LINK_RETRY_SECONDS)

    def _spawn(self, coro) -> None:
        # One task per message, so a slow Action never delays the next one.
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def publish_config(self) -> bool:
        """Send the current dimmer settings, retained. False when not
        connected — the next connect sends them anyway."""
        client = self._client
        if client is None:
            return False
        payload = device_config_payload(load_device_config(self.config_path))
        try:
            await client.publish(settings.mqtt_device_config_topic, payload, qos=1, retain=True)
        except aiomqtt.MqttError as exc:
            logger.warning("couldn't publish device config: %s", exc)
            return False
        return True

    async def _publish_discovery(self, client: aiomqtt.Client) -> None:
        prefix = settings.ha_discovery_prefix.strip().rstrip("/")
        if not prefix:
            return
        for topic, payload in ha_discovery_messages(prefix):
            await client.publish(topic, payload, qos=1, retain=True)

    async def handle(self, topic: str, payload: object) -> None:
        """One message from the device. Malformed ones are logged and
        dropped — a device bug should never take the link down."""
        raw = payload.decode() if isinstance(payload, (bytes, bytearray)) else str(payload)
        if topic == settings.mqtt_availability_topic:
            self.state.online = raw.strip() == "online"
        elif topic == settings.mqtt_sensors_topic:
            try:
                self.state.sensors = SensorReading.model_validate_json(raw)
            except ValidationError as exc:
                logger.warning("ignoring a malformed sensor reading: %s", exc)
                return
            self.state.sensors_at = time.time()
        elif topic == settings.mqtt_button_topic:
            try:
                message = ButtonPressMessage.model_validate_json(raw)
            except ValidationError as exc:
                logger.warning("ignoring a malformed button press: %s", exc)
                return
            await self._on_press(message)

    async def _on_press(self, message: ButtonPressMessage) -> None:
        action_id = load_device_config(self.config_path).binding(message.button, message.press)
        press = ButtonPress(button=message.button, press=message.press, at=time.time(),
                            action=action_id)
        self.state.presses.appendleft(press)
        if action_id is None:
            logger.info("button %d %s press: nothing bound", message.button, message.press)
            return
        outcome = await self.runner.run(action_id, source=f"button {message.button}")
        press.ok = outcome.ok
        press.text = outcome.text
