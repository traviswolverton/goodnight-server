"""Actions (app/actions.py): list, add/edit/delete, and run — the web UI's
Actions page. Reads are open to any signed-in user; writes (including
Run, which really does switch something) are admin-only and audited, via
the router's dependencies in app/api/__init__.py."""
from __future__ import annotations

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
from app.aggregator import build_multi_source_context, render_single_expression
from app.api.deps import _get_aggregator
from app.settings import settings

router = APIRouter()


def _action_view(action: ActionConfig, context: dict[str, object]) -> dict[str, object]:
    state = error = None
    if action.state_template:
        rendered, error = render_single_expression(action.state_template, context)
        state = fit_state(rendered)
    return {**action.model_dump(), "resolved_state": state, "state_error": error}


@router.get("/actions")
async def list_actions(request: Request) -> dict[str, object]:
    aggregator = _get_aggregator(request)
    context = build_multi_source_context(aggregator.latest_results)
    return {
        "actions": [_action_view(a, context) for a in load_actions(settings.actions_config_path)],
        # Running adapters that can perform actions, and which kinds.
        "adapters": [{"name": a.name, "type": a.type_name, "kinds": list(a.action_kinds)}
                     for a in aggregator.adapters if a.action_kinds],
        "context": context,
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
    context = build_multi_source_context(_get_aggregator(request).latest_results)
    rendered, error = render_single_expression(template, context)
    return {"rendered": rendered, "state": fit_state(rendered), "error": error}
