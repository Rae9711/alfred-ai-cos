"""Daily briefing (PRD 12.7, journey 1). Builds a structured snapshot of the user's
Today, asks the LLM for a calm morning briefing, and persists one row per user per day."""

from __future__ import annotations

from datetime import date as date_type
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import DailyBriefing, User
from app.llm import get_llm
from app.services.today import build_today

# Local-time window during which the morning briefing is allowed to fire. The wide
# window covers users whose worker tick missed 07:00 (the canonical "morning" hour).
MORNING_WINDOW = range(7, 10)  # 07:00–09:59 local


def _local_now(user: User, now_utc: datetime) -> datetime:
    try:
        tz = ZoneInfo(user.timezone or "UTC")
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")
    return now_utc.astimezone(tz)


def due_briefing_date(db: Session, user: User, *, now_utc: datetime) -> date_type | None:
    """If the user is inside their morning window and has no briefing yet for their
    local today, return that date. Else None. This is the dedup + scheduling kernel —
    the worker calls it hourly per user and acts only when it sees a date."""
    local = _local_now(user, now_utc)
    if local.hour not in MORNING_WINDOW:
        return None
    local_today = local.date()
    existing = get_today_briefing(db, user.id, today=local_today)
    if existing is not None:
        return None
    return local_today


def _snapshot(db: Session, user_id: str, *, today: date_type) -> dict[str, Any]:
    """The structured payload the briefing is generated from. Reuses the Today builder
    so the briefing and the Today screen never diverge."""
    dashboard = build_today(db, user_id, today=today)
    return dashboard.model_dump(mode="json")


def generate_briefing(db: Session, user_id: str, *, today: date_type) -> DailyBriefing:
    """Generate (or regenerate) today's briefing for a user. Idempotent per day:
    re-running replaces the day's summary rather than creating a duplicate."""
    snapshot = _snapshot(db, user_id, today=today)
    summary = get_llm().generate_daily_briefing(today_payload=snapshot)

    existing = db.scalar(
        select(DailyBriefing).where(DailyBriefing.user_id == user_id, DailyBriefing.date == today)
    )
    if existing is None:
        briefing = DailyBriefing(user_id=user_id, date=today, summary=summary, snapshot=snapshot)
        db.add(briefing)
    else:
        existing.summary = summary
        existing.snapshot = snapshot
        existing.user_feedback = None
        briefing = existing
    db.commit()
    return briefing


def get_today_briefing(db: Session, user_id: str, *, today: date_type) -> DailyBriefing | None:
    return db.scalar(
        select(DailyBriefing).where(DailyBriefing.user_id == user_id, DailyBriefing.date == today)
    )
