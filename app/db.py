"""Postgres access (users / sessions / audit log — see
docs/plan-ui-and-auth.md). Deliberately NOT a hard dependency of the rest
of the app: button presses, Actions and the device link are this
service's actual job and must keep running when the database is down or
not configured. So `Database` never raises out of start(); it connects (and
applies pending migrations) from a background task, keeps retrying, and
just reports `available`. Anything that needs the DB goes through
`get_session()`, which answers 503 while it's unavailable.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable

from fastapi import HTTPException, Request
from sqlalchemy import MetaData, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.migrations.runner import run_migrations

logger = logging.getLogger(__name__)

#: Seconds between connection attempts while the DB is unreachable (short,
#: so a normal boot — app up a few seconds before Postgres accepts
#: connections — recovers almost immediately) and between health checks
#: once it's up.
RETRY_INTERVAL_SECONDS = 5.0
HEALTHY_CHECK_INTERVAL_SECONDS = 30.0
CONNECT_TIMEOUT_SECONDS = 5.0

# Stable constraint names, so Alembic autogenerate diffs/renames are
# deterministic across environments.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class Database:
    def __init__(self, url: str | None) -> None:
        self._url = url
        self._engine: AsyncEngine | None = None
        self._sessionmaker: async_sessionmaker[AsyncSession] | None = None
        self._task: asyncio.Task | None = None
        self._migrated = False
        self._last_error: str | None = None
        self.available = False
        self._ready_callbacks: list[Callable[[Database], Awaitable[None]]] = []

    def on_ready(self, callback: Callable[[Database], Awaitable[None]]) -> None:
        """Run `callback(database)` each time the DB becomes available (after
        migrations). Failures are logged, never raised."""
        self._ready_callbacks.append(callback)

    @property
    def configured(self) -> bool:
        return self._url is not None

    def start(self) -> None:
        """Kick off the background connect/migrate/watch loop and return
        immediately — never blocks or fails app startup."""
        if not self._url:
            logger.info("DATABASE_URL not set; features that need the database are disabled")
            return
        self._engine = create_async_engine(
            self._url, pool_pre_ping=True,
            connect_args={"timeout": CONNECT_TIMEOUT_SECONDS},
        )
        self._sessionmaker = async_sessionmaker(self._engine, expire_on_commit=False)
        self._task = asyncio.create_task(self._watch())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._engine is not None:
            await self._engine.dispose()

    async def _watch(self) -> None:
        while True:
            await self._attempt()
            await asyncio.sleep(HEALTHY_CHECK_INTERVAL_SECONDS if self.available else RETRY_INTERVAL_SECONDS)

    async def _attempt(self) -> None:
        assert self._url is not None and self._engine is not None
        try:
            if not self._migrated:
                await asyncio.to_thread(run_migrations, self._url)
                self._migrated = True
            async with self._engine.connect() as conn:
                await asyncio.wait_for(conn.execute(text("SELECT 1")), timeout=CONNECT_TIMEOUT_SECONDS * 2)
        except Exception as exc:  # noqa: BLE001 - any failure just means "not available yet"
            message = f"{type(exc).__name__}: {exc}"
            # Log on a state or message change only, not every retry.
            if self.available or message != self._last_error:
                logger.warning("database unavailable (retrying): %s", message.splitlines()[0][:300])
            self._last_error = message
            self.available = False
            return
        was_available = self.available
        self._last_error = None
        self.available = True
        if not was_available:
            logger.info("database available (migrations up to date)")
            for callback in self._ready_callbacks:
                try:
                    await callback(self)
                except Exception:  # noqa: BLE001 - a hook failing must not take the DB "down"
                    logger.exception("database ready-callback %s failed", getattr(callback, "__name__", callback))

    def session(self) -> AsyncSession:
        if not self.available or self._sessionmaker is None:
            raise DatabaseUnavailable("database is not available")
        return self._sessionmaker()


class DatabaseUnavailable(RuntimeError):
    pass


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: a session, or 503 while the DB is down."""
    try:
        session = request.app.state.database.session()
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    async with session:
        yield session
