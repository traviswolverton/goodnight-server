"""Users, sessions and audit-log operations. Pure data logic — no HTTP."""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import ROLES, AuditLog, User, UserSession, utcnow  # noqa: F401 - re-exported for callers
from app.auth.passwords import (
    PasswordPolicyError,
    hash_password,
    validate_password,
    verify_password,
)
from app.settings import settings

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._@-]{0,63}$")
#: Session last_seen is only rewritten this often, not on every request.
TOUCH_INTERVAL = timedelta(minutes=1)


class UserError(ValueError):
    """A user-management request that's invalid (bad input, duplicate, would
    remove the last admin...). The message is safe to show the caller."""


def normalize_username(username: str) -> str:
    return username.strip().lower()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --- users ------------------------------------------------------------------

async def count_users(session: AsyncSession) -> int:
    return (await session.execute(select(func.count()).select_from(User))).scalar_one()


async def count_active_admins(session: AsyncSession) -> int:
    stmt = select(func.count()).select_from(User).where(User.role == "admin", User.is_active.is_(True))
    return (await session.execute(stmt)).scalar_one()


async def get_user_by_username(session: AsyncSession, username: str) -> User | None:
    return (await session.execute(
        select(User).where(User.username == normalize_username(username)))).scalar_one_or_none()


async def get_user(session: AsyncSession, user_id: int) -> User | None:
    return await session.get(User, user_id)


async def create_user(session: AsyncSession, username: str, password: str | None,
                      role: str = "viewer", email: str | None = None) -> User:
    username = normalize_username(username)
    if not USERNAME_RE.match(username):
        raise UserError("username must be 1-64 characters: letters, digits, and . _ @ - "
                        "(starting with a letter or digit)")
    if role not in ROLES:
        raise UserError(f"role must be one of: {', '.join(ROLES)}")
    password_hash = None
    if password is not None:
        try:
            validate_password(password, username)
        except PasswordPolicyError as exc:
            raise UserError(str(exc)) from exc
        password_hash = await hash_password(password)
    user = User(username=username, email=(email or "").strip() or None,
                password_hash=password_hash, role=role)
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise UserError(f"a user named '{username}' already exists") from exc
    return user


async def set_password(session: AsyncSession, user: User, password: str) -> None:
    try:
        validate_password(password, user.username)
    except PasswordPolicyError as exc:
        raise UserError(str(exc)) from exc
    user.password_hash = await hash_password(password)


async def authenticate(session: AsyncSession, username: str, password: str) -> User | None:
    """The user if username+password are right and the account is active."""
    user = await get_user_by_username(session, username)
    ok = await verify_password(user.password_hash if user else None, password)
    if not ok or user is None or not user.is_active:
        return None
    return user


# --- sessions ---------------------------------------------------------------

async def create_login_session(session: AsyncSession, user: User, ip: str | None,
                               user_agent: str | None) -> tuple[str, UserSession]:
    """Returns (cookie token, row). Only the token's hash is stored."""
    now = utcnow()
    await session.execute(delete(UserSession).where(UserSession.expires_at < now))  # opportunistic cleanup
    token = secrets.token_urlsafe(32)
    row = UserSession(
        id=hash_token(token), user_id=user.id, csrf_token=secrets.token_urlsafe(24),
        created_at=now, last_seen_at=now,
        expires_at=now + timedelta(days=settings.session_max_days),
        ip=ip, user_agent=(user_agent or "")[:256] or None,
    )
    session.add(row)
    user.last_login_at = now
    await session.flush()
    return token, row


async def lookup_session(session: AsyncSession, token: str) -> tuple[UserSession, User] | None:
    """The live (session, user) for a cookie token, enforcing absolute and
    idle expiry and the account's active flag. Expired rows are deleted."""
    row = await session.get(UserSession, hash_token(token))
    if row is None:
        return None
    now = utcnow()
    idle_limit = row.last_seen_at + timedelta(hours=settings.session_idle_hours)
    if row.expires_at <= now or idle_limit <= now:
        await session.delete(row)
        return None
    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        return None
    if now - row.last_seen_at > TOUCH_INTERVAL:
        row.last_seen_at = now
    return row, user


async def revoke_session(session: AsyncSession, session_id: str) -> None:
    await session.execute(delete(UserSession).where(UserSession.id == session_id))


async def revoke_user_sessions(session: AsyncSession, user_id: int, except_id: str | None = None) -> None:
    stmt = delete(UserSession).where(UserSession.user_id == user_id)
    if except_id:
        stmt = stmt.where(UserSession.id != except_id)
    await session.execute(stmt)


# --- audit ------------------------------------------------------------------

async def record_audit(session: AsyncSession, action: str, *, user_id: int | None = None,
                       username: str | None = None, target: str | None = None,
                       ip: str | None = None, detail: dict | None = None) -> None:
    session.add(AuditLog(action=action, user_id=user_id, username=username,
                         target=(target or None) and target[:200], ip=ip, detail=detail or None))


async def prune_audit(session: AsyncSession, retention_days: int) -> int:
    """Delete audit rows older than `retention_days` (0 = keep everything).
    Returns how many were removed."""
    if retention_days <= 0:
        return 0
    cutoff = utcnow() - timedelta(days=retention_days)
    result = await session.execute(delete(AuditLog).where(AuditLog.ts < cutoff))
    return result.rowcount or 0


async def list_audit(session: AsyncSession, limit: int = 100, before_id: int | None = None) -> list[AuditLog]:
    stmt = select(AuditLog).order_by(AuditLog.id.desc()).limit(min(max(limit, 1), 500))
    if before_id is not None:
        stmt = stmt.where(AuditLog.id < before_id)
    return list((await session.execute(stmt)).scalars())


def _ts(value: datetime | None) -> str | None:
    return value.isoformat() if value else None
