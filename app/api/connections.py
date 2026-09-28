"""The Connections page: which MQTT broker and Postgres database this app
uses (app/connections.py). Admins only.

Each change is a small flow, like Home Assistant's: the form's values are
tested first (POST .../test, which saves nothing), the page shows what
was found, and the save (PUT) runs the same test again server-side and
refuses anything that didn't pass — so a save can't point the app at a
broker it can't reach, or a database nobody could sign in to. A save
then restarts the app, which is when the new connection takes over.

Passwords go to the encrypted secret store and are never returned. A
blank password in a form means "keep the one in use now"."""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.api.system import _schedule_restart
from app.connections import (
    ConnectionConfigError,
    DatabaseConnection,
    check_mqtt,
    copy_database,
    database_from_form,
    inspect_database,
    mqtt_from_form,
    save_database,
    save_mqtt,
)
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
    publisher = getattr(request.app.state, "publisher", None)
    database = getattr(request.app.state, "database", None)
    current = _current_database()
    return {
        "mqtt": {
            "source": sources["mqtt"],
            "host": settings.mqtt_host, "port": settings.mqtt_port,
            "username": settings.mqtt_username, "password_set": bool(settings.mqtt_password),
            "connected": bool(publisher and publisher.connected),
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
        "can_save": bool(settings.secrets_master_key),
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
