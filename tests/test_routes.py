"""Route tests using a lightweight test app — not app.main.app directly,
since that one's lifespan connects to a real MQTT broker and loads real
adapters on startup. These routes only need app.state.aggregator set."""
from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models import Overall, ServiceReading, StatusPayload
from app.api import router as api_router
from app.routes import router
from tests.auth_helpers import bypass_auth


def _client(latest_payload=None) -> TestClient:
    test_app = FastAPI()
    bypass_auth(test_app)
    test_app.include_router(router)
    test_app.include_router(api_router)
    test_app.state.aggregator = SimpleNamespace(latest_payload=latest_payload)
    return TestClient(test_app)
def test_healthz_is_a_plain_ok():
    assert _client().get("/healthz").json() == {"ok": True}


# --- /api/mqtt-reference ---------------------------------------------------

def test_mqtt_reference_exposes_both_schemas_and_the_real_client_limits():
    from app.models import ActionRequest, ActionResult
    from app.aggregator import (
        CLIENT_LINE_MAX_CHARS,
        CLIENT_MAX_SERVICES,
        CLIENT_NAME_MAX_CHARS,
        CLIENT_OVERALL_TEXT_MAX_CHARS,
    )

    data = _client().get("/api/mqtt-reference").json()
    assert data["status_schema"]["title"] and data["camera_schema"]["title"]
    assert data["status_schema_url"] == "/schema/status_payload.schema.json"
    # Read from the same constants the aggregator enforces (not retyped), so
    # this fails if they ever drift instead of passing against a stale copy.
    assert data["limits"] == {
        "title_max_chars": CLIENT_NAME_MAX_CHARS, "line_max_chars": list(CLIENT_LINE_MAX_CHARS),
        "overall_text_max_chars": CLIENT_OVERALL_TEXT_MAX_CHARS, "max_services": CLIENT_MAX_SERVICES,
    }
    assert "sig" in data["camera_example"]["snapshot_url"]          # documents the signed link
    assert data["action_topic"] == "bedside/action"
    assert data["action_result_topic"] == "bedside/action/result"
    assert ActionRequest.model_validate(data["action_example"])
    assert ActionResult.model_validate(data["action_result_example"])


def test_mqtt_reference_live_example_is_null_until_something_was_polled_then_real():
    assert _client(latest_payload=None).get("/api/mqtt-reference").json()["status_example"] is None
    payload = StatusPayload(
        overall=Overall(level="ok", text="All systems normal"),
        services=[ServiceReading(name="adguard_main", status="ok", title="AdGuard", lines=["1782070 blocked"])],
    )
    example = _client(latest_payload=payload).get("/api/mqtt-reference").json()["status_example"]
    assert example["services"][0]["lines"] == ["1782070 blocked"]


# --- /api/overview ---------------------------------------------------------

def _overview_client(results, adapters, payload=None, connected=True, published_at=1700000100.0, db=True):
    app = FastAPI()
    bypass_auth(app)
    app.include_router(api_router)
    app.state.aggregator = SimpleNamespace(
        latest_payload=payload, latest_results=results, adapters=adapters,
        publisher=SimpleNamespace(connected=connected), last_published_at=published_at)
    app.state.database = SimpleNamespace(available=db)
    return TestClient(app)


def test_overview_reports_adapter_health_without_leaking_connection_details():
    from app.models import AdapterResult

    adapters = [SimpleNamespace(name="adguard_main", type_name="adguard", base_url="http://192.0.2.9", password="hunter2"),
                SimpleNamespace(name="nas", type_name="truenas", api_key="sekrit")]
    results = {"adguard_main": AdapterResult(name="adguard_main", status="warn", detail="3 blocked")}
    payload = StatusPayload(ts=1700000000.0, overall=Overall(level="warn", text="1 warning"),
                            services=[])
    resp = _overview_client(results, adapters, payload).get("/api/overview")
    body = resp.json()
    assert body["adapters"] == [
        {"name": "adguard_main", "type": "adguard", "status": "warn", "detail": "3 blocked",
         "reason": "3 blocked"},   # no status_reason of its own: the detail stands in
        {"name": "nas", "type": "truenas", "status": "unknown", "detail": None, "reason": None},
    ]
    assert body["overall"] == {"level": "warn", "text": "1 warning"}
    assert body["last_poll_ts"] == 1700000000.0 and body["last_published_ts"] == 1700000100.0
    assert body["mqtt_connected"] is True and body["database_available"] is True
    for secret in ("192.0.2.9", "hunter2", "sekrit"):
        assert secret not in resp.text


def test_overview_before_the_first_poll_and_with_mqtt_or_db_down():
    body = _overview_client({}, [], payload=None, connected=False, published_at=None, db=False).get("/api/overview").json()
    assert body["overall"] is None and body["last_poll_ts"] is None and body["last_published_ts"] is None
    assert body["mqtt_connected"] is False and body["database_available"] is False


# --- MqttPublisher.connected ------------------------------------------------

async def test_publisher_connected_flag_follows_connect_failed_publish_and_reconnect(monkeypatch):
    import aiomqtt

    from app.mqtt import MqttPublisher

    class FakeClient:
        fail = False

        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return None
        async def publish(self, *a, **kw):
            if FakeClient.fail:
                FakeClient.fail = False               # the retry after reconnecting succeeds
                raise aiomqtt.MqttError("gone")

    monkeypatch.setattr("app.mqtt.aiomqtt.Client", FakeClient)
    pub = MqttPublisher()
    assert pub.connected is False
    await pub.connect()
    assert pub.connected is True
    FakeClient.fail = True
    await pub._publish("t", "p", retain=False)        # fails once, reconnects, retries
    assert pub.connected is True
    await pub.disconnect()
    assert pub.connected is False


def test_overview_reports_version_and_uptime_for_the_footer(monkeypatch):
    monkeypatch.setattr("app.settings.settings.app_version", "1.2.3")
    body = _overview_client({}, []).get("/api/overview").json()
    assert body["version"] == "1.2.3" and body["uptime_seconds"] >= 0


def test_overview_reason_prefers_the_adapters_own_and_never_shows_a_raw_fetch_error():
    from app.models import AdapterResult

    adapters = [SimpleNamespace(name="ha", type_name="home_assistant"),
                SimpleNamespace(name="nas", type_name="truenas"),
                SimpleNamespace(name="kuma", type_name="uptime_kuma")]
    results = {
        "ha": AdapterResult(name="ha", status="warn", detail="Garage unavailable",
                            context={"status_reason": "Home Assistant has no reading for: Garage."}),
        "nas": AdapterResult(name="nas", status="down", detail="fetch failed"),
        "kuma": AdapterResult(name="kuma", status="ok", detail="71 up"),
    }
    payload = StatusPayload(ts=1700000000.0, overall=Overall(level="warn", text="x"),
                            services=[])
    reasons = {a["name"]: a["reason"] for a in
               _overview_client(results, adapters, payload).get("/api/overview").json()["adapters"]}
    assert reasons["ha"] == "Home Assistant has no reading for: Garage."
    assert "app log" in reasons["nas"]
    assert reasons["kuma"] is None


def test_overview_lists_adapters_alphabetically():
    from app.models import AdapterResult

    adapters = [SimpleNamespace(name=n, type_name="x") for n in ("unifi", "Adguard_backup", "frigate")]
    payload = StatusPayload(ts=1700000000.0, overall=Overall(level="ok", text="x"),
                            services=[])
    names = [a["name"] for a in _overview_client({}, adapters, payload).get("/api/overview").json()["adapters"]]
    assert names == ["Adguard_backup", "frigate", "unifi"]
