"""Keeps the audit log from growing forever: rows older than
AUDIT_RETENTION_DAYS are deleted whenever the database becomes available
(so at every app start)."""
from __future__ import annotations

import logging

from app.auth import service
from app.settings import settings

logger = logging.getLogger(__name__)


async def prune_audit_log(database) -> None:
    async with database.session() as session:
        removed = await service.prune_audit(session, settings.audit_retention_days)
        await session.commit()
    if removed:
        logger.info("pruned %d audit-log row(s) older than %d days", removed, settings.audit_retention_days)
