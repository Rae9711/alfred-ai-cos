"""Meeting prep routes (PRD 10.5, 12.3)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import CalendarEvent, User
from app.schemas.api import MeetingPrepOut, UpdateMeetingRequest, UpcomingMeeting
from app.services import calendar, meeting_prep

router = APIRouter(prefix="/meetings", tags=["meetings"])


@router.get("/upcoming", response_model=list[UpcomingMeeting])
def list_upcoming(
    within_hours: int | None = None,
    today: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CalendarEvent]:
    if today:
        return meeting_prep.today_events(db, user.id, timezone=user.timezone)
    return meeting_prep.upcoming_events(db, user.id, within_hours=within_hours)


@router.get("/{event_id}", response_model=UpcomingMeeting)
def get_meeting(
    event_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CalendarEvent:
    try:
        return calendar.get_event(db, user.id, event_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Event not found") from None


@router.patch("/{event_id}", response_model=UpcomingMeeting)
def update_meeting(
    event_id: str,
    payload: UpdateMeetingRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CalendarEvent:
    try:
        return calendar.update_event(
            db,
            user.id,
            event_id,
            title=payload.title,
            start=payload.start,
            end=payload.end,
            location=payload.location,
            description=payload.description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{event_id}", status_code=204)
def delete_meeting(
    event_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    try:
        calendar.delete_event(db, user.id, event_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


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
