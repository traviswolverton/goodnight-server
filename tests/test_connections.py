"""The Connections page: the MQTT broker / database saved from the UI
(app/connections.py, app/api/connections.py)."""
from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.api.connections as api_module
import app.connections as conn_module
from app.api import router
from app.connections import (
    DatabaseConnection,
    DatabaseReport,
    MqttConnection,
    apply_saved_connections,
    inspect_database,
    save_database,
    save_mqtt,
)
from app.secret_store import generate_key
from app.settings import settings
from tests.auth_helpers import bypass_auth

KEY = generate_key()
PASSWORD = "p@ss/word:with#odd%chars"


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setattr("app.secret_store.settings.secrets_master_key", KEY)


@pytest.fixture
def paths(tmp_path, monkeypatch):
    connections, secrets = str(tmp_path / "connections.yaml"), str(tmp_path / "secrets.enc.yaml")
    monkeypatch.setattr(settings, "connections_config_path", connections)
    monkeypatch.setattr(settings, "secrets_config_path", secrets)
    return connections, secrets


def _env_settings(paths):
    return SimpleNamespace(
        connections_config_path=paths[0], secrets_config_path=paths[1],
        mqtt_host="env-broker", mqtt_port=1883, mqtt_username="env-user", mqtt_password="env-pw",
        database_url="postgresql+asyncpg://envu:envp@env-db:5432/envdb",
    )


# --- saved file -> settings ------------------------------------------------------------------

def test_nothing_saved_leaves_env_in_charge(paths):
    s = _env_settings(paths)
    assert apply_saved_connections(s) == {"mqtt": "env", "database": "env"}
    assert s.mqtt_host == "env-broker" and s.database_url.endswith("@env-db:5432/envdb")


def test_saved_connections_replace_env_and_keep_passwords_out_of_the_yaml(paths):
    save_mqtt(*paths, MqttConnection("broker.lan", 8883, "agg", "mqtt-secret"))
    save_database(*paths, DatabaseConnection("db.lan", 5433, "dash", "dash_user", PASSWORD))
    text = open(paths[0]).read()
    assert "mqtt-secret" not in text and PASSWORD not in text

    s = _env_settings(paths)
    assert apply_saved_connections(s) == {"mqtt": "app", "database": "app"}
    assert (s.mqtt_host, s.mqtt_port, s.mqtt_username, s.mqtt_password) == ("broker.lan", 8883, "agg", "mqtt-secret")
    parsed = DatabaseConnection.from_url(s.database_url)
    assert (parsed.host, parsed.port, parsed.database, parsed.username, parsed.password) == (
        "db.lan", 5433, "dash", "dash_user", PASSWORD)          # odd characters survive the URL


def test_an_undecryptable_saved_password_falls_back_to_env(paths, monkeypatch):
    save_database(*paths, DatabaseConnection("db.lan", 5432, "dash", "u", PASSWORD))
    monkeypatch.setattr("app.secret_store.settings.secrets_master_key", generate_key())  # a different key
    s = _env_settings(paths)
    assert apply_saved_connections(s)["database"] == "env"
    assert s.database_url.endswith("@env-db:5432/envdb")


def test_saving_one_section_keeps_the_other(paths):
    save_mqtt(*paths, MqttConnection("broker.lan", 1883, "agg", None))
    save_database(*paths, DatabaseConnection("db.lan", 5432, "dash", "u", PASSWORD))
    raw = yaml.safe_load(open(paths[0]))
    assert set(raw) == {"mqtt", "database"}
    assert "password" not in raw["mqtt"]                       # anonymous broker: no secret stored


# --- deciding whether a database is safe to switch to ------------------------------------

def _fake_probe(**found):
    async def probe(conn, report):
        for key, value in {"connected": True, "server_version": "17.2", **found}.items():
            setattr(report, key, value)
    return probe


TARGET = DatabaseConnection("new.lan", 5432, "dash", "u", "pw-1234")


@pytest.mark.parametrize(("found", "bootstrap", "modes"), [
    ({"schema": "none", "can_create_tables": True}, False, ["copy"]),
    ({"schema": "none", "can_create_tables": True}, True, ["copy", "fresh"]),
    ({"schema": "none", "can_create_tables": False}, False, []),
    ({"schema": "current", "user_count": 2, "admins": ["travis"]}, False, ["use"]),
    ({"schema": "upgrade", "user_count": 2, "admins": ["travis"], "can_create_tables": True}, False, ["use"]),
    ({"schema": "upgrade", "user_count": 2, "admins": ["travis"], "can_create_tables": False}, False, []),
    ({"schema": "current", "user_count": 0}, False, ["copy"]),          # a copy that failed half-way
    ({"schema": "current", "user_count": 3, "admins": []}, True, []),   # nobody could manage it
    ({"schema": "unknown", "can_create_tables": True}, True, []),
    ({"schema": "foreign", "can_create_tables": True}, True, []),
])
async def test_inspect_database_only_offers_saves_that_leave_someone_able_to_sign_in(monkeypatch, found, bootstrap, modes):
    monkeypatch.setattr(conn_module, "_probe", _fake_probe(**found))
    report = await inspect_database(TARGET, None, bootstrap)
    assert report.modes == modes
    assert bool(report.problems) == (not modes)


async def test_inspect_database_reports_connection_errors_without_the_password(monkeypatch):
    async def probe(conn, report):
        raise OSError(f"auth failed for {conn.password}")
    monkeypatch.setattr(conn_module, "_probe", probe)
    report = await inspect_database(TARGET, None, True)
    assert report.modes == [] and "pw-1234" not in report.error and "***" in report.error


async def test_inspect_database_unreachable_host_is_a_problem_not_an_exception():
    report = await inspect_database(DatabaseConnection("127.0.0.1", 1, "x", "u", "pw-1234"), None, True)
    assert not report.connected and report.modes == [] and report.problems


async def test_check_mqtt_unreachable_broker():
    result = await conn_module.check_mqtt(MqttConnection("127.0.0.1", 1, "u", "pw-1234"))
    assert result["ok"] is False and result["error"]


# --- API -------------------------------------------------------------------------------------

@pytest.fixture
def client(paths, monkeypatch):
    monkeypatch.setattr(settings, "secrets_master_key", KEY)
    monkeypatch.setattr(settings, "mqtt_password", "running-mqtt-pw")
    monkeypatch.setattr(settings, "database_url", "postgresql+asyncpg://u:running-db-pw@old.lan:5432/dash")
    restarts = []
    monkeypatch.setattr(api_module, "_schedule_restart", lambda: restarts.append(True))
    app = FastAPI()
    app.include_router(router)
    app.state.connection_sources = {"mqtt": "env", "database": "app"}
    app.state.publisher = SimpleNamespace(connected=True)
    app.state.database = SimpleNamespace(available=True)
    c = TestClient(bypass_auth(app))
    c.restarts = restarts
    return c


def test_get_connections_never_returns_passwords(client):
    body = client.get("/api/connections").json()
    assert "running-mqtt-pw" not in str(body) and "running-db-pw" not in str(body)
    assert body["mqtt"]["password_set"] and body["mqtt"]["connected"]
    assert (body["database"]["host"], body["database"]["source"], body["database"]["available"]) == ("old.lan", "app", True)


def test_mqtt_blank_password_tests_with_the_running_one(client, monkeypatch):
    seen = []

    async def check(conn):
        seen.append(conn.password)
        return {"ok": True, "error": None}
    monkeypatch.setattr(api_module, "check_mqtt", check)
    assert client.post("/api/connections/mqtt/test", json={"fields": {"host": "b.lan", "password": ""}}).json()["ok"]
    assert seen == ["running-mqtt-pw"]


def test_mqtt_save_refuses_a_broker_that_fails_the_test(client, monkeypatch, paths):
    async def check(conn):
        return {"ok": False, "error": "Not authorized"}
    monkeypatch.setattr(api_module, "check_mqtt", check)
    resp = client.put("/api/connections/mqtt", json={"fields": {"host": "b.lan", "username": "x", "password": "y"}})
    assert resp.status_code == 400 and "Not authorized" in resp.json()["detail"]
    assert not os.path.exists(paths[0]) and client.restarts == []


def test_mqtt_save_after_a_passing_test_saves_and_restarts(client, monkeypatch, paths):
    async def check(conn):
        return {"ok": True, "error": None}
    monkeypatch.setattr(api_module, "check_mqtt", check)
    resp = client.put("/api/connections/mqtt", json={"fields": {"host": "b.lan", "port": "1884", "username": "agg", "password": "new-pw-1"}})
    assert resp.json() == {"saved": True, "restarting": True} and client.restarts == [True]
    assert yaml.safe_load(open(paths[0]))["mqtt"]["host"] == "b.lan"


def test_mqtt_bad_port_is_a_400(client):
    resp = client.post("/api/connections/mqtt/test", json={"fields": {"host": "b.lan", "port": "99999"}})
    assert resp.status_code == 400 and "Port" in resp.json()["detail"]


DB_FIELDS = {"host": "new.lan", "port": "5432", "database": "dash", "username": "u", "password": "new-db-pw"}


def _report(**kw):
    async def inspect(conn, current, bootstrap):
        return DatabaseReport(connected=True, **kw)
    return inspect


def test_database_save_refuses_a_mode_the_test_did_not_offer(client, monkeypatch, paths):
    monkeypatch.setattr(api_module, "inspect_database", _report(schema="current", user_count=3,
                                                                 problems=["no active administrator"]))
    resp = client.put("/api/connections/database", json={"fields": DB_FIELDS, "mode": "use"})
    assert resp.status_code == 400 and "no active administrator" in resp.json()["detail"]
    assert not os.path.exists(paths[0]) and client.restarts == []


def test_database_use_saves_and_restarts(client, monkeypatch, paths):
    monkeypatch.setattr(api_module, "inspect_database", _report(schema="current", modes=["use"]))
    resp = client.put("/api/connections/database", json={"fields": DB_FIELDS, "mode": "use"})
    assert resp.status_code == 200 and client.restarts == [True]
    saved = yaml.safe_load(open(paths[0]))["database"]
    assert saved["host"] == "new.lan" and saved["password"] == {"secret": "connection_database_password"}


def test_database_copy_copies_before_saving(client, monkeypatch, paths):
    monkeypatch.setattr(api_module, "inspect_database", _report(schema="none", modes=["copy"]))
    copied = []

    async def copy(source, conn):
        copied.append(conn.host)
        return {"users": 2}

    class Source:
        async def __aenter__(self):
            return "source-session"

        async def __aexit__(self, *exc):
            return False
    client.app.state.database = SimpleNamespace(available=True, session=Source)
    monkeypatch.setattr(api_module, "copy_database", copy)
    resp = client.put("/api/connections/database", json={"fields": DB_FIELDS, "mode": "copy"})
    assert resp.json()["copied"] == {"users": 2} and copied == ["new.lan"]
    assert os.path.exists(paths[0])


def test_database_failed_copy_saves_nothing(client, monkeypatch, paths):
    monkeypatch.setattr(api_module, "inspect_database", _report(schema="none", modes=["copy"]))

    async def copy(source, conn):
        raise RuntimeError("disk full")

    class Source:
        async def __aenter__(self):
            return None

        async def __aexit__(self, *exc):
            return False
    client.app.state.database = SimpleNamespace(available=True, session=Source)
    monkeypatch.setattr(api_module, "copy_database", copy)
    resp = client.put("/api/connections/database", json={"fields": DB_FIELDS, "mode": "copy"})
    assert resp.status_code == 500 and not os.path.exists(paths[0]) and client.restarts == []


def test_saving_needs_the_master_key(client, monkeypatch):
    monkeypatch.setattr(settings, "secrets_master_key", None)
    monkeypatch.setattr(api_module, "inspect_database", _report(schema="current", modes=["use"]))
    resp = client.put("/api/connections/database", json={"fields": DB_FIELDS, "mode": "use"})
    assert resp.status_code == 400 and "SECRETS_MASTER_KEY" in resp.json()["detail"]


# --- against real Postgres -------------------------------------------------------------------

@pytest.mark.skipif(not (os.environ.get("TEST_DATABASE_URL") and os.environ.get("TEST_DATABASE_URL_2")),
                    reason="set TEST_DATABASE_URL and TEST_DATABASE_URL_2 (two empty databases) to run")
async def test_copy_to_an_empty_database_keeps_everyone_signed_in():
    from sqlalchemy import select

    from app.auth.models import AuditLog, User, UserSession
    from app.connections import copy_database
    from app.db import Database

    source_db = Database(os.environ["TEST_DATABASE_URL"])
    source_db.start()
    target = DatabaseConnection.from_url(os.environ["TEST_DATABASE_URL_2"])
    try:
        for _ in range(100):
            if source_db.available:
                break
            await asyncio.sleep(0.1)
        async with source_db.session() as s:
            if not (await s.execute(select(User))).first():
                admin = User(username="copy-admin", role="admin", password_hash="x")
                s.add(admin)
                await s.flush()
                s.add(UserSession(id="sess-1", user_id=admin.id, csrf_token="c",
                                  expires_at=admin.created_at))
                s.add(AuditLog(action="test", user_id=admin.id, username="copy-admin", detail={"a": 1}))
                await s.commit()

        before = await inspect_database(target, None, False)
        assert before.connected and before.can_create_tables and before.modes == ["copy"], before

        async with source_db.session() as s:
            counts = await copy_database(s, target)
        assert counts["users"] >= 1 and counts["sessions"] >= 1 and counts["audit_log"] >= 1

        after = await inspect_database(target, None, False)
        assert after.schema == "current" and after.modes == ["use"] and "copy-admin" in after.admins

        copied_db = Database(target.url())
        copied_db.start()
        for _ in range(100):
            if copied_db.available:
                break
            await asyncio.sleep(0.1)
        async with copied_db.session() as s:     # the sequence moved past the copied ids
            s.add(User(username="after-copy", role="viewer"))
            await s.commit()
            assert (await s.execute(select(UserSession.id))).scalars().all() == ["sess-1"]
        await copied_db.stop()
    finally:
        await source_db.stop()
