"""Serves the built React app (frontend/dist).

Vite's hashed bundle files under /assets are cached forever; index.html
(and any other static file at the top level, e.g. the favicon) are not. Any
other GET path that isn't owned by the backend falls back to index.html so
client-side routes (/cards, /login, ...) survive a refresh.

The shell and bundle are deliberately public: they contain no data, and the
login screen is part of the app. Everything the app *shows* comes from /api,
which is authenticated (see app/auth/).
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse, Response

from app.settings import settings

router = APIRouter()

DEFAULT_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

#: URL paths owned by the backend. An unknown path under one of these is a
#: real 404 (JSON for API clients), never the SPA shell.
BACKEND_PREFIXES = ("api", "schema", "snapshot", "assets", "healthz")

IMMUTABLE = "public, max-age=31536000, immutable"


def dist_dir() -> Path:
    return Path(settings.frontend_dist_path) if settings.frontend_dist_path else DEFAULT_DIST


def _safe_file(base: Path, relative: str) -> Path | None:
    """`relative` under `base`, or None if it doesn't exist or escapes it."""
    try:
        candidate = (base / relative).resolve()
        if candidate.is_file() and candidate.is_relative_to(base.resolve()):
            return candidate
    except (OSError, ValueError):
        pass
    return None


@router.get("/assets/{path:path}", include_in_schema=False)
async def asset(path: str) -> Response:
    found = _safe_file(dist_dir() / "assets", path)
    if found is None:
        raise HTTPException(status_code=404)
    return FileResponse(found, headers={"Cache-Control": IMMUTABLE})


@router.get("/{path:path}", include_in_schema=False)
async def spa(path: str) -> Response:
    first = path.split("/", 1)[0]
    if first in BACKEND_PREFIXES:
        raise HTTPException(status_code=404)

    base = dist_dir()
    index = base / "index.html"
    if not index.is_file():
        return PlainTextResponse(
            "The web UI has not been built (frontend/dist is missing). "
            "Build it with `npm run build` in frontend/, or use the Docker image.",
            status_code=503,
        )
    static = _safe_file(base, path) if path else None
    if static is not None and static != index.resolve():
        return FileResponse(static, headers={"Cache-Control": "public, max-age=3600"})
    return FileResponse(index, headers={"Cache-Control": "no-store"})
