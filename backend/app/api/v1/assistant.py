"""Ask Albert (PRD 10.2). A free-text request → an interpreted action.

v1 understands calendar booking ("book my calendar tomorrow 5-6pm") and reminders/todos
("remind me tomorrow to pay rent"): the LLM resolves times against the user's timezone,
and the request runs through the capability spine (propose → execute) so it's audited
like every other action. Level-2 reversible writes execute without an approval card.
Other intents return an honest reply rather than pretending."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import User
from app.schemas.api import (
    AssistantAskRequest,
    AssistantAskResponse,
    AssistantChatRequest,
    AssistantChatResponse,
)
from app.services.assistant import (
    AssistantOutcome,
    chat_with_context,
    interpret_and_act,
    resolve_timezone,
)

router = APIRouter(prefix="/assistant", tags=["assistant"])


def _assistant_response(outcome: AssistantOutcome) -> AssistantAskResponse:
    remind = None
    if outcome.remind_at:
        try:
            remind = datetime.fromisoformat(outcome.remind_at)
        except ValueError:
            remind = None
    return AssistantAskResponse(
        reply=outcome.reply,
        action=outcome.action,
        detail=outcome.detail,
        task_id=outcome.task_id,
        task_title=outcome.task_title,
        remind_at=remind,
    )


@router.post("/ask", response_model=AssistantAskResponse)
def ask(
    payload: AssistantAskRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssistantAskResponse:
    tz = resolve_timezone(db, user, payload.timezone)
    outcome = interpret_and_act(db, user, text=payload.text, tz=tz)
    return _assistant_response(outcome)


@router.post("/chat", response_model=AssistantChatResponse)
def chat(
    payload: AssistantChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssistantChatResponse:
    tz = resolve_timezone(db, user, payload.timezone)
    outcome = chat_with_context(
        db,
        user,
        text=payload.text,
        tz=tz,
        history=[m.model_dump() for m in payload.history],
    )
    base = _assistant_response(outcome)
    return AssistantChatResponse(**base.model_dump())
