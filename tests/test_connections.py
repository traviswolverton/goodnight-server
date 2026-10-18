"""The Connections section of the Settings page: the MQTT broker / database / Home Assistant saved
from the UI (app/connections.py, app/api/connections.py)."""
from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace

import httpx
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
    load_home_assistant,
    save_database,
    save_mqtt,
)
from app.home_assistant import HomeAssistant, HomeAssistantLink
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
    app.state.device_link = SimpleNamespace(state=SimpleNamespace(link_connected=True))
    app.state.database = SimpleNamespace(available=True)
    app.state.home_assistant = HomeAssistantLink(None, None)
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


# --- the bedside device (ESP32): its broker and device token -----------------------------------------

from app.connections import device_token_valid, load_display, new_device_token, save_display_broker  # noqa: E402


def _display_settings(paths, **over):
    base = dict(connections_config_path=paths[0], secrets_config_path=paths[1],
                mqtt_host="app-broker", mqtt_port=1883,
                mqtt_client_username="bedside-esp32", mqtt_client_password="env-client-pw")
    return SimpleNamespace(**{**base, **over})


def test_display_falls_back_to_the_app_broker_with_env_client_account(paths):
    display = load_display(_display_settings(paths))
    assert display.source == "env" and display.broker.host == "app-broker"
    assert display.broker.password == "env-client-pw"
    assert load_display(_display_settings(paths, mqtt_client_password=None)).source == "none"


def test_display_saved_broker_wins_and_keeps_the_token(paths):
    token = new_device_token(paths[0])
    save_display_broker(*paths, MqttConnection("other.lan", 1884, "bedside-esp32", "saved-pw"))
    display = load_display(_display_settings(paths))
    assert (display.source, display.broker.host, display.broker.password) == ("app", "other.lan", "saved-pw")
    assert display.token_set and device_token_valid(paths[0], token)
    assert token not in open(paths[0]).read()                   # only its hash is stored


def test_a_new_token_replaces_the_old_one(paths):
    old = new_device_token(paths[0])
    new = new_device_token(paths[0])
    assert device_token_valid(paths[0], new) and not device_token_valid(paths[0], old)
    assert not device_token_valid(paths[0], "") and not device_token_valid(paths[0], None)


@pytest.fixture
def device_client(paths, monkeypatch):
    from app.routes import router as public_router
    monkeypatch.setattr(settings, "mqtt_host", "app-broker")
    monkeypatch.setattr(settings, "mqtt_client_username", "bedside-esp32")
    monkeypatch.setattr(settings, "mqtt_client_password", "env-client-pw")
    app = FastAPI()
    app.include_router(public_router)
    return TestClient(app)


def test_device_config_needs_the_token(device_client, paths):
    assert device_client.get("/device/config").status_code == 401
    new_device_token(paths[0])
    assert device_client.get("/device/config", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert device_client.get("/device/config?token=x").status_code == 401


def test_device_config_hands_over_the_broker_and_records_the_check_in(device_client, paths):
    token = new_device_token(paths[0])
    resp = device_client.get("/device/config", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200 and resp.headers["cache-control"] == "no-store"
    assert resp.json() == {"mqtt_host": "app-broker", "mqtt_port": 1883,
                           "mqtt_username": "bedside-esp32", "mqtt_password": "env-client-pw"}
    assert device_client.app.state.device_last_seen["ip"] == "testclient"


def test_device_config_without_an_account_is_503(device_client, paths, monkeypatch):
    monkeypatch.setattr(settings, "mqtt_client_password", None)
    token = new_device_token(paths[0])
    assert device_client.get("/device/config", headers={"Authorization": f"Bearer {token}"}).status_code == 503


def test_display_api_token_and_save(client, monkeypatch, paths):
    monkeypatch.setattr(settings, "mqtt_client_username", None)
    monkeypatch.setattr(settings, "mqtt_client_password", None)
    token = client.post("/api/connections/display/token").json()["token"]
    assert device_token_valid(paths[0], token)
    body = client.get("/api/connections").json()["display"]
    assert body["token_set"] and body["source"] == "none" and token not in str(body)

    async def check(conn):
        return {"ok": True, "error": None}
    monkeypatch.setattr(api_module, "check_mqtt", check)
    resp = client.put("/api/connections/display",
                      json={"fields": {"host": "b.lan", "username": "bedside-esp32", "password": "pw-1234"}})
    assert resp.json() == {"saved": True} and client.restarts == []       # no restart needed
    assert device_token_valid(paths[0], token)                             # save kept the token
    assert client.get("/api/connections").json()["display"]["source"] == "app"


def test_display_api_rejects_values_the_display_cannot_hold(client):
    resp = client.post("/api/connections/display/test",
                       json={"fields": {"host": "b.lan", "username": "bedside-esp32", "password": "x" * 96}})
    assert resp.status_code == 400 and "95" in resp.json()["detail"]
    resp = client.post("/api/connections/display/test", json={"fields": {"host": "b.lan", "username": "", "password": ""}})
    assert resp.status_code == 400


# --- Home Assistant ------------------------------------------------------------------------------

@pytest.fixture
def ha_check(monkeypatch):
    """HomeAssistant.check without a network: fails for a URL on .invalid."""
    seen: list[tuple[str, str, bool]] = []

    async def check(self, client):
        seen.append((self.base_url, self.token, self.verify_ssl))
        if ".invalid" in self.base_url:
            raise httpx.ConnectError("Name or service not known")
        if self.token == "bad-token":
            raise httpx.HTTPStatusError("401", request=httpx.Request("GET", self.base_url),
                                        response=httpx.Response(401))
        return {"version": "2026.9.1", "location_name": "Home"}
    monkeypatch.setattr(HomeAssistant, "check", check)
    return seen


def test_home_assistant_test_reports_what_it_found_or_why_not(client, ha_check):
    ok = client.post("/api/connections/home-assistant/test",
                     json={"fields": {"url": "http://ha.lan:8123/", "token": "tok-1234"}}).json()
    assert ok == {"ok": True, "error": None, "version": "2026.9.1", "location_name": "Home"}
    assert ha_check[-1] == ("http://ha.lan:8123", "tok-1234", True)
    refused = client.post("/api/connections/home-assistant/test",
                          json={"fields": {"url": "http://ha.lan:8123", "token": "bad-token"}}).json()
    assert not refused["ok"] and "refused the token" in refused["error"]
    unreachable = client.post("/api/connections/home-assistant/test",
                              json={"fields": {"url": "http://ha.invalid", "token": "tok-1234"}}).json()
    assert not unreachable["ok"] and unreachable["error"]


@pytest.mark.parametrize("fields", [{"url": "", "token": "t"}, {"url": "ha.lan:8123", "token": "t"},
                                    {"url": "http://ha.lan"}])
def test_home_assistant_form_needs_a_url_and_a_token(client, ha_check, fields):
    assert client.post("/api/connections/home-assistant/test", json={"fields": fields}).status_code == 400


def test_home_assistant_save_takes_effect_without_a_restart(client, ha_check, paths):
    resp = client.put("/api/connections/home-assistant",
                      json={"fields": {"url": "http://ha.lan:8123", "token": "tok-1234", "verify_ssl": "false"}})
    assert resp.json() == {"saved": True} and client.restarts == []
    link = client.app.state.home_assistant
    assert (link.ha.base_url, link.ha.token, link.ha.verify_ssl) == ("http://ha.lan:8123", "tok-1234", False)
    assert "tok-1234" not in open(paths[0]).read()
    summary = client.get("/api/connections").json()["home_assistant"]
    assert summary["url"] == "http://ha.lan:8123" and summary["token_set"] and "tok-1234" not in str(summary)

    # A blank token keeps the saved one.
    client.put("/api/connections/home-assistant", json={"fields": {"url": "http://ha2.lan:8123", "token": ""}})
    assert load_home_assistant(settings).token == "tok-1234"
    assert ha_check[-1] == ("http://ha2.lan:8123", "tok-1234", True)


def test_home_assistant_save_refuses_one_that_fails_its_test(client, ha_check, paths):
    resp = client.put("/api/connections/home-assistant",
                      json={"fields": {"url": "http://ha.invalid", "token": "tok-1234"}})
    assert resp.status_code == 400 and resp.json()["detail"].startswith("Not saved")
    assert load_home_assistant(settings) is None and client.app.state.home_assistant.ha is None


def test_catalog_without_home_assistant_says_to_set_it_up(client):
    resp = client.get("/api/home-assistant/catalog")
    assert resp.status_code == 409 and "Settings page" in resp.json()["detail"]
