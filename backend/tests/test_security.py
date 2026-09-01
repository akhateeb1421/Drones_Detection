"""Unit tests for password hashing and session tokens."""

import time

from app.core.security import (
    create_token,
    hash_password,
    resolve_user,
    resolve_ws_user,
    verify_password,
    verify_token,
)


def test_password_roundtrip():
    h = hash_password("s3cret!")
    assert h.startswith("pbkdf2$")
    assert verify_password("s3cret!", h) is True
    assert verify_password("wrong", h) is False


def test_password_hashes_are_salted():
    assert hash_password("same") != hash_password("same")


def test_malformed_hash_rejected():
    assert verify_password("x", "not-a-hash") is False
    assert verify_password("x", "") is False


def test_token_roundtrip():
    token = create_token("alice", "operator")
    data = verify_token(token)
    assert data is not None
    assert data["sub"] == "alice"
    assert data["role"] == "operator"


def test_tampered_token_rejected():
    token = create_token("alice", "operator")
    payload_b64, sig_b64 = token.split(".")
    # Flip a character in the payload — the signature must no longer match.
    flipped = ("A" if payload_b64[0] != "A" else "B") + payload_b64[1:]
    assert verify_token(f"{flipped}.{sig_b64}") is None
    assert verify_token("garbage") is None
    assert verify_token("") is None


def test_expired_token_rejected():
    token = create_token("alice", "admin", ttl_hours=-0.001)
    time.sleep(0.01)
    assert verify_token(token) is None


def test_role_must_be_known():
    # A token forged with an unknown role (e.g. by a bug) is not accepted.
    import base64
    import hashlib
    import hmac
    import json

    from app.core import security as sec

    payload = json.dumps(
        {"sub": "x", "role": "superadmin", "iat": 0, "exp": int(time.time()) + 3600},
        separators=(",", ":"),
    ).encode()
    sig = hmac.new(sec._secret(), payload, hashlib.sha256).digest()
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731
    assert verify_token(f"{b64(payload)}.{b64(sig)}") is None


def test_resolve_user_bearer_and_ws():
    token = create_token("op1", "operator")
    user = resolve_user(f"Bearer {token}")
    assert user is not None and user.role == "operator" and user.username == "op1"
    assert resolve_user(None, None) is None
    ws_user = resolve_ws_user(token)
    assert ws_user is not None and ws_user.username == "op1"
    assert resolve_ws_user("nonsense") is None
