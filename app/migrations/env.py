"""Alembic environment (async engine). The URL comes from
`config.attributes["url"]` when run by the app (app.migrations.runner),
or from DATABASE_URL via app.settings when run by hand:

    DATABASE_URL=postgresql+asyncpg://... alembic -c alembic.ini upgrade head
    alembic -c alembic.ini revision --autogenerate -m "describe change"
"""
from __future__ import annotations

import asyncio

from alembic import context
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.auth import models as _auth_models  # noqa: F401 - registers tables for autogenerate
from app.db import Base
from app.settings import settings

# Model modules are imported above so autogenerate sees them.

config = context.config
target_metadata = Base.metadata


def _url() -> str:
    url = config.attributes.get("url") or settings.database_url
    if not url:
        raise RuntimeError("no database URL: set DATABASE_URL")
    return url


def _do_run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def _run_online() -> None:
    engine = create_async_engine(_url(), poolclass=NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(_do_run)
    await engine.dispose()


if context.is_offline_mode():
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(_run_online())
