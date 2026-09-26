"""Test helpers for the auth layer."""
from __future__ import annotations

from fastapi import FastAPI

from app.auth.deps import AuthContext, audit_writes, current_user, optional_user

ADMIN = AuthContext(user_id=1, username="test-admin", role="admin",
                    session_id="test-session", csrf_token="test-csrf")
VIEWER = AuthContext(user_id=2, username="test-viewer", role="viewer",
                     session_id="test-session-2", csrf_token="test-csrf")


def bypass_auth(app: FastAPI, ctx: AuthContext = ADMIN) -> FastAPI:
    """Make every route see `ctx` as the logged-in user (no database, no
    cookies, no CSRF) and skip audit writes. For tests of what a route DOES,
    not of who may call it — that's tests/test_auth_*.py."""
    app.dependency_overrides[optional_user] = lambda: ctx
    app.dependency_overrides[current_user] = lambda: ctx
    app.dependency_overrides[audit_writes] = lambda: None
    return app
