"""Default-deny: every route on the real app must require authentication,
unless it's on the explicit public allowlist below. Adding a route without
protecting it fails this test — that's the point."""
from __future__ import annotations

from fastapi.routing import APIRoute

from app.auth.deps import (
    audit_writes,
    current_user,
    require_admin,
    require_admin_for_writes,
    snapshot_access,
)
from app.main import app

#: path -> why it's allowed to be reachable without a session.
PUBLIC = {
    "/healthz": "liveness probe",
    "/api/auth/login": "the login itself (rate limited)",
    "/schema": "static JSON Schema files (decided: public)",
    # The React shell and its bundle: static files with no data in them; the
    # login screen is part of the app. What the app shows comes from /api.
    "/assets/{path:path}": "hashed JS/CSS bundle",
    "/{path:path}": "SPA shell (index.html) for client-side routes",
}
PROTECTORS = {current_user, require_admin, require_admin_for_writes, snapshot_access}


def _calls(dependant):
    yield dependant.call
    for sub in dependant.dependencies:
        yield from _calls(sub)


def test_every_route_is_protected_or_explicitly_public():
    unprotected = []
    for route in app.routes:
        path = getattr(route, "path", "")
        if path in PUBLIC:
            continue
        if isinstance(route, APIRoute) and PROTECTORS & set(_calls(route.dependant)):
            continue
        unprotected.append(f"{sorted(getattr(route, 'methods', []) or [])} {path}")
    assert not unprotected, f"routes with no authentication: {unprotected}"


def test_public_allowlist_has_no_stale_entries():
    paths = {getattr(r, "path", "") for r in app.routes}
    assert set(PUBLIC) <= paths, f"stale allowlist entries: {set(PUBLIC) - paths}"


def test_swagger_and_openapi_endpoints_are_not_exposed():
    """FastAPI's built-in /docs, /redoc, /openapi.json would publish the
    whole API surface to anonymous visitors."""
    paths = {getattr(r, "path", "") for r in app.routes}
    assert not paths & {"/docs", "/redoc", "/openapi.json"}


def test_every_state_changing_api_route_is_audited_or_self_auditing():
    self_auditing = {"/api/auth/login", "/api/auth/logout", "/api/auth/change-password",
                     "/api/users", "/api/users/{user_id}", "/api/users/{user_id}/reset-password"}
    missing = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api/"):
            continue
        writes = route.methods & {"POST", "PUT", "PATCH", "DELETE"}
        if not writes or route.path in self_auditing:
            continue
        if audit_writes in set(_calls(route.dependant)):
            continue
        # previews are read-only by design: viewers may call them, nothing is saved
        if route.path in {"/api/preview", "/api/preview-status", "/api/preview-pixel-color"}:
            continue
        missing.append(f"{sorted(writes)} {route.path}")
    assert not missing, f"state-changing routes that don't write an audit entry: {missing}"


def test_previews_are_the_only_write_verbs_open_to_viewers():
    """Viewers get every GET plus the preview POSTs; nothing else state-changing."""
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api/"):
            continue
        if not (route.methods & {"POST", "PUT", "PATCH", "DELETE"}):
            continue
        calls = set(_calls(route.dependant))
        admin_gated = bool(calls & {require_admin, require_admin_for_writes}) or route.path.startswith("/api/auth/")
        viewer_ok = {"/api/preview", "/api/preview-status", "/api/preview-pixel-color"}
        assert admin_gated or route.path in viewer_ok, route.path
