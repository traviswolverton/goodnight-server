"""Login / logout / who-am-I / change password. The only /api routes that
work without a session (login itself); everything else declares its own
dependency."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.deps import AuthContext, client_ip, cookie_name, current_user
from app.auth.ratelimit import limiter
from app.auth.passwords import MAX_PASSWORD_LENGTH, verify_password
from app.db import get_session
from app.settings import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth")


class LoginRequest(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=MAX_PASSWORD_LENGTH)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(max_length=MAX_PASSWORD_LENGTH)
    new_password: str = Field(max_length=MAX_PASSWORD_LENGTH)


def user_out(user: service.User) -> dict[str, object]:
    return {
        "id": user.id, "username": user.username, "email": user.email, "role": user.role,
        "is_active": user.is_active, "has_password": user.password_hash is not None,
        "created_at": user.created_at.isoformat(),
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


@router.post("/login")
async def login(request: Request, response: Response, body: LoginRequest,
                session: AsyncSession = Depends(get_session)) -> dict[str, object]:
    ip = client_ip(request)
    wait = limiter.retry_after(ip, body.username)
    if wait:
        await service.record_audit(session, "login.blocked", username=body.username[:64], ip=ip)
        await session.commit()
        raise HTTPException(status_code=429, detail="too many failed logins; try again later",
                            headers={"Retry-After": str(wait)})

    user = await service.authenticate(session, body.username, body.password)
    if user is None:
        limiter.record_failure(ip, body.username)
        await service.record_audit(session, "login.failed", username=body.username[:64], ip=ip)
        await session.commit()
        # One message for unknown user / wrong password / disabled account.
        raise HTTPException(status_code=401, detail="invalid username or password")

    limiter.record_success(body.username)
    token, row = await service.create_login_session(
        session, user, ip, request.headers.get("user-agent"))
    await service.record_audit(session, "login.success", user_id=user.id, username=user.username, ip=ip)
    await session.commit()

    response.set_cookie(
        cookie_name(), token, max_age=int(settings.session_max_days * 86400),
        httponly=True, secure=settings.https_only, samesite="lax", path="/",
    )
    return {"user": user_out(user), "csrf_token": row.csrf_token}


@router.post("/logout")
async def logout(request: Request, response: Response, ctx: AuthContext = Depends(current_user),
                 session: AsyncSession = Depends(get_session)) -> dict[str, bool]:
    await service.revoke_session(session, ctx.session_id)
    await service.record_audit(session, "logout", user_id=ctx.user_id, username=ctx.username,
                               ip=client_ip(request))
    await session.commit()
    response.delete_cookie(cookie_name(), path="/")
    return {"ok": True}


@router.get("/me")
async def me(ctx: AuthContext = Depends(current_user),
             session: AsyncSession = Depends(get_session)) -> dict[str, object]:
    """Who am I, plus the CSRF token to send on state-changing requests.
    The SPA calls this on load; 401 means "show the login screen"."""
    user = await service.get_user(session, ctx.user_id)
    return {"user": user_out(user), "csrf_token": ctx.csrf_token}


@router.post("/change-password")
async def change_password(request: Request, body: ChangePasswordRequest,
                          ctx: AuthContext = Depends(current_user),
                          session: AsyncSession = Depends(get_session)) -> dict[str, bool]:
    # Its own rate-limit bucket: a stolen session must not be able to guess the
    # current password at full speed.
    key, ip = f"pw:{ctx.username}", client_ip(request)
    wait = limiter.retry_after(ip, key)
    if wait:
        raise HTTPException(status_code=429, detail="too many failed attempts; try again later",
                            headers={"Retry-After": str(wait)})
    user = await service.get_user(session, ctx.user_id)
    if not await verify_password(user.password_hash, body.current_password):
        limiter.record_failure(ip, key)
        await service.record_audit(session, "password.change_failed", user_id=user.id,
                                   username=user.username, ip=ip)
        await session.commit()
        raise HTTPException(status_code=400, detail="current password is incorrect")
    limiter.record_success(key)
    try:
        await service.set_password(session, user, body.new_password)
    except service.UserError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await service.revoke_user_sessions(session, user.id, except_id=ctx.session_id)  # log out everywhere else
    await service.record_audit(session, "password.change", user_id=user.id, username=user.username,
                               ip=client_ip(request))
    await session.commit()
    return {"ok": True}
