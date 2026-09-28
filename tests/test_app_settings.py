"""The Settings page: settings saved from the UI (app/app_settings.py,
app/api/app_settings.py)."""
from __future__ import annotations

import logging

import httpx
import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.api.app_settings as api_module
from app.api import router
from app.app_settings import FIELDS, SavedSettings, SettingsError, check_combination, coerce
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
    monkeypatch.setattr(settings, "poll_interval_seconds", 15.0)
    monkeypatch.setattr(settings, "heartbeat_interval_seconds", 45.0)
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
    ("poll_interval_seconds", "20", 20.0),
    ("snapshot_width", "480", 480),
    ("https_only", True, True),
    ("trusted_proxies", " 192.0.2.10 , ::1 ,", "192.0.2.10,::1"),
    ("ollama_base_url", "http://host:11434/", "http://host:11434"),
    ("ollama_base_url", "", None),                 # blank turns the feature off
    ("log_level", "debug", "DEBUG"),
])
def test_coerce_accepts(key, raw, expected):
    assert coerce(key, raw) == expected


@pytest.mark.parametrize(("key", "raw"), [
    ("poll_interval_seconds", "1"),                # below the minimum
    ("poll_interval_seconds", "abc"),
    ("snapshot_width", "480.5"),                   # integers only
    ("https_only", "yes"),
    ("trusted_proxies", "192.0.2.0/24"),         # client_ip() matches exact addresses
    ("ollama_base_url", "host:11434"),
    ("log_level", "LOUD"),
    ("database_url", "postgresql://x"),            # not editable here
])
def test_coerce_rejects(key, raw):
    with pytest.raises(SettingsError):
        coerce(key, raw)


def test_heartbeat_must_not_be_shorter_than_the_poll():
    with pytest.raises(SettingsError, match="Heartbeat"):
        check_combination({"poll_interval_seconds": 60, "heartbeat_interval_seconds": 30})


# --- startup overlay -------------------------------------------------------------------------

def test_saved_values_overlay_and_bad_ones_are_skipped(tmp_path):
    path = tmp_path / "settings.yaml"
    path.write_text("poll_interval_seconds: 30\nsnapshot_width: nonsense\nlog_level: WARNING\n")
    before_poll = settings.poll_interval_seconds
    saved = SavedSettings(settings)
    before_width = settings.snapshot_width
    saved.apply(settings, path)
    assert settings.poll_interval_seconds == 30.0 and settings.snapshot_width == before_width
    assert logging.getLogger().level == logging.WARNING           # applied, not just stored
    rows = {r["key"]: r for r in saved.describe(settings, path)}
    assert rows["poll_interval_seconds"]["source"] == "app"
    assert rows["poll_interval_seconds"]["baseline"] == before_poll        # what reset goes back to
    assert rows["session_max_days"]["source"] in ("env", "default")


# --- API -------------------------------------------------------------------------------------

def test_save_applies_immediately_and_reset_goes_back(client):
    body = client.put("/api/settings", json={"values": {"poll_interval_seconds": "20", "log_level": "DEBUG"}}).json()
    assert settings.poll_interval_seconds == 20.0 and _field(body, "poll_interval_seconds")["source"] == "app"
    assert logging.getLogger().level == logging.DEBUG
    assert yaml.safe_load(open(settings.app_settings_path)) == {"poll_interval_seconds": 20.0, "log_level": "DEBUG"}

    body = client.put("/api/settings", json={"values": {"poll_interval_seconds": None}}).json()
    assert settings.poll_interval_seconds == 15.0 and _field(body, "poll_interval_seconds")["source"] != "app"
    assert yaml.safe_load(open(settings.app_settings_path)) == {"log_level": "DEBUG"}


def test_a_bad_value_saves_nothing(client):
    resp = client.put("/api/settings", json={"values": {"poll_interval_seconds": "20", "snapshot_width": "5"}})
    assert resp.status_code == 400 and "Width" in resp.json()["detail"]
    assert settings.poll_interval_seconds == 15.0


def test_combination_rule_uses_the_values_being_saved(client):
    resp = client.put("/api/settings", json={"values": {"poll_interval_seconds": "60"}})
    assert resp.status_code == 400 and "Heartbeat" in resp.json()["detail"]
    ok = client.put("/api/settings", json={"values": {"poll_interval_seconds": "60", "heartbeat_interval_seconds": "120"}})
    assert ok.status_code == 200


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


def test_ollama_test_lists_models(client, monkeypatch):
    def handler(request):
        assert request.url.path == "/api/tags"
        return httpx.Response(200, json={"models": [{"name": "qwen2.5:14b"}, {"name": "llama3.1:8b"}]})
    real = httpx.AsyncClient
    monkeypatch.setattr(api_module.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    body = client.post("/api/settings/ollama/test", json={"url": "http://ollama:11434"}).json()
    assert body == {"ok": True, "error": None, "models": ["llama3.1:8b", "qwen2.5:14b"]}


def test_ollama_test_unreachable(client):
    body = client.post("/api/settings/ollama/test", json={"url": "http://127.0.0.1:1"}).json()
    assert body["ok"] is False and body["error"]
