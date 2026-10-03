"""Route tests using a lightweight test app — not app.main.app directly,
since that one's lifespan connects to a real MQTT broker and Home
Assistant on startup. These routes only need app.state set up."""
from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import router as api_router
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
                           "bedside/availability", "bedside/stick", "bedside/diagnostics",
                           "bedside/diagnostics/request"}
    assert topics["bedside/diagnostics"]["retained"] and not topics["bedside/stick"]["retained"]
    assert topics["bedside/diagnostics/request"]["direction"] == "server → device"
    assert topics["bedside/sound"]["direction"] == "server → device" and not topics["bedside/sound"]["retained"]
    assert topics["bedside/button"]["example"] == {"button": 3, "press": "long"}


# --- /api/overview ---------------------------------------------------------

class _FakeHomeAssistant:
    def __init__(self, status: str) -> None:
        self._status = status

    async def status(self) -> str:
        return self._status


def _overview_client(ha="connected", connected=True, db=True):
    app = FastAPI()
    bypass_auth(app)
    app.include_router(api_router)
    app.state.home_assistant = _FakeHomeAssistant(ha)
    app.state.device_link = SimpleNamespace(state=SimpleNamespace(link_connected=connected))
    app.state.database = SimpleNamespace(available=db)
    return TestClient(app)


def test_overview_reports_each_connection():
    body = _overview_client().get("/api/overview").json()
    assert (body["home_assistant"], body["mqtt_connected"], body["database_available"]) == ("connected", True, True)
    assert body["uptime_seconds"] >= 0 and body["version"]
    body = _overview_client("unreachable", connected=False, db=False).get("/api/overview").json()
    assert (body["home_assistant"], body["mqtt_connected"], body["database_available"]) == ("unreachable", False, False)
