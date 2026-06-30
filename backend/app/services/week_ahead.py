"""Weekly rhythm briefing — week-ahead summary for Sunday/Monday surfaces."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import CommitmentStatus, ScheduleProposalStatus
from app.db.models import CalendarEvent, Commitment, ScheduleProposal, User
from app.schemas.today import WeekAheadOut

_EN_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_ZH_DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def _local_tz(timezone: str | None):
    try:
        return ZoneInfo(timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return UTC


def is_week_boundary_prominent(now: datetime, *, timezone: str | None) -> bool:
    """Show the week-ahead card prominently on Sunday evening or Monday."""
    tz = _local_tz(timezone)
    local = now.astimezone(tz)
    if local.weekday() == 0:
        return True
    if local.weekday() == 6 and local.hour >= 17:
        return True
    return False


def _week_range(today: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    start = datetime.combine(today, datetime.min.time(), tzinfo=tz)
    end = start + timedelta(days=7)
    return start.astimezone(UTC), end.astimezone(UTC)


def build_week_ahead(
    db: Session,
    user_id: str,
    *,
    today: date,
    locale: str = "en",
    now: datetime | None = None,
) -> WeekAheadOut | None:
    now = now or datetime.now(UTC)
    user = db.get(User, user_id)
    tz = _local_tz(user.timezone if user else None)
    start_utc, end_utc = _week_range(today, tz)

    events = list(
        db.scalars(
            select(CalendarEvent).where(
                CalendarEvent.user_id == user_id,
                CalendarEvent.start_time.is_not(None),
                CalendarEvent.start_time >= start_utc,
                CalendarEvent.start_time < end_utc,
            )
        )
    )
    meeting_count = len(events)

    counts_by_weekday: dict[int, int] = {i: 0 for i in range(7)}
    for event in events:
        if event.start_time is None:
            continue
        wd = event.start_time.astimezone(tz).weekday()
        counts_by_weekday[wd] = counts_by_weekday.get(wd, 0) + 1

    busiest_weekday = max(counts_by_weekday, key=lambda k: counts_by_weekday[k])
    busiest_count = counts_by_weekday[busiest_weekday]
    day_labels = _ZH_DAYS if locale == "zh" else _EN_DAYS
    busiest_day = day_labels[busiest_weekday]

    pending_invites = list(
        db.scalars(
            select(ScheduleProposal).where(
                ScheduleProposal.user_id == user_id,
                ScheduleProposal.status == ScheduleProposalStatus.pending,
                ScheduleProposal.start_time >= start_utc,
                ScheduleProposal.start_time < end_utc,
            )
        )
    )

    fuzzy_commitments = list(
        db.scalars(
            select(Commitment).where(
                Commitment.user_id == user_id,
                Commitment.status == CommitmentStatus.open,
                Commitment.due_date.is_(None),
            )
        )
    )

    if locale == "zh":
        parts = [f"下周 {meeting_count} 个会"]
        if busiest_count > 0:
            parts.append(f"{busiest_day}最满")
        summary = "，".join(parts)
        if pending_invites:
            summary += f"；有 {len(pending_invites)} 个模糊邀约没敲定"
        elif fuzzy_commitments:
            summary += f"；有 {len(fuzzy_commitments)} 项待办还没定日期"
        summary += "。"
    else:
        parts = [f"{meeting_count} meeting{'s' if meeting_count != 1 else ''} next week"]
        if busiest_count > 0:
            parts.append(f"busiest on {busiest_day}")
        summary = ", ".join(parts) + "."
        if pending_invites:
            summary += f" {len(pending_invites)} tentative invite{'s' if len(pending_invites) != 1 else ''} still open."
        elif fuzzy_commitments:
            summary += f" {len(fuzzy_commitments)} open loop{'s' if len(fuzzy_commitments) != 1 else ''} without firm dates."

    prominent = is_week_boundary_prominent(now, timezone=user.timezone if user else None)
    pref = (user.preferences or {}).get("week_briefing") if user else None
    if isinstance(pref, dict) and pref.get("enabled") is False:
        return None

    return WeekAheadOut(
        summary=summary,
        meeting_count=meeting_count,
        busiest_day=busiest_day if busiest_count > 0 else None,
        pending_invites=len(pending_invites),
        fuzzy_commitments=len(fuzzy_commitments),
        show_prominently=prominent,
    )
