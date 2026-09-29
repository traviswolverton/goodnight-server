"""Read-only summaries for the Home page and the MQTT reference page. Open to
any signed-in user, so nothing sensitive goes in here: adapter hosts,
usernames and credentials stay behind the admin-only /api/adapters."""
from __future__ import annotations

import time

from fastapi import APIRouter, Request

from app.api.deps import status_reason
from app.settings import settings

router = APIRouter()

#: Roughly process start (this module is imported at app startup).
STARTED_AT = time.time()


@router.get("/overview")
async def overview(request: Request) -> dict[str, object]:
    """Health at a glance: per-adapter status, and whether polling, the
    broker and the database are working."""
    agg = request.app.state.aggregator
    device_link = getattr(request.app.state, "device_link", None)
    database = getattr(request.app.state, "database", None)

    adapters = []
    for adapter in sorted(agg.adapters, key=lambda a: a.name.lower()):
        result = agg.latest_results.get(adapter.name)
        adapters.append({
            "name": adapter.name,
            "type": adapter.type_name,
            "status": result.status if result else "unknown",
            "detail": result.detail if result else None,
            # Why it's warn/down, when the adapter spells it out (the Home
            # page shows it on the status pill). Never the raw fetch
            # error: that can name internal hosts, and this page is open
            # to viewers — the app log has it.
            "reason": status_reason(result),
        })

    return {
        "last_poll_ts": agg.last_poll_ts,
        "poll_interval_seconds": settings.poll_interval_seconds,
        "version": settings.app_version,
        "uptime_seconds": int(time.time() - STARTED_AT),
        "mqtt_connected": bool(device_link and device_link.state.link_connected),
        "database_available": bool(database and database.available),
        "adapters": adapters,
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
