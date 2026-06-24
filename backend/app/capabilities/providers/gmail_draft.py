"""Gmail draft-push capability (level 3). Pushes a stored DraftReply into the user's
Gmail drafts. This is the capability the original ActionProposal flow implemented;
it now lives behind the capability framework like every other action."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.capabilities.base import (
    CapabilityDescription,
    CapabilityError,
    ExecutionResult,
)
from app.db.enums import ActionType, Provider, RiskLevel
from app.db.models import DraftReply, Message, User
from app.services import gmail
from app.services.connected_accounts import get_google_account_for_message
from app.services.crypto import decrypt_token


class GmailDraftCapability:
    def describe(self) -> CapabilityDescription:
        return CapabilityDescription(
            action_type=ActionType.create_draft,
            risk_level=RiskLevel.external_comm,
            title="Push reply to Gmail",
            summary="Create a draft reply in your Gmail for review before sending.",
        )

    def validate(self, db: Session, user: User, payload: dict[str, Any]) -> None:
        draft_id = payload.get("draft_reply_id")
        draft = db.get(DraftReply, draft_id) if draft_id else None
        if draft is None or draft.user_id != user.id:
            raise CapabilityError("Draft not found")

    def execute(self, db: Session, user: User, payload: dict[str, Any]) -> ExecutionResult:
        draft = db.get(DraftReply, payload["draft_reply_id"])
        if draft is None:
            raise CapabilityError("Draft no longer exists")
        message = db.get(Message, draft.message_id)
        account = get_google_account_for_message(db, message) if message else None
        if message is None or account is None:
            raise CapabilityError("Missing source message or connected account")

        # Dev seed accounts have no real Gmail token; record a stub id so the flow can
        # be exercised end to end without Google.
        if account.scopes == ["seed"]:
            draft.gmail_draft_id = f"seed-draft-{draft.id}"
            return ExecutionResult(detail="Draft created (dev seed)", reversible=True)

        token = decrypt_token(account.token_ciphertext)
        gmail_draft_id = gmail.create_draft(
            token,
            to=message.sender,
            subject=draft.subject or f"Re: {message.subject or ''}".strip(),
            body=draft.body,
            thread_id=message.thread_id,
        )
        draft.gmail_draft_id = gmail_draft_id
        return ExecutionResult(
            detail="Draft created in Gmail",
            reversible=True,
            data={"gmail_draft_id": gmail_draft_id},
        )
