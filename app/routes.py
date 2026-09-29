"""HTTP routes outside the web UI's /api: the health check, and the
bedside device's broker settings."""
from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.auth.deps import client_ip, device_access
from app.connections import load_display
from app.settings import settings

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/healthz")
async def healthz() -> dict[str, bool]:
    return {"ok": True}


@router.get("/device/config", dependencies=[Depends(device_access)])
async def device_config(request: Request, response: Response) -> dict[str, object]:
    """The broker the bedside device should connect to, and its login
    (Connections page -> Bedside device; app/connections.py). The device asks
    at boot, every so often, and after repeated MQTT failures, and keeps
    the answer in its flash — so changing broker needs no reflash.

    Plain HTTP on the LAN, like the MQTT connection itself, which carries
    this same password in the clear."""
    request.app.state.device_last_seen = {"ts": time.time(), "ip": client_ip(request)}
    response.headers["Cache-Control"] = "no-store"
    display = load_display(settings)
    if display.broker is None:
        raise HTTPException(status_code=503, detail="no broker account is set for the device")
    broker = display.broker
    return {"mqtt_host": broker.host, "mqtt_port": broker.port,
            "mqtt_username": broker.username or "", "mqtt_password": broker.password or ""}
