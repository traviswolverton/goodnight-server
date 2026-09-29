"""The bedside device (app/device.py): what it last reported, and its
settings — dimmer thresholds, buzzer and button bindings. The web UI's
Device page.
Reads are open to any signed-in user; saving is admin-only and audited,
via the router's dependencies in app/api/__init__.py."""
from __future__ import annotations

from typing import get_args

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from app.actions import load_actions
from app.device import (
    CONFIRM_SECONDS,
    NUM_BUTTONS,
    DeviceConfig,
    SoundName,
    device_state,
    load_device_config,
    save_device_config,
)
from app.settings import settings

router = APIRouter()


@router.get("/device")
async def get_device() -> dict[str, object]:
    state = device_state
    return {
        "online": state.online,
        "link_connected": state.link_connected,
        "sensors": state.sensors.model_dump() if state.sensors else None,
        "sensors_age_seconds": state.sensors_age(),
        "presses": [p.model_dump() for p in state.presses],
        "config": load_device_config(settings.device_config_path).model_dump(mode="json"),
        # For the binding pickers.
        "actions": [{"id": a.id, "label": a.label}
                    for a in load_actions(settings.actions_config_path)],
        "num_buttons": NUM_BUTTONS,
        "confirm_seconds": CONFIRM_SECONDS,
        "sounds": list(get_args(SoundName)),
        "ha_discovery": bool(settings.ha_discovery_prefix.strip()),
    }


@router.put("/device/config")
async def save_config(request: Request, body: dict) -> dict[str, object]:
    try:
        config = DeviceConfig.model_validate(body)
    except ValidationError as exc:
        first = exc.errors()[0]
        field = ".".join(str(p) for p in first["loc"]) or "config"
        raise HTTPException(status_code=400,
                            detail=f"{field}: {first['msg'].removeprefix('Value error, ')}")
    known = {a.id for a in load_actions(settings.actions_config_path)}
    for number, binding in config.buttons.items():
        for press in ("short", "long"):
            action_id = getattr(binding, press)
            if action_id and action_id not in known:
                raise HTTPException(status_code=400,
                                    detail=f"button {number} {press}: no action named '{action_id}'")
    save_device_config(settings.device_config_path, config)
    sent = await request.app.state.device_link.publish_config()
    return {"saved": True, "sent_to_device": sent, "config": config.model_dump(mode="json")}


@router.post("/device/sound")
async def play_sound(request: Request, body: dict) -> dict[str, object]:
    """Play one of the buzzer's sounds now — the Device page's test buttons."""
    sound = body.get("sound")
    if sound not in get_args(SoundName):
        raise HTTPException(status_code=400, detail=f"no sound named {sound!r}")
    if not await request.app.state.device_link.publish_sound(sound):
        raise HTTPException(status_code=503, detail="couldn't reach the broker, so the device didn't get it")
    return {"sent": True}
