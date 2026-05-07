"""Cameras — one row per physical camera. Lat/lon/heading set at demo time."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DECIMAL, REAL, Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.db import Base


class Camera(Base):
    __tablename__ = "cameras"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name_ar: Mapped[str | None] = mapped_column(String(64), nullable=True)
    stream_url: Mapped[str] = mapped_column(String(255), nullable=False)

    latitude: Mapped[Decimal] = mapped_column(DECIMAL(10, 7), nullable=False)
    longitude: Mapped[Decimal] = mapped_column(DECIMAL(11, 7), nullable=False)
    heading_deg: Mapped[float] = mapped_column(REAL, nullable=False, default=0.0)
    altitude_m: Mapped[float] = mapped_column(REAL, nullable=False, default=10.0)
    fov_h_deg: Mapped[float] = mapped_column(REAL, nullable=False, default=82.6)
    fov_v_deg: Mapped[float] = mapped_column(REAL, nullable=False, default=52.0)
    sensor_w_px: Mapped[int] = mapped_column(Integer, nullable=False, default=1280)
    assumed_target_distance_m: Mapped[float] = mapped_column(REAL, nullable=False, default=500.0)

    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
