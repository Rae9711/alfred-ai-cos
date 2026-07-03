"""Compose new outbound emails from Ask (not thread replies)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import ComposeDraft, User
from app.schemas.api import ComposeDraftCreateRequest, ComposeDraftOut
from app.services.compose_email import create_compose_draft

router = APIRouter(prefix="/compose", tags=["compose"])


@router.get("/{draft_id}", response_model=ComposeDraftOut)
def get_compose_draft(
    draft_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ComposeDraft:
    draft = db.get(ComposeDraft, draft_id)
    if draft is None or draft.user_id != user.id:
        raise HTTPException(status_code=404, detail="Draft not found")
    return draft


@router.post("/draft", response_model=ComposeDraftOut)
def draft_compose_email(
    payload: ComposeDraftCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ComposeDraft:
    recipient = payload.recipient_email.strip()
    intent = payload.intent.strip()
    if not recipient or "@" not in recipient:
        raise HTTPException(status_code=400, detail="A valid recipient email is required.")
    if not intent:
        raise HTTPException(status_code=400, detail="What should the email say?")
    try:
        return create_compose_draft(
            db,
            user,
            recipient_email=recipient,
            recipient_name=payload.recipient_name,
            intent=intent,
            tone=payload.tone,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
