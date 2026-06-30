"""Draft reply generation (PRD 12.9, journey 3).

Generating a draft is internal preparation (risk level 1): no approval needed.
The draft is stored but not pushed to Gmail. Pushing or sending crosses to level 3
and is created as an ActionProposal in app/api/v1/actions.py."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import DraftReply, Message, User
from app.llm import get_llm
from app.schemas.api import DraftCreateRequest, DraftOut
from app.services.message_body import build_draft_context, fetch_message_body
from app.services.writing_style import (
    format_writing_style_prompt,
    get_writing_style,
    maybe_refresh_writing_style,
)

router = APIRouter(prefix="/drafts", tags=["drafts"])


@router.get("/{draft_id}", response_model=DraftOut)
def get_draft(
    draft_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DraftReply:
    draft = db.get(DraftReply, draft_id)
    if draft is None or draft.user_id != user.id:
        raise HTTPException(status_code=404, detail="Draft not found")
    return draft


@router.post("", response_model=DraftOut)
def create_draft(
    payload: DraftCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DraftReply:
    message = db.get(Message, payload.message_id)
    if message is None or message.user_id != user.id:
        raise HTTPException(status_code=404, detail="Message not found")

    revising = bool(payload.instruction or (payload.revision_history or []))
    if not revising:
        existing = db.scalar(
            select(DraftReply)
            .where(DraftReply.user_id == user.id, DraftReply.message_id == message.id)
            .order_by(DraftReply.created_at.desc())
        )
        if existing is not None:
            return existing

    try:
        body = fetch_message_body(db, message)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Could not load email from Gmail") from exc

    context = build_draft_context(message=message, body=body, db=db)
    maybe_refresh_writing_style(db, user)
    style_prompt = format_writing_style_prompt(get_writing_style(user))
    result = get_llm().draft_reply(
        thread_context=context,
        instruction=payload.instruction,
        tone=payload.tone,
        user_name=user.name,
        current_draft=payload.current_draft_body,
        revision_history=payload.revision_history or None,
        writing_style_prompt=style_prompt,
    )

    draft = DraftReply(
        user_id=user.id,
        message_id=message.id,
        subject=result.subject or f"Re: {message.subject or ''}".strip(),
        body=result.body,
        tone=payload.tone,
    )
    db.add(draft)
    db.commit()
    return draft
