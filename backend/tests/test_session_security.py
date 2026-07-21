"""Session token jti + revocation denylist behavior."""

from __future__ import annotations

import jwt
import pytest
from fastapi import HTTPException

from app.core import security
from app.core.config import get_settings


def _decode(token: str) -> dict:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


def test_session_token_carries_unique_jti() -> None:
    a = _decode(security.create_session_token("u1"))
    b = _decode(security.create_session_token("u1"))
    assert a["jti"] and b["jti"]
    assert a["jti"] != b["jti"]  # each session is independently revocable


def test_decode_rejects_tampered_token() -> None:
    with pytest.raises(HTTPException) as exc:
        security.decode_session_token("not-a-jwt")
    assert exc.value.status_code == 401


def test_revoked_jti_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    """When the denylist reports a jti as revoked, decoding must 401 (even though the
    signature is still valid)."""
    token = security.create_session_token("u1")
    # Simulate the denylist containing this token's jti without needing a live Redis.
    monkeypatch.setattr(security, "_is_revoked", lambda jti: True)
    with pytest.raises(HTTPException) as exc:
        security.decode_session_token(token)
    assert exc.value.status_code == 401
    assert exc.value.detail == "Session revoked"


def test_valid_token_passes_when_not_revoked(monkeypatch: pytest.MonkeyPatch) -> None:
    token = security.create_session_token("u1")
    monkeypatch.setattr(security, "_is_revoked", lambda jti: False)
    payload = security.decode_session_token(token)
    assert payload["sub"] == "u1"


def test_is_revoked_fails_open_without_redis() -> None:
    """No Redis available in unit tests: the denylist check must fail open (treat the
    token as not revoked) rather than raise."""
    assert security._is_revoked("some-jti") is False
