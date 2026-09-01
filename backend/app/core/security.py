"""Authentication: password hashing, signed session tokens, role deps.

Design notes
------------
* Passwords are hashed with PBKDF2-HMAC-SHA256 (stdlib — no extra deps).
* Session tokens are compact HMAC-signed payloads (JWT-shaped but
  dependency-free): ``base64url(json).base64url(hmac_sha256(secret, json))``.
  Payload carries {sub, role, iat, exp}.
* The legacy ``X-Admin-Token`` shared secret is still accepted and maps to
  a synthetic admin identity, so existing curl scripts / older UI builds
  keep working while accounts are rolled out.

Dependencies exported for routers:
* ``get_current_user`` — resolves the caller (or None). Never raises.
* ``require_user``     — any authenticated user (operator or admin).
* ``require_admin``    — admin role only (or the legacy admin token).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Query, status

from app.core.config import get_settings

log = logging.getLogger(__name__)

_PBKDF2_ITERATIONS = 240_000


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    """Return ``pbkdf2$<iterations>$<salt_hex>$<hash_hex>``."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iterations_s, salt_hex, hash_hex = stored.split("$")
        if scheme != "pbkdf2":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations_s)
        )
        return hmac.compare_digest(digest.hex(), hash_hex)
    except Exception:  # noqa: BLE001 — malformed hash == no match
        return False


# ---------------------------------------------------------------------------
# Session tokens
# ---------------------------------------------------------------------------

def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def _secret() -> bytes:
    s = get_settings()
    raw = s.auth_secret or f"derived::{s.admin_token}"
    return hashlib.sha256(raw.encode("utf-8")).digest()


def create_token(username: str, role: str, ttl_hours: float | None = None) -> str:
    s = get_settings()
    ttl = ttl_hours if ttl_hours is not None else s.auth_token_ttl_hours
    now = int(time.time())
    payload = json.dumps(
        {"sub": username, "role": role, "iat": now, "exp": now + int(ttl * 3600)},
        separators=(",", ":"),
    ).encode("utf-8")
    sig = hmac.new(_secret(), payload, hashlib.sha256).digest()
    return f"{_b64e(payload)}.{_b64e(sig)}"


def verify_token(token: str) -> dict | None:
    """Return the payload dict for a valid, unexpired token; else None."""
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        payload = _b64d(payload_b64)
        expected = hmac.new(_secret(), payload, hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64d(sig_b64)):
            return None
        data = json.loads(payload)
        if int(data.get("exp", 0)) < time.time():
            return None
        if data.get("role") not in {"admin", "operator"}:
            return None
        return data
    except Exception:  # noqa: BLE001 — any malformed token == invalid
        return None


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class AuthUser:
    username: str
    role: str  # 'admin' | 'operator'
    legacy: bool = False  # True when authenticated via the legacy X-Admin-Token


def resolve_user(
    authorization: str | None,
    x_admin_token: str | None = None,
) -> AuthUser | None:
    """Resolve an AuthUser from a Bearer token and/or legacy admin header."""
    if authorization and authorization.lower().startswith("bearer "):
        data = verify_token(authorization[7:].strip())
        if data is not None:
            return AuthUser(username=str(data["sub"]), role=str(data["role"]))
    settings = get_settings()
    if (
        x_admin_token
        and settings.admin_token
        and settings.admin_token != "replace_me"
        and hmac.compare_digest(x_admin_token, settings.admin_token)
    ):
        return AuthUser(username="admin", role="admin", legacy=True)
    return None


def get_current_user(
    authorization: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
    token: str | None = Query(default=None),
) -> AuthUser | None:
    """Resolve the caller from (in order) the Authorization: Bearer header,
    the legacy X-Admin-Token header, or a ``?token=`` query parameter.

    The query parameter exists for browser contexts that cannot set
    headers — chiefly ``<img src>`` loading track thumbnails. Prefer the
    header everywhere else (query strings end up in access logs)."""
    user = resolve_user(authorization, x_admin_token)
    if user is not None:
        return user
    if token:
        return resolve_ws_user(token)
    return None


def require_user(user: AuthUser | None = Depends(get_current_user)) -> AuthUser:
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Sign in and send Authorization: Bearer <token>.",
        )
    return user


def require_admin(user: AuthUser | None = Depends(get_current_user)) -> AuthUser:
    """Admin-only gate. Accepts an admin session token or the legacy X-Admin-Token."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
        )
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required.",
        )
    return user


def resolve_ws_user(token: str | None) -> AuthUser | None:
    """WebSocket auth: `?token=` carries either a session token or the
    legacy admin token value."""
    if not token:
        return None
    data = verify_token(token)
    if data is not None:
        return AuthUser(username=str(data["sub"]), role=str(data["role"]))
    settings = get_settings()
    if (
        settings.admin_token
        and settings.admin_token != "replace_me"
        and hmac.compare_digest(token, settings.admin_token)
    ):
        return AuthUser(username="admin", role="admin", legacy=True)
    return None
