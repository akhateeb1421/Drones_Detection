"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-04-28
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cameras",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(64), nullable=False, unique=True),
        sa.Column("stream_url", sa.String(255), nullable=False),
        sa.Column("latitude", sa.DECIMAL(10, 7), nullable=False),
        sa.Column("longitude", sa.DECIMAL(11, 7), nullable=False),
        sa.Column("heading_deg", sa.REAL, nullable=False, server_default="0"),
        sa.Column("altitude_m", sa.REAL, nullable=False, server_default="10"),
        sa.Column("fov_h_deg", sa.REAL, nullable=False, server_default="82.6"),
        sa.Column("fov_v_deg", sa.REAL, nullable=False, server_default="52"),
        sa.Column("sensor_w_px", sa.Integer, nullable=False, server_default="1280"),
        sa.Column("assumed_target_distance_m", sa.REAL, nullable=False, server_default="500"),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "sensitive_areas",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(64), nullable=False, unique=True),
        sa.Column("latitude", sa.DECIMAL(10, 7), nullable=False),
        sa.Column("longitude", sa.DECIMAL(11, 7), nullable=False),
        sa.Column("priority", sa.SmallInteger, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "attacks",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attack_type", sa.String(64), nullable=False),
        sa.Column("target_location", sa.String(255)),
        sa.Column("region", sa.String(128)),
        sa.Column("latitude", sa.DECIMAL(10, 7), nullable=False),
        sa.Column("longitude", sa.DECIMAL(11, 7), nullable=False),
        sa.Column("source", sa.String(16), nullable=False, server_default="historical"),
        sa.Column("drone_class", sa.String(32)),
        sa.Column("confidence", sa.REAL),
        sa.Column("speed_mps", sa.REAL),
        sa.Column("direction", sa.String(8)),
        sa.Column("nearest_area", sa.String(64)),
        sa.Column("eta_s", sa.REAL),
        sa.Column("approved_by", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_attacks_occurred_at", "attacks", ["occurred_at"])
    op.create_index("ix_attacks_region", "attacks", ["region"])
    op.create_index("ix_attacks_attack_type", "attacks", ["attack_type"])
    op.create_index("ix_attacks_source", "attacks", ["source"])

    op.create_table(
        "tracks",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("camera_id", sa.Integer, sa.ForeignKey("cameras.id"), nullable=False),
        sa.Column("track_id", sa.Integer, nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("voted_class", sa.String(32)),
        sa.Column("max_confidence", sa.REAL),
        sa.Column("max_speed_mps", sa.REAL),
        sa.Column("min_eta_s", sa.REAL),
        sa.Column("nearest_area", sa.String(64)),
        sa.Column("last_lat", sa.REAL),
        sa.Column("last_lon", sa.REAL),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("camera_id", "track_id", name="uq_tracks_camera_track"),
    )
    op.create_index("ix_tracks_status", "tracks", ["status"])

    op.create_table(
        "detections",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("camera_id", sa.Integer, sa.ForeignKey("cameras.id"), nullable=False),
        sa.Column("track_id", sa.Integer, nullable=False),
        sa.Column("frame_idx", sa.Integer, nullable=False),
        sa.Column("drone_class", sa.String(32), nullable=False),
        sa.Column("confidence", sa.REAL, nullable=False),
        sa.Column("latitude", sa.DECIMAL(10, 7)),
        sa.Column("longitude", sa.DECIMAL(11, 7)),
        sa.Column("speed_mps", sa.REAL),
        sa.Column("direction", sa.String(8)),
        sa.Column("angle_deg", sa.REAL),
        sa.Column("nearest_area", sa.String(64)),
        sa.Column("dist_m", sa.REAL),
        sa.Column("eta_s", sa.REAL),
        sa.Column("bbox_x1", sa.Integer),
        sa.Column("bbox_y1", sa.Integer),
        sa.Column("bbox_x2", sa.Integer),
        sa.Column("bbox_y2", sa.Integer),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_detections_camera_track_frame", "detections", ["camera_id", "track_id", "frame_idx"])
    op.create_index("ix_detections_captured_at", "detections", ["captured_at"])

    op.create_table(
        "model_predictions",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("region", sa.String(128), nullable=False),
        sa.Column("target_location", sa.String(255)),
        sa.Column("horizon_days", sa.SmallInteger, nullable=False),
        sa.Column("risk_probability", sa.REAL),
        sa.Column("forecast_count", sa.REAL),
        sa.Column("model_version", sa.String(32)),
    )
    op.create_index("ix_model_predictions_generated_at", "model_predictions", ["generated_at"])
    op.create_index("ix_model_predictions_region", "model_predictions", ["region"])


def downgrade() -> None:
    op.drop_table("model_predictions")
    op.drop_table("detections")
    op.drop_table("tracks")
    op.drop_table("attacks")
    op.drop_table("sensitive_areas")
    op.drop_table("cameras")
