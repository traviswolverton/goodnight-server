"""Actions: things the display can make happen (toggle a light, run a
script), defined in config/actions.yaml and listed on the device's
Actions menu. See DESIGN.md "Actions".

Like Cards and Pixels, an Action is plain data with no code change needed
to add one. It names the adapter that performs it (today, a Home
Assistant adapter — `Adapter.action_kinds` says which adapters can) and
optionally a `state_template` whose output the display shows next to the
label ("on", "21.5°").

The display only ever sends an action's `id`; everything that does
something — the service, the target, the credentials — stays here. So a
device (or anything else holding its MQTT login) can only trigger actions
already listed in this file.

actions.yaml is re-read fresh on every poll and every run, the same
hot-reload property as pixels.yaml: a save through the web UI takes effect
straight away, with no live object to patch.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, field_validator
from ruamel.yaml import YAML

from app.models import ActionItem

logger = logging.getLogger(__name__)

ActionKind = Literal["service", "script", "event"]

#: The display's own limits (desk-dashboard-esp32 status_payload.h) — the
#: web UI and the save path enforce these rather than letting a label be
#: silently cut short on the device.
MAX_ACTIONS = 12
ID_MAX = 23
LABEL_MAX = 23
STATE_MAX = 11

_ID_RE = re.compile(rf"^[a-z][a-z0-9_]{{0,{ID_MAX - 1}}}$")

#: The same action pressed again within this many seconds is ignored — an
#: encoder bounce or an MQTT redelivery shouldn't toggle a light twice.
DEBOUNCE_SECONDS = 1.0


class ActionConfig(BaseModel):
    """One entry in actions.yaml."""

    id: str
    """Stable identifier, the only thing the display sends back."""
    label: str
    adapter: str
    """Name of the adapter (adapters.yaml) that performs it."""
    kind: ActionKind = "service"
    service: str | None = None
    """kind=service: `domain.service`, e.g. `light.toggle`."""
    target: str | None = None
    """kind=service: the entity_id it acts on (optional for services that
    take none); kind=script: the `script.*` entity to run."""
    data: dict[str, object] = Field(default_factory=dict)
    """Extra service data (kind=service), script variables (kind=script),
    or extra event data (kind=event)."""
    confirm: bool = False
    """The display asks for a second press before sending it."""
    state_template: str | None = None

    @field_validator("id")
    @classmethod
    def _check_id(cls, value: str) -> str:
        if not _ID_RE.match(value):
            raise ValueError(
                f"id must be lowercase letters, digits and underscores, starting with a letter, "
                f"at most {ID_MAX} characters")
        return value

    @field_validator("label")
    @classmethod
    def _check_label(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("label is required")
        if len(value.encode("utf-8")) > LABEL_MAX:
            raise ValueError(f"label must fit the display: at most {LABEL_MAX} characters")
        return value


class ActionConfigError(ValueError):
    """A save was rejected. Safe to show to the user."""


def load_actions(config_path: str) -> list[ActionConfig]:
    """Read actions.yaml, in file order. Same resilience as the other
    loaders: a YAML syntax error means no actions until it's fixed, and
    one bad entry is skipped rather than costing the rest."""
    path = Path(config_path)
    if not path.exists():
        return []
    try:
        raw = yaml.safe_load(path.read_text()) or {}
    except yaml.YAMLError as exc:
        logger.error("%s is not valid YAML, no actions until this is fixed: %s", config_path, exc)
        return []
    actions: list[ActionConfig] = []
    for entry in raw.get("actions") or []:
        try:
            actions.append(ActionConfig.model_validate(entry))
        except Exception as exc:  # noqa: BLE001 - one bad entry shouldn't cost every other action
            logger.error("actions.yaml entry %r failed to load, skipping it: %s",
                         (entry or {}).get("id", entry), exc)
    return actions


def get_action(config_path: str, action_id: str) -> ActionConfig | None:
    return next((a for a in load_actions(config_path) if a.id == action_id), None)


_ROUND_TRIP_YAML = YAML()
_ROUND_TRIP_YAML.indent(mapping=2, sequence=4, offset=2)
_ROUND_TRIP_YAML.width = 4096


def _read_raw(path: Path):
    raw = None
    if path.exists():
        with path.open() as f:
            raw = _ROUND_TRIP_YAML.load(f)
    raw = raw or {}
    if raw.get("actions") is None:
        raw["actions"] = []
    return raw


def _write_raw(path: Path, raw) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w") as f:
        _ROUND_TRIP_YAML.dump(raw, f)
    os.replace(tmp, path)


def _entry(action: ActionConfig) -> dict[str, object]:
    """An action as written to actions.yaml: defaults left out."""
    dump = action.model_dump(exclude_defaults=True) | {"kind": action.kind}
    return {k: dump[k] for k in ActionConfig.model_fields if k in dump}


def save_action(config_path: str, action: ActionConfig, replace_id: str | None = None) -> None:
    """Add `action`, or replace the one currently called `replace_id`
    (which may differ from action.id: a rename), keeping its position."""
    path = Path(config_path)
    raw = _read_raw(path)
    entries = raw["actions"]
    existing = next((i for i, e in enumerate(entries) if e.get("id") == replace_id), None)
    if replace_id is not None and existing is None:
        raise ActionConfigError(f"no action named '{replace_id}'")
    if any(e.get("id") == action.id for i, e in enumerate(entries) if i != existing):
        raise ActionConfigError(f"an action named '{action.id}' already exists")
    if existing is None:
        if len(entries) >= MAX_ACTIONS:
            raise ActionConfigError(f"the display holds at most {MAX_ACTIONS} actions")
        entries.append(_entry(action))
    else:
        entries[existing] = _entry(action)
    _write_raw(path, raw)


def delete_action(config_path: str, action_id: str) -> None:
    path = Path(config_path)
    raw = _read_raw(path)
    before = len(raw["actions"])
    raw["actions"] = [e for e in raw["actions"] if e.get("id") != action_id]
    if len(raw["actions"]) == before:
        raise ActionConfigError(f"no action named '{action_id}'")
    _write_raw(path, raw)


def fit_state(text: str | None) -> str | None:
    """A rendered state_template as the display gets it: blank is None, and
    anything too long is cut at a character boundary."""
    if not text:
        return None
    encoded = text.encode("utf-8")[:STATE_MAX]
    return encoded.decode("utf-8", errors="ignore") or None


def build_action_items(actions: list[ActionConfig], render) -> list[ActionItem]:
    """The `actions` array of the status payload. `render(template)` returns
    the rendered text or None (app.aggregator supplies it, against the same
    context as cards)."""
    return [
        ActionItem(id=a.id, label=a.label, confirm=a.confirm,
                   state=fit_state(render(a.state_template)) if a.state_template else None)
        for a in actions[:MAX_ACTIONS]
    ]


class ActionOutcome(BaseModel):
    ok: bool
    text: str


class ActionRunner:
    """Runs actions by id, for both the display (app.mqtt's action listener)
    and the web UI's Run button. Owns the debounce, so the two can't
    double-fire each other either."""

    def __init__(self, aggregator, config_path: str) -> None:
        self.aggregator = aggregator
        self.config_path = config_path
        self._last_run: dict[str, float] = {}

    async def run(self, action_id: str, source: str) -> ActionOutcome:
        action = get_action(self.config_path, action_id)
        if action is None:
            return ActionOutcome(ok=False, text="Unknown action")
        now = time.monotonic()
        if now - self._last_run.get(action_id, float("-inf")) < DEBOUNCE_SECONDS:
            logger.info("action %r from %s ignored: pressed again within %ss",
                        action_id, source, DEBOUNCE_SECONDS)
            return ActionOutcome(ok=False, text="Too soon")
        self._last_run[action_id] = now

        adapter = self.aggregator.get_adapter(action.adapter)
        if adapter is None:
            logger.warning("action %r: adapter %r isn't loaded", action_id, action.adapter)
            return ActionOutcome(ok=False, text="No adapter")
        if action.kind not in adapter.action_kinds:
            return ActionOutcome(ok=False, text="Not supported")
        try:
            text = await asyncio.wait_for(adapter.run_action(self.aggregator.client, action), timeout=15)
        except Exception as exc:  # noqa: BLE001 - any failure is reported, never raised
            logger.warning("action %r from %s failed: %s", action_id, source, exc)
            return ActionOutcome(ok=False, text="Failed")
        logger.info("action %r run from %s", action_id, source)
        # Show the result (a light now "on") without waiting a whole poll
        # interval; the short delay gives Home Assistant time to update.
        self.aggregator.request_poll(delay=1.0)
        return ActionOutcome(ok=True, text=(text or "Done")[:STATE_MAX])
