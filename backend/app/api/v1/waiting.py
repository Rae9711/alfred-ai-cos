"""Waiting-for tracker routes (PRD 10.1, journey 5)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import User
from app.schemas.api import WaitingEntryOut, WaitingView
from app.services import waiting as waiting_service
from app.services.waiting import WaitingEntry

router = APIRouter(prefix="/waiting", tags=["waiting"])


def _to_out(entry: WaitingEntry) -> WaitingEntryOut:
    c = entry.commitment
    return WaitingEntryOut(
        id=c.id,
        description=c.description,
        counterparty=c.counterparty,
        due_date=c.due_date,
        age_days=entry.age_days,
        source_type=c.source_type,
        source_id=c.source_id,
    )


@router.get("", response_model=WaitingView)
def get_waiting(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WaitingView:
    view = waiting_service.build_waiting(db, user.id)
    return WaitingView(
        waiting_on_you=[_to_out(e) for e in view.waiting_on_you],
        you_are_waiting_on=[_to_out(e) for e in view.you_are_waiting_on],
    )
