"""Per-track alarm_fired_at timestamp.

Stamped by the worker when an alarm fires for any detection on the track.
Lets the dashboard reconcile its CRITICAL threat badges with the ephemeral
alarm WS events.

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-05
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tracks", sa.Column("alarm_fired_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("tracks", "alarm_fired_at")
