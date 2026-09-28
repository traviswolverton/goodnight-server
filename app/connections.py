"""The MQTT broker and Postgres database this app connects to, as set
from the web UI's Connections page (app/api/connections.py).

Saved in config/connections.yaml, with each password in the encrypted
secret store (app/secret_store.py), never in the YAML itself:

    mqtt:
      host: 192.0.2.25
      port: 1883
      username: aggregator
      password: {secret: connection_mqtt_password}
    database:
      host: 192.0.2.42
      port: 5432
      database: desk_dashboard
      username: desk_dashboard
      password: {secret: connection_database_password}

A section that's there replaces the matching .env values (MQTT_* /
DATABASE_URL) at startup; one that isn't leaves .env in charge. So .env
is only the first-boot bootstrap, and deleting a section (then
restarting) is the way back to it — the recovery path if a saved
database stops answering, since signing in needs the database.

The checks the UI runs before a save are here too: check_mqtt() and
inspect_database(), plus copy_database() for moving to an empty one.
"""
from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

import aiomqtt
import yaml
from alembic.script import ScriptDirectory
from alembic.util import CommandError
from sqlalchemy import func, select, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.secret_store import SecretError, get_secret, match_owner, set_secret

logger = logging.getLogger(__name__)

MQTT_SECRET = "connection_mqtt_password"
DATABASE_SECRET = "connection_database_password"

#: Seconds a connection test waits for a broker / database to answer.
TEST_TIMEOUT_SECONDS = 10.0
#: Rows per INSERT when copying the audit log to a new database.
COPY_CHUNK_ROWS = 1000


class ConnectionConfigError(ValueError):
    """A form value that can't be used. Safe to show as-is: never
    contains a password."""


@dataclass
class MqttConnection:
    host: str
    port: int = 1883
    username: str | None = None
    password: str | None = field(default=None, repr=False)


@dataclass
class DatabaseConnection:
    host: str
    port: int = 5432
    database: str = ""
    username: str = ""
    password: str | None = field(default=None, repr=False)

    def url(self) -> str:
        """SQLAlchemy async URL, with the password percent-encoded."""
        return URL.create(
            "postgresql+asyncpg", username=self.username, password=self.password,
            host=self.host, port=self.port, database=self.database,
        ).render_as_string(hide_password=False)

    def same_server_and_database(self, other: DatabaseConnection | None) -> bool:
        return other is not None and (
            (self.host.lower(), self.port, self.database) == (other.host.lower(), other.port, other.database))

    @classmethod
    def from_url(cls, url: str | None) -> DatabaseConnection | None:
        if not url:
            return None
        try:
            parsed = make_url(url)
        except ArgumentError:
            return None
        return cls(host=parsed.host or "", port=parsed.port or 5432, database=parsed.database or "",
                   username=parsed.username or "", password=parsed.password)


# --- Validation -------------------------------------------------------------

def _host(raw: object) -> str:
    host = str(raw or "").strip()
    if not host:
        raise ConnectionConfigError("Host is required")
    if any(c.isspace() for c in host) or "/" in host:
        raise ConnectionConfigError("Host must be a hostname or IP address, nothing else")
    return host


def _port(raw: object, default: int) -> int:
    if raw in (None, ""):
        return default
    try:
        port = int(str(raw).strip())
    except ValueError:
        raise ConnectionConfigError("Port must be a number") from None
    if not 1 <= port <= 65535:
        raise ConnectionConfigError("Port must be between 1 and 65535")
    return port


def mqtt_from_form(fields: dict, fallback_password: str | None) -> MqttConnection:
    """A blank password keeps `fallback_password` (the one in use), so
    editing the host doesn't mean retyping it."""
    username = str(fields.get("username") or "").strip() or None
    return MqttConnection(host=_host(fields.get("host")), port=_port(fields.get("port"), 1883),
                          username=username, password=fields.get("password") or fallback_password)


def database_from_form(fields: dict, fallback_password: str | None) -> DatabaseConnection:
    database = str(fields.get("database") or "").strip()
    username = str(fields.get("username") or "").strip()
    if not database:
        raise ConnectionConfigError("Database name is required")
    if not username:
        raise ConnectionConfigError("Username is required")
    password = fields.get("password") or fallback_password
    if not password:
        raise ConnectionConfigError("Password is required")
    return DatabaseConnection(host=_host(fields.get("host")), port=_port(fields.get("port"), 5432),
                              database=database, username=username, password=password)


# --- The saved file ---------------------------------------------------------

def _read(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return yaml.safe_load(path.read_text()) or {}
    except yaml.YAMLError as exc:
        raise ConnectionConfigError(f"{path} is not valid YAML") from exc


def _write_section(path: str | Path, section: str, values: dict) -> None:
    path = Path(path)
    raw = _read(path)
    raw[section] = values
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w") as f:
        yaml.safe_dump(raw, f, default_flow_style=False, sort_keys=False)
    match_owner(tmp, path if path.exists() else path.parent)
    os.replace(tmp, path)


def save_mqtt(path: str | Path, secrets_path: str | Path, conn: MqttConnection) -> None:
    """Secret first: a failure there (no master key) leaves the file as it was."""
    values: dict = {"host": conn.host, "port": conn.port, "username": conn.username}
    if conn.password:
        set_secret(secrets_path, MQTT_SECRET, conn.password)
        values["password"] = {"secret": MQTT_SECRET}
    _write_section(path, "mqtt", values)


def save_database(path: str | Path, secrets_path: str | Path, conn: DatabaseConnection) -> None:
    set_secret(secrets_path, DATABASE_SECRET, conn.password or "")
    _write_section(path, "database", {
        "host": conn.host, "port": conn.port, "database": conn.database,
        "username": conn.username, "password": {"secret": DATABASE_SECRET},
    })


def _password(value: object, secrets_path: str) -> str | None:
    if isinstance(value, dict) and set(value) == {"secret"}:
        return get_secret(secrets_path, str(value["secret"]))
    if value is None:
        return None
    raise ConnectionConfigError("password must be a {secret: <name>} reference")


def apply_saved_connections(settings) -> dict[str, str]:
    """Overlay config/connections.yaml onto `settings` (in place, before
    anything connects). Returns each connection's source: "app" (saved in
    the UI) or "env". A section that can't be read — bad YAML, or a secret
    the master key can't decrypt — is logged and skipped, leaving .env's
    values in use rather than stopping the app."""
    sources = {"mqtt": "env", "database": "env"}
    try:
        raw = _read(Path(settings.connections_config_path))
    except ConnectionConfigError as exc:
        logger.error("ignoring saved connections: %s", exc)
        return sources

    mqtt = raw.get("mqtt")
    if isinstance(mqtt, dict):
        try:
            conn = MqttConnection(host=_host(mqtt.get("host")), port=_port(mqtt.get("port"), 1883),
                                  username=mqtt.get("username") or None,
                                  password=_password(mqtt.get("password"), settings.secrets_config_path))
        except (ConnectionConfigError, SecretError) as exc:
            logger.error("ignoring the saved MQTT connection, using .env's: %s", exc)
        else:
            settings.mqtt_host, settings.mqtt_port = conn.host, conn.port
            settings.mqtt_username, settings.mqtt_password = conn.username, conn.password
            sources["mqtt"] = "app"

    database = raw.get("database")
    if isinstance(database, dict):
        try:
            conn = DatabaseConnection(
                host=_host(database.get("host")), port=_port(database.get("port"), 5432),
                database=str(database.get("database") or ""), username=str(database.get("username") or ""),
                password=_password(database.get("password"), settings.secrets_config_path))
        except (ConnectionConfigError, SecretError) as exc:
            logger.error("ignoring the saved database connection, using .env's: %s", exc)
        else:
            settings.database_url = conn.url()
            sources["database"] = "app"
    return sources


# --- Checks -----------------------------------------------------------------

def _describe(exc: BaseException, secrets: list[str | None]) -> str:
    message = str(exc) or type(exc).__name__
    for secret in secrets:
        if secret and len(secret) >= 4:
            message = message.replace(secret, "***")
    return message.splitlines()[0][:300]


async def check_mqtt(conn: MqttConnection) -> dict[str, object]:
    """Connect and sign in to the broker, then disconnect. Topic ACLs
    can't be checked from here: Mosquitto silently drops a publish the
    account isn't allowed, and says nothing to the sender."""
    try:
        async with asyncio.timeout(TEST_TIMEOUT_SECONDS):
            async with aiomqtt.Client(hostname=conn.host, port=conn.port, username=conn.username,
                                      password=conn.password, timeout=TEST_TIMEOUT_SECONDS):
                pass
    except Exception as exc:  # noqa: BLE001 - any failure is the answer to "does it connect?"
        # aiomqtt reports its own connect timeout as MqttError("timed out").
        if isinstance(exc, TimeoutError) or str(exc) == "timed out":
            return {"ok": False, "error": f"No answer from {conn.host}:{conn.port} within {TEST_TIMEOUT_SECONDS:.0f} seconds"}
        return {"ok": False, "error": _describe(exc, [conn.password])}
    return {"ok": True, "error": None}


@dataclass
class DatabaseReport:
    """What inspect_database() found, and what saving it would mean.

    `modes` is what a save may do: "use" (it already has this app's
    tables and an administrator), "copy" (it's empty: copy the users,
    sessions and audit log over from the current database first) or
    "fresh" (empty, and .env's ADMIN_USERNAME/ADMIN_PASSWORD will create
    the first administrator). Empty `modes` = it can't be saved, and
    `problems` says why."""
    connected: bool = False
    error: str | None = None
    server_version: str | None = None
    schema: str | None = None        # none | current | upgrade | unknown | foreign
    can_create_tables: bool = False
    user_count: int = 0
    admins: list[str] = field(default_factory=list)
    same_as_current: bool = False
    modes: list[str] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return dict(self.__dict__)


def _migration_heads() -> tuple[ScriptDirectory, str]:
    from app.migrations.runner import make_config
    script = ScriptDirectory.from_config(make_config())
    return script, script.get_current_head()


def _revision_known(script: ScriptDirectory, revision: str) -> bool:
    try:
        return script.get_revision(revision) is not None
    except CommandError:
        return False


async def _probe(conn: DatabaseConnection, report: DatabaseReport) -> None:
    engine = create_async_engine(conn.url(), poolclass=NullPool,
                                 connect_args={"timeout": TEST_TIMEOUT_SECONDS})
    try:
        async with engine.connect() as db:
            report.connected = True
            report.server_version = (await db.execute(text("SHOW server_version"))).scalar_one()
            has_versions = (await db.execute(text("SELECT to_regclass('alembic_version')"))).scalar_one() is not None
            has_users = (await db.execute(text("SELECT to_regclass('users')"))).scalar_one() is not None

            if has_versions:
                revision = (await db.execute(text("SELECT version_num FROM alembic_version"))).scalar_one_or_none()
                script, head = _migration_heads()
                if revision is None:
                    report.schema = "none"
                elif revision == head:
                    report.schema = "current"
                elif _revision_known(script, revision):
                    report.schema = "upgrade"
                else:
                    report.schema = "unknown"
            else:
                report.schema = "foreign" if has_users else "none"

            if has_users and report.schema in ("current", "upgrade"):
                report.user_count = (await db.execute(text("SELECT count(*) FROM users"))).scalar_one()
                report.admins = list((await db.execute(text(
                    "SELECT username FROM users WHERE role = 'admin' AND is_active ORDER BY username"))).scalars())

            # Can this account create tables here? (The migrations need to.)
            # Tried inside the (autobegun) transaction, which is always
            # rolled back.
            try:
                await db.execute(text("CREATE TABLE _desk_dashboard_probe (id integer)"))
                report.can_create_tables = True
            except Exception:  # noqa: BLE001 - "no" is the answer
                report.can_create_tables = False
            finally:
                await db.rollback()
    finally:
        await engine.dispose()


async def inspect_database(conn: DatabaseConnection, current: DatabaseConnection | None,
                           bootstrap_admin: bool) -> DatabaseReport:
    """Everything the UI needs to decide whether switching to `conn` is
    safe — above all, that someone can still sign in afterwards. Reads
    only; the table-creation probe is rolled back."""
    report = DatabaseReport(same_as_current=conn.same_server_and_database(current))
    try:
        async with asyncio.timeout(TEST_TIMEOUT_SECONDS * 2):
            await _probe(conn, report)
    except TimeoutError:
        report.error = f"No answer from {conn.host}:{conn.port} within {TEST_TIMEOUT_SECONDS * 2:.0f} seconds"
    except Exception as exc:  # noqa: BLE001 - reported to the form
        report.error = _describe(exc, [conn.password])

    if report.error:
        report.problems.append(report.error)
        return report

    if report.schema == "unknown":
        report.problems.append(
            "It has database migrations this app doesn't know: a newer version of this app, "
            "or another app's database. Use an empty database or this app's own.")
    elif report.schema == "foreign":
        report.problems.append(
            "It already has a users table that this app didn't create. Use an empty database or this app's own.")
    elif report.schema in ("none", "upgrade") and not report.can_create_tables:
        report.problems.append(
            f"The account '{conn.username}' can't create tables there, which this app needs to do. "
            "Make it the database's owner (docs/database.md).")
    elif report.user_count == 0:
        report.modes.append("copy")
        if bootstrap_admin:
            report.modes.append("fresh")
    elif report.admins:
        report.modes.append("use")
    else:
        report.problems.append(
            "It has users but no active administrator, so nobody could manage the app after switching.")
    return report


async def copy_database(source_session, target: DatabaseConnection) -> dict[str, int]:
    """Create this app's tables in `target` (an empty database) and copy
    every user, session and audit-log row over from the current one,
    keeping their ids — so sessions stay valid and whoever is signed in
    stays signed in after the switch. One transaction on the target:
    either everything is copied or nothing is."""
    from app.auth.models import AuditLog, User, UserSession
    from app.migrations.runner import run_migrations

    url = target.url()
    await asyncio.to_thread(run_migrations, url)
    tables = [User.__table__, UserSession.__table__, AuditLog.__table__]  # foreign-key order
    counts: dict[str, int] = {}
    engine = create_async_engine(url, poolclass=NullPool, connect_args={"timeout": TEST_TIMEOUT_SECONDS})
    try:
        async with engine.begin() as db:
            if (await db.execute(select(func.count()).select_from(User.__table__))).scalar_one():
                raise ConnectionConfigError("That database has users now; test it again")
            for table in tables:
                rows = [dict(row) for row in (await source_session.execute(select(table))).mappings()]
                for start in range(0, len(rows), COPY_CHUNK_ROWS):
                    await db.execute(table.insert(), rows[start:start + COPY_CHUNK_ROWS])
                counts[table.name] = len(rows)
            for table in (User.__table__, AuditLog.__table__):
                await db.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{table.name}', 'id'), "
                    f"coalesce(max(id), 1), max(id) IS NOT NULL) FROM {table.name}"))
    finally:
        await engine.dispose()
    return counts
