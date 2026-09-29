"""FastAPI dependencies that authenticate and authorise requests.

Everything funnels through two callables — `optional_user` (who is this,
if anyone) and `current_user` (must be logged in, CSRF-checked) — so tests
can stub the whole layer by overriding just those two. Every route is
default-deny: tests/test_auth_coverage.py fails if a route is neither
protected by one of these nor on its explicit public allowlist.
"""
from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request

from app.auth import service
from app.auth.models import AuditLog
from app.settings import settings

logger = logging.getLogger(__name__)

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
#: Only these request-body keys are copied into the audit trail — never
#: anything that could carry a secret (e.g. an adapter's `fields`).
AUDIT_BODY_KEYS = ("name", "type", "enabled", "sound")


@dataclass(frozen=True)
class AuthContext:
    user_id: int
    username: str
    role: str
    session_id: str
    csrf_token: str

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def cookie_name() -> str:
    # The __Host- prefix makes browsers reject the cookie unless it's Secure,
    # Path=/ and host-only — only usable when we know we're on HTTPS.
    return "__Host-dd_session" if settings.https_only else "dd_session"


def client_ip(request: Request) -> str | None:
    peer = request.client.host if request.client else None
    trusted = {p.strip() for p in settings.trusted_proxies.split(",") if p.strip()}
    if peer and peer in trusted:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            hops = [h.strip() for h in forwarded.split(",") if h.strip()]
            for hop in reversed(hops):          # rightmost hop we don't trust
                if hop not in trusted:
                    return hop
            return hops[0] if hops else peer
    return peer


def request_is_https(request: Request) -> bool:
    """Whether the browser reached us over HTTPS: directly, or through a
    trusted proxy that says so in X-Forwarded-Proto (anyone else's header
    is ignored, like X-Forwarded-For in client_ip)."""
    if request.url.scheme == "https":
        return True
    peer = request.client.host if request.client else None
    trusted = {p.strip() for p in settings.trusted_proxies.split(",") if p.strip()}
    forwarded = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return bool(peer and peer in trusted and forwarded == "https")


def _database(request: Request):
    return getattr(request.app.state, "database", None)


async def optional_user(request: Request) -> AuthContext | None:
    """The logged-in user from the session cookie, or None (no cookie, bad or
    expired session, database down). Never raises."""
    token = request.cookies.get(cookie_name())
    database = _database(request)
    if not token or database is None or not database.available:
        return None
    try:
        async with database.session() as session:
            found = await service.lookup_session(session, token)
            await session.commit()
    except Exception:  # noqa: BLE001 - a DB hiccup means "not authenticated", not a 500
        logger.exception("session lookup failed")
        return None
    if found is None:
        return None
    row, user = found
    return AuthContext(user.id, user.username, user.role, row.id, row.csrf_token)


async def current_user(request: Request, ctx: AuthContext | None = Depends(optional_user)) -> AuthContext:
    """Must be logged in. State-changing requests must also carry the
    session's CSRF token in `X-CSRF-Token` (a header a cross-site form or
    fetch can't set without CORS approval)."""
    if ctx is None:
        database = _database(request)
        if database is None or not database.available:
            raise HTTPException(status_code=503, detail="authentication is temporarily unavailable")
        raise HTTPException(status_code=401, detail="not authenticated")
    if request.method not in SAFE_METHODS:
        sent = request.headers.get("x-csrf-token", "")
        if not secrets.compare_digest(sent.encode(), ctx.csrf_token.encode()):
            raise HTTPException(status_code=403, detail="missing or invalid CSRF token")
    return ctx


#: Any logged-in user (viewer or admin).
require_user = current_user


async def require_admin(ctx: AuthContext = Depends(current_user)) -> AuthContext:
    if not ctx.is_admin:
        raise HTTPException(status_code=403, detail="administrator access required")
    return ctx


async def require_admin_for_writes(request: Request, ctx: AuthContext = Depends(current_user)) -> AuthContext:
    """Viewers may read; anything state-changing needs an admin."""
    if request.method not in SAFE_METHODS and not ctx.is_admin:
        raise HTTPException(status_code=403, detail="administrator access required")
    return ctx


async def audit_writes(request: Request, ctx: AuthContext = Depends(current_user)) -> None:
    """Records every state-changing API call (who, what, from where) before
    it runs, so a call that then fails is still on record. Fails closed: if
    the audit row can't be written, the request doesn't proceed."""
    if request.method in SAFE_METHODS:
        return
    detail: dict[str, object] = {}
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 - no/invalid JSON body
        body = None
    if isinstance(body, dict):
        detail = {k: body[k] for k in AUDIT_BODY_KEYS
                  if isinstance(body.get(k), (str, int, float, bool))}
    route = request.scope.get("route")
    action = f"api.{getattr(route, 'name', request.url.path)}"
    target = ", ".join(f"{k}={v}" for k, v in request.path_params.items()) or None
    async with _database(request).session() as session:
        session.add(AuditLog(action=action[:64], user_id=ctx.user_id, username=ctx.username,
                             target=target, ip=client_ip(request), detail=detail or None))
        await session.commit()


async def device_access(request: Request) -> None:
    """GET /device/config: the desk display's device token, sent as
    `Authorization: Bearer <token>` (a header, so it never lands in an
    access log the way a query string would). The display has no session
    and no user account; this token is all it has."""
    from app.connections import device_token_valid   # local: keeps auth free of connections at import

    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not device_token_valid(settings.connections_config_path, token.strip()):
        logger.warning("rejected a device config request from %s: missing or wrong device token",
                       client_ip(request))
        raise HTTPException(status_code=401, detail="missing or invalid device token")
