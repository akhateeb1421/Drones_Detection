"""Login + identity endpoints, and default-account bootstrap."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import (
    AuthUser,
    create_token,
    hash_password,
    require_admin,
    require_user,
    verify_password,
)
from app.models import AuditLog, User
from app.schemas.auth import LoginIn, LoginOut, MeOut
from app.services.audit import audit

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


def ensure_default_users(db: Session) -> None:
    """Create the bootstrap admin + operator accounts when the users table
    is empty. Called once at app startup. Passwords come from .env
    (ADMIN_PASSWORD / OPERATOR_PASSWORD); fallbacks are logged loudly."""
    existing = db.execute(select(User.id).limit(1)).first()
    if existing is not None:
        return
    s = get_settings()
    admin_pw = s.admin_password or (s.admin_token if s.admin_token != "replace_me" else "")
    if not admin_pw:
        admin_pw = "admin"
        log.warning(
            "No ADMIN_PASSWORD / ADMIN_TOKEN configured — bootstrap admin password "
            "is 'admin'. Set ADMIN_PASSWORD in backend/.env and restart."
        )
    operator_pw = s.operator_password
    if not operator_pw:
        operator_pw = "operator"
        log.warning(
            "No OPERATOR_PASSWORD configured — bootstrap operator password is "
            "'operator'. Set OPERATOR_PASSWORD in backend/.env and restart."
        )
    db.add(User(username=s.admin_username, password_hash=hash_password(admin_pw), role="admin"))
    db.add(User(username=s.operator_username, password_hash=hash_password(operator_pw), role="operator"))
    db.commit()
    log.info(
        "Bootstrapped default users: %s (admin), %s (operator).",
        s.admin_username, s.operator_username,
    )


@router.post("/login", response_model=LoginOut)
def login(payload: LoginIn, db: Session = Depends(get_db)) -> LoginOut:
    user = db.execute(
        select(User).where(User.username == payload.username.strip())
    ).scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        audit(db, payload.username.strip() or "?", "login_failed", None)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )
    user.last_login_at = datetime.now(timezone.utc)
    audit(db, user.username, "login", {"role": user.role})
    db.commit()
    settings = get_settings()
    return LoginOut(
        token=create_token(user.username, user.role),
        username=user.username,
        role=user.role,
        expires_in_s=int(settings.auth_token_ttl_hours * 3600),
    )


@router.get("/me", response_model=MeOut)
def me(user: AuthUser = Depends(require_user)) -> MeOut:
    return MeOut(username=user.username, role=user.role)


@router.get("/audit")
def audit_trail(
    limit: int = Query(default=200, ge=1, le=2000),
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_admin),
) -> list[dict]:
    """Most recent audit events (admin only)."""
    rows = db.execute(
        select(AuditLog).order_by(AuditLog.ts.desc()).limit(limit)
    ).scalars().all()
    return [
        {"ts": r.ts.isoformat(), "username": r.username, "action": r.action, "detail": r.detail}
        for r in rows
    ]
