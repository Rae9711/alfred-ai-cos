"""Meeting prep routes (PRD 10.5, 12.3)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import CalendarEvent, User
from app.schemas.api import MeetingPrepOut, UpcomingMeeting
from app.services import meeting_prep

router = APIRouter(prefix="/meetings", tags=["meetings"])


@router.get("/upcoming", response_model=list[UpcomingMeeting])
def list_upcoming(
    within_hours: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CalendarEvent]:
    return meeting_prep.upcoming_events(db, user.id, within_hours=within_hours)


@router.get("/{event_id}/prep", response_model=MeetingPrepOut)
def prep(
    event_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeetingPrepOut:
    event = db.get(CalendarEvent, event_id)
    if event is None or event.user_id != user.id:
        raise HTTPException(status_code=404, detail="Event not found")
    related = meeting_prep.related_messages(db, user.id, event)
    summary = meeting_prep.prepare(db, user.id, event)
    return MeetingPrepOut(
        event=UpcomingMeeting.model_validate(event),
        summary=summary.summary,
        open_commitments=summary.open_commitments,
        suggested_questions=summary.suggested_questions,
        related_message_count=len(related),
    )
