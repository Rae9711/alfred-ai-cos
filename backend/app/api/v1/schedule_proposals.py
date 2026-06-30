"""Schedule proposal routes — one-tap add to calendar from email."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import User
from app.schemas.api import AcceptScheduleProposalRequest, AcceptScheduleProposalResponse
from app.services import schedule_proposal as schedule_service

router = APIRouter(prefix="/schedule-proposals", tags=["schedule-proposals"])


@router.post("/{proposal_id}/accept", response_model=AcceptScheduleProposalResponse)
def accept_proposal(
    proposal_id: str,
    payload: AcceptScheduleProposalRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AcceptScheduleProposalResponse:
    try:
        proposal, detail = schedule_service.accept_proposal(
            db, user, proposal_id, timezone=payload.timezone
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AcceptScheduleProposalResponse(
        accepted=True,
        reply=detail,
        detail=detail,
        event_id=proposal.calendar_event_id,
    )


@router.post("/{proposal_id}/dismiss")
def dismiss_proposal(
    proposal_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    try:
        schedule_service.dismiss_proposal(db, user.id, proposal_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"dismissed": True}
