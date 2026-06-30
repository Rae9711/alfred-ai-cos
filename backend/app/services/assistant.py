"""Shared assistant logic: resolve the user's timezone and interpret-then-act.

Both the Ask endpoint (free text) and the Inbox "Yes/Add to calendar" action route
through here, so calendar actions from natural language have one audited path."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.capabilities.base import ExecutionResult
from app.db.enums import ActionType, SourceType
from app.db.models import Message, User
from app.llm import get_llm
from app.services import execution, meeting_prep
from app.services.actions import propose_action_internal
from app.services.inbox_filter import message_in_primary_inbox
from app.services.inbox_view import (
    effective_inbox_category,
    message_needs_attention,
    message_user_decided,
    user_replied_message_ids,
)
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


_REMINDER_FALLBACK_RE = re.compile(
    r"(?:"
    r"remind(?:\s+me|\s+us)?(?:\s+(?:on|at|by|before))?\s+"
    r"(?P<when>today|tomorrow|tonight|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})"
    r"(?:\s+to|\s+about|\s+that)?\s+(?P<title>.+)|"
    r"(?:明天|后天|今日|今天).{0,6}提醒(?:我|一下)?(?P<zh_title>.+)|"
    r"提醒(?:我|一下)?(?:明天|后天|今天|今日)(?P<zh_title2>.+)"
    r")",
    re.IGNORECASE,
)


def _parse_reminder_when(when: str, *, now: datetime) -> date:
    lower = when.lower().strip()
    today = now.date()
    if lower in {"today", "tonight", "今天", "今日"}:
        return today
    if lower == "tomorrow" or lower == "明天":
        return today + timedelta(days=1)
    if lower == "后天":
        return today + timedelta(days=2)
    if lower == "next week":
        return today + timedelta(days=7)
    weekdays = {
        "monday": 0,
        "tuesday": 1,
        "wednesday": 2,
        "thursday": 3,
        "friday": 4,
        "saturday": 5,
        "sunday": 6,
    }
    if lower in weekdays:
        target = weekdays[lower]
        days_ahead = (target - today.weekday()) % 7
        if days_ahead == 0:
            days_ahead = 7
        return today + timedelta(days=days_ahead)
    return date.fromisoformat(lower)


def _fallback_reminder_from_text(text: str, *, now: datetime) -> tuple[str, date] | None:
    """Deterministic reminder parse when the LLM misses create_task intent."""
    stripped = text.strip()
    if not stripped:
        return None
    m = _REMINDER_FALLBACK_RE.search(stripped)
    if m:
        title = (m.group("title") or m.group("zh_title") or m.group("zh_title2") or "").strip()
        when = m.group("when") or "tomorrow"
        if title:
            try:
                due = _parse_reminder_when(when, now=now)
            except ValueError:
                due = now.date() + timedelta(days=1)
            return (title.rstrip("。．.!"), due)
    if "提醒" in stripped and ("明天" in stripped or "后天" in stripped or "今天" in stripped):
        due = now.date() + timedelta(days=1 if "明天" in stripped else 0 if "今天" in stripped else 2)
        title = re.sub(r"^.*提醒(?:我|一下)?", "", stripped)
        title = re.sub(r"^(明天|后天|今天|今日)", "", title).strip(" ：:，,")
        if title:
            return (title.rstrip("。．.!"), due)
    return None


def _default_remind_at(due: date, tz: str) -> datetime:
    """Morning-of reminder in the user's timezone."""
    try:
        local = datetime(due.year, due.month, due.day, 9, 0, tzinfo=ZoneInfo(tz))
    except (ZoneInfoNotFoundError, ValueError):
        local = datetime(due.year, due.month, due.day, 9, 0, tzinfo=UTC)
    return local.astimezone(UTC)


@dataclass
class AssistantOutcome:
    action: str  # booked | updated | cancelled | created | none
    reply: str
    detail: str | None = None
    task_id: str | None = None
    task_title: str | None = None
    remind_at: str | None = None


def _outcome_from_task_execution(
    *,
    result: ExecutionResult,
    reply: str,
) -> AssistantOutcome:
    data = result.data or {}
    return AssistantOutcome(
        action="created",
        reply=reply,
        detail=result.detail,
        task_id=data.get("task_id"),
        task_title=data.get("title"),
        remind_at=data.get("remind_at"),
    )


def _execute_create_reminder(
    db: Session,
    user: User,
    *,
    title: str,
    due: date | None,
    tz: str,
    llm_reply: str = "",
) -> AssistantOutcome:
    target: dict[str, str] = {
        "title": title,
        "source_type": SourceType.manual.value,
    }
    if due is not None:
        target["due_date"] = due.isoformat()
        target["remind_at"] = _default_remind_at(due, tz).isoformat()
    proposal = propose_action_internal(
        db,
        user,
        action_type=ActionType.create_task,
        target=target,
        reason="Reminder from an assistant request",
    )
    result = execution.execute_proposal(db, user, proposal)
    reply = (llm_reply or "").strip() or result.detail
    if not llm_reply and due is not None:
        reply = f"Got it — I'll remind you {_format_due_date(due, tz)}: {title}."
    return _outcome_from_task_execution(result=result, reply=reply)


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

    # Reminders before check_calendar — the LLM often mislabels "明天提醒我…" as a
    # calendar read when it should create a task; check_calendar must not short-circuit.
    if interp.intent == "create_task" and interp.title:
        due = interp.due_date
        if due is None:
            fallback_due = _fallback_reminder_from_text(text, now=now)
            if fallback_due is not None:
                due = fallback_due[1]
        return _execute_create_reminder(
            db,
            user,
            title=interp.title,
            due=due,
            tz=tz,
            llm_reply=interp.reply or "",
        )

    if _text_requests_action(text):
        fallback = _fallback_reminder_from_text(text, now=now)
        if fallback is not None:
            title, due = fallback
            return _execute_create_reminder(db, user, title=title, due=due, tz=tz)

    if interp.intent == "check_calendar":
        reply = (interp.reply or "").strip() or _calendar_check_reply(db, user.id, tz)
        return AssistantOutcome(action="none", reply=reply)

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
    replied = user_replied_message_ids(db, user_id)
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
        if not message_needs_attention(
            category=category,
            user_replied=m.id in replied,
            user_decided=message_user_decided(m),
        ):
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
) -> AssistantOutcome:
    """Answer a free-form question using Today, waiting, inbox, and calendar context."""
    if _text_requests_action(text):
        outcome = interpret_and_act(db, user, text=text, tz=tz)
        if outcome.action != "none":
            return outcome
        # check_calendar and other none-action intents still have a useful reply.
        if outcome.reply and outcome.reply != (
            "I'm not sure how to help with that — try asking about your calendar."
        ):
            return outcome

    context = build_assistant_context(db, user, tz=tz)
    result = get_llm().answer_contextual_question(
        question=text,
        context=context,
        history=history,
    )
    reply = (result.reply or "").strip()
    return AssistantOutcome(
        action="none",
        reply=reply or "I'm not sure — try asking about your priorities or inbox.",
    )
