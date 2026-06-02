"""Admin token dependency (used to gate write/approve endpoints)."""

from fastapi import Header, HTTPException, status

from app.core.config import Settings
settings = Settings()


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    """Reject the request unless the X-Admin-Token header matches the configured token."""
    if not settings.admin_token or settings.admin_token == "replace_me":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ADMIN_TOKEN is not configured on the server.",
        )
    if x_admin_token != settings.admin_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid X-Admin-Token header.",
        )
