"""Draft new outbound emails for Ask free chat (not thread replies)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import ComposeDraft, User
from app.llm import get_llm
from app.services.connected_accounts import get_primary_google_account
from app.services.writing_style import (
    format_writing_style_prompt,
    get_writing_style,
    maybe_refresh_writing_style,
)


def create_compose_draft(
    db: Session,
    user: User,
    *,
    recipient_email: str,
    recipient_name: str | None,
    intent: str,
    tone: str = "concise",
) -> ComposeDraft:
    account = get_primary_google_account(db, user.id)
    if account is None:
        raise ValueError("Connect Gmail before sending email from Ask.")

    display = (recipient_name or recipient_email).strip()
    maybe_refresh_writing_style(db, user)
    style_prompt = format_writing_style_prompt(get_writing_style(user))
    thread_context = (
        "NEW OUTBOUND EMAIL (not a reply to an existing thread)\n"
        f"To: {display} <{recipient_email.strip()}>\n"
        f"What the user wants to say: {intent.strip()}\n"
    )
    result = get_llm().draft_reply(
        thread_context=thread_context,
        instruction=(
            "Write a brand-new email from scratch. Do not use a Re: subject line. "
            "Keep it natural and match what the user asked for."
        ),
        tone=tone,
        user_name=user.name,
        writing_style_prompt=style_prompt,
    )
    subject = (result.subject or "").strip()
    if subject.lower().startswith("re:"):
        subject = subject[3:].strip()
    if not subject:
        subject = "Hello"

    draft = ComposeDraft(
        user_id=user.id,
        connected_account_id=account.id,
        recipient_email=recipient_email.strip(),
        recipient_name=recipient_name.strip() if recipient_name else None,
        subject=subject,
        body=result.body.strip(),
        tone=tone,
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return draft
