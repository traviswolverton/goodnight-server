"""Home Assistant: the one service this app acts on. Buttons run Actions
through it, and an Action's state text reads entity states from it.

Read on demand, never polled: the only things that use a state are the
web UI's Actions page (its state beside each label, and the editor's
Preview) and an Action's `verify` check, so each asks when it needs to.

The connection (URL, token, TLS check) is set on the Settings page and
saved in config/connections.yaml (app/connections.py). A save swaps the
client in place (HomeAssistantLink.replace) — no restart.

Auth is a long-lived access token (Profile → Security in Home
Assistant). A token has its user's full permissions, so make it on a
dedicated non-admin user. The token never leaves this server; the device
only ever sends a button number.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

#: What the `event` action kind fires; an automation triggers on it with
#: `platform: event` / `event_type: bedside_dashboard_action`. (Not the desk
#: dashboard's name: both can share one Home Assistant without their events mixing.)
EVENT_TYPE = "bedside_dashboard_action"

#: Seconds any one request to Home Assistant may take.
REQUEST_TIMEOUT_SECONDS = 10.0

#: How long a full states read is reused. A page load renders every
#: action's state from one read, and the Preview button right after it
#: shouldn't need another.
STATES_CACHE_SECONDS = 2.0

#: How long the Home page's "is it reachable" answer is reused.
CHECK_CACHE_SECONDS = 30.0

#: Attributes never passed on to templates. Entity states reach the
#: Actions editor and AI-assist prompts, and Home Assistant puts secrets
#: and people's whereabouts in attributes: a camera's `access_token` (and
#: an `entity_picture` URL carrying it) opens its image, and a person or
#: device_tracker has live GPS coordinates. Found 2026-09-27 on the live
#: install. Matched on the attribute name, case-insensitively; anything
#: containing one of the SENSITIVE_WORDS is dropped too (a future
#: integration's `api_key`).
SENSITIVE_ATTRIBUTES = {
    "access_token", "entity_picture", "entity_picture_local",
    "latitude", "longitude", "altitude", "gps_accuracy", "course", "speed",
    "vertical_accuracy", "user_id", "device_trackers",
}
SENSITIVE_WORDS = ("token", "password", "secret", "api_key", "apikey", "credential")


def _safe_attributes(attributes: dict) -> dict:
    return {
        k: v for k, v in attributes.items()
        if k.lower() not in SENSITIVE_ATTRIBUTES and not any(w in k.lower() for w in SENSITIVE_WORDS)
    }


def entity_view(raw: dict) -> dict[str, object]:
    """One entity as templates see it: `states['light.desk'].state`."""
    entity_id = str(raw.get("entity_id", ""))
    attributes = raw.get("attributes") or {}
    return {
        "entity_id": entity_id,
        "domain": entity_id.split(".", 1)[0],
        "state": str(raw.get("state", "")),
        "name": attributes.get("friendly_name") or entity_id,
        "unit": attributes.get("unit_of_measurement") or "",
        "attributes": _safe_attributes(attributes),
        "last_changed": raw.get("last_changed"),
    }


class HomeAssistant:
    """A client for one Home Assistant instance's REST API."""

    def __init__(self, base_url: str, token: str, verify_ssl: bool = True) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.verify_ssl = verify_ssl
        # httpx can only turn verification off per client, not per request,
        # so without it this owns a private client; aclose() releases it.
        self._own_client: httpx.AsyncClient | None = None

    def _http(self, shared: httpx.AsyncClient) -> httpx.AsyncClient:
        if self.verify_ssl:
            return shared
        if self._own_client is None:
            self._own_client = httpx.AsyncClient(verify=False)
        return self._own_client

    async def aclose(self) -> None:
        if self._own_client is not None:
            await self._own_client.aclose()
            self._own_client = None

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    async def _get(self, client: httpx.AsyncClient, path: str) -> object:
        resp = await self._http(client).get(f"{self.base_url}{path}", headers=self._headers,
                                            timeout=REQUEST_TIMEOUT_SECONDS)
        resp.raise_for_status()
        return resp.json()

    async def _post(self, client: httpx.AsyncClient, path: str, body: dict) -> None:
        resp = await self._http(client).post(f"{self.base_url}{path}", headers=self._headers, json=body,
                                             timeout=REQUEST_TIMEOUT_SECONDS)
        resp.raise_for_status()

    async def check(self, client: httpx.AsyncClient) -> dict[str, object]:
        """Reach it and sign in: what the Settings page's Test shows."""
        config = await self._get(client, "/api/config")
        config = config if isinstance(config, dict) else {}
        return {"version": config.get("version"), "location_name": config.get("location_name")}

    async def states(self, client: httpx.AsyncClient) -> dict[str, dict[str, object]]:
        """Every entity, by id — what state templates render against."""
        raw = await self._get(client, "/api/states")
        views = (entity_view(item) for item in (raw if isinstance(raw, list) else []) if isinstance(item, dict))
        return {str(v["entity_id"]): v for v in views}

    async def catalog(self, client: httpx.AsyncClient) -> dict[str, object]:
        """Every entity and service: what the Actions editor's pickers offer."""
        states = await self.states(client)
        services = await self._get(client, "/api/services")
        entities = [{"id": v["entity_id"], "name": v["name"], "state": v["state"]}
                    for _, v in sorted(states.items())]
        service_names = sorted(
            f"{domain['domain']}.{service}"
            for domain in (services if isinstance(services, list) else []) if isinstance(domain, dict)
            for service in (domain.get("services") or {})
        )
        return {"entities": entities, "services": service_names}

    async def run_action(self, client: httpx.AsyncClient, action) -> str:
        """Perform `action` (an app.actions.ActionConfig). Raises on
        failure; returns the short text shown on success."""
        data = dict(action.data or {})
        if action.kind == "service":
            domain, _, service = (action.service or "").partition(".")
            if not domain or not service:
                raise ValueError(f"service must look like 'light.toggle', got {action.service!r}")
            if action.target:
                data["entity_id"] = action.target
            await self._post(client, f"/api/services/{domain}/{service}", data)
        elif action.kind == "script":
            if not (action.target or "").startswith("script."):
                raise ValueError(f"a script action needs a script.* entity, got {action.target!r}")
            await self._post(client, "/api/services/script/turn_on", {"entity_id": action.target, **(
                {"variables": data} if data else {})})
        elif action.kind == "event":
            await self._post(client, f"/api/events/{EVENT_TYPE}",
                             {**data, "action": action.id, "label": action.label})
        else:
            raise ValueError(f"Home Assistant can't run a {action.kind!r} action")
        return "Done"

    async def read_states(self, client: httpx.AsyncClient, entity_ids: list[str]) -> dict[str, str | None]:
        """One GET /api/states/<id> per entity, read fresh — what a verify
        check watches. None for an entity that doesn't exist."""
        states: dict[str, str | None] = {}
        for entity_id in entity_ids:
            resp = await self._http(client).get(f"{self.base_url}/api/states/{entity_id}",
                                                headers=self._headers, timeout=REQUEST_TIMEOUT_SECONDS)
            if resp.status_code == 404:
                states[entity_id] = None
                continue
            resp.raise_for_status()
            states[entity_id] = str(resp.json().get("state"))
        return states


@dataclass
class _Cached:
    at: float
    value: object


class HomeAssistantLink:
    """The app's current Home Assistant (or None when it isn't set up),
    shared by everything that uses it, with short-lived caches of the
    reads a page load repeats."""

    def __init__(self, ha: HomeAssistant | None, client: httpx.AsyncClient) -> None:
        self.ha = ha
        self.client = client
        self._states: _Cached | None = None
        self._check: _Cached | None = None

    async def replace(self, ha: HomeAssistant | None) -> None:
        """Use a newly saved connection from now on."""
        old, self.ha = self.ha, ha
        self._states = self._check = None
        if old is not None:
            await old.aclose()

    async def aclose(self) -> None:
        if self.ha is not None:
            await self.ha.aclose()

    async def states(self) -> dict[str, dict[str, object]]:
        """Every entity (see HomeAssistant.states), reused for a moment.
        Empty when it isn't set up; raises when it can't be read."""
        ha = self.ha
        if ha is None:
            return {}
        now = time.monotonic()
        if self._states is None or now - self._states.at > STATES_CACHE_SECONDS:
            self._states = _Cached(now, await ha.states(self.client))
        return self._states.value  # type: ignore[return-value]

    async def status(self) -> str:
        """"not_set_up", "connected" or "unreachable", reused for a while
        (the Home page asks every few seconds)."""
        ha = self.ha
        if ha is None:
            return "not_set_up"
        now = time.monotonic()
        if self._check is None or now - self._check.at > CHECK_CACHE_SECONDS:
            try:
                await ha.check(self.client)
                result = "connected"
            except Exception:  # noqa: BLE001 - any failure means "unreachable"
                result = "unreachable"
            self._check = _Cached(now, result)
        return self._check.value  # type: ignore[return-value]
