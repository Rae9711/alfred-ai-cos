"""Ask Albert (PRD 10.2). A free-text request → an interpreted action.

v1 understands calendar booking ("book my calendar tomorrow 5-6pm"): the LLM resolves
the times against the user's timezone, and the request runs through the capability spine
(propose → execute) so it's audited like every other action. Booking your own time is a
level-2 reversible write, so it executes without an approval card; Albert just confirms.
Other intents return an honest reply rather than pretending."""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.enums import ActionType
from app.db.models import User
from app.llm import get_llm
from app.schemas.api import AssistantAskRequest, AssistantAskResponse
from app.services import execution
from app.services.actions import propose_action_internal

router = APIRouter(prefix="/assistant", tags=["assistant"])


def _now_in_tz(timezone: str) -> datetime:
    try:
        return datetime.now(ZoneInfo(timezone))
    except (ZoneInfoNotFoundError, ValueError):
        return datetime.now(UTC)


@router.post("/ask", response_model=AssistantAskResponse)
def ask(
    payload: AssistantAskRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssistantAskResponse:
    # Prefer the device timezone from the request (the app sends it); fall back to the
    # stored one. Persist it so other features (briefings, due dates) use the real zone.
    tz = payload.timezone or user.timezone or "UTC"
    if payload.timezone and payload.timezone != user.timezone:
        try:
            ZoneInfo(payload.timezone)  # validate before storing
            user.timezone = payload.timezone
            db.commit()
        except (ZoneInfoNotFoundError, ValueError):
            tz = user.timezone or "UTC"
    now = _now_in_tz(tz)
    interp = get_llm().interpret_request(text=payload.text, now_iso=now.isoformat(), timezone=tz)

    if interp.intent == "book_calendar" and interp.start and interp.end and interp.title:
        proposal = propose_action_internal(
            db,
            user,
            action_type=ActionType.create_calendar_event,
            target={
                "title": interp.title,
                "start": interp.start,
                "end": interp.end,
            },
            reason="Booked from an Ask request",
        )
        result = execution.execute_proposal(db, user, proposal)
        return AssistantAskResponse(
            reply=interp.reply or result.detail,
            action="booked",
            detail=result.detail,
        )

    return AssistantAskResponse(reply=interp.reply, action="none", detail=None)
