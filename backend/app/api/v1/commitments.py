"""List and update commitments (PRD 12.5 feedback loop)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.enums import CommitmentStatus, SourceType
from app.db.models import Commitment, DraftReply, Message, User
from app.llm import get_llm
from app.schemas.api import CommitmentDraftOut, CommitmentDraftRequest, CommitmentOut

router = APIRouter(prefix="/commitments", tags=["commitments"])


@router.get("", response_model=list[CommitmentOut])
def list_commitments(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Commitment]:
    return list(db.scalars(select(Commitment).where(Commitment.user_id == user.id)))


@router.post("/{commitment_id}/status", response_model=CommitmentOut)
def update_status(
    commitment_id: str,
    status: CommitmentStatus,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Commitment:
    """Mark done / snooze / dismiss. This is the user feedback signal (PRD 20.1)."""
    commitment = db.get(Commitment, commitment_id)
    if commitment is None or commitment.user_id != user.id:
        raise HTTPException(status_code=404, detail="Commitment not found")
    commitment.status = status
    db.commit()
    return commitment


@router.post("/{commitment_id}/draft", response_model=CommitmentDraftOut)
def draft_for_commitment(
    commitment_id: str,
    payload: CommitmentDraftRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CommitmentDraftOut:
    """Draft a reply for a commitment (the 'Act' button on a Today priority).

    Internal preparation (risk level 1): the draft is generated and returned, not sent.
    Context is the commitment's own description + verbatim source evidence — not a
    separate Gmail thread — so this works for any priority, with or without a message.
    """
    commitment = db.get(Commitment, commitment_id)
    if commitment is None or commitment.user_id != user.id:
        raise HTTPException(status_code=404, detail="Commitment not found")

    context_parts = [f"Task: {commitment.description}"]
    if commitment.counterparty:
        context_parts.append(f"Counterparty: {commitment.counterparty}")
    if commitment.evidence:
        context_parts.append(f"Source (verbatim): {commitment.evidence}")
    context = "\n".join(context_parts)

    result = get_llm().draft_reply(
        thread_context=context,
        instruction=payload.instruction,
        tone=payload.tone,
        user_name=user.name,
    )

    subject = result.subject or f"Re: {commitment.description}".strip()

    # If this commitment came from an email, persist a real DraftReply tied to that
    # message so the reply can be SENT (threaded). Otherwise it's save/review only.
    draft_reply_id: str | None = None
    if commitment.source_type == SourceType.gmail and commitment.source_id:
        message = db.scalar(
            select(Message).where(
                Message.user_id == user.id,
                Message.external_id == commitment.source_id,
            )
        )
        if message is not None:
            draft = DraftReply(
                user_id=user.id,
                message_id=message.id,
                subject=subject,
                body=result.body,
                tone=payload.tone,
            )
            db.add(draft)
            db.commit()
            draft_reply_id = draft.id

    return CommitmentDraftOut(
        recipient=commitment.counterparty,
        subject=subject,
        body=result.body,
        tone=payload.tone,
        evidence=commitment.evidence,
        draft_reply_id=draft_reply_id,
    )
