"""app/db.py: the database is optional infrastructure — never a reason the
app (or its aggregator/MQTT loop) fails to start."""
from __future__ import annotations

import asyncio
import os

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

import app.db as db_module
from app.db import Database, DatabaseUnavailable, get_session

# Nothing listens on port 1 — connection refused immediately, no timeout wait.
UNREACHABLE = "postgresql+asyncpg://u:p@127.0.0.1:1/nope"


async def test_unconfigured_database_is_a_noop():
    database = Database(None)
    database.start()
    assert not database.configured and not database.available
    with pytest.raises(DatabaseUnavailable):
        database.session()
    await database.stop()


async def test_unreachable_database_never_raises_and_reports_unavailable(monkeypatch):
    monkeypatch.setattr(db_module, "RETRY_INTERVAL_SECONDS", 0.05)
    database = Database(UNREACHABLE)
    database.start()                      # must return immediately, not raise
    await asyncio.sleep(0.3)              # a few failed attempts
    assert database.configured and not database.available
    with pytest.raises(DatabaseUnavailable):
        database.session()
    await database.stop()                 # cancels the retry loop cleanly


def test_get_session_dependency_answers_503_while_unavailable():
    app = FastAPI()
    app.state.database = Database(UNREACHABLE)

    @app.get("/needs-db")
    async def needs_db(session=Depends(get_session)):
        return {"ok": True}

    resp = TestClient(app).get("/needs-db")
    assert resp.status_code == 503
    assert "not available" in resp.json()["detail"]


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"),
                    reason="set TEST_DATABASE_URL (postgresql+asyncpg://...) to run against a real Postgres")
async def test_migrations_apply_and_sessions_work_against_real_postgres():
    from alembic.script import ScriptDirectory

    from app.migrations.runner import make_config

    head = ScriptDirectory.from_config(make_config()).get_current_head()
    database = Database(os.environ["TEST_DATABASE_URL"])
    database.start()
    try:
        for _ in range(100):
            if database.available:
                break
            await asyncio.sleep(0.1)
        assert database.available
        async with database.session() as session:
            assert (await session.execute(text("select version_num from alembic_version"))).scalar_one() == head
    finally:
        await database.stop()
