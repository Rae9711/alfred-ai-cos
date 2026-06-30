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
    ScheduleConflictOut,
    ScheduleProposalOut,
    TodayDashboard,
    TodayPriority,
    WaitingItem,
)
from app.services.meeting_prep import today_events, upcoming_events
from app.services.planning import build_planning_suggestions
from app.services.priority import build_context, score_commitment
from app.services.schedule_proposal import find_proposal_conflicts, list_pending_proposals


def build_day_overview(
    *,
    meeting_count: int,
    pending_proposals: list[tuple[str, str]],
    locale: str = "en",
) -> str | None:
    """One-line Today summary for the butler block, e.g. '今天 3 个会，1 个待确认约会'."""
    if meeting_count == 0 and not pending_proposals:
        return None
    if locale == "zh":
        parts: list[str] = []
        if meeting_count > 0:
            parts.append(f"今天 {meeting_count} 个会")
        if pending_proposals:
            who, title = pending_proposals[0]
            label = f"{who} {title}" if who else title
            n = len(pending_proposals)
            if n == 1:
                parts.append(f"1 个待确认约会（{label}）")
            else:
                parts.append(f"{n} 个待确认约会（{label} 等）")
        return "，".join(parts) + "。"
    parts_en: list[str] = []
    if meeting_count > 0:
        parts_en.append(
            f"{meeting_count} meeting{'s' if meeting_count != 1 else ''} today"
        )
    if pending_proposals:
        who, title = pending_proposals[0]
        label = f"{who}: {title}" if who else title
        n = len(pending_proposals)
        if n == 1:
            parts_en.append(f"1 pending invite ({label})")
        else:
            parts_en.append(f"{n} pending invites ({label}, …)")
    return ", ".join(parts_en) + "."


def build_today(
    db: Session, user_id: str, *, today: date, locale: str = "en"
) -> TodayDashboard:
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
            conflicts=[
                ScheduleConflictOut(event_id=eid, title=etitle)
                for eid, etitle in find_proposal_conflicts(
                    db, user_id, start=p.start_time, end=p.end_time
                )
            ],
        )
        for p in pending_schedule
    ]

    proposal_labels = [
        (senders_by_msg.get(p.source_message_id) or "", p.title) for p in pending_schedule
    ]
    day_overview = build_day_overview(
        meeting_count=len(today_events(db, user_id, timezone=user.timezone if user else None)),
        pending_proposals=proposal_labels,
        locale=locale,
    )

    summary = (
        f"You have {len(open_commitments)} open loop(s). "
        f"{len(top)} matter today. {len(waiting_on_user)} people are waiting on you. "
        f"{len(meetings)} meeting(s) need prep."
    )
    return TodayDashboard(
        summary=summary,
        day_overview=day_overview,
        top_priorities=top,
        people_waiting_on_you=waiting_on_user,
        you_are_waiting_on=user_waiting_on,
        meetings_to_prepare=meetings,
        suggestions=suggestions,
        quick_wins=quick_wins,
        schedule_proposals=schedule_proposals,
    )
