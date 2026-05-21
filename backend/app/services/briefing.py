"""Daily briefing (PRD 12.7, journey 1). Builds a structured snapshot of the user's
Today, asks the LLM for a calm morning briefing, and persists one row per user per day."""

from __future__ import annotations

from datetime import date as date_type
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import DailyBriefing
from app.llm import get_llm
from app.services.today import build_today


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
