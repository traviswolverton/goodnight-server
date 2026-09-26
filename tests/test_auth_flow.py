"""Authentication end to end: real Database (the real Alembic migrations, run
against a temp SQLite file), real sessions, real cookies — the auth layer is
NOT stubbed here. See tests/auth_helpers.py for the bypass other suites use."""
from __future__ import annotations

import asyncio
import os
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select, text

from app.api import router as api_router
from app.auth import service
from app.auth.bootstrap import bootstrap_admin
from app.auth.models import AuditLog, UserSession, utcnow
from app.auth.ratelimit import LoginRateLimiter
from app.db import Database
from app.routes import router as routes_router
from app.security_headers import SecurityHeadersMiddleware

PW = "correct horse battery"
PW2 = "another long passphrase"


@pytest.fixture
async def env(tmp_path, monkeypatch):
    monkeypatch.setattr("app.api.auth.limiter", LoginRateLimiter())
    # SQLite by default; set TEST_DATABASE_URL (a scratch Postgres!) to run the
    # same suite against the real thing — its tables are truncated after each test.
    pg_url = os.environ.get("TEST_DATABASE_URL")
    db = Database(pg_url or f"sqlite+aiosqlite:///{tmp_path}/auth.db")
    db.start()
    for _ in range(200):
        if db.available:
            break
        await asyncio.sleep(0.05)
    assert db.available, "migrations should apply and the DB come up"
    app = FastAPI()
    for r in (api_router, routes_router):
        app.include_router(r)
    app.add_middleware(SecurityHeadersMiddleware)
    app.state.database = db
    app.state.aggregator = SimpleNamespace(cards=[], latest_results={}, adapters=[], latest_payload=None,
                                           get_card=lambda name: None)
    yield SimpleNamespace(app=app, db=db)
    if pg_url:
        db.available = True
        async with db.session() as s:
            await s.execute(text("TRUNCATE users, sessions, audit_log RESTART IDENTITY CASCADE"))
            await s.commit()
    await db.stop()


@pytest.fixture
async def seeded(env):
    async with env.db.session() as s:
        await service.create_user(s, "alice", PW, "admin")
        await service.create_user(s, "bob", PW, "viewer")
        await s.commit()
    return env


def new_client(env) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=env.app), base_url="http://test")


async def login(client, username="alice", password=PW) -> str:
    r = await client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["csrf_token"]


async def audit_actions(env) -> list[str]:
    async with env.db.session() as s:
        return [r.action for r in (await s.execute(select(AuditLog).order_by(AuditLog.id))).scalars()]


# --- login / session --------------------------------------------------------

async def test_login_sets_httponly_samesite_cookie_and_never_stores_the_raw_token(seeded):
    async with new_client(seeded) as c:
        r = await c.post("/api/auth/login", json={"username": "Alice", "password": PW})   # case-insensitive
        assert r.status_code == 200 and r.json()["user"]["role"] == "admin"
        cookie = r.headers["set-cookie"]
        assert cookie.startswith("dd_session=") and "HttpOnly" in cookie and "SameSite=lax" in cookie
        token = c.cookies["dd_session"]
    async with seeded.db.session() as s:
        ids = [x.id for x in (await s.execute(select(UserSession))).scalars()]
    assert ids == [service.hash_token(token)] and token not in ids     # only the hash is stored


async def test_bad_logins_are_indistinguishable(seeded):
    async with seeded.db.session() as s:
        (await service.get_user_by_username(s, "bob")).is_active = False
        await s.commit()
    async with new_client(seeded) as c:
        results = [await c.post("/api/auth/login", json={"username": u, "password": p})
                   for u, p in (("alice", "wrong password!!"), ("nobody", PW), ("bob", PW))]
    assert {r.status_code for r in results} == {401}
    assert len({r.json()["detail"] for r in results}) == 1               # same message for all three
    assert "login.failed" in await audit_actions(seeded)


async def test_me_requires_a_session_and_returns_the_csrf_token(seeded):
    async with new_client(seeded) as c:
        assert (await c.get("/api/auth/me")).status_code == 401
        token = await login(c)
        me = (await c.get("/api/auth/me")).json()
        assert me["user"]["username"] == "alice" and me["csrf_token"] == token
        assert "password_hash" not in str(me) and "$argon2" not in str(me)


async def test_logout_revokes_the_session_server_side(seeded):
    async with new_client(seeded) as c:
        csrf = await login(c)
        old_cookie = c.cookies["dd_session"]
        assert (await c.post("/api/auth/logout", headers={"X-CSRF-Token": csrf})).status_code == 200
        c.cookies.set("dd_session", old_cookie)          # replay the stolen/old cookie
        assert (await c.get("/api/auth/me")).status_code == 401


@pytest.mark.parametrize("field,delta", [("expires_at", timedelta(seconds=-1)),
                                         ("last_seen_at", timedelta(hours=-25))])
async def test_absolute_and_idle_expiry(seeded, field, delta):
    async with new_client(seeded) as c:
        await login(c)
        async with seeded.db.session() as s:
            row = (await s.execute(select(UserSession))).scalar_one()
            setattr(row, field, utcnow() + delta)
            await s.commit()
        assert (await c.get("/api/auth/me")).status_code == 401


# --- CSRF -------------------------------------------------------------------

async def test_state_changing_requests_need_the_csrf_header(seeded):
    async with new_client(seeded) as c:
        csrf = await login(c)
        body = {"username": "carol", "password": PW, "role": "viewer"}
        assert (await c.post("/api/users", json=body)).status_code == 403
        assert (await c.post("/api/users", json=body, headers={"X-CSRF-Token": "wrong"})).status_code == 403
        assert (await c.post("/api/users", json=body, headers={"X-CSRF-Token": csrf})).status_code == 201


# --- roles ------------------------------------------------------------------

async def test_viewer_can_read_and_preview_but_not_write_or_see_admin_areas(seeded):
    async with new_client(seeded) as c:
        h = {"X-CSRF-Token": await login(c, "bob")}
        assert (await c.get("/api/cards")).status_code == 200
        assert (await c.get("/api/status")).status_code == 503                    # authorised: just no payload yet
        # preview is allowed for viewers (404 = auth passed, card doesn't exist)
        assert (await c.post("/api/preview", json={"card": "x", "templates": []}, headers=h)).status_code == 404
        for method, path, body in (("POST", "/api/save-render", {"card": "x", "render": True}),
                                   ("POST", "/api/save", {"card": "x"}),
                                   ("POST", "/api/restart", None),
                                   ("GET", "/api/adapters", None),
                                   ("GET", "/api/users", None),
                                   ("GET", "/api/audit-log", None)):
            r = await c.request(method, path, json=body, headers=h)
            assert r.status_code == 403, (method, path, r.status_code)


async def test_admin_writes_are_audited_without_leaking_secrets(seeded):
    async with new_client(seeded) as c:
        h = {"X-CSRF-Token": await login(c)}
        r = await c.post("/api/add-adapter", headers=h,
                         json={"type": "nope", "name": "ag", "fields": {"password": "hunter2-secret"}})
        assert r.status_code == 400                                          # unknown type, but attempted
        entries = (await c.get("/api/audit-log")).json()["entries"]
    hit = next(e for e in entries if e["action"] == "api.add_adapter_endpoint")
    assert hit["username"] == "alice" and hit["detail"] == {"type": "nope", "name": "ag"}
    assert "hunter2-secret" not in str(entries)


# --- brute force ------------------------------------------------------------

async def test_repeated_failures_lock_the_account_out_even_for_the_right_password(seeded):
    async with new_client(seeded) as c:
        for _ in range(8):
            assert (await c.post("/api/auth/login", json={"username": "alice", "password": "nope-nope-nope"})).status_code == 401
        blocked = await c.post("/api/auth/login", json={"username": "alice", "password": PW})
        assert blocked.status_code == 429 and int(blocked.headers["Retry-After"]) > 0
        assert (await c.post("/api/auth/login", json={"username": "bob", "password": PW})).status_code == 200


def test_rate_limiter_window_and_success_reset():
    now = [0.0]
    lim = LoginRateLimiter(max_per_account=3, max_per_ip=100, window_seconds=60, clock=lambda: now[0])
    for _ in range(3):
        lim.record_failure("1.1.1.1", "u")
    assert lim.retry_after("1.1.1.1", "U") > 0                               # case-insensitive key
    now[0] = 61
    assert lim.retry_after("1.1.1.1", "u") == 0                              # window passed
    for _ in range(3):
        lim.record_failure(None, "u")
    lim.record_success("u")
    assert lim.retry_after(None, "u") == 0


def test_rate_limiter_also_throttles_one_ip_across_many_usernames():
    lim = LoginRateLimiter(max_per_account=100, max_per_ip=3)
    for i in range(3):
        lim.record_failure("9.9.9.9", f"user{i}")
    assert lim.retry_after("9.9.9.9", "someone-new") > 0
    assert lim.retry_after("8.8.8.8", "someone-new") == 0


# --- user management --------------------------------------------------------

async def test_user_lifecycle_and_guard_rails(seeded):
    async with new_client(seeded) as c:
        h = {"X-CSRF-Token": await login(c)}
        r = await c.post("/api/users", headers=h, json={"username": "carol", "password": "short", "role": "viewer"})
        assert r.status_code == 400 and "12 characters" in r.json()["detail"]
        assert (await c.post("/api/users", headers=h, json={"username": "ALICE", "password": PW})).status_code == 400
        assert (await c.post("/api/users", headers=h, json={"username": "x", "password": PW, "role": "root"})).status_code == 400
        users = {u["username"]: u for u in (await c.get("/api/users")).json()["users"]}
        assert set(users) == {"alice", "bob"} and "password_hash" not in str(users)

        # can't strand the system with no administrator
        alice = users["alice"]["id"]
        assert (await c.patch(f"/api/users/{alice}", headers=h, json={"role": "viewer"})).status_code == 400
        assert (await c.patch(f"/api/users/{alice}", headers=h, json={"is_active": False})).status_code == 400
        assert (await c.delete(f"/api/users/{alice}", headers=h)).status_code == 400

        # ...but with a second admin, demotion is fine
        bob = users["bob"]["id"]
        assert (await c.patch(f"/api/users/{bob}", headers=h, json={"role": "admin"})).status_code == 200
        assert (await c.patch(f"/api/users/{alice}", headers=h, json={"role": "viewer"})).status_code == 200
    assert {"user.update"} <= set(await audit_actions(seeded))


async def test_deactivating_or_resetting_a_user_kills_their_sessions(seeded):
    async with new_client(seeded) as admin, new_client(seeded) as bob_client, new_client(seeded) as bob2:
        h = {"X-CSRF-Token": await login(admin)}
        await login(bob_client, "bob")
        await login(bob2, "bob")
        bob_id = next(u["id"] for u in (await admin.get("/api/users")).json()["users"] if u["username"] == "bob")

        assert (await bob_client.get("/api/auth/me")).status_code == 200
        assert (await admin.post(f"/api/users/{bob_id}/reset-password", headers=h, json={"password": PW2})).status_code == 200
        assert (await bob_client.get("/api/auth/me")).status_code == 401
        assert (await bob2.get("/api/auth/me")).status_code == 401
        async with new_client(seeded) as fresh:
            assert (await fresh.post("/api/auth/login", json={"username": "bob", "password": PW})).status_code == 401
            await login(fresh, "bob", PW2)

        await admin.patch(f"/api/users/{bob_id}", headers=h, json={"is_active": False})
        async with new_client(seeded) as fresh:
            assert (await fresh.post("/api/auth/login", json={"username": "bob", "password": PW2})).status_code == 401


async def test_change_password_verifies_current_and_logs_out_other_sessions(seeded):
    async with new_client(seeded) as here, new_client(seeded) as elsewhere:
        h = {"X-CSRF-Token": await login(here)}
        await login(elsewhere)
        bad = await here.post("/api/auth/change-password", headers=h,
                              json={"current_password": "not-my-password", "new_password": PW2})
        assert bad.status_code == 400
        ok = await here.post("/api/auth/change-password", headers=h,
                             json={"current_password": PW, "new_password": PW2})
        assert ok.status_code == 200
        assert (await here.get("/api/auth/me")).status_code == 200            # this session survives
        assert (await elsewhere.get("/api/auth/me")).status_code == 401        # the other one doesn't


# --- pages, headers, redirects ---------------------------------------------

async def test_security_headers_and_no_store_on_api(seeded):
    async with new_client(seeded) as c:
        r = await c.get("/healthz")
        assert r.status_code == 200                                              # the one open route
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["x-frame-options"] == "DENY"
        assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
        assert (await c.get("/api/auth/me")).headers["cache-control"] == "no-store"
        strict = r.headers["content-security-policy"]
        assert "script-src 'self';" in strict and "script-src 'self' 'unsafe-inline'" not in strict
        assert "'unsafe-inline'" not in strict.split("style-src")[0]      # no inline scripts anywhere
        assert "strict-transport-security" not in r.headers                      # only when HTTPS_ONLY


async def test_https_only_marks_cookie_secure_host_prefixed_and_sends_hsts(seeded, monkeypatch):
    monkeypatch.setattr("app.settings.settings.https_only", True)
    async with new_client(seeded) as c:
        r = await c.post("/api/auth/login", json={"username": "alice", "password": PW})
        cookie = r.headers["set-cookie"]
        assert cookie.startswith("__Host-dd_session=") and "Secure" in cookie
        assert "strict-transport-security" in r.headers


# --- bootstrap & degraded mode ---------------------------------------------

async def test_bootstrap_creates_the_first_admin_once(env, monkeypatch):
    monkeypatch.setattr("app.settings.settings.admin_username", "Owner")
    monkeypatch.setattr("app.settings.settings.admin_password", PW)
    await bootstrap_admin(env.db)
    await bootstrap_admin(env.db)                                               # second run: no-op
    async with env.db.session() as s:
        assert await service.count_users(s) == 1
        assert (await service.get_user_by_username(s, "owner")).role == "admin"
    async with new_client(env) as c:
        await login(c, "owner")


async def test_bootstrap_does_nothing_without_credentials_or_when_users_exist(env, seeded, monkeypatch):
    monkeypatch.setattr("app.settings.settings.admin_username", "mallory")
    monkeypatch.setattr("app.settings.settings.admin_password", PW)
    await bootstrap_admin(env.db)                                               # users already exist
    async with env.db.session() as s:
        assert await service.get_user_by_username(s, "mallory") is None


async def test_when_the_database_is_down_auth_answers_503_and_healthz_still_works(seeded):
    seeded.db.available = False
    async with new_client(seeded) as c:
        assert (await c.get("/healthz")).status_code == 200
        assert (await c.get("/api/auth/me")).status_code == 503
        assert (await c.post("/api/auth/login", json={"username": "alice", "password": PW})).status_code == 503


# --- hardening (phase 5) ----------------------------------------------------

async def test_change_password_is_rate_limited_so_a_hijacked_session_cannot_guess_it(seeded):
    async with new_client(seeded) as c:
        h = {"X-CSRF-Token": await login(c)}
        bad = {"current_password": "not-the-password", "new_password": PW2}
        for _ in range(8):
            assert (await c.post("/api/auth/change-password", headers=h, json=bad)).status_code == 400
        blocked = await c.post("/api/auth/change-password", headers=h,
                               json={"current_password": PW, "new_password": PW2})     # even the right one
        assert blocked.status_code == 429 and int(blocked.headers["Retry-After"]) > 0
        assert (await c.get("/api/auth/me")).status_code == 200                        # login itself unaffected
    assert "password.change_failed" in await audit_actions(seeded)


async def test_audit_pruning_removes_only_old_rows_and_zero_keeps_everything(seeded):
    from datetime import timedelta

    from app.auth.retention import prune_audit_log

    async with seeded.db.session() as s:
        await service.record_audit(s, "old.event", username="x")
        await service.record_audit(s, "new.event", username="x")
        await s.flush()
        old = (await s.execute(select(AuditLog).where(AuditLog.action == "old.event"))).scalar_one()
        old.ts = utcnow() - timedelta(days=400)
        await s.commit()

    await prune_audit_log(seeded.db)                                   # default: 365 days
    actions = await audit_actions(seeded)
    assert "old.event" not in actions and "new.event" in actions

    async with seeded.db.session() as s:
        assert await service.prune_audit(s, 0) == 0                    # 0 = keep everything
