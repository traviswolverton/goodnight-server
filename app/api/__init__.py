"""Admin JSON API, mounted at /api. One router per domain.

Authorization is applied here, per router, so a new route inherits it
by default (tests/test_auth_coverage.py enforces that nothing is left open):

- actions / device / overview / mqtt-reference: any logged-in user may
  read; only admins may write
- previews: any logged-in user (they render, never save)
- system (restart): admins only
- connections (MQTT broker / database / Home Assistant, and its entity
  and service lists), settings: admins only
- users / audit log: admins only
- auth: login is public; the rest of it requires a session
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api import actions, app_settings, auth, connections, device, overview, system, users
from app.auth.deps import audit_writes, require_admin, require_admin_for_writes, require_user

router = APIRouter(prefix="/api")

router.include_router(auth.router)

_writes = [Depends(require_admin_for_writes), Depends(audit_writes)]
router.include_router(actions.router, dependencies=_writes)
router.include_router(device.router, dependencies=_writes)
router.include_router(overview.router, dependencies=[Depends(require_user)])

_admin = [Depends(require_admin), Depends(audit_writes)]
router.include_router(system.router, dependencies=_admin)
router.include_router(connections.router, dependencies=_admin)
router.include_router(app_settings.router, dependencies=_admin)

# users.py records its own, more specific audit entries.
router.include_router(users.router, dependencies=[Depends(require_admin)])
