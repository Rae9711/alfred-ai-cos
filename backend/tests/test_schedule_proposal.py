"""Schedule proposal extraction, today dashboard, and accept flow."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from app.db.enums import Provider, ScheduleProposalStatus
from app.db.models import CalendarEvent, ConnectedAccount, Message, ScheduleProposal, User
from app.schemas.llm import ExtractedScheduleProposal
from app.services import extraction, schedule_proposal as schedule_service
from app.services.today import build_today
from tests.fakes import FakeLLM


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="leo@example.com", timezone="America/Los_Angeles")
    db.add(u)
    db.commit()
    return u


def _message(user_id: str) -> Message:
    return Message(
        user_id=user_id,
        external_id="charlie-breakfast",
        sender="Charlie <charlie@example.com>",
        recipients=["leo@example.com"],
        subject="Breakfast tomorrow",
        sent_at=datetime(2026, 6, 29, 18, 0, tzinfo=UTC),
        sender_classification="person",
    )


def _proposal_extract() -> ExtractedScheduleProposal:
    start = datetime(2026, 6, 30, 8, 0, tzinfo=timezone(timedelta(hours=-7)))
    end = start + timedelta(hours=1)
    return ExtractedScheduleProposal(
        title="Breakfast with Charlie",
        start=start.isoformat(),
        end=end.isoformat(),
        timezone="America/Los_Angeles",
        location="the restaurant",
        participants=["Charlie"],
        confidence=0.92,
    )


def _patch_llm(monkeypatch: pytest.MonkeyPatch, fake: FakeLLM) -> None:
    monkeypatch.setattr(extraction, "get_llm", lambda: fake)
    monkeypatch.setattr(schedule_service, "get_llm", lambda: fake)


def test_classification_schedule_candidate_triggers_extraction(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeLLM(schedule_candidate=True, schedule_proposal=_proposal_extract())
    _patch_llm(monkeypatch, fake)
    msg = _message(user.id)
    db.add(msg)
    db.flush()

    extraction.process_message(
        db,
        msg,
        body="Leo, let's have breakfast at the restaurant tomorrow at 8am",
    )

    row = db.query(ScheduleProposal).one()
    assert row.title == "Breakfast with Charlie"
    assert row.status == ScheduleProposalStatus.pending
    assert row.source_message_id == msg.id


def test_schedule_candidate_false_skips_extraction(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch, FakeLLM(schedule_candidate=False))
    msg = _message(user.id)
    db.add(msg)
    db.flush()
    extraction.process_message(db, msg, body="Thanks for the update.")
    assert db.query(ScheduleProposal).count() == 0


def test_dedup_against_existing_calendar_event(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    start = datetime(2026, 6, 30, 8, 0, tzinfo=timezone(timedelta(hours=-7)))
    db.add(
        CalendarEvent(
            user_id=user.id,
            external_id="gcal-1",
            title="Breakfast with Charlie",
            start_time=start,
            end_time=start + timedelta(hours=1),
        )
    )
    db.commit()

    fake = FakeLLM(schedule_candidate=True, schedule_proposal=_proposal_extract())
    _patch_llm(monkeypatch, fake)
    msg = _message(user.id)
    db.add(msg)
    db.flush()
    extraction.process_message(db, msg, body="breakfast tomorrow 8am")
    assert db.query(ScheduleProposal).count() == 0


def test_build_today_includes_pending_proposals(db: Session, user: User) -> None:
    msg = _message(user.id)
    db.add(msg)
    db.flush()
    start = datetime(2026, 6, 30, 8, 0, tzinfo=timezone(timedelta(hours=-7)))
    db.add(
        ScheduleProposal(
            user_id=user.id,
            source_message_id=msg.id,
            title="Breakfast with Charlie",
            start_time=start,
            end_time=start + timedelta(hours=1),
            timezone="America/Los_Angeles",
            location="the restaurant",
            participants=["Charlie"],
            confidence=0.9,
        )
    )
    db.commit()

    dashboard = build_today(db, user.id, today=datetime(2026, 6, 29, tzinfo=UTC).date())
    assert len(dashboard.schedule_proposals) == 1
    assert dashboard.schedule_proposals[0].counterparty == "Charlie"
    assert dashboard.schedule_proposals[0].title == "Breakfast with Charlie"


def test_accept_proposal_books_calendar(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = ConnectedAccount(
        user_id=user.id,
        provider=Provider.google,
        provider_account_email=user.email,
        token_ciphertext="encrypted",
    )
    db.add(account)
    msg = _message(user.id)
    db.add(msg)
    db.flush()
    start = datetime(2026, 6, 30, 8, 0, tzinfo=timezone(timedelta(hours=-7)))
    proposal = ScheduleProposal(
        user_id=user.id,
        source_message_id=msg.id,
        title="Breakfast with Charlie",
        start_time=start,
        end_time=start + timedelta(hours=1),
        timezone="America/Los_Angeles",
        participants=["Charlie"],
        confidence=0.9,
    )
    db.add(proposal)
    db.commit()

    booked = CalendarEvent(
        user_id=user.id,
        external_id="evt-charlie",
        title="Breakfast with Charlie",
        start_time=start,
        end_time=start + timedelta(hours=1),
    )

    def _book(*_args, **_kwargs):
        db.add(booked)
        db.flush()
        return booked

    monkeypatch.setattr("app.services.calendar.book_event", _book)

    accepted, detail = schedule_service.accept_proposal(db, user, proposal.id)
    assert accepted.status == ScheduleProposalStatus.accepted
    assert accepted.calendar_event_id == booked.id
    assert "Breakfast" in detail
