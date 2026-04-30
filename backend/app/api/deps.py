"""Shared API dependencies."""

from app.core.db import get_db  # noqa: F401  (re-exported for convenience)
from app.core.security import require_admin  # noqa: F401
