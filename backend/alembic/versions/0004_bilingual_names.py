"""Bilingual name_ar columns for cameras and sensitive_areas.

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-05
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cameras", sa.Column("name_ar", sa.String(64), nullable=True))
    op.add_column("sensitive_areas", sa.Column("name_ar", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("cameras", "name_ar")
    op.drop_column("sensitive_areas", "name_ar")
