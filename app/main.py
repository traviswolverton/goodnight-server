"""FastAPI entrypoint. Owns the app lifecycle: on startup, load config,
connect to MQTT, and kick off the aggregator's poll loop as a background
task; on shutdown, stop the loop and disconnect cleanly.

Run a single worker/process — the aggregator loop and MQTT connection are
in-process state, so multiple workers would each poll independently and
publish duplicate/conflicting messages. See DESIGN.md deployment notes.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.actions import ActionRunner
from app.adapters import ADAPTER_REGISTRY  # noqa: F401 - ensures adapters register
from app.aggregator import Aggregator
from app.api import router as api_router
from app.config import load_adapters, load_cards
from app.app_settings import SavedSettings
from app.connections import apply_saved_connections
from app.db import Database
from app.device import MqttDeviceLink, device_state
from app.auth.bootstrap import bootstrap_admin
from app.auth.retention import prune_audit_log
from app.mqtt import MqttPublisher
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
    publisher = MqttPublisher()
    await publisher.connect()

    adapters = load_adapters(settings.adapters_config_path)
    logger.info("loaded %d adapter(s): %s", len(adapters), [a.name for a in adapters])

    cards = load_cards(settings.cards_config_path)
    logger.info("loaded %d explicit card(s): %s", len(cards), [c.name for c in cards])

    database = Database(settings.database_url)
    database.on_ready(bootstrap_admin)
    database.on_ready(prune_audit_log)
    database.start()  # background connect/migrate; never blocks or fails startup

    aggregator = Aggregator(adapters=adapters, cards=cards, publisher=publisher, client=http_client)
    loop_task = asyncio.create_task(aggregator.run_forever())

    action_runner = ActionRunner(aggregator, settings.actions_config_path)

    device_link = MqttDeviceLink(device_state, action_runner, settings.device_config_path)
    device_task = asyncio.create_task(device_link.run_forever())

    app.state.http_client = http_client
    app.state.publisher = publisher
    app.state.aggregator = aggregator
    app.state.action_runner = action_runner
    app.state.device_link = device_link
    app.state.database = database

    try:
        yield
    finally:
        aggregator.stop()
        await loop_task
        device_task.cancel()
        try:
            await device_task
        except asyncio.CancelledError:
            pass
        await publisher.disconnect()
        await database.stop()
        for adapter in adapters:
            await adapter.aclose()
        await http_client.aclose()


# No built-in /docs, /redoc or /openapi.json: they'd publish the whole API
# surface to anyone who can reach the port. (/docs/mqtt is our own page.)
app = FastAPI(title="Bedside Dashboard Server", lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(router)
app.include_router(api_router)
app.add_middleware(SecurityHeadersMiddleware)

# Raw JSON Schema files, reachable at e.g. /schema/status_payload.schema.json
# — linked from GET /docs/mqtt (app/routes.py), which is the actual
# human-readable reference. Regenerate the files themselves via
# scripts/export_schema.py after any app/models.py change.
app.mount(
    "/schema",
    StaticFiles(directory=str(Path(__file__).resolve().parent.parent / "schema")),
    name="schema",
)

# Last on purpose: its catch-all only sees paths nothing above (including the
# /schema mount) claimed.
app.include_router(spa_router)
