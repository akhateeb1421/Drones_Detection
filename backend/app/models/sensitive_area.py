"""Sensitive areas — locations to defend. Editable from the admin UI."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DECIMAL, DateTime, Integer, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.db import Base


class SensitiveArea(Base):
    __tablename__ = "sensitive_areas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name_ar: Mapped[str | None] = mapped_column(String(64), nullable=True)
    latitude: Mapped[Decimal] = mapped_column(DECIMAL(10, 7), nullable=False)
    longitude: Mapped[Decimal] = mapped_column(DECIMAL(11, 7), nullable=False)
    priority: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
