"""Read-only summaries for the Home page and the MQTT reference page. Open to
any signed-in user, so nothing sensitive goes in here: adapter hosts,
usernames and credentials stay behind the admin-only /api/adapters."""
from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi import APIRouter, Request

from app import actions as actions_module
from app import aggregator as aggregator_module
from app.models import CameraAlert
from app.api.deps import status_reason
from app.settings import settings

router = APIRouter()

#: Roughly process start (this module is imported at app startup).
STARTED_AT = time.time()

SCHEMA_DIR = Path(__file__).resolve().parent.parent.parent / "schema"

# Illustrative only — camera alerts are one-shot events (see
# app/adapters/frigate.py), so unlike bedside/status there's no retained
# real example to pull from app.state.
CAMERA_ALERT_EXAMPLE = CameraAlert(
    camera="front_door",
    ts=1737000000,
    snapshot_url="http://<host>/snapshot/front_door?event=<id>&exp=<unix>&sig=<sig>",
    label="person",
    text="Front Door: person detected",
).model_dump(mode="json")


@router.get("/overview")
async def overview(request: Request) -> dict[str, object]:
    """Health at a glance: the display's overall state, per-adapter status,
    and whether polling/MQTT/the database are working."""
    agg = request.app.state.aggregator
    payload = agg.latest_payload
    publisher = getattr(agg, "publisher", None)
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
        "overall": payload.overall.model_dump() if payload else None,
        "last_poll_ts": payload.ts if payload else None,
        "last_published_ts": getattr(agg, "last_published_at", None),
        "poll_interval_seconds": settings.poll_interval_seconds,
        "heartbeat_interval_seconds": settings.heartbeat_interval_seconds,
        "version": settings.app_version,
        "uptime_seconds": int(time.time() - STARTED_AT),
        "mqtt_connected": bool(getattr(publisher, "connected", False)),
        "database_available": bool(database and database.available),
        "adapters": adapters,
    }


@router.get("/mqtt-reference")
async def mqtt_reference(request: Request) -> dict[str, object]:
    """Everything the MQTT reference page shows, built from the live schema
    files and the same constants the aggregator enforces — so the page can't
    drift from the real contract the way hand-written docs would."""
    latest = request.app.state.aggregator.latest_payload
    return {
        "status_topic": settings.mqtt_status_topic,
        "camera_topic": settings.mqtt_camera_alert_topic,
        "heartbeat_interval_seconds": settings.heartbeat_interval_seconds,
        "status_schema_url": "/schema/status_payload.schema.json",
        "camera_schema_url": "/schema/camera_alert.schema.json",
        "status_schema": json.loads((SCHEMA_DIR / "status_payload.schema.json").read_text()),
        "camera_schema": json.loads((SCHEMA_DIR / "camera_alert.schema.json").read_text()),
        "status_example": latest.model_dump(mode="json") if latest else None,
        "camera_example": CAMERA_ALERT_EXAMPLE,
        "action_topic": settings.mqtt_action_topic,
        "action_result_topic": settings.mqtt_action_result_topic,
        "action_schema_url": "/schema/action_request.schema.json",
        "action_result_schema_url": "/schema/action_result.schema.json",
        "action_example": {"id": "desk_lamp", "req": 17},
        "action_result_example": {"id": "desk_lamp", "req": 17, "ok": True, "text": "Done"},
        "limits": {
            "title_max_chars": aggregator_module.CLIENT_NAME_MAX_CHARS,
            "line_max_chars": list(aggregator_module.CLIENT_LINE_MAX_CHARS),
            "overall_text_max_chars": aggregator_module.CLIENT_OVERALL_TEXT_MAX_CHARS,
            "max_services": aggregator_module.CLIENT_MAX_SERVICES,
            "max_actions": actions_module.MAX_ACTIONS,
            "action_label_max_chars": actions_module.LABEL_MAX,
            "action_state_max_chars": actions_module.STATE_MAX,
        },
    }
