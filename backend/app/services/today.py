"""Today builder (PRD 10.1, 19.1 GET /api/v1/today).

Assembles the Today dashboard from scored commitments: top priorities, people
waiting on the user, what the user is waiting on, and upcoming meetings that need
preparation."""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import CommitmentOwner, CommitmentStatus, Priority
from app.db.models import Commitment, Message, User
from app.schemas.today import (
    MeetingToPrepare,
    ScheduleProposalOut,
    TodayDashboard,
    TodayPriority,
    WaitingItem,
)
from app.services.meeting_prep import upcoming_events
from app.services.planning import build_planning_suggestions
from app.services.priority import build_context, score_commitment
from app.services.schedule_proposal import list_pending_proposals


def build_today(db: Session, user_id: str, *, today: date) -> TodayDashboard:
    open_commitments = list(
        db.scalars(
            select(Commitment).where(
                Commitment.user_id == user_id,
                Commitment.status == CommitmentStatus.open,
            )
        )
    )
    # Build the per-user ranking context once, then score every commitment against
    # it. The context captures VIP/stranger/engagement/dismissal/thread signals so
    # the truly important items rise to the top, not just the ones with deadlines.
    user = db.get(User, user_id)
    context = build_context(db, user) if user is not None else None
    scored = sorted(
        (score_commitment(c, today=today, context=context) for c in open_commitments),
        key=lambda s: s.score,
        reverse=True,
    )

    top = [
        TodayPriority(
            id=s.commitment.id,
            title=s.commitment.description,
            priority=s.priority,
            reason=s.reason,
            due_date=s.commitment.due_date,
            counterparty=s.commitment.counterparty,
            confidence=s.commitment.confidence,
        )
        for s in scored
        if s.priority not in (Priority.noise,)
    ][:5]

    # "Waiting" buckets are about real people; automated/marketing senders are excluded
    # (their tasks can still appear in top_priorities).
    waiting_on_user = [
        WaitingItem(
            id=s.commitment.id,
            description=s.commitment.description,
            person=s.commitment.counterparty,
        )
        for s in scored
        if s.commitment.owner == CommitmentOwner.user
        and s.commitment.counterparty
        and not s.commitment.from_automated
    ]
    user_waiting_on = [
        WaitingItem(
            id=s.commitment.id,
            description=s.commitment.description,
            person=s.commitment.counterparty,
        )
        for s in scored
        if s.commitment.owner == CommitmentOwner.counterparty
        and s.commitment.counterparty
        and not s.commitment.from_automated
    ]

    meetings = [
        MeetingToPrepare(
            id=event.id,
            title=event.title,
            start_time=event.start_time.isoformat() if event.start_time else None,
        )
        for event in upcoming_events(db, user_id, within_hours=48)
        if event.prep_required
    ]

    suggestions, quick_wins = build_planning_suggestions(
        db, user_id, today=today, scored=scored
    )

    pending_schedule = list_pending_proposals(db, user_id, limit=5)
    message_ids = {p.source_message_id for p in pending_schedule}
    senders_by_msg: dict[str, str] = {}
    if message_ids:
        for msg in db.scalars(select(Message).where(Message.id.in_(message_ids))):
            senders_by_msg[msg.id] = (msg.sender or "").split("<")[0].strip() or msg.sender

    schedule_proposals = [
        ScheduleProposalOut(
            id=p.id,
            source_message_id=p.source_message_id,
            title=p.title,
            start_time=p.start_time.isoformat(),
            end_time=p.end_time.isoformat(),
            timezone=p.timezone,
            location=p.location,
            participants=p.participants,
            confidence=p.confidence,
            counterparty=senders_by_msg.get(p.source_message_id),
        )
        for p in pending_schedule
    ]

    summary = (
        f"You have {len(open_commitments)} open loop(s). "
        f"{len(top)} matter today. {len(waiting_on_user)} people are waiting on you. "
        f"{len(meetings)} meeting(s) need prep."
    )
    return TodayDashboard(
        summary=summary,
        top_priorities=top,
        people_waiting_on_you=waiting_on_user,
        you_are_waiting_on=user_waiting_on,
        meetings_to_prepare=meetings,
        suggestions=suggestions,
        quick_wins=quick_wins,
        schedule_proposals=schedule_proposals,
    )
