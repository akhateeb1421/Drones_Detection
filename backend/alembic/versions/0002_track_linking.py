"""Track linking columns for cross-camera handoff.

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-04
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tracks", sa.Column("linked_track_id", sa.Integer, nullable=True))
    op.add_column("tracks", sa.Column("last_heading_deg", sa.REAL, nullable=True))
    op.create_index("ix_tracks_linked", "tracks", ["linked_track_id"])


def downgrade() -> None:
    op.drop_index("ix_tracks_linked", table_name="tracks")
    op.drop_column("tracks", "last_heading_deg")
    op.drop_column("tracks", "linked_track_id")
