"""Append-only audit trail for privileged actions."""

from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

from app.models import AuditLog

log = logging.getLogger(__name__)


def audit(db: Session, username: str, action: str, detail: dict | str | None = None) -> None:
    """Record an audit event. Never raises — auditing must not break the
    action it describes; failures are logged instead."""
    try:
        detail_str = json.dumps(detail, ensure_ascii=False, default=str) if isinstance(detail, dict) else detail
        db.add(AuditLog(username=username, action=action, detail=detail_str))
        # No commit here — the caller's transaction commits the audit row
        # atomically with the action it describes.
    except Exception:  # noqa: BLE001
        log.exception("Failed to record audit event %s by %s", action, username)
