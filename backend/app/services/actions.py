"""Action proposal helper (PRD 12.10). Builds an ActionProposal for a registered
capability with the right approval policy for its risk level, and persists it. Both the
/actions route and other callers (e.g. the assistant) propose through here so every
action shares one audited path."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.capabilities import get_capability
from app.db.enums import ActionStatus, ActionType
from app.db.models import ActionProposal, ComposeDraft, DraftReply, Message, User
from app.services import execution
from app.services.inbox_view import message_is_handled


def propose_action_internal(
    db: Session,
    user: User,
    *,
    action_type: ActionType,
    target: dict[str, Any],
    reason: str | None = None,
    proposed_content: str | None = None,
) -> ActionProposal:
    """Create and persist an ActionProposal for `action_type`. Raises 400 if no
    capability is registered for it. The proposal's approval_required follows the
    capability's risk level."""
    provider = get_capability(action_type)
    if provider is None:
        raise HTTPException(status_code=400, detail=f"No capability for {action_type}")
    desc = provider.describe()
    policy = execution.approval_policy(desc.risk_level)
    proposal = ActionProposal(
        user_id=user.id,
        action_type=action_type,
        risk_level=desc.risk_level.value,
        target=target,
        proposed_content=proposed_content,
        reason=reason or desc.summary,
        approval_required=policy.approval_required,
        status=ActionStatus.proposed,
    )
    db.add(proposal)
    db.commit()
    return proposal


def proposal_is_actionable(db: Session, proposal: ActionProposal) -> bool:
    """False when a staged send/draft proposal can no longer be executed.

    Chase follow-ups and draft sends point at a DraftReply. If that draft (or its
    source message) is gone, or the message is already read/handled, the proposal
    should not stay in the home approval banner.
    """
    target = proposal.target or {}
    draft_id = target.get("draft_reply_id")
    if draft_id:
        draft = db.get(DraftReply, draft_id)
        if draft is None:
            return False
        message = db.get(Message, draft.message_id)
        if message is None or message_is_handled(message):
            return False
        return True

    compose_id = target.get("compose_draft_id")
    if compose_id:
        return db.get(ComposeDraft, compose_id) is not None

    # Calendar / task / other proposals without a draft target stay listed.
    return True


def list_pending_proposals(db: Session, user_id: str) -> list[ActionProposal]:
    """Pending approval queue, pruning orphans (missing/handled draft sources)."""
    waiting = list(
        db.scalars(
            select(ActionProposal)
            .where(
                ActionProposal.user_id == user_id,
                ActionProposal.status == ActionStatus.proposed,
            )
            .order_by(ActionProposal.created_at.desc())
        )
    )
    actionable: list[ActionProposal] = []
    rejected = 0
    for proposal in waiting:
        if proposal_is_actionable(db, proposal):
            actionable.append(proposal)
            continue
        proposal.status = ActionStatus.rejected
        rejected += 1
    if rejected:
        db.commit()
    return actionable


def reject_proposals_for_message(db: Session, user_id: str, message_id: str) -> int:
    """Reject pending draft/send proposals tied to a message the user has handled."""
    draft_ids = set(
        db.scalars(
            select(DraftReply.id).where(
                DraftReply.user_id == user_id,
                DraftReply.message_id == message_id,
            )
        )
    )
    if not draft_ids:
        return 0

    rejected = 0
    for proposal in db.scalars(
        select(ActionProposal).where(
            ActionProposal.user_id == user_id,
            ActionProposal.status == ActionStatus.proposed,
        )
    ):
        target = proposal.target or {}
        if target.get("draft_reply_id") in draft_ids:
            proposal.status = ActionStatus.rejected
            rejected += 1
    if rejected:
        db.commit()
    return rejected
