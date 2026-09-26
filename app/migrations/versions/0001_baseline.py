"""Baseline: no tables yet. Establishes the revision chain (and proves the
migration pipeline works end to end); the users/sessions/audit_log tables
arrive with the auth work (docs/plan-ui-and-auth.md, Phase 1).

Revision ID: 0001
Revises:
"""
from __future__ import annotations

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
