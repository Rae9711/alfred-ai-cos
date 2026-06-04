"""Outbound reply tracking: when Alfred sends a reply, watch for a response and
nudge the user when the thread goes silent.

This closes the loop on the user's own commitments. The aging push (#39) covered
"people waiting on you"; this covers "what you're waiting on after replying"."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import NotificationType
from app.db.models import Message, OutboundReply, User
from app.services import notifications

# Wait this long after sending before deciding the counterparty hasn't replied.
# Three days mirrors the waiting-on-you aging window so the two follow-up rails
# fire on a similar rhythm.
SILENCE_DAYS = 3


def record_send(
    db: Session,
    user: User,
    *,
    source_message: Message,
    recipient: str,
    subject: str | None,
    sent_at: datetime | None = None,
) -> OutboundReply:
    """Persist that Alfred sent a reply on the user's behalf. Idempotent on
    (user_id, source_message_id) — re-sending to the same message reuses the
    existing watch row so duplicate sends don't double-track."""
    existing = db.scalar(
        select(OutboundReply).where(
            OutboundReply.user_id == user.id,
            OutboundReply.source_message_id == source_message.id,
        )
    )
    if existing is not None:
        return existing
    row = OutboundReply(
        user_id=user.id,
        source_message_id=source_message.id,
        thread_id=source_message.thread_id,
        recipient=recipient,
        subject=subject,
        sent_at=sent_at or datetime.now(UTC),
    )
    db.add(row)
    db.commit()
    return row


def resolve_replied_threads(db: Session, user: User, *, now: datetime) -> int:
    """For every watch row, check if a NEW inbound message has arrived on the
    thread after the send. If so, mark it resolved. Returns the count resolved."""
    open_watches = list(
        db.scalars(
            select(OutboundReply).where(
                OutboundReply.user_id == user.id,
                OutboundReply.resolved_at.is_(None),
                OutboundReply.thread_id.is_not(None),
            )
        )
    )
    if not open_watches:
        return 0
    user_email = (user.email or "").lower()
    resolved = 0
    for w in open_watches:
        # Any message on the thread sent AFTER our outbound, by someone other
        # than the user, counts as a response.
        reply = db.scalar(
            select(Message).where(
                Message.user_id == user.id,
                Message.thread_id == w.thread_id,
                Message.sent_at.is_not(None),
                Message.sent_at > w.sent_at,
                Message.sender != user.email,
            )
        )
        if reply is not None and (reply.sender or "").lower() != user_email:
            w.resolved_at = now
            resolved += 1
    if resolved:
        db.commit()
    return resolved


def scan_silent_threads(db: Session, user: User, *, now: datetime) -> int:
    """Push follow_up_due for outbound replies that have been silent past
    SILENCE_DAYS. Deduped per outbound id."""
    # Resolve first so we don't push on threads that already replied.
    resolve_replied_threads(db, user, now=now)
    cutoff = now - timedelta(days=SILENCE_DAYS)
    waiting = list(
        db.scalars(
            select(OutboundReply).where(
                OutboundReply.user_id == user.id,
                OutboundReply.resolved_at.is_(None),
                OutboundReply.follow_up_pushed.is_(False),
                OutboundReply.sent_at <= cutoff,
            )
        )
    )
    pushed = 0
    for w in waiting:
        title = f"Still waiting on {w.recipient}"
        # SQLite drops tzinfo; coerce both sides to UTC for the math.
        sent = w.sent_at if w.sent_at.tzinfo else w.sent_at.replace(tzinfo=UTC)
        days_silent = max(1, (now - sent).days)
        subject = (w.subject or "your reply")[:80]
        body = f"{days_silent} days since you replied: {subject}"
        created = notifications.enqueue(
            db,
            user.id,
            ntype=NotificationType.follow_up_due,
            title=title[:80],
            body=body[:160],
            payload={
                "outbound_id": w.id,
                "message_id": w.source_message_id,
                "deep_link": "/waiting",
            },
            dedup_key=f"silent:{w.id}",
        )
        if created is not None:
            w.follow_up_pushed = True
            pushed += 1
    if pushed:
        db.commit()
    return pushed
