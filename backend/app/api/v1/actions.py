"""Action approval spine (PRD 12.10, 17, 19.1).

Every action that touches the outside world exists as an ActionProposal and runs
through app.services.execution, which enforces approval-by-risk, spend limits, and
audit logging. Routes here propose, approve, and reject; the execution service
decides and acts via the capability registry.

The original draft-to-Gmail endpoint is kept as a convenience wrapper over the
generic propose endpoint so existing clients and tests keep working."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import CursorResult, select, update
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.enums import ActionStatus, ActionType
from app.db.models import ActionProposal, DraftReply, User
from app.schemas.api import ActionProposalOut, ProposeActionRequest
from app.services import execution
from app.services.actions import propose_action_internal

router = APIRouter(prefix="/actions", tags=["actions"])


def _propose(
    db: Session,
    user: User,
    *,
    action_type: ActionType,
    target: dict[str, Any],
    reason: str | None = None,
    proposed_content: str | None = None,
) -> ActionProposal:
    # Delegates to the service so every proposal (route or assistant) shares one path.
    return propose_action_internal(
        db,
        user,
        action_type=action_type,
        target=target,
        reason=reason,
        proposed_content=proposed_content,
    )


@router.post("", response_model=ActionProposalOut)
def propose_action(
    payload: ProposeActionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ActionProposal:
    """Generic proposal entry point for any registered capability."""
    return _propose(
        db,
        user,
        action_type=payload.action_type,
        target=payload.target,
        reason=payload.reason,
    )


@router.post("/propose-draft-to-gmail/{draft_id}", response_model=ActionProposalOut)
def propose_push_draft(
    draft_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ActionProposal:
    """Convenience wrapper: propose pushing a stored draft into Gmail (level 3)."""
    draft = db.get(DraftReply, draft_id)
    if draft is None or draft.user_id != user.id:
        raise HTTPException(status_code=404, detail="Draft not found")
    return _propose(
        db,
        user,
        action_type=ActionType.create_draft,
        target={"draft_reply_id": draft.id},
        proposed_content=draft.body,
        reason="Push the prepared reply into your Gmail drafts for review before sending.",
    )


@router.post("/propose-send-draft/{draft_id}", response_model=ActionProposalOut)
def propose_send_draft(
    draft_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ActionProposal:
    """Convenience wrapper: propose SENDING a stored draft via Gmail (level 3, gmail.send).
    The proposal is approval-gated by the execution spine like every level-3 action."""
    draft = db.get(DraftReply, draft_id)
    if draft is None or draft.user_id != user.id:
        raise HTTPException(status_code=404, detail="Draft not found")
    return _propose(
        db,
        user,
        action_type=ActionType.send_email,
        target={"draft_reply_id": draft.id},
        proposed_content=draft.body,
        reason="Send this reply from your Gmail account.",
    )


@router.get("/pending", response_model=list[ActionProposalOut])
def list_pending(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ActionProposal]:
    """Proposals awaiting the user's decision (PRD 10.6 approval queue)."""
    return list(
        db.scalars(
            select(ActionProposal)
            .where(
                ActionProposal.user_id == user.id,
                ActionProposal.status == ActionStatus.proposed,
            )
            .order_by(ActionProposal.created_at.desc())
        )
    )


@router.post("/{action_id}/approve", response_model=ActionProposalOut)
def approve_action(
    action_id: str,
    confirm: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ActionProposal:
    """Approve and execute. Level 4-5 actions require ?confirm=true (strong confirmation)."""
    proposal = _owned_proposal(db, action_id, user.id)
    if proposal.status != ActionStatus.proposed:
        raise HTTPException(status_code=409, detail=f"Action already {proposal.status.value}")

    if execution.requires_strong_confirmation(proposal.risk_level) and not confirm:
        raise HTTPException(
            status_code=428,
            detail="This action needs strong confirmation. Re-send with confirm=true.",
        )

    # Atomically claim the proposal: only the request that flips proposed -> approved
    # proceeds. Concurrent approvals update zero rows and get 409, so a single proposal
    # is never executed twice (no double charge). (BLOCKER-4)
    claimed = db.execute(
        update(ActionProposal)
        .where(
            ActionProposal.id == proposal.id,
            ActionProposal.status == ActionStatus.proposed,
        )
        .values(status=ActionStatus.approved, approved_at=datetime.now(UTC))
    )
    db.commit()
    if cast("CursorResult[Any]", claimed).rowcount != 1:
        raise HTTPException(status_code=409, detail="Action already being processed")
    db.refresh(proposal)

    try:
        execution.execute_proposal(db, user, proposal)
    except execution.ExecutionBlocked as exc:
        raise HTTPException(status_code=502, detail=f"Execution failed: {exc}") from exc
    except Exception as exc:
        # Gmail/LLM/network errors are audited as failed proposals; return 502 not 500.
        raise HTTPException(status_code=502, detail=f"Execution failed: {exc}") from exc
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
