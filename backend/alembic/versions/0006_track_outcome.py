"""Per-track outcome (countered vs hit) after operator approval.

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-08
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tracks", sa.Column("outcome", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("tracks", "outcome")
