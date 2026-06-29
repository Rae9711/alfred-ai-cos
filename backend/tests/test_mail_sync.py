"""New-mail background sync and push notifications."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.db.enums import MessageClassification, NotificationType
from app.db.models import Device, Message, User
from app.services import mail_sync
from app.services.ingestion import SyncIngestResult
from app.services.mail_sync import (
    classify_pending_messages_sync,
    notify_new_mail,
    run_mail_sync,
    sync_user_and_notify,
)


class _StubNotifier:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    def send(self, *, push_token: str, title: str, body: str, data: dict) -> None:
        self.sent.append({"push_token": push_token, "title": title, "body": body, "data": data})


@pytest.fixture
def user(db: Session) -> User:
    user = User(email="me@example.com", preferences={"proactiveness": "balanced"})
    db.add(user)
    db.commit()
    return user


def _message(user_id: str, *, ext: str) -> Message:
    return Message(
        user_id=user_id,
        source="gmail",
        external_id=ext,
        sender="Ray <ray@example.com>",
        recipients=[],
        subject="Hello",
        classification=MessageClassification.needs_reply,
    )


def test_notify_new_mail_sends_push(db: Session, user: User) -> None:
    db.add(Device(user_id=user.id, push_token="ExponentPushToken[test]", platform="ios"))
    msg = _message(user.id, ext="m1")
    db.add(msg)
    db.commit()

    notifier = _StubNotifier()
    assert notify_new_mail(db, user, [msg], provider=notifier) is True
    assert len(notifier.sent) == 1
    assert notifier.sent[0]["data"]["type"] == NotificationType.new_mail.value


def test_sync_user_and_notify_skips_initial_backfill(db: Session, user: User, monkeypatch) -> None:
    def fake_run(_db, _uid):
        msg = _message(user.id, ext="m2")
        return (SyncIngestResult(new_messages=[msg], initial_backfill=True), 1, 0)

    monkeypatch.setattr(mail_sync, "run_mail_sync", fake_run)
    notifier = _StubNotifier()
    stats = sync_user_and_notify(db, user, provider=notifier, notify=True)
    assert stats["pushed"] == 0
    assert notifier.sent == []


def test_ingest_only_classifies_pending_messages(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    pending = Message(
        user_id=user.id,
        source="gmail",
        external_id="pending-1",
        sender="friend@example.com",
        recipients=[],
        subject="Please reply",
        snippet="Need your answer",
        classification=None,
        sender_classification="person",
        gmail_labels=["INBOX", "CATEGORY_PERSONAL"],
    )
    db.add(pending)
    db.commit()

    monkeypatch.setattr(
        mail_sync.ingestion,
        "sync_messages",
        lambda _db, _uid, incremental=True: SyncIngestResult(
            new_messages=[], initial_backfill=False
        ),
    )
    monkeypatch.setattr(
        mail_sync.extraction,
        "process_message",
        lambda _db, message, body=None, **_: (
            setattr(message, "classification", MessageClassification.needs_reply) or []
        ),
    )

    result, processed, commitments = run_mail_sync(db, user.id, ingest_only=True)
    assert result.new_messages == []
    assert processed == 1
    assert commitments == 0
    assert pending.classification == MessageClassification.needs_reply


def test_classify_pending_messages_sync_respects_limit(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    for i in range(3):
        db.add(
            Message(
                user_id=user.id,
                source="gmail",
                external_id=f"pending-{i}",
                sender="friend@example.com",
                recipients=[],
                subject=f"Mail {i}",
                classification=None,
                sender_classification="person",
                gmail_labels=["INBOX", "CATEGORY_PERSONAL"],
            )
        )
    db.commit()

    calls: list[str] = []

    def track(_db, message, body=None, **_):
        calls.append(message.external_id)
        message.classification = MessageClassification.needs_reply
        return []

    monkeypatch.setattr(mail_sync.extraction, "process_message", track)
    processed = classify_pending_messages_sync(db, user.id, limit=2)
    assert processed == 2
    assert len(calls) == 2
