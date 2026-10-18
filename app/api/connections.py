"""The Connections section of the Settings page: which MQTT broker, Postgres database and Home
Assistant this app uses (app/connections.py). Admins only.

Each change is a small flow, like Home Assistant's: the form's values are
tested first (POST .../test, which saves nothing), the page shows what
was found, and the save (PUT) runs the same test again server-side and
refuses anything that didn't pass — so a save can't point the app at a
broker it can't reach, or a database nobody could sign in to. A save
then restarts the app, which is when the new connection takes over.

Passwords go to the encrypted secret store and are never returned. A
blank password in a form means "keep the one in use now".

The Display section is the broker the bedside device is handed by GET
/device/config. Saving it needs no restart (that endpoint reads the file
each time); the device picks it up at its next check-in.

Home Assistant needs no restart either: a save swaps the client in place.
Its entity and service lists for the Actions editor's pickers are here
too (GET /home-assistant/catalog)."""
from __future__ import annotations

import asyncio
import logging
from typing import Literal

import httpx

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.api.system import _schedule_restart
from app.connections import (
    ConnectionConfigError,
    DatabaseConnection,
    check_mqtt,
    copy_database,
    database_from_form,
    home_assistant_from_form,
    inspect_database,
    load_display,
    load_home_assistant,
    mqtt_from_form,
    new_device_token,
    save_database,
    save_display_broker,
    save_home_assistant,
    save_mqtt,
)
from app.home_assistant import HomeAssistant
from app.secret_store import SecretError
from app.settings import settings

logger = logging.getLogger(__name__)
router = APIRouter()


class ConnectionForm(BaseModel):
    fields: dict[str, str | int | None]


class DatabaseSaveForm(ConnectionForm):
    mode: Literal["use", "copy", "fresh"]


def _sources(request: Request) -> dict[str, str]:
    return getattr(request.app.state, "connection_sources", None) or {"mqtt": "env", "database": "env"}


def _current_database() -> DatabaseConnection | None:
    return DatabaseConnection.from_url(settings.database_url)


def _bootstrap_admin_configured() -> bool:
    return bool(settings.admin_username and settings.admin_password)


def _require_master_key() -> None:
    if not settings.secrets_master_key:
        raise HTTPException(status_code=400, detail=(
            "SECRETS_MASTER_KEY isn't set in .env, so there's nowhere safe to keep the password"))


@router.get("/connections")
async def get_connections(request: Request) -> dict[str, object]:
    sources = _sources(request)
    device_link = getattr(request.app.state, "device_link", None)
    database = getattr(request.app.state, "database", None)
    current = _current_database()
    return {
        "mqtt": {
            "source": sources["mqtt"],
            "host": settings.mqtt_host, "port": settings.mqtt_port,
            "username": settings.mqtt_username, "password_set": bool(settings.mqtt_password),
            "connected": bool(device_link and device_link.state.link_connected),
        },
        "database": {
            "source": sources["database"],
            "configured": current is not None,
            "host": current.host if current else None,
            "port": current.port if current else None,
            "database": current.database if current else None,
            "username": current.username if current else None,
            "password_set": bool(current and current.password),
            "available": bool(database and database.available),
        },
        "display": _display_summary(request),
        "home_assistant": await _home_assistant_summary(request),
        "can_save": bool(settings.secrets_master_key),
    }


def _display_summary(request: Request) -> dict[str, object]:
    display = load_display(settings)
    broker = display.broker
    return {
        "source": display.source,
        "host": broker.host if broker else None,
        "port": broker.port if broker else None,
        "username": broker.username if broker else None,
        "password_set": bool(broker and broker.password),
        "token_set": display.token_set,
        "last_seen": getattr(request.app.state, "device_last_seen", None),
    }


async def _home_assistant_summary(request: Request) -> dict[str, object]:
    conn = load_home_assistant(settings)
    return {
        "url": conn.url if conn else None,
        "verify_ssl": conn.verify_ssl if conn else True,
        "token_set": bool(conn and conn.token),
        "status": await request.app.state.home_assistant.status(),
    }


# --- MQTT -------------------------------------------------------------------

def _mqtt_form(body: ConnectionForm):
    try:
        return mqtt_from_form(body.fields, settings.mqtt_password)
    except ConnectionConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/connections/mqtt/test")
async def test_mqtt(body: ConnectionForm) -> dict[str, object]:
    return await check_mqtt(_mqtt_form(body))


@router.put("/connections/mqtt")
async def save_mqtt_connection(body: ConnectionForm) -> dict[str, object]:
    conn = _mqtt_form(body)
    if conn.password:
        _require_master_key()
    result = await check_mqtt(conn)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=f"Not saved: the broker test failed ({result['error']})")
    try:
        save_mqtt(settings.connections_config_path, settings.secrets_config_path, conn)
    except (SecretError, ConnectionConfigError) as exc:
        raise HTTPException(status_code=500, detail=f"Couldn't save the connection: {exc}")
    logger.warning("MQTT connection changed to %s:%s via the admin API; restarting", conn.host, conn.port)
    _schedule_restart()
    return {"saved": True, "restarting": True}


# --- Database ---------------------------------------------------------------

def _database_form(body: ConnectionForm) -> DatabaseConnection:
    current = _current_database()
    try:
        return database_from_form(body.fields, current.password if current else None)
    except ConnectionConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/connections/database/test")
async def test_database(body: ConnectionForm) -> dict[str, object]:
    report = await inspect_database(_database_form(body), _current_database(), _bootstrap_admin_configured())
    return report.as_dict()


@router.put("/connections/database")
async def save_database_connection(request: Request, body: DatabaseSaveForm) -> dict[str, object]:
    conn = _database_form(body)
    _require_master_key()
    report = await inspect_database(conn, _current_database(), _bootstrap_admin_configured())
    if body.mode not in report.modes:
        why = "; ".join(report.problems) or f"it can't be saved with the '{body.mode}' option (test it again)"
        raise HTTPException(status_code=400, detail=f"Not saved: {why}")

    copied: dict[str, int] = {}
    if body.mode == "copy":
        try:
            async with request.app.state.database.session() as source:
                copied = await copy_database(source, conn)
        except ConnectionConfigError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        except Exception as exc:  # noqa: BLE001 - reported, nothing saved
            logger.exception("copying to the new database failed")
            raise HTTPException(status_code=500, detail=(
                f"Copying to the new database failed, so nothing was saved: {type(exc).__name__}"))

    try:
        save_database(settings.connections_config_path, settings.secrets_config_path, conn)
    except (SecretError, ConnectionConfigError) as exc:
        raise HTTPException(status_code=500, detail=f"Couldn't save the connection: {exc}")
    logger.warning("database changed to %s:%s/%s via the admin API (%s, copied %s); restarting",
                   conn.host, conn.port, conn.database, body.mode, copied or "nothing")
    _schedule_restart()
    return {"saved": True, "restarting": True, "copied": copied}


# --- Display (the bedside ESP32) ---------------------------------------------

#: The device's fixed-size buffers for what /device/config returns
#: (goodnight-device include/device_config.h), minus the terminator.
DISPLAY_LIMITS = {"host": 63, "username": 47, "password": 95}


def _display_form(body: ConnectionForm):
    current = load_display(settings).broker
    try:
        conn = mqtt_from_form(body.fields, current.password if current else None)
    except ConnectionConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not conn.username or not conn.password:
        raise HTTPException(status_code=400, detail="The device needs a username and password")
    for name, limit in DISPLAY_LIMITS.items():
        if len(getattr(conn, name) or "") > limit:
            raise HTTPException(status_code=400, detail=f"The device can't hold a {name} over {limit} characters")
    return conn


@router.post("/connections/display/test")
async def test_display(body: ConnectionForm) -> dict[str, object]:
    return await check_mqtt(_display_form(body))


@router.put("/connections/display")
async def save_display(body: ConnectionForm) -> dict[str, object]:
    conn = _display_form(body)
    _require_master_key()
    result = await check_mqtt(conn)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=f"Not saved: the broker test failed ({result['error']})")
    try:
        save_display_broker(settings.connections_config_path, settings.secrets_config_path, conn)
    except (SecretError, ConnectionConfigError) as exc:
        raise HTTPException(status_code=500, detail=f"Couldn't save the connection: {exc}")
    logger.warning("display broker changed to %s:%s via the admin API", conn.host, conn.port)
    return {"saved": True}


@router.post("/connections/display/token")
async def make_device_token() -> dict[str, object]:
    """A new device token, shown this once (only its hash is kept). The
    old one stops working at once; the device keeps its cached broker
    settings until it's reflashed with the new one."""
    try:
        token = new_device_token(settings.connections_config_path)
    except ConnectionConfigError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    logger.warning("new display device token issued via the admin API")
    return {"token": token}


# --- Home Assistant ------------------------------------------------------------

def _home_assistant_form(body: ConnectionForm):
    current = load_home_assistant(settings)
    try:
        return home_assistant_from_form(body.fields, current.token if current else None)
    except ConnectionConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _redact(message: str, secret: str | None) -> str:
    if secret and len(secret) >= 4:
        message = message.replace(secret, "***")
    return message.splitlines()[0][:300] if message else message


async def _check_home_assistant(conn) -> dict[str, object]:
    ha = HomeAssistant(conn.url, conn.token or "", conn.verify_ssl)
    try:
        async with httpx.AsyncClient() as client:
            found = await asyncio.wait_for(ha.check(client), timeout=20)
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        error = ("Home Assistant refused the token (401): make a new long-lived access token"
                 if code == 401 else f"Home Assistant answered {code}")
        return {"ok": False, "error": error}
    except Exception as exc:  # noqa: BLE001 - any failure is the answer to "does it connect?"
        if isinstance(exc, (TimeoutError, httpx.TimeoutException)):
            return {"ok": False, "error": f"No answer from {conn.url}"}
        return {"ok": False, "error": _redact(str(exc) or type(exc).__name__, conn.token)}
    finally:
        await ha.aclose()
    return {"ok": True, "error": None, **found}


@router.post("/connections/home-assistant/test")
async def test_home_assistant(body: ConnectionForm) -> dict[str, object]:
    return await _check_home_assistant(_home_assistant_form(body))


@router.put("/connections/home-assistant")
async def save_home_assistant_connection(request: Request, body: ConnectionForm) -> dict[str, object]:
    conn = _home_assistant_form(body)
    _require_master_key()
    result = await _check_home_assistant(conn)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=f"Not saved: the test failed ({result['error']})")
    try:
        save_home_assistant(settings.connections_config_path, settings.secrets_config_path, conn)
    except (SecretError, ConnectionConfigError) as exc:
        raise HTTPException(status_code=500, detail=f"Couldn't save the connection: {exc}")
    await request.app.state.home_assistant.replace(HomeAssistant(conn.url, conn.token or "", conn.verify_ssl))
    logger.warning("Home Assistant changed to %s via the admin API", conn.url)
    return {"saved": True}


@router.get("/home-assistant/catalog")
async def home_assistant_catalog(request: Request) -> dict[str, object]:
    """Every entity and service: the Actions editor's pickers."""
    link = request.app.state.home_assistant
    if link.ha is None:
        raise HTTPException(status_code=409, detail="Home Assistant isn't set up (Settings page)")
    try:
        return await asyncio.wait_for(link.ha.catalog(link.client), timeout=20)
    except Exception as exc:  # noqa: BLE001 - reported to the page
        raise HTTPException(status_code=502, detail=f"couldn't read Home Assistant: {type(exc).__name__}")
