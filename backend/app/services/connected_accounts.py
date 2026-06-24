"""Helpers for a user's connected Google mailboxes."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import Provider
from app.db.models import ConnectedAccount, Message, User


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
