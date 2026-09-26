"""Process-level actions."""
from __future__ import annotations

import asyncio
import logging
import os
import signal

from fastapi import APIRouter

logger = logging.getLogger(__name__)
router = APIRouter()


def _schedule_restart() -> None:
    """Exit the process shortly after the HTTP response is sent. The
    compose service has `restart: unless-stopped`, so Docker brings it
    straight back up and re-reads every config file. Uses SIGTERM (uvicorn's
    graceful shutdown) rather than a hard exit, so the lifespan cleanup
    (MQTT disconnect, adapter clients) still runs. No docker socket needed."""
    asyncio.get_running_loop().call_later(0.5, os.kill, os.getpid(), signal.SIGTERM)


@router.post("/restart")
async def restart_app() -> dict[str, object]:
    logger.warning("restart requested via the admin API")
    _schedule_restart()
    return {"restarting": True}
