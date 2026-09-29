"""App settings an admin can change on the web UI's Settings page
(app/api/app_settings.py), instead of in .env.

Saved in config/settings.yaml as plain `key: value` pairs, only for the
ones changed there. At startup they're laid over the values from .env (or
the built-in defaults); on a save they're applied to the running app at
once. Every setting here is read where it's used, not copied at startup,
so none of them needs a restart (see FIELDS' notes for the two that take
effect a little later).

What's deliberately NOT here: anything that can lock you out beyond
what the Settings page guards against (DATABASE_URL, MQTT — those are the
Connections section, with their own tests), SECRETS_MASTER_KEY (it unlocks
this very file's neighbours), the first-admin pair (bootstrap only), the MQTT
topic names (a contract with the device's firmware) and the Compose-only
values (APP_PORT, APP_BIND, APP_UID, COMPOSE_PROFILES).
"""
from __future__ import annotations

import ipaddress
import logging
import os
from dataclasses import asdict, dataclass
from pathlib import Path

import yaml

from app.secret_store import match_owner

logger = logging.getLogger(__name__)

LOG_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR"]


class SettingsError(ValueError):
    """A value that can't be used; `key` is the field it's about."""

    def __init__(self, key: str, message: str) -> None:
        super().__init__(message)
        self.key = key


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    group: str
    help: str
    kind: str                       # number | integer | boolean | text | select
    minimum: float | None = None
    maximum: float | None = None
    unit: str | None = None
    options: tuple[str, ...] = ()
    placeholder: str | None = None


FIELDS: tuple[Field, ...] = (
    Field("session_idle_hours", "Sign out after idle", "Sign-in and security",
          "A session ends after this long without use.", "number", 0.25, 720, "hours"),
    Field("session_max_days", "Session lifetime", "Sign-in and security",
          "Sign in again after this long, however active. Applies to new sign-ins.",
          "number", 1, 365, "days"),
    Field("https_only", "HTTPS only", "Sign-in and security",
          "On when the web UI is reached over HTTPS (through a reverse proxy): marks the sign-in "
          "cookie Secure and sends HSTS. Can only be turned on from an HTTPS page, since plain-HTTP "
          "sign-ins would stop working.", "boolean"),
    Field("trusted_proxies", "Trusted proxies", "Sign-in and security",
          "IP addresses of reverse proxies whose X-Forwarded-For is believed, comma-separated. Used "
          "for the audit log and login throttling. Empty trusts none.", "text",
          placeholder="e.g. 192.0.2.10"),
    Field("audit_retention_days", "Keep audit log for", "Sign-in and security",
          "Older entries are removed when the app starts. 0 keeps everything.",
          "integer", 0, 3650, "days"),

    Field("ollama_base_url", "Ollama URL", "AI assist",
          "Where the template Generate buttons send requests. Empty turns the feature off.", "text",
          placeholder="http://host.docker.internal:11434"),
    Field("ollama_model", "Model", "AI assist",
          "Pick one that supports tool calling (see app/settings.py for what's been tried).", "text"),

    Field("log_level", "Log level", "Diagnostics",
          "How much the app writes to its log.", "select", options=tuple(LOG_LEVELS)),
)
BY_KEY = {f.key: f for f in FIELDS}


# --- Validation -----------------------------------------------------------------

def coerce(key: str, raw: object) -> object:
    """One form value -> the typed value to store, or SettingsError."""
    field = BY_KEY.get(key)
    if field is None:
        raise SettingsError(key, f"'{key}' isn't a setting that can be changed here")

    if field.kind == "boolean":
        if isinstance(raw, bool):
            return raw
        raise SettingsError(key, f"{field.label} must be on or off")

    if field.kind in ("number", "integer"):
        if isinstance(raw, bool) or raw in (None, ""):
            raise SettingsError(key, f"{field.label} is required")
        try:
            value = float(raw) if field.kind == "number" else int(str(raw).strip())
        except ValueError:
            raise SettingsError(key, f"{field.label} must be a {'whole ' if field.kind == 'integer' else ''}number") from None
        if field.minimum is not None and value < field.minimum:
            raise SettingsError(key, f"{field.label} must be at least {field.minimum:g}")
        if field.maximum is not None and value > field.maximum:
            raise SettingsError(key, f"{field.label} must be at most {field.maximum:g}")
        return value

    text = "" if raw is None else str(raw).strip()
    if field.kind == "select":
        if text.upper() not in field.options:
            raise SettingsError(key, f"{field.label} must be one of {', '.join(field.options)}")
        return text.upper()
    if key == "trusted_proxies":
        parts = [p.strip() for p in text.split(",") if p.strip()]
        for part in parts:
            try:
                ipaddress.ip_address(part)
            except ValueError:
                raise SettingsError(key, f"'{part}' isn't an IP address (ranges aren't supported)") from None
        return ",".join(parts)
    if key == "ollama_base_url":
        if not text:
            return None
        if not text.startswith(("http://", "https://")) or any(c.isspace() for c in text):
            raise SettingsError(key, "Ollama URL must start with http:// or https://")
        return text.rstrip("/")
    if key == "ollama_model" and not text:
        raise SettingsError(key, "Model is required")
    return text


# --- The saved file, and applying it -----------------------------------------

def read_saved(path: str | Path) -> dict[str, object]:
    path = Path(path)
    if not path.exists():
        return {}
    try:
        raw = yaml.safe_load(path.read_text()) or {}
    except yaml.YAMLError as exc:
        raise SettingsError("", f"{path} is not valid YAML") from exc
    return raw if isinstance(raw, dict) else {}


def write_saved(path: str | Path, values: dict[str, object]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w") as f:
        yaml.safe_dump({k: values[k] for k in BY_KEY if k in values}, f, default_flow_style=False, sort_keys=False)
    match_owner(tmp, path if path.exists() else path.parent)
    os.replace(tmp, path)


def apply_value(settings, key: str, value: object) -> None:
    setattr(settings, key, value)
    if key == "log_level":
        logging.getLogger().setLevel(str(value))


class SavedSettings:
    """The settings as they were before config/settings.yaml was laid over
    them (.env or built-in defaults) — what "reset" goes back to — plus
    which of those came from the environment."""

    def __init__(self, settings) -> None:
        self.baseline = {f.key: getattr(settings, f.key) for f in FIELDS}
        self.from_env = {f.key for f in FIELDS if f.key.upper() in os.environ}

    def apply(self, settings, path: str | Path) -> None:
        """Lay the saved file over `settings`. A value that no longer
        validates (a hand edit, a narrowed range) is logged and skipped,
        never fatal."""
        try:
            saved = read_saved(path)
        except SettingsError as exc:
            logger.error("ignoring saved settings: %s", exc)
            return
        for key, raw in saved.items():
            try:
                apply_value(settings, key, coerce(key, raw))
            except SettingsError as exc:
                logger.error("ignoring saved setting %s: %s", key, exc)

    def describe(self, settings, path: str | Path) -> list[dict[str, object]]:
        """Every field with its current value, what reset would give, and
        where the current value comes from: app | env | default."""
        try:
            saved = read_saved(path)
        except SettingsError:
            saved = {}
        rows = []
        for field in FIELDS:
            source = "app" if field.key in saved else "env" if field.key in self.from_env else "default"
            rows.append({**asdict(field), "options": list(field.options),
                         "value": getattr(settings, field.key),
                         "baseline": self.baseline[field.key], "source": source})
        return rows
