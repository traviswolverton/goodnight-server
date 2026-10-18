"""Home Assistant (app/home_assistant.py) using httpx.MockTransport — no real network."""
from __future__ import annotations

import json

import httpx
import pytest

from app.actions import ActionConfig
from app.home_assistant import HomeAssistant, HomeAssistantLink

STATES = [
    {"entity_id": "sensor.office_temperature", "state": "21.5",
     "attributes": {"friendly_name": "Office temperature", "unit_of_measurement": "°C"},
     "last_changed": "2026-09-26T08:00:00+00:00"},
    {"entity_id": "light.desk", "state": "on", "attributes": {"friendly_name": "Desk lamp"}},
    {"entity_id": "binary_sensor.front_door", "state": "unavailable", "attributes": {}},
    {"entity_id": "binary_sensor.back_door", "state": "off", "attributes": {"friendly_name": "Back door"}},
    {"entity_id": "sensor.unwatched", "state": "1", "attributes": {}},
]


def _ha(**options) -> HomeAssistant:
    return HomeAssistant("http://ha.lan:8123/", "tok", **options)


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _states_handler(requests: list[httpx.Request] | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        if requests is not None:
            requests.append(request)
        assert request.headers["Authorization"] == "Bearer tok"
        if request.url.path == "/api/states":
            return httpx.Response(200, json=STATES)
        if request.url.path == "/api/services":
            return httpx.Response(200, json=[
                {"domain": "light", "services": {"toggle": {}, "turn_on": {}}},
                {"domain": "script", "services": {"turn_on": {}}},
            ])
        return httpx.Response(200, json=[])
    return handler


async def test_states_reads_every_entity_as_templates_see_it():
    async with _client(_states_handler()) as client:
        states = await _ha().states(client)
    assert sorted(states) == sorted(e["entity_id"] for e in STATES)
    temp = states["sensor.office_temperature"]
    assert temp["state"] == "21.5"
    assert temp["name"] == "Office temperature"
    assert temp["unit"] == "°C"
    assert temp["domain"] == "sensor"
    # No friendly_name: the id stands in, so a template never shows blank.
    assert states["binary_sensor.front_door"]["name"] == "binary_sensor.front_door"


async def test_states_raises_on_a_bad_token():
    async with _client(lambda request: httpx.Response(401, json={"message": "Invalid"})) as client:
        with pytest.raises(httpx.HTTPStatusError):
            await _ha().states(client)


async def test_check_reports_the_version_and_location():
    def handler(request):
        assert request.url.path == "/api/config"
        return httpx.Response(200, json={"version": "2026.9.1", "location_name": "Home", "components": []})
    async with _client(handler) as client:
        assert await _ha().check(client) == {"version": "2026.9.1", "location_name": "Home"}


async def test_catalog_lists_every_entity_and_service():
    async with _client(_states_handler()) as client:
        catalog = await _ha().catalog(client)
    assert {"id": "light.desk", "name": "Desk lamp", "state": "on"} in catalog["entities"]
    assert len(catalog["entities"]) == len(STATES)
    assert catalog["services"] == ["light.toggle", "light.turn_on", "script.turn_on"]


async def _run(action: ActionConfig) -> httpx.Request:
    seen: list[httpx.Request] = []
    async with _client(_states_handler(seen)) as client:
        assert await _ha().run_action(client, action) == "Done"
    assert len(seen) == 1
    return seen[0]


async def test_service_action_posts_to_the_service_with_the_target():
    request = await _run(ActionConfig(id="lamp", label="Lamp", kind="service",
                                      service="light.turn_on", target="light.desk",
                                      data={"brightness_pct": 40}))
    assert request.method == "POST"
    assert request.url.path == "/api/services/light/turn_on"
    assert json.loads(request.content) == {"brightness_pct": 40, "entity_id": "light.desk"}


async def test_script_action_turns_the_script_on_with_variables():
    request = await _run(ActionConfig(id="movie", label="Movie", kind="script",
                                      target="script.movie_mode", data={"dim": True}))
    assert request.url.path == "/api/services/script/turn_on"
    assert json.loads(request.content) == {"entity_id": "script.movie_mode", "variables": {"dim": True}}


async def test_event_action_fires_bedside_dashboard_action_with_its_id():
    request = await _run(ActionConfig(id="bedtime", label="Bedtime", kind="event"))
    assert request.url.path == "/api/events/bedside_dashboard_action"
    assert json.loads(request.content) == {"action": "bedtime", "label": "Bedtime"}


@pytest.mark.parametrize("action", [
    ActionConfig(id="bad", label="Bad", kind="service", service="toggle"),
    ActionConfig(id="bad", label="Bad", kind="script", target="light.desk"),
])
async def test_malformed_actions_are_refused_before_any_request(action):
    async with _client(_states_handler()) as client:
        with pytest.raises(ValueError):
            await _ha().run_action(client, action)


async def test_secrets_and_whereabouts_never_reach_templates():
    """Found live 2026-09-27: a camera's access token and every person's GPS
    position were in the variables table, which viewer accounts can see."""
    states = [
        {"entity_id": "camera.front_door", "state": "streaming", "attributes": {
            "access_token": "abc123", "entity_picture": "/api/camera_proxy/camera.front_door?token=abc123",
            "friendly_name": "Front door", "brand": "Reolink", "Some_Api_Key": "k"}},
        {"entity_id": "person.travis", "state": "home", "attributes": {
            "latitude": 12.3456, "longitude": -65.4321, "gps_accuracy": 12, "friendly_name": "Travis",
            "in_zones": ["zone.home"], "user_id": "u1", "device_trackers": ["device_tracker.phone"]}},
    ]

    def handler(request):
        return httpx.Response(200, json=states)
    async with _client(handler) as client:
        result = await _ha().states(client)
    camera = result["camera.front_door"]["attributes"]
    person = result["person.travis"]["attributes"]
    assert camera == {"friendly_name": "Front door", "brand": "Reolink"}
    assert person == {"friendly_name": "Travis", "in_zones": ["zone.home"]}
    assert "abc123" not in repr(result) and "12.3456" not in repr(result)


async def test_read_states_reads_each_entity_fresh():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/api/states/cover.gone":
            return httpx.Response(404, json={"message": "Entity not found."})
        return httpx.Response(200, json={"entity_id": request.url.path.rsplit("/", 1)[1], "state": "closed"})

    async with _client(handler) as client:
        states = await _ha().read_states(client, ["cover.left", "cover.gone"])
    assert states == {"cover.left": "closed", "cover.gone": None}
    assert [r.url.path for r in requests] == ["/api/states/cover.left", "/api/states/cover.gone"]
    assert requests[0].headers["authorization"].startswith("Bearer ")


async def test_read_states_raises_on_a_bad_token():
    async with _client(lambda request: httpx.Response(401)) as client:
        with pytest.raises(httpx.HTTPStatusError):
            await _ha().read_states(client, ["cover.left"])


async def test_the_link_reuses_a_states_read_for_a_moment():
    requests: list[httpx.Request] = []
    async with _client(_states_handler(requests)) as client:
        link = HomeAssistantLink(_ha(), client)
        await link.states()
        await link.states()
    assert len(requests) == 1


async def test_the_link_without_home_assistant_has_no_states_and_says_so():
    link = HomeAssistantLink(None, None)
    assert await link.states() == {}
    assert await link.status() == "not_set_up"


async def test_the_link_status_says_unreachable_when_the_check_fails():
    async with _client(lambda request: httpx.Response(401)) as client:
        assert await HomeAssistantLink(_ha(), client).status() == "unreachable"


async def test_replacing_the_connection_drops_what_the_old_one_read():
    async with _client(_states_handler()) as client:
        link = HomeAssistantLink(_ha(), client)
        assert "light.desk" in await link.states()
        await link.replace(None)
        assert await link.states() == {}
