"""Proactive Google token refresh (connected_accounts + google_oauth).

Regression cover for the bug where ``credentials_from_payload`` never set ``expiry``,
so ``creds.expired`` was always ``False`` and the proactive refresh branch never ran —
a stale grant then only failed deep inside the Gmail/Calendar call. With ``expiry`` now
populated: an expired-but-refreshable token refreshes and persists; a revoked grant
surfaces up front as ``TokenReconnectRequired``; a payload with no expiry still works.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from google.auth.exceptions import RefreshError
from sqlalchemy.orm import Session

from app.db.enums import Provider
from app.db.models import ConnectedAccount, User
from app.services import google_oauth as oauth
from app.services.connected_accounts import TokenReconnectRequired, refresh_google_token
from app.services.crypto import decrypt_token, encrypt_token


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="tokens@example.com")
    db.add(u)
    db.commit()
    return u


def _account(db: Session, user: User, payload: dict) -> ConnectedAccount:
    acct = ConnectedAccount(
        user_id=user.id,
        provider=Provider.google,
        provider_account_email="tokens@example.com",
        scopes=payload.get("scopes", []),
        token_ciphertext=encrypt_token(payload),
    )
    db.add(acct)
    db.commit()
    return acct


def _past_iso() -> str:
    return (datetime.now(UTC) - timedelta(hours=1)).isoformat()


def _base_payload(**overrides: object) -> dict:
    payload = {
        "token": "old-access-token",
        "refresh_token": "refresh-abc",
        "token_uri": "https://oauth2.googleapis.com/token",
        "client_id": "cid",
        "client_secret": "csecret",
        "scopes": ["https://www.googleapis.com/auth/gmail.modify"],
        "expiry": _past_iso(),
    }
    payload.update(overrides)
    return payload


# --- expiry parsing (pure) ---


def test_parse_expiry_iso_string_is_naive_utc() -> None:
    dt = oauth._parse_expiry({"expiry": "2026-01-01T12:00:00+00:00"})
    assert dt == datetime(2026, 1, 1, 12, 0, 0)
    assert dt is not None and dt.tzinfo is None


def test_parse_expiry_z_suffix() -> None:
    assert oauth._parse_expiry({"expiry": "2026-01-01T12:00:00Z"}) == datetime(2026, 1, 1, 12, 0, 0)


def test_parse_expiry_epoch_fallbacks() -> None:
    secs = oauth._parse_expiry({"expires_at": 1_700_000_000})
    millis = oauth._parse_expiry({"expiry_date": 1_700_000_000_000})
    assert secs == millis == datetime.fromtimestamp(1_700_000_000, tz=UTC).replace(tzinfo=None)


def test_parse_expiry_missing_or_bad_is_none() -> None:
    assert oauth._parse_expiry({}) is None
    assert oauth._parse_expiry({"expiry": "not-a-date"}) is None
    assert oauth._parse_expiry({"expiry": None}) is None


def test_credentials_reflect_expiry() -> None:
    creds = oauth.credentials_from_payload(_base_payload())
    assert creds.expiry is not None
    assert creds.expired is True  # expiry is in the past


# --- refresh_google_token flow ---


def test_expired_token_is_proactively_refreshed_and_persisted(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = _base_payload()
    acct = _account(db, user, payload)
    new_expiry = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1)

    def fake_refresh(self: oauth.Credentials, request: object) -> None:  # noqa: ARG001
        self.token = "fresh-access-token"
        self.expiry = new_expiry

    monkeypatch.setattr(oauth.Credentials, "refresh", fake_refresh)

    creds, token = refresh_google_token(db, acct)

    assert creds.token == "fresh-access-token"
    assert token["token"] == "fresh-access-token"
    # Rotated token was re-encrypted and persisted for later requests to reuse.
    persisted = decrypt_token(acct.token_ciphertext)
    assert persisted["token"] == "fresh-access-token"
    assert persisted["expiry"] == new_expiry.isoformat()


def test_revoked_grant_raises_token_reconnect_required(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    acct = _account(db, user, _base_payload())

    def boom(self: oauth.Credentials, request: object) -> None:  # noqa: ARG001
        raise RefreshError("invalid_grant")

    monkeypatch.setattr(oauth.Credentials, "refresh", boom)

    with pytest.raises(TokenReconnectRequired):
        refresh_google_token(db, acct)


def test_missing_expiry_payload_does_not_crash(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    # No expiry ⇒ creds.expired is False ⇒ no refresh attempted, no crash, token unchanged.
    payload = _base_payload()
    payload.pop("expiry")
    acct = _account(db, user, payload)

    def should_not_run(self: oauth.Credentials, request: object) -> None:  # noqa: ARG001
        raise AssertionError("refresh should not be attempted without an expiry")

    monkeypatch.setattr(oauth.Credentials, "refresh", should_not_run)

    creds, token = refresh_google_token(db, acct)
    assert creds.expired is False
    assert token["token"] == "old-access-token"
