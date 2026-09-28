"""HTTP routes. This service is mostly a background MQTT publisher (see
app/aggregator.py) — these endpoints exist for debugging, health checks,
the display's broker settings, and the Frigate snapshot proxy. (The human-facing MQTT reference is served as
JSON by app/api/overview.py and rendered by the React app.)"""
from __future__ import annotations

import io
import logging
import re
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from PIL import Image

from app.auth.deps import client_ip, device_access, snapshot_access
from app.connections import load_display
from app.settings import settings

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/healthz")
async def healthz() -> dict[str, bool]:
    return {"ok": True}


@router.get("/device/config", dependencies=[Depends(device_access)])
async def device_config(request: Request, response: Response) -> dict[str, object]:
    """The broker the desk display should connect to, and its login
    (Connections page -> Display; app/connections.py). The display asks
    at boot, every so often, and after repeated MQTT failures, and keeps
    the answer in its flash — so changing broker needs no reflash.

    Plain HTTP on the LAN, like the MQTT connection itself, which carries
    this same password in the clear."""
    request.app.state.device_last_seen = {"ts": time.time(), "ip": client_ip(request)}
    response.headers["Cache-Control"] = "no-store"
    display = load_display(settings)
    if display.broker is None:
        raise HTTPException(status_code=503, detail="no broker account is set for the display")
    broker = display.broker
    return {"mqtt_host": broker.host, "mqtt_port": broker.port,
            "mqtt_username": broker.username or "", "mqtt_password": broker.password or ""}


_SAFE_ID = re.compile(r"^[A-Za-z0-9_.\-]+$")


def _frigate_base_url(request: Request) -> str | None:
    """The configured Frigate adapter's URL (Adapters tab)."""
    aggregator = getattr(request.app.state, "aggregator", None)
    for adapter in getattr(aggregator, "adapters", []):
        if adapter.type_name == "frigate":
            return adapter.base_url
    return None


@router.get("/snapshot/{camera}", dependencies=[Depends(snapshot_access)])
async def get_snapshot(camera: str, request: Request, event: str | None = None,
                       exp: str | None = None, sig: str | None = None) -> Response:
    """Proxies a Frigate snapshot, scaled to fit the client display's
    resolution (aspect ratio kept, letterboxed on black) so the ESP32
    only has to decode, never resize. With `?event=<id>` it's that
    detection's own snapshot (with the bounding box) — what a camera
    alert links to; without, the camera's latest frame.

    Access: a valid signed link (`exp`+`sig`, what camera alerts carry —
    see app/signing.py) or a logged-in session; enforced by the
    snapshot_access dependency.

    TODO: this is a synchronous-per-request proxy sized for "user taps to
    view a camera" or the alert-jump flow — it is not meant to be polled.
    """
    for value in (camera, event):
        if value is not None and (not _SAFE_ID.match(value) or ".." in value):
            raise HTTPException(status_code=400, detail="invalid camera or event id")

    base_url = _frigate_base_url(request)
    if not base_url:
        raise HTTPException(status_code=503, detail="no Frigate adapter configured")

    client: httpx.AsyncClient = request.app.state.http_client
    url = (f"{base_url}/api/events/{event}/snapshot.jpg?bbox=1" if event
           else f"{base_url}/api/{camera}/latest.jpg")

    try:
        resp = await client.get(url, timeout=10.0)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("frigate snapshot fetch failed for %r: %s", camera, exc)
        raise HTTPException(status_code=502, detail="failed to fetch snapshot from Frigate") from exc

    size = (settings.snapshot_width, settings.snapshot_height)
    image = Image.open(io.BytesIO(resp.content)).convert("RGB")
    image.thumbnail(size)
    canvas = Image.new("RGB", size, "black")
    canvas.paste(image, ((size[0] - image.width) // 2, (size[1] - image.height) // 2))

    buf = io.BytesIO()
    canvas.save(buf, format="JPEG", quality=85)
    return Response(content=buf.getvalue(), media_type="image/jpeg")
