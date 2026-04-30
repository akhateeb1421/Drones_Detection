"""Per-track summary — one row per (camera_id, track_id), updated as frames stream in."""

from datetime import datetime

from sqlalchemy import REAL, BigInteger, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.db import Base


class Track(Base):
    __tablename__ = "tracks"
    __table_args__ = (
        UniqueConstraint("camera_id", "track_id", name="uq_tracks_camera_track"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    camera_id: Mapped[int] = mapped_column(Integer, ForeignKey("cameras.id"), nullable=False)
    track_id: Mapped[int] = mapped_column(Integer, nullable=False)

    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    voted_class: Mapped[str | None] = mapped_column(String(32), nullable=True)
    max_confidence: Mapped[float | None] = mapped_column(REAL, nullable=True)
    max_speed_mps: Mapped[float | None] = mapped_column(REAL, nullable=True)
    min_eta_s: Mapped[float | None] = mapped_column(REAL, nullable=True)
    nearest_area: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_lat: Mapped[float | None] = mapped_column(REAL, nullable=True)
    last_lon: Mapped[float | None] = mapped_column(REAL, nullable=True)

    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
