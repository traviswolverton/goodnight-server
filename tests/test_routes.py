"""Route tests using a lightweight test app — not app.main.app directly,
since that one's lifespan connects to a real MQTT broker and loads real
adapters on startup. These routes only need app.state set up."""
from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import router as api_router
from app.models import AdapterResult
from app.routes import router
from tests.auth_helpers import bypass_auth


def _client() -> TestClient:
    test_app = FastAPI()
    bypass_auth(test_app)
    test_app.include_router(router)
    test_app.include_router(api_router)
    return TestClient(test_app)


def test_healthz_is_a_plain_ok():
    assert _client().get("/healthz").json() == {"ok": True}


# --- /api/mqtt-reference ---------------------------------------------------

def test_mqtt_reference_lists_the_device_topics_from_the_real_settings():
    topics = {t["topic"]: t for t in _client().get("/api/mqtt-reference").json()["topics"]}
    assert set(topics) == {"bedside/config", "bedside/sound", "bedside/sensors", "bedside/button",
                           "bedside/availability"}
    assert topics["bedside/sound"]["direction"] == "server → device" and not topics["bedside/sound"]["retained"]
    assert topics["bedside/button"]["example"] == {"button": 3, "press": "long"}


# --- /api/overview ---------------------------------------------------------

def _overview_client(results, adapters, last_poll_ts=1700000000.0, connected=True, db=True):
    app = FastAPI()
    bypass_auth(app)
    app.include_router(api_router)
    app.state.aggregator = SimpleNamespace(latest_results=results, adapters=adapters, last_poll_ts=last_poll_ts)
    app.state.device_link = SimpleNamespace(state=SimpleNamespace(link_connected=connected))
    app.state.database = SimpleNamespace(available=db)
    return TestClient(app)


def test_overview_reports_adapter_health_without_leaking_connection_details():
    adapters = [SimpleNamespace(name="adguard_main", type_name="adguard", base_url="http://192.0.2.9", password="hunter2"),
                SimpleNamespace(name="nas", type_name="truenas", api_key="sekrit")]
    results = {"adguard_main": AdapterResult(name="adguard_main", status="warn", detail="3 blocked")}
    resp = _overview_client(results, adapters).get("/api/overview")
    body = resp.json()
    assert body["adapters"] == [
        {"name": "adguard_main", "type": "adguard", "status": "warn", "detail": "3 blocked",
         "reason": "3 blocked"},   # no status_reason of its own: the detail stands in
        {"name": "nas", "type": "truenas", "status": "unknown", "detail": None, "reason": None},
    ]
    assert body["last_poll_ts"] == 1700000000.0
    assert body["mqtt_connected"] is True and body["database_available"] is True
    for secret in ("192.0.2.9", "hunter2", "sekrit"):
        assert secret not in resp.text


def test_overview_before_the_first_poll_and_with_mqtt_or_db_down():
    body = _overview_client({}, [], last_poll_ts=None, connected=False, db=False).get("/api/overview").json()
    assert body["last_poll_ts"] is None
    assert body["mqtt_connected"] is False and body["database_available"] is False


def test_overview_reports_version_and_uptime_for_the_footer(monkeypatch):
    monkeypatch.setattr("app.settings.settings.app_version", "1.2.3")
    body = _overview_client({}, []).get("/api/overview").json()
    assert body["version"] == "1.2.3" and body["uptime_seconds"] >= 0


def test_overview_reason_prefers_the_adapters_own_and_never_shows_a_raw_fetch_error():
    adapters = [SimpleNamespace(name="ha", type_name="home_assistant"),
                SimpleNamespace(name="nas", type_name="truenas"),
                SimpleNamespace(name="kuma", type_name="uptime_kuma")]
    results = {
        "ha": AdapterResult(name="ha", status="warn", detail="Garage unavailable",
                            context={"status_reason": "Home Assistant has no reading for: Garage."}),
        "nas": AdapterResult(name="nas", status="down", detail="fetch failed"),
        "kuma": AdapterResult(name="kuma", status="ok", detail="71 up"),
    }
    reasons = {a["name"]: a["reason"] for a in
               _overview_client(results, adapters).get("/api/overview").json()["adapters"]}
    assert reasons["ha"] == "Home Assistant has no reading for: Garage."
    assert "app log" in reasons["nas"]
    assert reasons["kuma"] is None


def test_overview_lists_adapters_alphabetically():
    adapters = [SimpleNamespace(name=n, type_name="x") for n in ("unifi", "Adguard_backup", "home")]
    names = [a["name"] for a in _overview_client({}, adapters).get("/api/overview").json()["adapters"]]
    assert names == ["Adguard_backup", "home", "unifi"]
