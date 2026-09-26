"""Programmatic Alembic entry point. The migrations live inside the app
package (not a top-level alembic/ dir) so they ship in the Docker image,
which only copies app/ and schema/."""
from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config

MIGRATIONS_DIR = Path(__file__).resolve().parent


def make_config(url: str | None = None) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    if url is not None:
        # Via attributes, not set_main_option: ConfigParser interpolation
        # would choke on a '%' in the (URL-encoded) password.
        cfg.attributes["url"] = url
    return cfg


def run_migrations(url: str) -> None:
    """Blocking `alembic upgrade head`. Call from a thread (env.py runs its
    own event loop)."""
    command.upgrade(make_config(url), "head")
