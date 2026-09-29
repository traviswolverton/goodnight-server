"""Read-only summaries for the Home page and the MQTT reference page. Open to
any signed-in user, so nothing sensitive goes in here: hosts, usernames and
credentials stay behind the admin-only /api/connections."""
from __future__ import annotations

import time

from fastapi import APIRouter, Request

from app.settings import settings

router = APIRouter()

#: Roughly process start (this module is imported at app startup).
STARTED_AT = time.time()


@router.get("/overview")
async def overview(request: Request) -> dict[str, object]:
    """Health at a glance: whether Home Assistant, the broker and the
    database are working."""
    device_link = getattr(request.app.state, "device_link", None)
    database = getattr(request.app.state, "database", None)
    return {
        "version": settings.app_version,
        "uptime_seconds": int(time.time() - STARTED_AT),
        "home_assistant": await request.app.state.home_assistant.status(),
        "mqtt_connected": bool(device_link and device_link.state.link_connected),
        "database_available": bool(database and database.available),
    }


@router.get("/mqtt-reference")
async def mqtt_reference() -> dict[str, object]:
    """The topics between this server and the device, from the same
    settings the code uses, so the page can't drift from the real ones.
    DESIGN.md has the full story of each."""
    return {
        "topics": [
            {"topic": settings.mqtt_device_config_topic, "direction": "server → device", "retained": True,
             "about": "The screen dimmer and buzzer settings (Device page).",
             "example": {"dimmer": {"bright_lux": 20, "dark_lux": 2, "dim_contrast": 1, "wake_seconds": 15},
                         "sounds": {"enabled": True, "volume": 80, "dark_volume": 10}}},
            {"topic": settings.mqtt_sound_topic, "direction": "server → device", "retained": False,
             "about": "A sound to play now: armed, running, success, failure or cancel. Urgent ones "
                      "(failures) play at full volume even in the dark.",
             "example": {"sound": "armed", "urgent": False}},
            {"topic": settings.mqtt_sensors_topic, "direction": "device → server", "retained": True,
             "about": "Room readings and the screen level, every 30 s. null for a sensor with no reading.",
             "example": {"temperature_c": 21.5, "humidity": 44, "lux": 3.5, "screen": "off"}},
            {"topic": settings.mqtt_button_topic, "direction": "device → server", "retained": False,
             "about": "A button press. What it does is decided here (Buttons page).",
             "example": {"button": 3, "press": "long"}},
            {"topic": settings.mqtt_availability_topic, "direction": "device → server", "retained": True,
             "about": "online, or offline (the device's last will).",
             "example": "online"},
        ],
    }
