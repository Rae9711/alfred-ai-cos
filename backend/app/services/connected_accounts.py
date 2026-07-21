"""Helpers for a user's connected Google mailboxes."""

from __future__ import annotations

from typing import Any

from google.auth.exceptions import RefreshError
from google.oauth2.credentials import Credentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import Provider
from app.db.models import ConnectedAccount, Message
from app.services.crypto import decrypt_token, encrypt_token
from app.services.google_oauth import fresh_credentials


class TokenReconnectRequired(RuntimeError):
    """The stored Google grant can no longer be refreshed.

    Raised when the access token is expired and either the refresh token is gone or
    Google rejects it (revoked from the user's account, password reset, scope change,
    etc.). Callers should surface this as "reconnect your mailbox" rather than a raw
    500 — reconnecting is the only fix, and retrying will never succeed.
    """


def refresh_google_token(
    db: Session, account: ConnectedAccount
) -> tuple[Credentials, dict[str, Any]]:
    """Return live Google credentials for ``account``, refreshing + persisting first.

    This is the single choke point for turning a stored (encrypted) OAuth token into
    usable credentials. It:
      1. decrypts the stored token payload,
      2. refreshes the access token if it has expired (``fresh_credentials``), and
      3. re-encrypts and persists the rotated payload **once** when it changed, so
         later calls in other requests reuse the fresh token instead of each
         re-refreshing on every expiry.

    Centralizing this (instead of letting each caller decrypt → refresh → maybe
    persist by hand) keeps token rotation consistent and gives one place to turn an
    unrefreshable grant into ``TokenReconnectRequired``.
    """
    stored = decrypt_token(account.token_ciphertext)
    try:
        creds, token = fresh_credentials(stored)
    except RefreshError as exc:  # Google rejected the refresh token (revoked/expired).
        raise TokenReconnectRequired(
            f"Google grant for {account.provider_account_email or account.id} needs reconnect"
        ) from exc
    # Expired access token with nothing to refresh from ⇒ the grant is unusable.
    if creds.expired and not creds.refresh_token and not stored.get("seed"):
        raise TokenReconnectRequired(
            f"Google grant for {account.provider_account_email or account.id} needs reconnect"
        )
    if token != stored:
        account.token_ciphertext = encrypt_token(token)
        db.commit()
    return creds, token


def get_primary_google_account(db: Session, user_id: str) -> ConnectedAccount | None:
    accounts = list_google_accounts(db, user_id)
    return accounts[0] if accounts else None


def list_google_accounts(db: Session, user_id: str) -> list[ConnectedAccount]:
    return list(
        db.scalars(
            select(ConnectedAccount)
            .where(
                ConnectedAccount.user_id == user_id,
                ConnectedAccount.provider == Provider.google,
            )
            .order_by(ConnectedAccount.created_at.asc())
        )
    )


def get_google_account(db: Session, user_id: str, account_id: str) -> ConnectedAccount | None:
    return db.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.id == account_id,
            ConnectedAccount.user_id == user_id,
            ConnectedAccount.provider == Provider.google,
        )
    )


def get_google_account_for_message(db: Session, message: Message) -> ConnectedAccount | None:
    if not message.connected_account_id:
        return None
    return db.get(ConnectedAccount, message.connected_account_id)


def list_user_ids_with_google(db: Session) -> list[str]:
    """Distinct user ids that have at least one connected Google mailbox."""
    return list(
        db.scalars(
            select(ConnectedAccount.user_id)
            .where(ConnectedAccount.provider == Provider.google)
            .distinct()
        )
    )
