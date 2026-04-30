"""Unified attacks table — replaces the legacy `attack_history` table."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DECIMAL, REAL, BigInteger, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.db import Base


class Attack(Base):
    __tablename__ = "attacks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    attack_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    region: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    latitude: Mapped[Decimal] = mapped_column(DECIMAL(10, 7), nullable=False)
    longitude: Mapped[Decimal] = mapped_column(DECIMAL(11, 7), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="historical", index=True)

    # Live-only fields (NULL for historical/synthetic)
    drone_class: Mapped[str | None] = mapped_column(String(32), nullable=True)
    confidence: Mapped[float | None] = mapped_column(REAL, nullable=True)
    speed_mps: Mapped[float | None] = mapped_column(REAL, nullable=True)
    direction: Mapped[str | None] = mapped_column(String(8), nullable=True)
    nearest_area: Mapped[str | None] = mapped_column(String(64), nullable=True)
    eta_s: Mapped[float | None] = mapped_column(REAL, nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
