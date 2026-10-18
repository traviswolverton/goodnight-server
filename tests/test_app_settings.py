"""The Settings page: settings saved from the UI (app/app_settings.py,
app/api/app_settings.py)."""
from __future__ import annotations

import logging

import httpx
import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import router
from app.app_settings import FIELDS, SavedSettings, SettingsError, coerce
from app.settings import settings
from tests.auth_helpers import bypass_auth


@pytest.fixture(autouse=True)
def _restore_settings(tmp_path, monkeypatch):
    """Every test here changes the real settings object; put it back."""
    for field in FIELDS:
        monkeypatch.setattr(settings, field.key, getattr(settings, field.key))
    monkeypatch.setattr(settings, "app_settings_path", str(tmp_path / "settings.yaml"))
    level = logging.getLogger().level
    yield
    logging.getLogger().setLevel(level)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings, "session_idle_hours", 24.0)
    monkeypatch.setattr(settings, "audit_retention_days", 365)
    monkeypatch.setattr(settings, "https_only", False)
    monkeypatch.setattr(settings, "trusted_proxies", "")
    app = FastAPI()
    app.include_router(router)
    app.state.saved_settings = SavedSettings(settings)
    return TestClient(bypass_auth(app))


def _field(body, key):
    return next(f for f in body["fields"] if f["key"] == key)


# --- validation ------------------------------------------------------------------------------

@pytest.mark.parametrize(("key", "raw", "expected"), [
    ("session_idle_hours", "20", 20.0),
    ("audit_retention_days", "90", 90),
    ("https_only", True, True),
    ("trusted_proxies", " 192.0.2.10 , ::1 ,", "192.0.2.10,::1"),
    ("log_level", "debug", "DEBUG"),
])
def test_coerce_accepts(key, raw, expected):
    assert coerce(key, raw) == expected


@pytest.mark.parametrize(("key", "raw"), [
    ("session_idle_hours", "0.1"),              # below the minimum
    ("session_idle_hours", "abc"),
    ("audit_retention_days", "90.5"),             # integers only
    ("https_only", "yes"),
    ("trusted_proxies", "192.0.2.0/24"),         # client_ip() matches exact addresses
    ("log_level", "LOUD"),
    ("database_url", "postgresql://x"),            # not editable here
])
def test_coerce_rejects(key, raw):
    with pytest.raises(SettingsError):
        coerce(key, raw)


# --- startup overlay -------------------------------------------------------------------------

def test_saved_values_overlay_and_bad_ones_are_skipped(tmp_path):
    path = tmp_path / "settings.yaml"
    path.write_text("session_idle_hours: 30\naudit_retention_days: nonsense\n"
                    "heartbeat_interval_seconds: 45\nlog_level: WARNING\n")  # a since-removed setting too
    before_poll = settings.session_idle_hours
    saved = SavedSettings(settings)
    before_days = settings.audit_retention_days
    saved.apply(settings, path)
    assert settings.session_idle_hours == 30.0 and settings.audit_retention_days == before_days
    assert logging.getLogger().level == logging.WARNING           # applied, not just stored
    rows = {r["key"]: r for r in saved.describe(settings, path)}
    assert rows["session_idle_hours"]["source"] == "app"
    assert rows["session_idle_hours"]["baseline"] == before_poll        # what reset goes back to
    assert rows["session_max_days"]["source"] in ("env", "default")


# --- API -------------------------------------------------------------------------------------

def test_save_applies_immediately_and_reset_goes_back(client):
    body = client.put("/api/settings", json={"values": {"session_idle_hours": "20", "log_level": "DEBUG"}}).json()
    assert settings.session_idle_hours == 20.0 and _field(body, "session_idle_hours")["source"] == "app"
    assert logging.getLogger().level == logging.DEBUG
    assert yaml.safe_load(open(settings.app_settings_path)) == {"session_idle_hours": 20.0, "log_level": "DEBUG"}

    body = client.put("/api/settings", json={"values": {"session_idle_hours": None}}).json()
    assert settings.session_idle_hours == 24.0 and _field(body, "session_idle_hours")["source"] != "app"
    assert yaml.safe_load(open(settings.app_settings_path)) == {"log_level": "DEBUG"}


def test_a_bad_value_saves_nothing(client):
    resp = client.put("/api/settings", json={"values": {"session_idle_hours": "20", "audit_retention_days": "-1"}})
    assert resp.status_code == 400 and "audit" in resp.json()["detail"].lower()
    assert settings.session_idle_hours == 24.0


def test_https_only_cannot_be_turned_on_over_http(client):
    resp = client.put("/api/settings", json={"values": {"https_only": True}})
    assert resp.status_code == 400 and "plain-HTTP" in resp.json()["detail"]
    assert settings.https_only is False


def test_https_only_over_https_keeps_you_signed_in(client):
    client.base_url = httpx.URL("https://testserver")
    client.cookies.set("dd_session", "tok-1")
    resp = client.put("/api/settings", json={"values": {"https_only": True}})
    assert resp.status_code == 200 and settings.https_only is True
    cookies = resp.headers.get_list("set-cookie")
    assert any(c.startswith("__Host-dd_session=tok-1") and "Secure" in c for c in cookies)
    assert any(c.startswith("dd_session=") and "Max-Age=0" in c for c in cookies)   # the old one is cleared


def test_https_detected_through_a_trusted_proxy_only(client, monkeypatch):
    headers = {"X-Forwarded-Proto": "https"}
    assert client.get("/api/settings", headers=headers).json()["request_is_https"] is False
    monkeypatch.setattr(settings, "trusted_proxies", "testclient")
    assert client.get("/api/settings", headers=headers).json()["request_is_https"] is True




def test_saving_drops_settings_that_no_longer_exist(client):
    with open(settings.app_settings_path, "w") as f:
        f.write("heartbeat_interval_seconds: 45\nlog_level: DEBUG\n")
    assert client.put("/api/settings", json={"values": {"session_idle_hours": "20"}}).status_code == 200
    assert yaml.safe_load(open(settings.app_settings_path)) == {"log_level": "DEBUG", "session_idle_hours": 20.0}
