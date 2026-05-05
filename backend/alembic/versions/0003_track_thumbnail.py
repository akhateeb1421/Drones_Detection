"""Per-track thumbnail path.

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-04
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tracks", sa.Column("thumbnail_path", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("tracks", "thumbnail_path")
