"""Rendering an Action's `state_template` (app/actions.py): the short
text the web UI shows beside its label ("on", "21.5 C").

A template sees two things:
  - `states['<entity_id>']`: each Home Assistant entity (app.home_assistant.
    entity_view): `.state` (always a string), `.name`, `.unit`, `.domain`,
    `.attributes`, `.last_changed`.
  - `device`: the bedside device's own readings (`device.temperature_c`,
    `device.motion`...).
"""
from __future__ import annotations

import time

from jinja2.sandbox import SandboxedEnvironment

from app.device import DeviceState

#: Sandboxed since template strings come from config — config the owner
#: writes themselves today, but sandboxing costs nothing and means a future
#: shared config source doesn't get free attribute access to arbitrary
#: Python objects. Built-in filters (join, format, etc.) stay available;
#: sandboxing restricts attribute/method access on objects, not the filter
#: set.
_TEMPLATE_ENV = SandboxedEnvironment(autoescape=False)


def device_context(state: DeviceState, now: float | None = None) -> dict[str, object]:
    """The device's latest readings, as `device.<field>`."""
    reading = state.sensors
    age = state.sensors_age(now if now is not None else time.time())
    temperature = reading.temperature_c if reading else None
    return {
        "temperature_c": temperature,
        "temperature_f": round(temperature * 9 / 5 + 32, 1) if temperature is not None else None,
        "humidity": reading.humidity if reading else None,
        "lux": reading.lux if reading else None,
        "screen": reading.screen if reading else None,
        "motion": reading.motion if reading else None,
        "online": bool(state.online),
        "last_report_seconds": int(age) if age is not None else None,
    }


def template_context(states: dict[str, dict[str, object]], device: dict[str, object]) -> dict[str, object]:
    return {"states": states, "device": device}


def render_single_expression(template_str: str, context: dict[str, object]) -> tuple[str | None, str | None]:
    """Renders one Jinja2 template string against a context. Returns
    (rendered_text, None) on success or (None, error_message) on
    failure. Never raises — every caller decides what to do with a
    failure itself (show no state, or show the exact error in the preview
    UI)."""
    try:
        return _TEMPLATE_ENV.from_string(template_str).render(**context).strip(), None
    except Exception as exc:  # noqa: BLE001 - caller decides how to handle this
        return None, str(exc)
