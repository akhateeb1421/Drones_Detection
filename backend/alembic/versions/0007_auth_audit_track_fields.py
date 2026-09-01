"""User accounts, audit log, and new per-track fields
(last_speed_mps for cross-camera projection, last_cam_bearing_deg for
two-camera triangulation).

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-31
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(64), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(16), nullable=False, server_default="operator"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("ts", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("username", sa.String(64), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
    )
    op.create_index("ix_audit_log_ts", "audit_log", ["ts"])
    op.create_index("ix_audit_log_username", "audit_log", ["username"])
    op.create_index("ix_audit_log_action", "audit_log", ["action"])

    op.add_column("tracks", sa.Column("last_speed_mps", sa.REAL(), nullable=True))
    op.add_column("tracks", sa.Column("last_cam_bearing_deg", sa.REAL(), nullable=True))


def downgrade() -> None:
    op.drop_column("tracks", "last_cam_bearing_deg")
    op.drop_column("tracks", "last_speed_mps")
    op.drop_index("ix_audit_log_action", table_name="audit_log")
    op.drop_index("ix_audit_log_username", table_name="audit_log")
    op.drop_index("ix_audit_log_ts", table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
