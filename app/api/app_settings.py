"""The Settings page (app/app_settings.py). Admins only.

A save validates every changed value (and the rules across them) before
writing anything, then applies them to the running app straight away —
no restart. Two guards keep a save from locking anyone out:

- HTTPS only can't be switched on from a plain-HTTP page: the sign-in
  cookie would become Secure, which a browser never sends over HTTP.
- Switching HTTPS only either way renames the sign-in cookie
  (auth.deps.cookie_name); the save re-issues the current session under
  the new name, so the admin making the change stays signed in."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.app_settings import (
    BY_KEY,
    SettingsError,
    apply_value,
    coerce,
    read_saved,
    write_saved,
)
from app.auth.deps import cookie_name, request_is_https
from app.settings import settings

logger = logging.getLogger(__name__)
router = APIRouter()


class SaveSettings(BaseModel):
    values: dict[str, Any]
    """key -> new value, or null to go back to the .env / built-in value."""


def _page(request: Request) -> dict[str, object]:
    saved = request.app.state.saved_settings
    return {"fields": saved.describe(settings, settings.app_settings_path),
            "request_is_https": request_is_https(request)}


@router.get("/settings")
async def get_settings(request: Request) -> dict[str, object]:
    return _page(request)


@router.put("/settings")
async def save_settings(request: Request, response: Response, body: SaveSettings) -> dict[str, object]:
    baseline = request.app.state.saved_settings.baseline
    try:
        # Settings that no longer exist (removed in an update) are dropped.
        stored = {k: v for k, v in read_saved(settings.app_settings_path).items() if k in BY_KEY}
        effective = {key: getattr(settings, key) for key in BY_KEY}
        for key, raw in body.values.items():
            if raw is None:
                if key not in BY_KEY:
                    raise SettingsError(key, f"'{key}' isn't a setting that can be changed here")
                stored.pop(key, None)
                effective[key] = baseline[key]
            else:
                stored[key] = effective[key] = coerce(key, raw)
    except SettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if effective["https_only"] and not settings.https_only and not request_is_https(request):
        raise HTTPException(status_code=400, detail=(
            "HTTPS only can't be turned on from a plain-HTTP page: sign-ins over HTTP would stop "
            "working. Open the app through its HTTPS address first."))

    write_saved(settings.app_settings_path, stored)

    old_cookie, old_secure = cookie_name(), settings.https_only
    token = request.cookies.get(old_cookie)
    for key in body.values:
        apply_value(settings, key, effective[key])
    if token and (cookie_name() != old_cookie or settings.https_only != old_secure):
        response.delete_cookie(old_cookie, path="/")
        response.set_cookie(cookie_name(), token, max_age=int(settings.session_max_days * 86400),
                            httponly=True, secure=settings.https_only, samesite="lax", path="/")

    logger.warning("settings changed via the admin API: %s", ", ".join(sorted(body.values)) or "nothing")
    return _page(request)
