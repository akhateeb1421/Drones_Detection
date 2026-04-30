"""Cached ML predictions — written by the training scripts, read by the API."""

from datetime import datetime

from sqlalchemy import REAL, BigInteger, DateTime, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.db import Base


class ModelPrediction(Base):
    __tablename__ = "model_predictions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    region: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    target_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    horizon_days: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    risk_probability: Mapped[float | None] = mapped_column(REAL, nullable=True)
    forecast_count: Mapped[float | None] = mapped_column(REAL, nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
