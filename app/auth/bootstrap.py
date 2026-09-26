"""Creates the first administrator from ADMIN_USERNAME / ADMIN_PASSWORD when
the users table is empty. Runs each time the database becomes available;
a no-op once any user exists."""
from __future__ import annotations

import logging

from app.auth import service
from app.settings import settings

logger = logging.getLogger(__name__)


async def bootstrap_admin(database) -> None:
    async with database.session() as session:
        if await service.count_users(session) > 0:
            return
        if not (settings.admin_username and settings.admin_password):
            logger.warning("no users exist and ADMIN_USERNAME/ADMIN_PASSWORD are not set — "
                           "nobody can log in until you set them and restart")
            return
        user = await service.create_user(session, settings.admin_username,
                                         settings.admin_password, role="admin")
        await service.record_audit(session, "user.bootstrap", user_id=user.id,
                                   username=user.username, target=user.username)
        await session.commit()
    logger.info("created first administrator %r from ADMIN_USERNAME — you can now remove "
                "ADMIN_USERNAME/ADMIN_PASSWORD from .env", user.username)
