"""Daily briefing routes (PRD 12.7, 19.1)."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import DailyBriefing, User
from app.schemas.api import BriefingFeedbackRequest, BriefingOut
from app.schemas.today import WeekAheadOut
from app.services import briefing
from app.services.week_ahead import build_week_ahead

router = APIRouter(prefix="/briefings", tags=["briefings"])


@router.post("/generate", response_model=BriefingOut)
def generate(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DailyBriefing:
    today = datetime.now(UTC).date()
    return briefing.generate_briefing(db, user.id, today=today)


@router.get("/today", response_model=BriefingOut)
def today(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DailyBriefing:
    current = briefing.get_today_briefing(db, user.id, today=datetime.now(UTC).date())
    if current is None:
        raise HTTPException(status_code=404, detail="No briefing yet today; generate one")
    return current


@router.get("/week", response_model=WeekAheadOut)
def week(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    locale: str = Query("en", pattern="^(en|zh)$"),
) -> WeekAheadOut:
    today = datetime.now(UTC).date()
    result = build_week_ahead(db, user.id, today=today, locale=locale)
    if result is None:
        raise HTTPException(status_code=404, detail="Week briefing not available")
    return result


@router.post("/{briefing_id}/feedback", response_model=BriefingOut)
def feedback(
    briefing_id: str,
    payload: BriefingFeedbackRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DailyBriefing:
    row = db.get(DailyBriefing, briefing_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Briefing not found")
    row.user_feedback = "useful" if payload.useful else "not_useful"
    db.commit()
    return row
