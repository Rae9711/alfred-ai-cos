"""Shared assistant logic: resolve the user's timezone and interpret-then-act.

Both the Ask endpoint (free text) and the Inbox "Yes/Add to calendar" action route
through here, so calendar actions from natural language have one audited path."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from google.auth.exceptions import RefreshError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.capabilities.base import ExecutionResult
from app.db.enums import ActionType, SourceType
from app.db.models import Message, User
from app.llm import get_llm
from app.services import execution, meeting_prep
from app.services.actions import propose_action_internal
from app.services.connected_accounts import TokenReconnectRequired
from app.services.inbox_filter import message_in_primary_inbox
from app.services.inbox_view import (
    effective_inbox_category,
    message_is_handled,
    message_needs_attention,
    user_replied_message_ids,
)
from app.services.today import build_today
from app.services.waiting import build_waiting


_GOOGLE_RECONNECT_REPLY = {
    "en": (
        "Your Google connection expired — open You → Settings, reconnect Google, "
        "then ask me again and I'll put it on your calendar."
    ),
    "zh": "Google 授权已过期 — 请到「我的 → 设置」重新连接 Google，然后再让我帮你加进日历。",
}

_GOOGLE_CONNECT_REPLY = {
    "en": "Connect Google in You → Settings first, then I can book this on your calendar.",
    "zh": "请先到「我的 → 设置」连接 Google，我才能帮你写入日历。",
}

_EMPTY_INBOX_REPLY = {
    "en": (
        "Nothing's come in yet — I'll let you know the moment something needs your attention."
    ),
    "zh": "目前还没有需要你处理的新消息 — 有动静我会第一时间告诉你。",
}

_NOT_CONFIDENT_REPLY = {
    "en": "I'm not confident about that one — try asking about your priorities or inbox.",
    "zh": "这个我不太确定 — 可以问问今天的优先级或收件箱。",
}

_UNSURE_REPLY = {
    "en": "I'm not sure — try asking about your priorities or inbox.",
    "zh": "我不太确定 — 可以问问今天的优先级或收件箱。",
}


def _reply_locale(text: str, user: User | None = None) -> str:
    pref = (user.preferences or {}).get("locale") if user is not None else None
    if pref in ("zh", "en"):
        return pref
    if re.search(r"[\u4e00-\u9fff]", text or ""):
        return "zh"
    return "en"


def _localized(table: dict[str, str], locale: str) -> str:
    return table.get(locale) or table["en"]


def _is_missing_google_account(exc: BaseException) -> bool:
    return isinstance(exc, ValueError) and "No connected Google account" in str(exc)


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


def _format_upcoming(db: Session, user_id: str, *, cited_ids: set[str] | None = None) -> str:
    lines: list[str] = []
    for event in meeting_prep.upcoming_events(db, user_id, within_hours=24 * 14)[:20]:
        when = event.start_time.isoformat() if event.start_time else "?"
        if cited_ids is not None:
            cited_ids.add(event.id)
        lines.append(f"- [id:{event.id}] {event.title or 'Untitled'} | {when}")
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
    "meeting",
    "appointment",
    "订",
    "日历",
    "安排",
    "要去",
    "开会",
    "见面",
    "预约",
    "改期",
    "取消会议",
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

# "明天十一点要去 X" / "周五下午3点开会" — calendar-shaped even without 日历/安排.
_ZH_SCHEDULE_HINT_RE = re.compile(
    r"(明天|后天|今天|今日|周一|周二|周三|周四|周五|周六|周日|星期一|星期二|"
    r"星期三|星期四|星期五|星期六|星期日)"
    r".{0,12}("
    r"\d{1,2}\s*[:：点]"
    r"|[零〇一二两三四五六七八九十]+\s*点"
    r")"
    r".{0,20}("
    r"要?去|开会|见面|会议|拜访|出发|起飞|到达"
    r")",
)

_EN_SCHEDULE_HINT_RE = re.compile(
    r"(?i)\b(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|"
    r"saturday|sunday)\b.{0,40}\b("
    r"\d{1,2}\s*(?:am|pm|:00|:\d{2})|"
    r"noon|morning|afternoon|evening"
    r")\b.{0,40}\b("
    r"go\s+to|meet|meeting|visit|flight|leave\s+for|head\s+to"
    r")\b",
)


def _text_requests_action(text: str) -> bool:
    lower = text.lower()
    if any(h in lower for h in _ACTION_HINTS):
        return True
    stripped = text.strip()
    return bool(_ZH_SCHEDULE_HINT_RE.search(stripped) or _EN_SCHEDULE_HINT_RE.search(stripped))


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
    if re.search(r"(?i)\bremind me\b", stripped):
        title = re.sub(r"(?i)^.*?remind me(?:\s+to|\s+about|\s+that)?\s*", "", stripped).strip()
        if title:
            return (title.rstrip("。．.!"), now.date())
    if "提醒" in stripped:
        title = re.sub(r"^.*提醒(?:我|一下)?", "", stripped).strip(" ：:，,")
        if title:
            return (title.rstrip("。．.!"), now.date())
    return None


_ZH_DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
}


def _zh_numeral_to_int(raw: str) -> int | None:
    s = raw.strip()
    if not s:
        return None
    if s.isdigit():
        return int(s)
    if s == "十":
        return 10
    if s.startswith("十"):
        ones = _ZH_DIGITS.get(s[1:], 0) if len(s) > 1 else 0
        return 10 + ones
    if "十" in s:
        parts = s.split("十", 1)
        tens = _ZH_DIGITS.get(parts[0], 1)
        ones = _ZH_DIGITS.get(parts[1], 0) if parts[1] else 0
        return tens * 10 + ones
    if len(s) == 1 and s in _ZH_DIGITS:
        return _ZH_DIGITS[s]
    return None


_ZH_BOOK_RE = re.compile(
    r"^(?P<day>明天|后天|今天|今日)?"
    r"(?P<ampm>上午|下午|晚上|中午)?"
    r"(?P<hour>\d{1,2}|[零〇一二两三四五六七八九十]+)\s*点(?P<half>半)?"
    r"(?:\s*(?P<minute>\d{1,2}|[零〇一二两三四五六七八九十]+)\s*分?)?"
    r"(?:\s*(?:要)?去|\s*(?:有)?(?:开会|见面|会议|拜访))"
    r"(?P<title>.+)$"
)

_EN_BOOK_RE = re.compile(
    r"(?i)^(?P<day>tomorrow|today|tonight)\s+"
    r"(?:at\s+)?"
    r"(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?\s*(?P<ampm>am|pm)?"
    r"\s+(?:go\s+to|leave\s+for|head\s+to|visit|meet(?:ing)?(?:\s+at)?)\s+"
    r"(?P<title>.+)$"
)


def _event_day_offset(day: str | None, *, ampm: str | None = None) -> int:
    if not day:
        return 0
    d = day.lower()
    if d in {"tomorrow", "明天"}:
        return 1
    if d in {"后天"}:
        return 2
    if d in {"today", "tonight", "今天", "今日"}:
        return 0
    return 0


def _fallback_book_calendar_from_text(
    text: str, *, now: datetime, tz: str
) -> tuple[str, datetime, datetime, str | None] | None:
    """Deterministic book when the LLM / action gate misses clear schedule phrasing."""
    stripped = text.strip().rstrip("。．.！!？?")
    if not stripped:
        return None

    title: str | None = None
    location: str | None = None
    hour: int | None = None
    minute = 0
    day_token: str | None = None
    ampm: str | None = None

    m = _ZH_BOOK_RE.match(stripped)
    if m:
        day_token = m.group("day")
        ampm = m.group("ampm")
        hour = _zh_numeral_to_int(m.group("hour") or "")
        if m.group("half"):
            minute = 30
        elif m.group("minute"):
            minute = _zh_numeral_to_int(m.group("minute") or "") or 0
        title = (m.group("title") or "").strip(" ：:，,")
        if title and re.search(r"(开会|见面|会议|拜访)", stripped) and "去" not in stripped[:20]:
            location = None
        else:
            location = title or None
    else:
        m2 = _EN_BOOK_RE.match(stripped)
        if not m2:
            return None
        day_token = m2.group("day")
        ampm = m2.group("ampm")
        hour = int(m2.group("hour"))
        minute = int(m2.group("minute") or 0)
        title = (m2.group("title") or "").strip(" .,!")
        location = title or None

    if hour is None or not title:
        return None
    if hour < 0 or hour > 24 or minute < 0 or minute > 59:
        return None

    if ampm in {"下午", "晚上", "pm"} and 0 < hour < 12:
        hour += 12
    elif ampm in {"上午", "am"} and hour == 12:
        hour = 0
    elif ampm == "中午" and hour < 12:
        hour = 12 if hour == 0 else hour
    elif (
        not ampm
        and 1 <= hour <= 6
        and re.search(r"(开会|见面|会议|拜访|meeting)", stripped, re.IGNORECASE)
    ):
        # 「三点开会」通常指下午 15:00，而非凌晨 03:00。
        hour += 12
    if hour == 24:
        hour = 0

    try:
        zone = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        zone = UTC
    local_now = now.astimezone(zone) if now.tzinfo else now.replace(tzinfo=zone)
    target_day = local_now.date() + timedelta(days=_event_day_offset(day_token, ampm=ampm))
    start = datetime(
        target_day.year, target_day.month, target_day.day, hour, minute, tzinfo=zone
    )
    end = start + timedelta(hours=1)
    if location:
        event_title = title if title.startswith("去") else f"去 {location.strip()}"
    else:
        event_title = title
    return (event_title.strip(), start, end, location)


def _default_remind_at(due: date, tz: str) -> datetime:
    """Morning-of reminder in the user's timezone."""
    try:
        local = datetime(due.year, due.month, due.day, 9, 0, tzinfo=ZoneInfo(tz))
    except (ZoneInfoNotFoundError, ValueError):
        local = datetime(due.year, due.month, due.day, 9, 0, tzinfo=UTC)
    return local.astimezone(UTC)


@dataclass
class AssistantOutcome:
    action: str  # booked | updated | cancelled | created | device_book | none
    reply: str
    detail: str | None = None
    task_id: str | None = None
    task_title: str | None = None
    remind_at: str | None = None
    device_calendar_title: str | None = None
    device_calendar_start: str | None = None
    device_calendar_end: str | None = None
    device_calendar_location: str | None = None


_APPLE_PRIMARY_MODIFY_REPLY = (
    "Your default calendar for new events is Apple Calendar. "
    "Reschedule and cancel still use Google Calendar for synced events — "
    "switch Default calendar to Google in Settings, or cancel in the Calendar app."
)


def _calendar_write_outcome(
    *,
    action: str,
    reply: str,
    run: Callable[[], ExecutionResult],
    locale: str = "en",
) -> AssistantOutcome:
    """Run a calendar mutation; turn reconnect / missing-grant into a clear reply."""
    try:
        result = run()
    except (TokenReconnectRequired, RefreshError):
        return AssistantOutcome(
            action="none", reply=_localized(_GOOGLE_RECONNECT_REPLY, locale)
        )
    except ValueError as exc:
        if _is_missing_google_account(exc):
            return AssistantOutcome(
                action="none", reply=_localized(_GOOGLE_CONNECT_REPLY, locale)
            )
        raise
    return AssistantOutcome(
        action=action, reply=reply or result.detail, detail=result.detail
    )


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
        locale = _reply_locale(title, user)
        reply = (
            f"好的，我会在 {_format_due_date(due, tz)} 提醒你：{title}。"
            if locale == "zh"
            else f"Got it — I'll remind you {_format_due_date(due, tz)}: {title}."
        )
    return _outcome_from_task_execution(result=result, reply=reply)


def _execute_book_calendar(
    db: Session,
    user: User,
    *,
    title: str,
    start: datetime,
    end: datetime,
    location: str | None,
    text: str,
    llm_reply: str = "",
) -> AssistantOutcome:
    from app.services.calendar_write import should_write_apple

    locale = _reply_locale(text or title, user)
    start_iso = start.isoformat()
    end_iso = end.isoformat()
    if should_write_apple(user):
        if locale == "zh":
            when = start.strftime("%m月%d日 %H:%M")
            reply = (llm_reply or "").strip() or f"好的，已准备加到日历：{when} — {title}。"
        else:
            when = start.strftime("%a %b %-d %-I:%M %p")
            reply = (llm_reply or "").strip() or f"I'll add “{title}” to your Apple Calendar ({when})."
        return AssistantOutcome(
            action="device_book",
            reply=reply,
            detail=f"Book on Apple Calendar: {title}",
            device_calendar_title=title,
            device_calendar_start=start_iso,
            device_calendar_end=end_iso,
            device_calendar_location=location,
        )
    target: dict[str, str] = {"title": title, "start": start_iso, "end": end_iso}
    if location:
        target["location"] = location
    proposal = propose_action_internal(
        db,
        user,
        action_type=ActionType.create_calendar_event,
        target=target,
        reason="Booked from an assistant request",
    )
    confirm = (llm_reply or "").strip() or (
        f"好的，已加到日历：{title}。" if locale == "zh" else f"Booked — {title}."
    )
    return _calendar_write_outcome(
        action="booked",
        reply=confirm,
        locale=locale,
        run=lambda: execution.execute_proposal(db, user, proposal),
    )


def interpret_and_act(db: Session, user: User, *, text: str, tz: str) -> AssistantOutcome:
    now = _now_in_tz(tz)
    locale = _reply_locale(text, user)
    upcoming = _format_upcoming(db, user.id)
    interp = get_llm().interpret_request(
        text=text,
        now_iso=now.isoformat(),
        timezone=tz,
        upcoming_events=upcoming,
    )

    if interp.intent == "book_calendar" and interp.start and interp.end and interp.title:
        try:
            start = datetime.fromisoformat(interp.start)
            end = datetime.fromisoformat(interp.end)
        except ValueError:
            start = end = None  # type: ignore[assignment]
        if start is not None and end is not None:
            return _execute_book_calendar(
                db,
                user,
                title=interp.title,
                start=start,
                end=end,
                location=None,
                text=text,
                llm_reply=interp.reply or "",
            )

    if interp.intent == "reschedule_calendar" and interp.event_id and (interp.start or interp.end):
        from app.services.calendar_write import should_write_apple

        if should_write_apple(user):
            return AssistantOutcome(action="none", reply=_APPLE_PRIMARY_MODIFY_REPLY)
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
        return _calendar_write_outcome(
            action="updated",
            reply=interp.reply or "",
            run=lambda: execution.execute_proposal(db, user, proposal),
        )

    if interp.intent == "cancel_calendar" and interp.event_id:
        from app.services.calendar_write import should_write_apple

        if should_write_apple(user):
            return AssistantOutcome(action="none", reply=_APPLE_PRIMARY_MODIFY_REPLY)
        proposal = propose_action_internal(
            db,
            user,
            action_type=ActionType.delete_calendar_event,
            target={"event_id": interp.event_id},
            reason="Cancelled from an assistant request",
        )
        return _calendar_write_outcome(
            action="cancelled",
            reply=interp.reply or "",
            run=lambda: execution.execute_proposal(db, user, proposal),
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

    # "明天十一点要去 X" — book even if the LLM said check_calendar / none.
    book = _fallback_book_calendar_from_text(text, now=now, tz=tz)
    if book is not None:
        title, start, end, location = book
        return _execute_book_calendar(
            db,
            user,
            title=title,
            start=start,
            end=end,
            location=location,
            text=text,
        )

    if interp.intent == "check_calendar":
        reply = (interp.reply or "").strip() or _calendar_check_reply(db, user.id, tz)
        return AssistantOutcome(action="none", reply=reply)

    reply = (interp.reply or "").strip()
    if not reply:
        reply = (
            "我不太确定怎么帮你 — 可以让我查看或预订日历。"
            if locale == "zh"
            else "I'm not sure how to help with that — try asking about your calendar."
        )
    elif re.search(_CALENDAR_ONLY_RE, reply, re.IGNORECASE):
        reply = (
            "我可以帮你查看或预订日历、设置提醒、按名字起草短信，或从收件箱回复。"
            if locale == "zh"
            else (
                "I can check or book your calendar, set reminders and tasks, draft a text by name "
                '(e.g. "text Mom: see you tomorrow"), or help reply from Inbox.'
            )
        )
    return AssistantOutcome(action="none", reply=reply)


# Back-compat alias used by message booking tests.
def interpret_and_book(db: Session, user: User, *, text: str, tz: str) -> AssistantOutcome:
    return interpret_and_act(db, user, text=text, tz=tz)


def _format_today_context(db: Session, user_id: str, *, tz: str, cited_ids: set[str]) -> str:
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
            cited_ids.add(p.id)
            lines.append(f"- [id:{p.id}] {p.title}{who}{due}: {p.reason}")
    else:
        lines.append("- (none)")
    return "\n".join(lines)


def _format_waiting_context(db: Session, user_id: str, *, cited_ids: set[str]) -> str:
    view = build_waiting(db, user_id)
    lines = ["Waiting on you:"]
    for entry in view.waiting_on_you[:8]:
        cited_ids.add(entry.commitment.id)
        lines.append(
            f"- [id:{entry.commitment.id}] {entry.commitment.description} "
            f"({entry.commitment.counterparty})"
        )
    if not view.waiting_on_you:
        lines.append("- (none)")
    lines.append("")
    lines.append("You are waiting on:")
    for entry in view.you_are_waiting_on[:8]:
        cited_ids.add(entry.commitment.id)
        lines.append(
            f"- [id:{entry.commitment.id}] {entry.commitment.description} "
            f"({entry.commitment.counterparty})"
        )
    if not view.you_are_waiting_on:
        lines.append("- (none)")
    return "\n".join(lines)


def _format_inbox_context(db: Session, user_id: str, *, cited_ids: set[str]) -> str:
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
        # SMS is a first-class source alongside Gmail — do not filter it out of
        # assistant context (see /plan-eng-review + /plan-design-review 2026-07-02).
        if m.source != "sms" and not message_in_primary_inbox(m):
            continue
        category = effective_inbox_category(m)
        if not message_needs_attention(
            category=category,
            user_replied=m.id in replied,
            user_decided=message_is_handled(m),
        ):
            continue
        subj = m.subject or m.snippet or "(no subject)"
        source_tag = "sms" if m.source == "sms" else category
        cited_ids.add(m.id)
        lines.append(f"- [id:{m.id}] [{source_tag}] {m.sender}: {subj}")
        count += 1
        if count >= 10:
            break
    if count == 0:
        lines.append("- (none)")
    return "\n".join(lines)


def build_assistant_context(db: Session, user: User, *, tz: str) -> tuple[str, set[str]]:
    """Structured snapshot for contextual Ask chat.

    Returns the formatted text alongside the set of real ids that appear in it, so
    chat_with_context can verify the model only cites things that actually exist
    (structural grounding, not just prompt instruction — see D2, 2026-07-02).
    """
    cited_ids: set[str] = set()
    events = _format_upcoming(db, user.id, cited_ids=cited_ids)
    parts = [
        _format_today_context(db, user.id, tz=tz, cited_ids=cited_ids),
        "",
        _format_waiting_context(db, user.id, cited_ids=cited_ids),
        "",
        _format_inbox_context(db, user.id, cited_ids=cited_ids),
        "",
        "Upcoming calendar (next 2 weeks):",
        events or "(none)",
    ]
    return "\n".join(parts), cited_ids


def chat_with_context(
    db: Session,
    user: User,
    *,
    text: str,
    tz: str,
    history: list[dict[str, str]] | None = None,
) -> AssistantOutcome:
    """Answer a free-form question using Today, waiting, inbox, and calendar context."""
    locale = _reply_locale(text, user)
    if _text_requests_action(text):
        outcome = interpret_and_act(db, user, text=text, tz=tz)
        if outcome.action != "none":
            return outcome
        # check_calendar and other none-action intents still have a useful reply.
        if outcome.reply and outcome.reply != (
            "I'm not sure how to help with that — try asking about your calendar."
        ) and outcome.reply != (
            "我不太确定怎么帮你 — 可以让我查看或预订日历。"
        ):
            return outcome

    # Deterministic calendar book even if action-hint gate / LLM missed it.
    now = _now_in_tz(tz)
    book = _fallback_book_calendar_from_text(text, now=now, tz=tz)
    if book is not None:
        title, start, end, location = book
        return _execute_book_calendar(
            db,
            user,
            title=title,
            start=start,
            end=end,
            location=location,
            text=text,
        )

    context, context_ids = build_assistant_context(db, user, tz=tz)
    result = get_llm().answer_contextual_question(
        question=text,
        context=context,
        history=history,
    )

    if not result.has_context:
        # Distinct from "I don't understand your question" — this is a brand-new
        # or fully caught-up user with nothing to report yet. See D7, 2026-07-02.
        return AssistantOutcome(
            action="none",
            reply=_localized(_EMPTY_INBOX_REPLY, locale),
        )

    if result.cited_ids and not set(result.cited_ids).issubset(context_ids):
        # The model cited something that isn't actually in the context we sent it —
        # treat as a grounding failure rather than surface a possibly-invented
        # answer as fact (structural grounding, not just prompt instruction — D2).
        return AssistantOutcome(
            action="none",
            reply=_localized(_NOT_CONFIDENT_REPLY, locale),
        )

    reply = (result.reply or "").strip()
    return AssistantOutcome(
        action="none",
        reply=reply or _localized(_UNSURE_REPLY, locale),
    )
