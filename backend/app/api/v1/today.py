"""GET /api/v1/today (PRD 10.1, 19.1)."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.enums import ActionType
from app.db.models import User, UserHabit
from app.schemas.api import ScheduleBlockRequest, ScheduleBlockResponse
from app.schemas.today import TodayDashboard
from app.services import execution
from app.services.actions import propose_action_internal
from app.services.assistant import resolve_timezone
from app.services.planning_dismiss import dismiss_suggestion
from app.services.today import build_today

router = APIRouter(prefix="/today", tags=["today"])


@router.get("", response_model=TodayDashboard)
def get_today(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    locale: str = Query("en", pattern="^(en|zh)$"),
) -> TodayDashboard:
    today = datetime.now(UTC).date()
    return build_today(db, user.id, today=today, locale=locale)


@router.post("/schedule-block", response_model=ScheduleBlockResponse)
def schedule_block(
    payload: ScheduleBlockRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ScheduleBlockResponse:
    """Book a planning time-block onto the user's calendar (level-2 reversible write)."""
    resolve_timezone(db, user, payload.timezone)
    proposal = propose_action_internal(
        db,
        user,
        action_type=ActionType.create_calendar_event,
        target={"title": payload.title, "start": payload.start, "end": payload.end},
        reason="Scheduled from a planning suggestion",
    )
    result = execution.execute_proposal(db, user, proposal)
    event_id = (result.data or {}).get("event_id") if result.data else None
    return ScheduleBlockResponse(
        booked=True,
        reply=result.detail,
        detail=result.detail,
        event_id=str(event_id) if event_id else None,
    )


@router.post("/habit-suggestions/{habit_id}/dismiss")
def dismiss_habit_suggestion(
    habit_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """Hide a habit suggestion for today (user tapped 忽略)."""
    habit = db.get(UserHabit, habit_id)
    if habit is None or habit.user_id != user.id:
        raise HTTPException(status_code=404, detail="Habit not found")
    today = datetime.now(UTC).date()
    dismiss_suggestion(db, user, kind="habit", item_id=habit_id, day=today)
    return {"dismissed": True}


@router.post("/planning-suggestions/{item_id}/dismiss")
def dismiss_planning_suggestion(
    item_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """Hide a time-block / quick-win suggestion for today."""
    today = datetime.now(UTC).date()
    dismiss_suggestion(db, user, kind="planning", item_id=item_id, day=today)
    return {"dismissed": True}
