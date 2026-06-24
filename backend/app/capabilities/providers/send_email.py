"""Send-email capability (level 3 external comm). Sends a stored DraftReply on the
user's behalf via gmail.send. Level 3 → always approval-gated by the execution spine.

Sends exactly what the user reviewed: if the draft was already pushed to Gmail drafts
(gmail_draft_id set), it sends that draft; otherwise it composes and sends the stored
body directly. Either way the recipient/subject/body come from the user's own draft and
the call uses the user's own decrypted token."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.capabilities.base import (
    CapabilityDescription,
    CapabilityError,
    ExecutionResult,
)
from app.db.enums import ActionType, RiskLevel
from app.db.models import DraftReply, Message, User
from app.services import gmail, outbound_tracking
from app.services.connected_accounts import get_google_account_for_message
from app.services.crypto import decrypt_token
from app.services.message_read import mark_message_read


class SendEmailCapability:
    def describe(self) -> CapabilityDescription:
        return CapabilityDescription(
            action_type=ActionType.send_email,
            risk_level=RiskLevel.external_comm,
            title="Send email",
            summary="Send this reply from your Gmail account.",
        )

    def validate(self, db: Session, user: User, payload: dict[str, Any]) -> None:
        draft_id = payload.get("draft_reply_id")
        draft = db.get(DraftReply, draft_id) if draft_id else None
        if draft is None or draft.user_id != user.id:
            raise CapabilityError("Draft not found")

    def execute(self, db: Session, user: User, payload: dict[str, Any]) -> ExecutionResult:
        draft = db.get(DraftReply, payload["draft_reply_id"])
        if draft is None or draft.user_id != user.id:
            raise CapabilityError("Draft no longer exists")
        message = db.get(Message, draft.message_id)
        account = get_google_account_for_message(db, message) if message else None
        if message is None or account is None:
            raise CapabilityError("Missing source message or connected account")

        # Dev seed accounts have no real Gmail token; simulate a send end to end.
        if account.scopes == ["seed"]:
            outbound_tracking.record_send(
                db,
                user,
                source_message=message,
                recipient=message.sender,
                subject=draft.subject,
            )
            return ExecutionResult(detail="Email sent (dev seed)", reversible=False)

        token = decrypt_token(account.token_ciphertext)
        subject = draft.subject or f"Re: {message.subject or ''}".strip()
        if draft.gmail_draft_id:
            sent = gmail.send_draft(token, draft.gmail_draft_id)
        else:
            sent = gmail.send_message(
                token,
                to=message.sender,
                subject=subject,
                body=draft.body,
                thread_id=message.thread_id,
            )
        # Track the outbound so we can nudge the user if the thread goes silent.
        outbound_tracking.record_send(
            db,
            user,
            source_message=message,
            recipient=message.sender,
            subject=subject,
        )
        try:
            mark_message_read(db, user, message)
        except Exception:
            pass
        # Sending is not reversible (it left the user's mailbox).
        return ExecutionResult(
            detail=f"Sent to {message.sender}",
            reversible=False,
            data={"gmail_message_id": sent.get("id")},
        )
