"""Per-frame detection records — append-only history of every YOLO hit."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DECIMAL, REAL, BigInteger, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.db import Base


class Detection(Base):
    __tablename__ = "detections"
    __table_args__ = (
        Index("ix_detections_camera_track_frame", "camera_id", "track_id", "frame_idx"),
        Index("ix_detections_captured_at", "captured_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    camera_id: Mapped[int] = mapped_column(Integer, ForeignKey("cameras.id"), nullable=False)
    track_id: Mapped[int] = mapped_column(Integer, nullable=False)
    frame_idx: Mapped[int] = mapped_column(Integer, nullable=False)

    drone_class: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[float] = mapped_column(REAL, nullable=False)

    latitude: Mapped[Decimal | None] = mapped_column(DECIMAL(10, 7), nullable=True)
    longitude: Mapped[Decimal | None] = mapped_column(DECIMAL(11, 7), nullable=True)

    speed_mps: Mapped[float | None] = mapped_column(REAL, nullable=True)
    direction: Mapped[str | None] = mapped_column(String(8), nullable=True)
    angle_deg: Mapped[float | None] = mapped_column(REAL, nullable=True)

    nearest_area: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dist_m: Mapped[float | None] = mapped_column(REAL, nullable=True)
    eta_s: Mapped[float | None] = mapped_column(REAL, nullable=True)

    bbox_x1: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bbox_y1: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bbox_x2: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bbox_y2: Mapped[int | None] = mapped_column(Integer, nullable=True)

    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
