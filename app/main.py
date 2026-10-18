"""FastAPI entrypoint. Owns the app lifecycle: on startup, load config,
connect to Home Assistant and start the device's MQTT link as a
background task; on shutdown, stop it cleanly.

Run a single worker/process — the device link is in-process state, so
multiple workers would each handle every button press. See DESIGN.md
deployment notes.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from app.actions import ActionRunner
from app.api import router as api_router
from app.app_settings import SavedSettings
from app.connections import apply_saved_connections, load_home_assistant
from app.db import Database
from app.device import MqttDeviceLink, device_state
from app.home_assistant import HomeAssistant, HomeAssistantLink
from app.auth.bootstrap import bootstrap_admin
from app.auth.retention import prune_audit_log
from app.routes import router
from app.spa import router as spa_router
from app.security_headers import SecurityHeadersMiddleware
from app.settings import settings

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # First: the broker/database saved in the UI replace .env's values.
    app.state.connection_sources = apply_saved_connections(settings)
    # ...and so do the ones saved on the Settings page.
    app.state.saved_settings = SavedSettings(settings)
    app.state.saved_settings.apply(settings, settings.app_settings_path)
    http_client = httpx.AsyncClient()

    ha_conn = load_home_assistant(settings)
    home_assistant = HomeAssistantLink(
        HomeAssistant(ha_conn.url, ha_conn.token or "", ha_conn.verify_ssl) if ha_conn else None, http_client)
    logger.info("Home Assistant: %s", ha_conn.url if ha_conn else "not set up (Settings page)")

    database = Database(settings.database_url)
    database.on_ready(bootstrap_admin)
    database.on_ready(prune_audit_log)
    database.start()  # background connect/migrate; never blocks or fails startup

    action_runner = ActionRunner(home_assistant, settings.actions_config_path)

    device_link = MqttDeviceLink(device_state, action_runner, settings.device_config_path)
    device_task = asyncio.create_task(device_link.run_forever())

    app.state.http_client = http_client
    app.state.home_assistant = home_assistant
    app.state.action_runner = action_runner
    app.state.device_link = device_link
    app.state.database = database

    try:
        yield
    finally:
        device_task.cancel()
        try:
            await device_task
        except asyncio.CancelledError:
            pass
        await database.stop()
        await home_assistant.aclose()
        await http_client.aclose()


# No built-in /docs, /redoc or /openapi.json: they'd publish the whole API
# surface to anyone who can reach the port.
app = FastAPI(title="Bedside Dashboard Server", lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(router)
app.include_router(api_router)
app.add_middleware(SecurityHeadersMiddleware)

# Last on purpose: its catch-all only sees paths nothing above claimed.
app.include_router(spa_router)
