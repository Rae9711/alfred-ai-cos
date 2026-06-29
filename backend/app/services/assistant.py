"""Shared assistant logic: resolve the user's timezone and interpret-then-act.

Both the Ask endpoint (free text) and the Inbox "Yes/Add to calendar" action route
through here, so calendar actions from natural language have one audited path."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import ActionType, SourceType
from app.db.models import Message, User
from app.llm import get_llm
from app.services import execution, meeting_prep
from app.services.actions import propose_action_internal
from app.services.inbox_filter import message_in_primary_inbox
from app.services.inbox_view import effective_inbox_category, message_needs_attention
from app.services.today import build_today
from app.services.waiting import build_waiting


def resolve_timezone(db: Session, user: User, requested: str | None) -> str:
    """Prefer a valid requested (device) timezone and persist it; else the stored one."""
    if requested and requested != user.timezone:
        try:
            ZoneInfo(requested)
            user.timezone = requested
            db.commit()
            return requested
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return user.timezone or "UTC"


def _now_in_tz(timezone: str) -> datetime:
    try:
        return datetime.now(ZoneInfo(timezone))
    except (ZoneInfoNotFoundError, ValueError):
        return datetime.now(UTC)


def _format_upcoming(db: Session, user_id: str) -> str:
    lines: list[str] = []
    for event in meeting_prep.upcoming_events(db, user_id, within_hours=24 * 14)[:20]:
        when = event.start_time.isoformat() if event.start_time else "?"
        lines.append(f"- id={event.id} | {event.title or 'Untitled'} | {when}")
    return "\n".join(lines) if lines else "(none)"


def _format_local_time(iso: datetime, tz: str) -> str:
    try:
        local = iso.astimezone(ZoneInfo(tz))
    except (ZoneInfoNotFoundError, ValueError):
        local = iso
    return local.strftime("%a %b %-d, %-I:%M %p")


def _calendar_check_reply(db: Session, user_id: str, tz: str) -> str:
    """Fallback when the LLM marks a read-only calendar query but leaves reply empty."""
    events = meeting_prep.upcoming_events(db, user_id, within_hours=48)
    if not events:
        return "Nothing on your calendar in the next couple of days."
    lines = [
        f"• {_format_local_time(e.start_time, tz)} — {e.title or 'Untitled'}"
        for e in events[:8]
        if e.start_time
    ]
    return "Here's what's coming up:\n" + "\n".join(lines)


_CALENDAR_ONLY_RE = (
    r"only help with calendar|can only help with calendar|"
    r"只能.*日历|仅.*日历|outside.*context|out of scope|超出.*范围"
)

_ACTION_HINTS = (
    # calendar
    "book",
    "schedule",
    "calendar",
    "reschedule",
    "cancel",
    "订",
    "日历",
    "安排",
    # reminders / tasks
    "remind",
    "reminder",
    "todo",
    "task",
    "don't forget",
    "remember to",
    "提醒",
    "备忘",
    "待办",
    "记一下",
    "别忘了",
)


def _text_requests_action(text: str) -> bool:
    lower = text.lower()
    return any(h in lower for h in _ACTION_HINTS)


def _format_due_date(d: date, tz: str) -> str:
    try:
        local = datetime(d.year, d.month, d.day, tzinfo=ZoneInfo(tz))
    except (ZoneInfoNotFoundError, ValueError):
        local = datetime(d.year, d.month, d.day)
    return local.strftime("%a %b %-d")


@dataclass
class AssistantOutcome:
    action: str  # booked | updated | cancelled | created | none
    reply: str
    detail: str | None = None


def interpret_and_act(db: Session, user: User, *, text: str, tz: str) -> AssistantOutcome:
    now = _now_in_tz(tz)
    upcoming = _format_upcoming(db, user.id)
    interp = get_llm().interpret_request(
        text=text,
        now_iso=now.isoformat(),
        timezone=tz,
        upcoming_events=upcoming,
    )

    if interp.intent == "book_calendar" and interp.start and interp.end and interp.title:
        proposal = propose_action_internal(
            db,
            user,
            action_type=ActionType.create_calendar_event,
            target={"title": interp.title, "start": interp.start, "end": interp.end},
            reason="Booked from an assistant request",
        )
        result = execution.execute_proposal(db, user, proposal)
        return AssistantOutcome(
            action="booked", reply=interp.reply or result.detail, detail=result.detail
        )

    if interp.intent == "reschedule_calendar" and interp.event_id and (interp.start or interp.end):
        target: dict[str, str] = {"event_id": interp.event_id}
        if interp.start:
            target["start"] = interp.start
        if interp.end:
            target["end"] = interp.end
        if interp.title:
            target["title"] = interp.title
        proposal = propose_action_internal(
            db,
            user,
            action_type=ActionType.update_calendar_event,
            target=target,
            reason="Rescheduled from an assistant request",
        )
        result = execution.execute_proposal(db, user, proposal)
        return AssistantOutcome(
            action="updated", reply=interp.reply or result.detail, detail=result.detail
        )

    if interp.intent == "cancel_calendar" and interp.event_id:
        proposal = propose_action_internal(
            db,
            user,
            action_type=ActionType.delete_calendar_event,
            target={"event_id": interp.event_id},
            reason="Cancelled from an assistant request",
        )
        result = execution.execute_proposal(db, user, proposal)
        return AssistantOutcome(
            action="cancelled", reply=interp.reply or result.detail, detail=result.detail
        )

    if interp.intent == "check_calendar":
        reply = (interp.reply or "").strip() or _calendar_check_reply(db, user.id, tz)
        return AssistantOutcome(action="none", reply=reply)

    if interp.intent == "create_task" and interp.title:
        target: dict[str, str] = {
            "title": interp.title,
            "source_type": SourceType.manual.value,
        }
        if interp.due_date:
            target["due_date"] = interp.due_date.isoformat()
        proposal = propose_action_internal(
            db,
            user,
            action_type=ActionType.create_task,
            target=target,
            reason="Reminder from an assistant request",
        )
        result = execution.execute_proposal(db, user, proposal)
        reply = (interp.reply or "").strip() or result.detail
        if not interp.reply and interp.due_date:
            reply = f"Got it — I'll remind you {_format_due_date(interp.due_date, tz)}: {interp.title}."
        return AssistantOutcome(
            action="created", reply=reply, detail=result.detail
        )

    reply = (interp.reply or "").strip()
    if not reply:
        reply = "I'm not sure how to help with that — try asking about your calendar."
    elif re.search(_CALENDAR_ONLY_RE, reply, re.IGNORECASE):
        reply = (
            "I can check or book your calendar, set reminders and tasks, draft a text by name "
            '(e.g. "text Mom: see you tomorrow"), or help reply from Inbox.'
        )
    return AssistantOutcome(action="none", reply=reply)


# Back-compat alias used by message booking tests.
def interpret_and_book(db: Session, user: User, *, text: str, tz: str) -> AssistantOutcome:
    return interpret_and_act(db, user, text=text, tz=tz)


def _format_today_context(db: Session, user_id: str, *, tz: str) -> str:
    try:
        today = datetime.now(ZoneInfo(tz)).date()
    except (ZoneInfoNotFoundError, ValueError):
        today = datetime.now(UTC).date()
    dashboard = build_today(db, user_id, today=today)
    lines = [dashboard.summary, "", "Top priorities:"]
    if dashboard.top_priorities:
        for p in dashboard.top_priorities[:8]:
            due = f" (due {p.due_date})" if p.due_date else ""
            who = f" — {p.counterparty}" if p.counterparty else ""
            lines.append(f"- {p.title}{who}{due}: {p.reason}")
    else:
        lines.append("- (none)")
    return "\n".join(lines)


def _format_waiting_context(db: Session, user_id: str) -> str:
    view = build_waiting(db, user_id)
    lines = ["Waiting on you:"]
    for entry in view.waiting_on_you[:8]:
        lines.append(f"- {entry.commitment.description} ({entry.commitment.counterparty})")
    if not view.waiting_on_you:
        lines.append("- (none)")
    lines.append("")
    lines.append("You are waiting on:")
    for entry in view.you_are_waiting_on[:8]:
        lines.append(f"- {entry.commitment.description} ({entry.commitment.counterparty})")
    if not view.you_are_waiting_on:
        lines.append("- (none)")
    return "\n".join(lines)


def _format_inbox_context(db: Session, user_id: str) -> str:
    rows = list(
        db.scalars(
            select(Message)
            .where(Message.user_id == user_id, Message.sent_at.is_not(None))
            .order_by(Message.sent_at.desc().nullslast())
            .limit(40)
        )
    )
    lines = ["Inbox needing attention:"]
    count = 0
    for m in rows:
        if m.source == "sms" or not message_in_primary_inbox(m):
            continue
        category = effective_inbox_category(m)
        if not message_needs_attention(category=category, user_replied=False):
            continue
        subj = m.subject or m.snippet or "(no subject)"
        lines.append(f"- [{category}] {m.sender}: {subj}")
        count += 1
        if count >= 10:
            break
    if count == 0:
        lines.append("- (none)")
    return "\n".join(lines)


def build_assistant_context(db: Session, user: User, *, tz: str) -> str:
    """Structured snapshot for contextual Ask chat."""
    events = _format_upcoming(db, user.id)
    parts = [
        _format_today_context(db, user.id, tz=tz),
        "",
        _format_waiting_context(db, user.id),
        "",
        _format_inbox_context(db, user.id),
        "",
        "Upcoming calendar (next 2 weeks):",
        events or "(none)",
    ]
    return "\n".join(parts)


def chat_with_context(
    db: Session,
    user: User,
    *,
    text: str,
    tz: str,
    history: list[dict[str, str]] | None = None,
) -> str:
    """Answer a free-form question using Today, waiting, inbox, and calendar context."""
    if _text_requests_action(text):
        outcome = interpret_and_act(db, user, text=text, tz=tz)
        if outcome.action != "none":
            return outcome.reply
        # check_calendar and other none-action intents still have a useful reply.
        if outcome.reply and outcome.reply != (
            "I'm not sure how to help with that — try asking about your calendar."
        ):
            return outcome.reply

    context = build_assistant_context(db, user, tz=tz)
    result = get_llm().answer_contextual_question(
        question=text,
        context=context,
        history=history,
    )
    reply = (result.reply or "").strip()
    return reply or "I'm not sure — try asking about your priorities or inbox."
