"""Priority Inbox (PRD 12.4). Lists the user's synced, classified messages for the
Inbox screen, collapsing the fine-grained MessageClassification into the four UI
categories and filtering spam/noise (surfaced only as a count)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import get_current_user
from app.db.base import get_db
from app.db.enums import MessageClassification
from app.db.models import Message, User
from app.schemas.api import (
    BookMessageRequest,
    BookMessageResponse,
    InboxMessageOut,
    InboxOut,
    MessageDetailOut,
    MessageReadOut,
)
from app.services.assistant import interpret_and_book, resolve_timezone
from app.services.connected_accounts import list_google_accounts
from app.services.inbox_filter import message_in_primary_inbox
from app.services.message_body import fetch_message_body
from app.services.message_read import account_has_gmail_modify, mark_message_read
from app.services.inbox_view import (
    effective_inbox_category,
    is_message_unread,
    message_needs_attention,
    needs_action_cutoff_utc,
    start_of_today_utc,
    user_replied_message_ids,
)
from app.services.sms_inbox import sms_reply_phone

router = APIRouter(prefix="/messages", tags=["messages"])

# Classifications that should not appear in the inbox at all (counted as "filtered").
_FILTERED = {MessageClassification.spam_noise}


@router.get("", response_model=InboxOut)
def list_inbox(
    scope: str = Query(
        default="synced",
        description="'synced' = latest synced Primary mail (default); "
        "'needs_action' = last 14 days of Needs Reply / Needs Decision mail; "
        "'unread' = unread Primary only; 'today' = since local midnight; "
        "'sms' = forwarded text messages only",
    ),
    mailbox: str | None = Query(
        default=None,
        description="Filter by connected mailbox email; omit for all mailboxes",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InboxOut:
    accounts = list_google_accounts(db, user.id)
    mailbox_emails = sorted({a.provider_account_email for a in accounts if a.provider_account_email})
    account_by_id = {a.id: a.provider_account_email or "" for a in accounts}

    filter_account_id: str | None = None
    if mailbox:
        for account in accounts:
            if account.provider_account_email == mailbox:
                filter_account_id = account.id
                break

    settings = get_settings()
    today_start = start_of_today_utc(user.timezone)
    needs_action_start = needs_action_cutoff_utc()
    replied_ids = user_replied_message_ids(db, user.id)
    synced_limit = settings.sync_initial_max_results
    unread_limit = settings.sync_unread_max_results

    stmt = (
        select(Message)
        .where(Message.user_id == user.id)
        .where(Message.sent_at.is_not(None))
        .order_by(Message.sent_at.desc().nullslast())
    )
    if scope == "sms":
        stmt = stmt.where(Message.source == "sms").limit(synced_limit)
    elif scope == "today":
        stmt = stmt.where(Message.sent_at >= today_start)
    elif scope == "unread":
        stmt = stmt.limit(unread_limit * 2)
    elif scope == "needs_action":
        stmt = stmt.where(Message.sent_at >= needs_action_start)
    else:
        stmt = stmt.limit(synced_limit * 3)

    rows = list(db.scalars(stmt))

    messages: list[InboxMessageOut] = []
    filtered = 0
    for m in rows:
        if scope == "synced" and len(messages) >= synced_limit:
            break
        if scope == "unread" and len(messages) >= unread_limit:
            break
        if scope == "sms" and len(messages) >= synced_limit:
            break
        if filter_account_id and scope != "sms" and m.connected_account_id != filter_account_id:
            continue
        if scope != "sms" and m.source != "sms":
            if not message_in_primary_inbox(m):
                filtered += 1
                continue
        if m.classification in _FILTERED:
            filtered += 1
            continue

        category = effective_inbox_category(m)
        is_unread = is_message_unread(m)
        if scope == "unread" and not is_unread:
            continue
        user_replied = m.id in replied_ids
        if scope == "needs_action" and not message_needs_attention(
            category=category,
            user_replied=user_replied,
        ):
            continue
        messages.append(
            InboxMessageOut(
                id=m.id,
                sender=m.sender,
                subject=m.subject,
                snippet=m.snippet,
                take=m.body_summary,
                category=category,
                sent_at=m.sent_at,
                action_required=m.action_required,
                mailbox_email=account_by_id.get(m.connected_account_id or "", ""),
                is_unread=is_unread,
                user_replied=user_replied,
                source=m.source or "gmail",
                reply_phone=sms_reply_phone(m),
            )
        )

    return InboxOut(
        messages=messages,
        filtered_count=filtered,
        mailboxes=mailbox_emails,
    )


@router.get("/{message_id}", response_model=MessageDetailOut)
def get_message(
    message_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageDetailOut:
    """Return one message with the full Gmail body for reply drafting."""
    message = db.get(Message, message_id)
    if message is None or message.user_id != user.id:
        raise HTTPException(status_code=404, detail="Message not found")

    accounts = list_google_accounts(db, user.id)
    account_by_id = {a.id: a.provider_account_email or "" for a in accounts}

    try:
        body = fetch_message_body(db, message)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        detail = "Could not load message body"
        if message.source != "sms":
            detail = "Could not load email from Gmail"
        raise HTTPException(status_code=502, detail=detail) from exc

    return MessageDetailOut(
        id=message.id,
        sender=message.sender,
        subject=message.subject,
        snippet=message.snippet,
        take=message.body_summary,
        body=body,
        category=effective_inbox_category(message),
        sent_at=message.sent_at,
        mailbox_email=account_by_id.get(message.connected_account_id or "", ""),
        source=message.source or "gmail",
        reply_phone=sms_reply_phone(message),
    )


@router.post("/{message_id}/read", response_model=MessageReadOut)
def mark_read(
    message_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageReadOut:
    """Mark a message read in Gmail and update local label state."""
    message = db.get(Message, message_id)
    if message is None or message.user_id != user.id:
        raise HTTPException(status_code=404, detail="Message not found")
    try:
        message, gmail_synced = mark_message_read(db, user, message)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Could not update Gmail") from exc
    return MessageReadOut(
        id=message.id,
        is_unread=is_message_unread(message),
        gmail_synced=gmail_synced,
    )


@router.post("/{message_id}/book", response_model=BookMessageResponse)
def book_from_message(
    message_id: str,
    payload: BookMessageRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BookMessageResponse:
    """"Yes / Add to calendar" on an event-like message. Interprets the message content
    for a date/time and books it on the user's calendar through the audited spine."""
    message = db.get(Message, message_id)
    if message is None or message.user_id != user.id:
        raise HTTPException(status_code=404, detail="Message not found")

    tz = resolve_timezone(db, user, payload.timezone)
    # Give the interpreter the message so it can pull the title + time from it.
    text = (
        f"Add this to my calendar if it describes an event with a time.\n"
        f"Subject: {message.subject or '(none)'}\n{message.snippet or ''}"
    )
    outcome = interpret_and_book(db, user, text=text, tz=tz)
    return BookMessageResponse(
        booked=outcome.action == "booked", reply=outcome.reply, detail=outcome.detail
    )
