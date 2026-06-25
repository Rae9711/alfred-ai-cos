"""Account routes: profile, onboarding calibration, deletion, integration
revocation (PRD 9.1, 12.1, 13.1)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.enums import Provider, SyncStatus
from app.db.models import (
    ActionProposal,
    AuditLog,
    CalendarEvent,
    Commitment,
    ConnectedAccount,
    DailyBriefing,
    Device,
    DraftReply,
    ExecutionLog,
    Message,
    Notification,
    SpendLimit,
    Task,
    User,
)
from app.schemas.api import ConnectedMailboxOut, MeOut, OnboardingPrefs
from app.services import google_oauth
from app.services.connected_accounts import list_google_accounts
from app.services.crypto import decrypt_token
from app.services.message_read import account_has_gmail_modify

router = APIRouter(tags=["account"])

# Every user-scoped table. Deleted explicitly so account deletion works regardless
# of whether the database enforces ON DELETE CASCADE (Postgres does; SQLite needs a
# PRAGMA). Order does not matter since we delete by user_id, not by FK chain.
# Must list ALL user-scoped tables: a missing one orphans data on a non-cascading DB
# and violates "delete all associated data" (PRD 12.1, 13.1).
_USER_SCOPED = (
    AuditLog,
    ExecutionLog,
    ActionProposal,
    SpendLimit,
    DraftReply,
    Notification,
    Device,
    DailyBriefing,
    Task,
    Commitment,
    CalendarEvent,
    Message,
    ConnectedAccount,
)

_ONBOARDING_KEYS = ("focus", "optimize_for", "proactiveness")


def _is_onboarded(user: User) -> bool:
    return any(user.preferences.get(k) for k in _ONBOARDING_KEYS)


def _me(db: Session, user: User) -> MeOut:
    mailboxes = [
        ConnectedMailboxOut(
            id=a.id,
            email=a.provider_account_email or "",
            sync_status=a.sync_status,
            last_synced_at=a.last_synced_at,
            gmail_modify=account_has_gmail_modify(a),
        )
        for a in list_google_accounts(db, user.id)
        if a.provider_account_email
    ]
    return MeOut(
        id=user.id,
        email=user.email,
        name=user.name,
        timezone=user.timezone,
        preferences=dict(user.preferences),
        onboarded=_is_onboarded(user),
        connected_mailboxes=mailboxes,
    )


@router.get("/me", response_model=MeOut)
def get_me(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeOut:
    return _me(db, user)


@router.post("/onboarding", response_model=MeOut)
def set_onboarding(
    prefs: OnboardingPrefs,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeOut:
    data = prefs.model_dump()
    # Name is a first-class User field (used to sign drafts), not a preference.
    if data.get("name"):
        user.name = data["name"]
    # Merge the rest into preferences so settings added later coexist.
    calibration = {k: v for k, v in data.items() if k != "name" and v is not None}
    merged = dict(user.preferences)
    merged.update(calibration)
    user.preferences = merged
    db.commit()
    return _me(db, user)


def _revoke_account(account: ConnectedAccount) -> None:
    """Best-effort revoke of a connected account's OAuth grant. Never raises."""
    if account.provider == Provider.google:
        try:
            google_oauth.revoke_token(decrypt_token(account.token_ciphertext))
        except Exception:  # noqa: BLE001 - revocation is best-effort, never blocks
            pass


@router.delete("/connected-accounts/{account_id}", status_code=204)
def disconnect_mailbox(
    account_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Revoke and delete one linked Gmail mailbox and its synced messages."""
    account = db.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.id == account_id,
            ConnectedAccount.user_id == user.id,
        )
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Mailbox not connected")
    _revoke_account(account)
    db.execute(delete(Message).where(Message.connected_account_id == account.id))
    db.delete(account)
    db.commit()


@router.delete("/connected-accounts/provider/{provider}", status_code=204)
def disconnect_account(
    provider: Provider,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Revoke and delete all integrations for a provider (legacy)."""
    accounts = list(
        db.scalars(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == user.id,
                ConnectedAccount.provider == provider,
            )
        )
    )
    if not accounts:
        raise HTTPException(status_code=404, detail="Account not connected")
    for account in accounts:
        _revoke_account(account)
        db.execute(delete(Message).where(Message.connected_account_id == account.id))
        db.delete(account)
    db.commit()


@router.delete("/me", status_code=204)
def delete_account(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Delete the account and all associated data, revoking integrations first
    (PRD 12.1, 13.1). Revocation is best-effort; deletion always proceeds."""
    for account in db.scalars(select(ConnectedAccount).where(ConnectedAccount.user_id == user.id)):
        _revoke_account(account)

    for model in _USER_SCOPED:
        db.execute(delete(model).where(model.user_id == user.id))
    db.delete(user)
    db.commit()
