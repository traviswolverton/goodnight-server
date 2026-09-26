"""User management and the audit log — administrators only (the router is
mounted behind require_admin in app/api/__init__.py). These handlers write
their own specific audit entries instead of the generic per-call one."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import user_out
from app.auth import service
from app.auth.deps import AuthContext, client_ip, require_admin
from app.auth.passwords import MAX_PASSWORD_LENGTH
from app.db import get_session
from sqlalchemy import select

router = APIRouter()


class CreateUserRequest(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=MAX_PASSWORD_LENGTH)
    role: str = "viewer"
    email: str | None = Field(default=None, max_length=254)


class UpdateUserRequest(BaseModel):
    role: str | None = None
    is_active: bool | None = None
    email: str | None = Field(default=None, max_length=254)


class ResetPasswordRequest(BaseModel):
    password: str = Field(max_length=MAX_PASSWORD_LENGTH)


async def _target(session: AsyncSession, user_id: int) -> service.User:
    user = await service.get_user(session, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="no such user")
    return user


async def _ensure_admin_remains(session: AsyncSession, user: service.User, *,
                                becoming_admin: bool, becoming_active: bool) -> None:
    """Refuse a change that would leave zero active administrators."""
    if user.role == "admin" and user.is_active and not (becoming_admin and becoming_active):
        if await service.count_active_admins(session) <= 1:
            raise HTTPException(status_code=400, detail="can't remove the last active administrator")


@router.get("/users")
async def list_users(session: AsyncSession = Depends(get_session)) -> dict[str, object]:
    rows = (await session.execute(select(service.User).order_by(service.User.username))).scalars()
    return {"users": [user_out(u) for u in rows]}


@router.post("/users", status_code=201)
async def create_user(request: Request, body: CreateUserRequest, ctx: AuthContext = Depends(require_admin),
                      session: AsyncSession = Depends(get_session)) -> dict[str, object]:
    try:
        user = await service.create_user(session, body.username, body.password, body.role, body.email)
    except service.UserError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await service.record_audit(session, "user.create", user_id=ctx.user_id, username=ctx.username,
                               target=user.username, ip=client_ip(request), detail={"role": user.role})
    await session.commit()
    return {"user": user_out(user)}


@router.patch("/users/{user_id}")
async def update_user(request: Request, user_id: int, body: UpdateUserRequest,
                      ctx: AuthContext = Depends(require_admin),
                      session: AsyncSession = Depends(get_session)) -> dict[str, object]:
    user = await _target(session, user_id)
    role = body.role if body.role is not None else user.role
    active = body.is_active if body.is_active is not None else user.is_active
    if role not in service.ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of: {', '.join(service.ROLES)}")
    await _ensure_admin_remains(session, user, becoming_admin=role == "admin", becoming_active=active)

    changes = {}
    if role != user.role:
        changes["role"] = role
    if active != user.is_active:
        changes["is_active"] = active
    if body.email is not None:
        user.email = body.email.strip() or None
    user.role, user.is_active = role, active
    if not active:
        await service.revoke_user_sessions(session, user.id)
    elif "role" in changes:
        await service.revoke_user_sessions(session, user.id)   # role change: re-login picks up the new role
    await service.record_audit(session, "user.update", user_id=ctx.user_id, username=ctx.username,
                               target=user.username, ip=client_ip(request), detail=changes or None)
    await session.commit()
    return {"user": user_out(user)}


@router.post("/users/{user_id}/reset-password")
async def reset_password(request: Request, user_id: int, body: ResetPasswordRequest,
                         ctx: AuthContext = Depends(require_admin),
                         session: AsyncSession = Depends(get_session)) -> dict[str, bool]:
    user = await _target(session, user_id)
    try:
        await service.set_password(session, user, body.password)
    except service.UserError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await service.revoke_user_sessions(session, user.id)
    await service.record_audit(session, "user.reset_password", user_id=ctx.user_id, username=ctx.username,
                               target=user.username, ip=client_ip(request))
    await session.commit()
    return {"ok": True}


@router.delete("/users/{user_id}")
async def delete_user(request: Request, user_id: int, ctx: AuthContext = Depends(require_admin),
                      session: AsyncSession = Depends(get_session)) -> dict[str, bool]:
    user = await _target(session, user_id)
    if user.id == ctx.user_id:
        raise HTTPException(status_code=400, detail="you can't delete your own account")
    await _ensure_admin_remains(session, user, becoming_admin=False, becoming_active=False)
    username = user.username
    await session.delete(user)
    await service.record_audit(session, "user.delete", user_id=ctx.user_id, username=ctx.username,
                               target=username, ip=client_ip(request))
    await session.commit()
    return {"ok": True}


@router.get("/audit-log")
async def audit_log(limit: int = 100, before_id: int | None = None,
                    session: AsyncSession = Depends(get_session)) -> dict[str, object]:
    rows = await service.list_audit(session, limit, before_id)
    return {"entries": [
        {"id": r.id, "ts": r.ts.isoformat(), "user_id": r.user_id, "username": r.username,
         "action": r.action, "target": r.target, "ip": r.ip, "detail": r.detail}
        for r in rows]}
