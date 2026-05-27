"""Ask Albert (PRD 10.2). A free-text request → an interpreted action.

v1 understands calendar booking ("book my calendar tomorrow 5-6pm"): the LLM resolves
the times against the user's timezone, and the request runs through the capability spine
(propose → execute) so it's audited like every other action. Booking your own time is a
level-2 reversible write, so it executes without an approval card; Albert just confirms.
Other intents return an honest reply rather than pretending."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import User
from app.schemas.api import AssistantAskRequest, AssistantAskResponse
from app.services.assistant import interpret_and_book, resolve_timezone

router = APIRouter(prefix="/assistant", tags=["assistant"])


@router.post("/ask", response_model=AssistantAskResponse)
def ask(
    payload: AssistantAskRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssistantAskResponse:
    tz = resolve_timezone(db, user, payload.timezone)
    outcome = interpret_and_book(db, user, text=payload.text, tz=tz)
    return AssistantAskResponse(
        reply=outcome.reply,
        action="booked" if outcome.booked else "none",
        detail=outcome.detail,
    )
