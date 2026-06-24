"""New-mail background sync and push notifications."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.db.enums import MessageClassification, NotificationType
from app.db.models import Device, Message, User
from app.services.ingestion import SyncIngestResult
from app.services import mail_sync
from app.services.mail_sync import notify_new_mail, sync_user_and_notify


class _StubNotifier:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    def send(self, *, push_token: str, title: str, body: str, data: dict) -> None:
        self.sent.append(
            {"push_token": push_token, "title": title, "body": body, "data": data}
        )


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
