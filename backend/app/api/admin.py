"""Admin auth check.

Used by the dashboard to validate the admin token before flipping the UI
into admin mode. The actual write/approve endpoints already gate themselves
with `require_admin`, but we expose this lightweight check so the login
form can reject a bad token before changing any UI state.
"""

from fastapi import APIRouter, Depends

from app.core.security import require_admin

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/check")
def admin_check(_: None = Depends(require_admin)) -> dict[str, bool]:
    return {"ok": True}
