"""Auth paths that do not require Google: Apple SIWA + continue-without-gmail."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.api.v1 import auth as auth_routes
from app.core.config import get_settings
from app.core.security import decode_session_token
from app.db.models import User
from app.schemas.api import AppleSignInRequest
from app.services import apple_auth


def _fake_request(ip: str = "127.0.0.1") -> MagicMock:
    req = MagicMock()
    req.headers = {}
    req.client.host = ip
    return req


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> None:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_apple_local_email_stable() -> None:
    a = apple_auth.apple_local_email("001234.abcdef")
    b = apple_auth.apple_local_email("001234.abcdef")
    assert a == b
    assert apple_auth.is_apple_local_email(a)


def test_verify_identity_token_requires_client_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APPLE_CLIENT_ID", "")
    get_settings.cache_clear()
    with pytest.raises(HTTPException) as exc:
        apple_auth.verify_identity_token("not-a-token")
    assert exc.value.status_code == 503


def test_apple_sign_in_creates_user(db, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APPLE_CLIENT_ID", "com.haoruiwang.alfred")
    get_settings.cache_clear()

    identity = apple_auth.AppleIdentity(
        sub="apple-sub-1",
        email="rae@icloud.com",
        email_verified=True,
    )
    monkeypatch.setattr(apple_auth, "verify_identity_token", lambda _t: identity)

    result = auth_routes.apple_sign_in(
        AppleSignInRequest(identity_token="fake", full_name="Rae W", email="rae@icloud.com"),
        _fake_request(),
        db=db,
    )
    payload = decode_session_token(result.access_token)
    user = db.get(User, payload["sub"])
    assert user is not None
    assert user.email == "rae@icloud.com"
    assert user.apple_sub == "apple-sub-1"
    assert user.name == "Rae W"


def test_apple_sign_in_reuses_by_sub(db, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APPLE_CLIENT_ID", "com.haoruiwang.alfred")
    get_settings.cache_clear()
    existing = User(email="rae@icloud.com", apple_sub="apple-sub-1", name="Rae")
    db.add(existing)
    db.commit()

    identity = apple_auth.AppleIdentity(sub="apple-sub-1", email=None, email_verified=False)
    monkeypatch.setattr(apple_auth, "verify_identity_token", lambda _t: identity)

    result = auth_routes.apple_sign_in(
        AppleSignInRequest(identity_token="fake"),
        _fake_request(),
        db=db,
    )
    payload = decode_session_token(result.access_token)
    assert payload["sub"] == existing.id


def test_apple_sign_in_without_email_uses_synthetic(db, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APPLE_CLIENT_ID", "com.haoruiwang.alfred")
    get_settings.cache_clear()
    identity = apple_auth.AppleIdentity(sub="sub.noemail", email=None, email_verified=False)
    monkeypatch.setattr(apple_auth, "verify_identity_token", lambda _t: identity)

    result = auth_routes.apple_sign_in(
        AppleSignInRequest(identity_token="fake"),
        _fake_request(),
        db=db,
    )
    payload = decode_session_token(result.access_token)
    user = db.get(User, payload["sub"])
    assert user is not None
    assert apple_auth.is_apple_local_email(user.email)
    assert user.apple_sub == "sub.noemail"


def test_continue_without_gmail(db) -> None:
    result = auth_routes.continue_without_gmail(_fake_request(), db=db)
    payload = decode_session_token(result.access_token)
    user = db.get(User, payload["sub"])
    assert user is not None
    assert user.email.endswith("@local.alfred")
    assert (user.preferences or {}).get("auth_provider") == "anonymous"
    assert user.apple_sub is None


def test_sync_messages_noop_without_google(db) -> None:
    from app.services.ingestion import sync_messages

    user = User(email="anon@local.alfred", preferences={"auth_provider": "anonymous"})
    db.add(user)
    db.commit()
    result = sync_messages(db, user.id)
    assert result.new_messages == []
    assert result.initial_backfill is False
