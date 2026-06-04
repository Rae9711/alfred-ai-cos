"""Smart snooze: park a commitment until a wake condition fires.

Two condition shapes:
  - until_date: a parsed calendar date.
  - until_reply: re-open when the source thread gets a new inbound message.

Common natural-language phrases get parsed in-house (no new dependency). For
anything richer we'd reach for dateparser, but the slice scope is "Monday",
"tomorrow morning", "+3d", "next week", "this weekend", "until reply".
The parser is intentionally narrow: the API surfaces the parsed date back to
the client so the user can see what we interpreted."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import CommitmentStatus
from app.db.models import Commitment, Message


@dataclass
class SnoozeSpec:
    """Parsed wake condition. Either `until_date` or `until_reply` (or both)."""

    until_date: date | None = None
    until_reply: bool = False
    interpreted_as: str = ""  # human-friendly echo so the UI can confirm


WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


def parse(input_text: str, *, today: date) -> SnoozeSpec | None:
    """Best-effort: returns None when the phrase doesn't match any known shape.
    Callers should fall back to asking the user for a specific date."""
    if not input_text:
        return None
    text = input_text.strip().lower()
    if not text:
        return None

    # 1) "until reply" / "when X replies"
    if (
        "until reply" in text
        or "when they reply" in text
        or "after reply" in text
        or text
        in (
            "reply",
            "until_reply",
        )
    ):
        return SnoozeSpec(until_reply=True, interpreted_as="when they reply")

    # 2) +Nd / +Nw shorthand
    m = re.fullmatch(r"\+?(\d+)\s*([dw])", text)
    if m:
        n = int(m.group(1))
        unit_days = 1 if m.group(2) == "d" else 7
        target = today + timedelta(days=n * unit_days)
        return SnoozeSpec(until_date=target, interpreted_as=f"in {n}{m.group(2)}")

    # 3) "tomorrow [morning]"
    if "tomorrow" in text:
        return SnoozeSpec(until_date=today + timedelta(days=1), interpreted_as="tomorrow")

    # 4) "this weekend" / "next weekend"
    if "weekend" in text:
        # Next Saturday from today; if it's Sunday, jump 6 days for "next" Sat.
        days_until_sat = (5 - today.weekday()) % 7
        if days_until_sat == 0 and "next" in text:
            days_until_sat = 7
        return SnoozeSpec(
            until_date=today + timedelta(days=days_until_sat or 6),
            interpreted_as="this weekend",
        )

    # 5) "next week" → next Monday
    if "next week" in text:
        days_until_mon = ((7 - today.weekday()) % 7) or 7
        return SnoozeSpec(
            until_date=today + timedelta(days=days_until_mon),
            interpreted_as="next week",
        )

    # 6) "monday", "next friday", etc.
    for name, idx in WEEKDAYS.items():
        if name in text:
            ahead = (idx - today.weekday()) % 7
            if ahead == 0:
                ahead = 7  # "monday" on a Monday means next Monday, not today
            return SnoozeSpec(
                until_date=today + timedelta(days=ahead),
                interpreted_as=name,
            )

    # 7) Bare ISO date "2026-06-15"
    try:
        d = date.fromisoformat(text)
        return SnoozeSpec(until_date=d, interpreted_as=d.isoformat())
    except ValueError:
        pass

    return None


# ---------- actions ----------


def snooze(db: Session, commitment: Commitment, *, spec: SnoozeSpec) -> Commitment:
    """Apply a parsed snooze spec to a commitment. Idempotent: re-snoozing with
    a new spec replaces the old wake condition."""
    commitment.snooze_until = spec.until_date
    commitment.snooze_until_reply = spec.until_reply
    commitment.status = CommitmentStatus.snoozed
    db.commit()
    return commitment


def wake(db: Session, commitment: Commitment) -> Commitment:
    """Re-open a snoozed commitment and clear wake conditions."""
    commitment.snooze_until = None
    commitment.snooze_until_reply = False
    commitment.status = CommitmentStatus.open
    db.commit()
    return commitment


def scan_wakes(db: Session, user_id: str, *, today: date) -> int:
    """Re-open commitments whose wake condition has fired. Two paths:

      - snooze_until <= today
      - snooze_until_reply AND there's a new inbound on the same thread since
        the commitment was snoozed.

    Returns the number of items woken."""
    snoozed = list(
        db.scalars(
            select(Commitment).where(
                Commitment.user_id == user_id,
                Commitment.status == CommitmentStatus.snoozed,
            )
        )
    )
    woken = 0
    for c in snoozed:
        if c.snooze_until and c.snooze_until <= today:
            wake(db, c)
            woken += 1
            continue
        if c.snooze_until_reply and c.source_id:
            src = db.get(Message, c.source_id)
            if src and src.thread_id:
                # "Since the snooze" — use the commitment's updated_at because
                # that's when the wake condition was set. SQLite drops tzinfo
                # on DateTime(timezone=True), so we strip on both sides for the
                # comparison rather than relying on it.
                since = c.updated_at
                if since and since.tzinfo is not None:
                    since = since.replace(tzinfo=None)
                reply = db.scalar(
                    select(Message).where(
                        Message.user_id == user_id,
                        Message.thread_id == src.thread_id,
                        Message.id != src.id,
                        Message.sent_at.is_not(None),
                        Message.sent_at > since,
                    )
                )
                if reply is not None:
                    wake(db, c)
                    woken += 1
    return woken


SnoozeMode = Literal["date", "reply"]
