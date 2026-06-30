"""Rules-based habit detection from calendar history (v1).

Scans ~30 days of CalendarEvent rows for recurring time blocks (same activity,
similar weekday + time window), stores them in user_habits, and surfaces proactive
Today suggestions when today matches a habit day but nothing is scheduled."""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.models import CalendarEvent, User, UserHabit
from app.schemas.today import HabitSuggestionOut
from app.services.meeting_prep import today_events

LOOKBACK_DAYS = 30
MIN_OCCURRENCES = 3
MIN_WEEKDAY_HITS = 2
TIME_WINDOW_MINUTES = 60
TITLE_MATCH_MINUTES = 120

_ZH_WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
_EN_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


@dataclass(frozen=True)
class DetectedHabit:
    activity: str
    activity_key: str
    typical_days: list[int]
    start_time: time
    end_time: time
    confidence: float


def _local_tz(timezone: str | None):
    try:
        return ZoneInfo(timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return UTC


def normalize_activity(title: str | None) -> str:
    if not title:
        return ""
    t = title.strip().lower()
    t = re.sub(r"^(weekly|daily)\s+", "", t)
    t = re.sub(r"\s+", " ", t)
    return t


def activity_key(title: str | None) -> str:
    return normalize_activity(title)[:256]


def _title_matches(a: str | None, b: str | None) -> bool:
    na, nb = normalize_activity(a), normalize_activity(b)
    if not na or not nb:
        return False
    return na == nb or na in nb or nb in na


def _minutes_since_midnight(dt: datetime) -> int:
    local = dt
    return local.hour * 60 + local.minute


def _median_time(times: list[time]) -> time:
    minutes = sorted(t.hour * 60 + t.minute for t in times)
    mid = int(statistics.median(minutes))
    return time(hour=mid // 60, minute=mid % 60)


def detect_habits_from_events(
    events: list[CalendarEvent],
    *,
    timezone: str | None,
    reference: date,
) -> list[DetectedHabit]:
    """Pure detection: group events by title and find recurring weekday/time patterns."""
    tz = _local_tz(timezone)
    window_start = reference - timedelta(days=LOOKBACK_DAYS)
    grouped: dict[str, list[CalendarEvent]] = {}
    for event in events:
        if event.start_time is None or event.end_time is None or not event.title:
            continue
        start = event.start_time.astimezone(tz)
        if start.date() < window_start:
            continue
        key = activity_key(event.title)
        if not key:
            continue
        grouped.setdefault(key, []).append(event)

    habits: list[DetectedHabit] = []
    weeks_in_window = max(1, LOOKBACK_DAYS // 7)

    for key, rows in grouped.items():
        if len(rows) < MIN_OCCURRENCES:
            continue
        by_weekday: dict[int, list[CalendarEvent]] = {}
        for event in rows:
            start = event.start_time.astimezone(tz)  # type: ignore[union-attr]
            by_weekday.setdefault(start.weekday(), []).append(event)

        typical_days = sorted(
            wd for wd, hits in by_weekday.items() if len(hits) >= MIN_WEEKDAY_HITS
        )
        if not typical_days:
            continue

        pattern_events = [e for wd in typical_days for e in by_weekday[wd]]
        starts = [e.start_time.astimezone(tz).time() for e in pattern_events]  # type: ignore[union-attr]
        ends = [e.end_time.astimezone(tz).time() for e in pattern_events]  # type: ignore[union-attr]
        start_t = _median_time(starts)
        end_t = _median_time(ends)
        if end_t <= start_t:
            end_t = time(hour=min(23, start_t.hour + 1), minute=start_t.minute)

        hits = len(pattern_events)
        confidence = min(1.0, hits / max(1, weeks_in_window * len(typical_days)))
        if confidence < 0.35:
            continue

        sample_title = max((e.title or key for e in pattern_events), key=len)
        habits.append(
            DetectedHabit(
                activity=sample_title,
                activity_key=key,
                typical_days=typical_days,
                start_time=start_t,
                end_time=end_t,
                confidence=round(confidence, 2),
            )
        )

    return sorted(habits, key=lambda h: (-h.confidence, h.activity))


def sync_user_habits(db: Session, user_id: str, *, today: date | None = None) -> int:
    """Recompute habits for a user from calendar history. Returns rows upserted."""
    user = db.get(User, user_id)
    if user is None:
        return 0
    today = today or datetime.now(UTC).date()
    tz = _local_tz(user.timezone)
    window_start = datetime.combine(today - timedelta(days=LOOKBACK_DAYS), time.min, tzinfo=tz)
    events = list(
        db.scalars(
            select(CalendarEvent).where(
                CalendarEvent.user_id == user_id,
                CalendarEvent.start_time.is_not(None),
                CalendarEvent.start_time >= window_start.astimezone(UTC),
            )
        )
    )
    detected = detect_habits_from_events(events, timezone=user.timezone, reference=today)
    db.execute(delete(UserHabit).where(UserHabit.user_id == user_id))
    for habit in detected:
        db.add(
            UserHabit(
                user_id=user_id,
                activity=habit.activity,
                activity_key=habit.activity_key,
                typical_days=habit.typical_days,
                start_time=habit.start_time,
                end_time=habit.end_time,
                confidence=habit.confidence,
            )
        )
    db.commit()
    return len(detected)


def _format_weekdays(days: list[int], locale: str) -> str:
    labels = _ZH_WEEKDAYS if locale == "zh" else _EN_WEEKDAYS
    return "、".join(labels[d] for d in sorted(days)) if locale == "zh" else ", ".join(
        labels[d] for d in sorted(days)
    )


def _time_period_label(hour: int, locale: str) -> str:
    if locale == "zh":
        if hour < 12:
            return "早上"
        if hour < 17:
            return "下午"
        return "晚上"
    if hour < 12:
        return "morning"
    if hour < 17:
        return "afternoon"
    return "evening"


def _format_clock(t: time, locale: str) -> str:
    if locale == "zh":
        return f"{t.hour}–{t.hour + 1 if t.minute == 0 else t.hour}:{t.minute:02d}点"
    return t.strftime("%-I %p").lstrip("0") if hasattr(t, "strftime") else str(t)


def format_habit_pattern_summary(habit: UserHabit, *, locale: str) -> str:
    days = _format_weekdays(habit.typical_days, locale)
    period = _time_period_label(habit.start_time.hour, locale)
    if locale == "zh":
        return f"你通常{days}{period}{habit.activity}"
    return f"You usually do {habit.activity} on {days} in the {period}"


def _event_covers_habit(event: CalendarEvent, habit: UserHabit, *, tz: ZoneInfo) -> bool:
    if event.start_time is None or not _title_matches(event.title, habit.activity):
        return False
    start = event.start_time.astimezone(tz)
    event_min = _minutes_since_midnight(start)
    habit_min = habit.start_time.hour * 60 + habit.start_time.minute
    return abs(event_min - habit_min) <= TITLE_MATCH_MINUTES


def _suggested_slot(
    habit: UserHabit, *, today: date, tz: ZoneInfo
) -> tuple[datetime, datetime]:
    start = datetime.combine(today, habit.start_time, tzinfo=tz)
    end = datetime.combine(today, habit.end_time, tzinfo=tz)
    if end <= start:
        end = start + timedelta(hours=1)
    return start.astimezone(UTC), end.astimezone(UTC)


def build_habit_suggestions(
    db: Session,
    user_id: str,
    *,
    today: date,
    locale: str = "en",
    now: datetime | None = None,
) -> list[HabitSuggestionOut]:
    """Proactive suggestions when today matches a habit day but nothing is scheduled."""
    now = now or datetime.now(UTC)
    user = db.get(User, user_id)
    tz = _local_tz(user.timezone if user else None)
    weekday = now.astimezone(tz).date().weekday() if user else today.weekday()

    habits = list(
        db.scalars(
            select(UserHabit)
            .where(UserHabit.user_id == user_id)
            .order_by(UserHabit.confidence.desc())
        )
    )
    if not habits:
        sync_user_habits(db, user_id, today=today)
        habits = list(
            db.scalars(
                select(UserHabit)
                .where(UserHabit.user_id == user_id)
                .order_by(UserHabit.confidence.desc())
            )
        )

    todays_events = today_events(
        db, user_id, timezone=user.timezone if user else None, now=now
    )
    suggestions: list[HabitSuggestionOut] = []

    for habit in habits:
        if weekday not in habit.typical_days:
            continue
        if any(_event_covers_habit(e, habit, tz=tz) for e in todays_events):
            continue

        start_utc, end_utc = _suggested_slot(habit, today=today, tz=tz)
        pattern = format_habit_pattern_summary(habit, locale=locale)
        start_local = start_utc.astimezone(tz)
        end_local = end_utc.astimezone(tz)
        start_label = start_local.strftime("%H:%M")
        end_label = end_local.strftime("%H:%M")

        if locale == "zh":
            prompt = (
                f"今天还没排{habit.activity}，要帮你留 {start_label}–{end_label} 吗？"
            )
        else:
            prompt = (
                f"No {habit.activity} on your calendar today — "
                f"block {start_label}–{end_label}?"
            )

        suggestions.append(
            HabitSuggestionOut(
                habit_id=habit.id,
                activity=habit.activity,
                pattern_summary=pattern,
                prompt=prompt,
                suggested_start=start_utc.isoformat(),
                suggested_end=end_utc.isoformat(),
                typical_days=habit.typical_days,
                confidence=habit.confidence,
            )
        )
        if len(suggestions) >= 2:
            break

    return suggestions
