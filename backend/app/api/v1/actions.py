"""Action approval spine (PRD 12.10, 17, 19.1).

The slice's one external action is pushing a drafted reply into Gmail as a real
draft. Even that is gated: Albert creates an ActionProposal (level 3), the user
approves, then the Execution Agent acts and writes an ExecutionLog. Sending the
email outright (vs. creating a Gmail draft) is deliberately not built; it needs
the gmail.send scope and stronger confirmation (see docs/TODO.md)."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.enums import (
    ActionStatus,
    ActionType,
    Provider,
    RiskLevel,
    SourceType,
)
from app.db.models import (
    ActionProposal,
    ConnectedAccount,
    DraftReply,
    ExecutionLog,
    Message,
    User,
)
from app.schemas.api import ActionProposalOut
from app.services import gmail
from app.services import tasks as task_service
from app.services.crypto import decrypt_token

router = APIRouter(prefix="/actions", tags=["actions"])


@router.post("/propose-draft-to-gmail/{draft_id}", response_model=ActionProposalOut)
def propose_push_draft(
    draft_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ActionProposal:
    """Create a level-3 proposal to push a stored draft into Gmail. Needs approval."""
    draft = db.get(DraftReply, draft_id)
    if draft is None or draft.user_id != user.id:
        raise HTTPException(status_code=404, detail="Draft not found")

    proposal = ActionProposal(
        user_id=user.id,
        action_type=ActionType.create_draft,
        risk_level=RiskLevel.external_comm.value,
        target={"draft_reply_id": draft.id},
        proposed_content=draft.body,
        reason="Push the prepared reply into your Gmail drafts for review before sending.",
        approval_required=True,
        status=ActionStatus.proposed,
    )
    db.add(proposal)
    db.commit()
    return proposal


@router.post("/{action_id}/approve", response_model=ActionProposalOut)
def approve_action(
    action_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ActionProposal:
    """Approve and execute. The only executor in the slice pushes a Gmail draft."""
    proposal = _owned_proposal(db, action_id, user.id)
    if proposal.status != ActionStatus.proposed:
        raise HTTPException(status_code=409, detail=f"Action already {proposal.status.value}")

    proposal.status = ActionStatus.approved
    proposal.approved_at = datetime.now(UTC)
    db.commit()

    try:
        _execute(db, proposal, user)
        proposal.status = ActionStatus.executed
        proposal.executed_at = datetime.now(UTC)
        db.add(
            ExecutionLog(
                user_id=user.id,
                action_proposal_id=proposal.id,
                action_type=proposal.action_type,
                result="success",
                rollback_available=False,
            )
        )
    except Exception as exc:  # never fail silently (PRD 13.3)
        proposal.status = ActionStatus.failed
        db.add(
            ExecutionLog(
                user_id=user.id,
                action_proposal_id=proposal.id,
                action_type=proposal.action_type,
                result="error",
                error=str(exc),
            )
        )
        db.commit()
        raise HTTPException(status_code=502, detail=f"Execution failed: {exc}") from exc
    db.commit()
    return proposal


@router.post("/{action_id}/reject", response_model=ActionProposalOut)
def reject_action(
    action_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ActionProposal:
    proposal = _owned_proposal(db, action_id, user.id)
    proposal.status = ActionStatus.rejected
    db.commit()
    return proposal


def _owned_proposal(db: Session, action_id: str, user_id: str) -> ActionProposal:
    proposal = db.get(ActionProposal, action_id)
    if proposal is None or proposal.user_id != user_id:
        raise HTTPException(status_code=404, detail="Action not found")
    return proposal


def _execute(db: Session, proposal: ActionProposal, user: User) -> None:
    """Execution Agent (PRD 14.1 agent 8). Dispatches on action type.

    B1 generalizes this into a CapabilityProvider registry; for now it branches
    over the action types the slice supports."""
    if proposal.action_type == ActionType.create_draft:
        _execute_push_draft(db, proposal, user)
    elif proposal.action_type == ActionType.create_task:
        _execute_create_task(db, proposal, user)
    else:
        raise ValueError(f"No executor for action type {proposal.action_type}")


def _execute_push_draft(db: Session, proposal: ActionProposal, user: User) -> None:
    """Push a drafted reply into Gmail (level 3)."""
    draft_id = proposal.target.get("draft_reply_id")
    draft = db.get(DraftReply, draft_id)
    if draft is None:
        raise ValueError("Draft no longer exists")
    message = db.get(Message, draft.message_id)
    account = db.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.user_id == user.id, ConnectedAccount.provider == Provider.google
        )
    )
    if message is None or account is None:
        raise ValueError("Missing source message or connected account")

    # Dev seed accounts have no real Gmail token; record a stub id so the approval
    # flow can be exercised end to end without Google. Real accounts hit Gmail.
    if account.scopes == ["seed"]:
        draft.gmail_draft_id = f"seed-draft-{draft.id}"
        return

    token = decrypt_token(account.token_ciphertext)
    gmail_draft_id = gmail.create_draft(
        token,
        to=message.sender,
        subject=draft.subject or f"Re: {message.subject or ''}".strip(),
        body=draft.body,
        thread_id=message.thread_id,
    )
    draft.gmail_draft_id = gmail_draft_id


def _execute_create_task(db: Session, proposal: ActionProposal, user: User) -> None:
    """Create a task from an approved proposal (level 2 reversible write)."""
    title = proposal.target.get("title")
    if not title:
        raise ValueError("create_task proposal has no title")
    task_service.create_task(
        db,
        user.id,
        title=str(title),
        description=proposal.target.get("description"),
        source_type=SourceType.gmail,
        source_id=proposal.target.get("source_id"),
        confidence=proposal.target.get("confidence"),
    )
