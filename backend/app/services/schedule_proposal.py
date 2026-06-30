"""Schedule proposal extraction and lifecycle."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import ActionType, ScheduleProposalStatus
from app.db.models import CalendarEvent, Message, ScheduleProposal, User
from app.llm import get_llm
from app.schemas.llm import ClassificationResult, ExtractedScheduleProposal
from app.services import execution
from app.services.actions import propose_action_internal


def _parse_iso(ts: str) -> datetime:
    dt = datetime.fromisoformat(ts)
    if dt.tzinfo is None:
        raise ValueError(f"datetime must include timezone: {ts}")
    return dt


def _title_matches(existing: str | None, proposed: str) -> bool:
    if not existing:
        return False
    a = existing.strip().lower()
    b = proposed.strip().lower()
    return a == b or a in b or b in a


def _overlaps_existing_event(
    db: Session, user_id: str, *, start: datetime, title: str
) -> bool:
    window = timedelta(minutes=15)
    events = db.scalars(
        select(CalendarEvent).where(
            CalendarEvent.user_id == user_id,
            CalendarEvent.start_time.is_not(None),
            CalendarEvent.start_time >= start - window,
            CalendarEvent.start_time <= start + window,
        )
    )
    return any(_title_matches(e.title, title) for e in events)


def maybe_extract_schedule_proposal(
    db: Session,
    user: User,
    message: Message,
    *,
    body: str,
    classification: ClassificationResult,
    reference_date: date,
) -> ScheduleProposal | None:
    """Run structured schedule extraction when classification flagged a candidate."""
    if not classification.schedule_candidate:
        return None

    existing = db.scalar(
        select(ScheduleProposal).where(
            ScheduleProposal.user_id == user.id,
            ScheduleProposal.source_message_id == message.id,
            ScheduleProposal.status == ScheduleProposalStatus.pending,
        )
    )
    if existing is not None:
        return existing

    extracted = get_llm().extract_schedule_proposal(
        subject=message.subject,
        body=body,
        sender=message.sender,
        user_email=user.email,
        user_timezone=user.timezone or "UTC",
        reference_date=reference_date,
    )
    if extracted is None:
        return None

    start = _parse_iso(extracted.start)
    end = _parse_iso(extracted.end)
    if end <= start:
        end = start + timedelta(hours=1)

    if _overlaps_existing_event(db, user.id, start=start, title=extracted.title):
        return None

    proposal = ScheduleProposal(
        user_id=user.id,
        source_message_id=message.id,
        title=extracted.title,
        start_time=start,
        end_time=end,
        timezone=extracted.timezone,
        location=extracted.location,
        participants=extracted.participants,
        confidence=extracted.confidence,
        status=ScheduleProposalStatus.pending,
    )
    db.add(proposal)
    db.commit()
    return proposal


def list_pending_proposals(db: Session, user_id: str, *, limit: int = 5) -> list[ScheduleProposal]:
    return list(
        db.scalars(
            select(ScheduleProposal)
            .where(
                ScheduleProposal.user_id == user_id,
                ScheduleProposal.status == ScheduleProposalStatus.pending,
            )
            .order_by(ScheduleProposal.start_time.asc())
            .limit(limit)
        )
    )


def get_proposal(db: Session, user_id: str, proposal_id: str) -> ScheduleProposal:
    proposal = db.get(ScheduleProposal, proposal_id)
    if proposal is None or proposal.user_id != user_id:
        raise ValueError("Schedule proposal not found")
    return proposal


def dismiss_proposal(db: Session, user_id: str, proposal_id: str) -> ScheduleProposal:
    proposal = get_proposal(db, user_id, proposal_id)
    if proposal.status != ScheduleProposalStatus.pending:
        raise ValueError("Proposal is not pending")
    proposal.status = ScheduleProposalStatus.dismissed
    db.commit()
    return proposal


def accept_proposal(
    db: Session,
    user: User,
    proposal_id: str,
    *,
    timezone: str | None = None,
) -> tuple[ScheduleProposal, str]:
    """Book the proposal on the user's calendar via the audited capability spine."""
    from app.services.assistant import resolve_timezone

    proposal = get_proposal(db, user.id, proposal_id)
    if proposal.status != ScheduleProposalStatus.pending:
        raise ValueError("Proposal is not pending")

    resolve_timezone(db, user, timezone or proposal.timezone)
    target: dict[str, str] = {
        "title": proposal.title,
        "start": proposal.start_time.isoformat(),
        "end": proposal.end_time.isoformat(),
    }
    if proposal.location:
        target["location"] = proposal.location

    action = propose_action_internal(
        db,
        user,
        action_type=ActionType.create_calendar_event,
        target=target,
        reason=f"Added from email: {proposal.title}",
    )
    result = execution.execute_proposal(db, user, action)
    event_id = (result.data or {}).get("event_id") if result.data else None

    proposal.status = ScheduleProposalStatus.accepted
    proposal.calendar_event_id = str(event_id) if event_id else None
    db.commit()
    return proposal, result.detail
