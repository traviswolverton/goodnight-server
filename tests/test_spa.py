"""app/spa.py: serving the built React app, and how it coexists with the backend's own routes."""
from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI

from app.spa import _safe_file, router as spa_router

INDEX = "<!doctype html><title>Desk Dashboard</title><div id=root></div>"


@pytest.fixture
def dist(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text(INDEX)
    (tmp_path / "favicon.svg").write_text("<svg/>")
    (tmp_path / "assets" / "index-abc123.js").write_text("console.log(1)")
    (tmp_path.parent / "secret.txt").write_text("outside the dist dir")
    monkeypatch.setattr("app.settings.settings.frontend_dist_path", str(tmp_path))
    return tmp_path


def client(app: FastAPI | None = None) -> httpx.AsyncClient:
    if app is None:
        app = FastAPI()
        app.include_router(spa_router)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


@pytest.mark.parametrize("path", ["/", "/login", "/cards", "/users", "/some/deep/client/route"])
async def test_client_side_routes_get_the_shell_and_are_never_cached(dist, path):
    async with client() as c:
        r = await c.get(path)
    assert r.status_code == 200 and r.text == INDEX
    assert r.headers["cache-control"] == "no-store"      # so a new deploy is picked up at once


async def test_hashed_assets_are_cached_forever_and_other_static_files_briefly(dist):
    async with client() as c:
        asset = await c.get("/assets/index-abc123.js")
        icon = await c.get("/favicon.svg")
    assert asset.status_code == 200 and "immutable" in asset.headers["cache-control"]
    assert icon.status_code == 200 and icon.text == "<svg/>"
    assert "max-age=3600" in icon.headers["cache-control"]


async def test_missing_asset_is_a_404_not_the_shell(dist):
    async with client() as c:
        r = await c.get("/assets/gone.js")
    assert r.status_code == 404 and INDEX not in r.text


@pytest.mark.parametrize("path", ["/api/nope", "/api", "/schema/nope.json", "/snapshot", "/healthz/x"])
async def test_unknown_backend_paths_are_404_not_html(dist, path):
    """An API client hitting a mistyped URL must not be handed the SPA shell."""
    async with client() as c:
        r = await c.get(path)
    assert r.status_code == 404 and INDEX not in r.text


def test_path_traversal_cannot_escape_the_dist_directory(dist):
    assert _safe_file(dist, "favicon.svg") is not None
    assert _safe_file(dist, "../secret.txt") is None
    assert _safe_file(dist, "assets/../../secret.txt") is None
    assert _safe_file(dist, "/etc/passwd") is None
    assert _safe_file(dist, "assets") is None                 # a directory, not a file


async def test_clear_message_when_the_frontend_has_not_been_built(tmp_path, monkeypatch):
    monkeypatch.setattr("app.settings.settings.frontend_dist_path", str(tmp_path / "nothing-here"))
    async with client() as c:
        r = await c.get("/cards")
    assert r.status_code == 503 and "has not been built" in r.text


async def test_the_real_app_keeps_its_own_routes_ahead_of_the_catch_all(dist):
    """Regression guard for registration order: the SPA catch-all must come
    after everything the backend owns, including the /schema static mount."""
    from app.main import app

    async with client(app) as c:
        health = await c.get("/healthz")
        schema = await c.get("/schema/status_payload.schema.json")
        shell = await c.get("/login")
        api = await c.get("/api/cards")
        old = await c.get("/tools/lines-template")
    assert health.json() == {"ok": True}
    assert schema.status_code == 200 and schema.headers["content-type"].startswith("application/json")
    assert shell.text == INDEX and shell.headers["content-security-policy"].count("'unsafe-inline'") == 1
    assert api.status_code in (401, 503) and api.headers["content-type"].startswith("application/json")
    assert old.text == INDEX                                   # old bookmarks reach the SPA, which redirects them
