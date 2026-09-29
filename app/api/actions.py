"""Actions (app/actions.py): list, add/edit/delete, and run — the web UI's
Actions page. Reads are open to any signed-in user; writes (including
Run, which really does switch something) are admin-only and audited, via
the router's dependencies in app/api/__init__.py."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from app.actions import (
    LABEL_MAX,
    STATE_MAX,
    ActionConfig,
    ActionConfigError,
    delete_action,
    fit_state,
    load_actions,
    save_action,
)
from app.device import device_state
from app.settings import settings
from app.state_templates import device_context, render_single_expression, template_context

logger = logging.getLogger(__name__)
router = APIRouter()


async def _context(request: Request) -> tuple[dict[str, object], str | None]:
    """The live template context, and why Home Assistant's half of it is
    empty (None when it isn't). Never the raw error: it can name internal
    hosts, and this is open to viewers; the app log has it."""
    link = request.app.state.home_assistant
    problem = None
    try:
        states = await link.states()
    except Exception as exc:  # noqa: BLE001 - states just go blank
        logger.warning("couldn't read Home Assistant's states: %s", exc)
        states, problem = {}, "Home Assistant can’t be reached, so states are blank."
    if link.ha is None:
        problem = "Home Assistant isn’t set up."
    return template_context(states, device_context(device_state)), problem


def _action_view(action: ActionConfig, context: dict[str, object], problem: str | None) -> dict[str, object]:
    state = error = None
    if action.state_template:
        rendered, error = render_single_expression(action.state_template, context)
        state = fit_state(rendered)
        if problem:
            error = None  # the page says why once, not on every action
    return {**action.model_dump(), "resolved_state": state, "state_error": error}


@router.get("/actions")
async def list_actions(request: Request) -> dict[str, object]:
    context, problem = await _context(request)
    return {
        "actions": [_action_view(a, context, problem) for a in load_actions(settings.actions_config_path)],
        "home_assistant": {"set_up": request.app.state.home_assistant.ha is not None, "problem": problem},
        # Only the device's readings: every entity would be thousands of
        # values, and viewers can read this. The editor's entity picker
        # (admin-only) covers Home Assistant.
        "context": {"device": context["device"]},
        "limits": {"label_max": LABEL_MAX, "state_max": STATE_MAX},
    }


def _parse(body: dict) -> ActionConfig:
    try:
        return ActionConfig.model_validate(body)
    except ValidationError as exc:
        first = exc.errors()[0]
        field = ".".join(str(p) for p in first["loc"]) or "action"
        raise HTTPException(status_code=400, detail=f"{field}: {first['msg'].removeprefix('Value error, ')}")


@router.post("/actions")
async def create_action(body: dict) -> dict[str, object]:
    action = _parse(body)
    try:
        save_action(settings.actions_config_path, action)
    except ActionConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"saved": True, "id": action.id}


@router.put("/actions/{action_id}")
async def update_action(action_id: str, body: dict) -> dict[str, object]:
    action = _parse(body)
    try:
        save_action(settings.actions_config_path, action, replace_id=action_id)
    except ActionConfigError as exc:
        raise HTTPException(status_code=404 if "no action named" in str(exc) else 400, detail=str(exc))
    return {"saved": True, "id": action.id}


@router.delete("/actions/{action_id}")
async def remove_action(action_id: str) -> dict[str, object]:
    try:
        delete_action(settings.actions_config_path, action_id)
    except ActionConfigError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"removed": True, "id": action_id}


@router.post("/actions/{action_id}/run")
async def run_action(request: Request, action_id: str) -> dict[str, object]:
    """Run a saved action now — the same path the display's press takes."""
    outcome = await request.app.state.action_runner.run(action_id, source="web")
    return outcome.model_dump()


@router.post("/preview-action-state")
async def preview_action_state(request: Request, body: dict) -> dict[str, object]:
    """Render an unsaved state_template against live data."""
    template = str(body.get("state_template") or "")
    context, problem = await _context(request)
    rendered, error = render_single_expression(template, context)
    return {"rendered": rendered, "state": fit_state(rendered), "error": error, "problem": problem}
