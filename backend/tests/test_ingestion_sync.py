"""Tests for Gmail sync policy: initial Primary backfill vs incremental history."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import MessageClassification, Provider, SyncStatus
from app.db.models import ConnectedAccount, Message, User
from app.services import gmail, ingestion
from app.services.crypto import encrypt_token
from app.services.gmail import HistoryExpiredError


@pytest.fixture(autouse=True)
def _patch_unread_sync(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gmail, "list_unread_primary_message_ids", lambda *_a, **_k: [])
    monkeypatch.setattr(gmail, "list_unread_inbox_message_ids", lambda *_a, **_k: [])
    monkeypatch.setattr(gmail, "list_recent_message_ids", lambda *_a, **_k: [])
    monkeypatch.setattr(
        gmail,
        "list_history_label_affected_message_ids",
        lambda *_a, **_k: (set(), "hist"),
    )


def _connect(db: Session, user: User, *, history_id: str | None = None) -> ConnectedAccount:
    account = ConnectedAccount(
        user_id=user.id,
        provider=Provider.google,
        provider_account_email=user.email,
        scopes=["gmail.readonly"],
        token_ciphertext=encrypt_token({"token": "t"}),
        sync_status=SyncStatus.never,
        gmail_history_id=history_id,
    )
    db.add(account)
    db.commit()
    return account


def _raw(mid: str) -> dict:
    return {
        "external_id": mid,
        "thread_id": "thread-1",
        "sender": "friend@example.com",
        "recipients": ["me@example.com"],
        "subject": "Hello",
        "snippet": "Please reply",
        "body": "Please reply when you can.",
        "internal_date_ms": str(int(datetime(2026, 6, 20, tzinfo=UTC).timestamp() * 1000)),
        "headers": {},
    }


@pytest.fixture
def user(db: Session) -> User:
    user = User(email="me@example.com")
    db.add(user)
    db.commit()
    return user


def test_initial_backfill_uses_primary_and_sets_history(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _connect(db, user, history_id=None)
    listed: list[int] = []

    def fake_list(token, *, max_results, inbox_tab):
        listed.extend([max_results, inbox_tab])
        return ["m1", "m2"]

    monkeypatch.setattr(gmail, "list_recent_message_ids", fake_list)
    monkeypatch.setattr(
        gmail,
        "get_message_label_ids",
        lambda _t, mid: ["INBOX", "CATEGORY_PERSONAL"],
    )
    monkeypatch.setattr(gmail, "get_message", lambda _t, mid: _raw(mid))
    monkeypatch.setattr(gmail, "get_history_id", lambda _t: "hist-99")

    result = ingestion.sync_messages(db, user.id)

    assert result.initial_backfill is True
    assert listed == [50, "primary"]
    assert len(result.new_messages) == 2
    account = db.scalar(select(ConnectedAccount).where(ConnectedAccount.user_id == user.id))
    assert account is not None
    assert account.gmail_history_id == "hist-99"
    assert account.sync_status == SyncStatus.ok


def test_incremental_uses_history_and_filters_primary(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _connect(db, user, history_id="hist-old")
    monkeypatch.setattr(
        gmail,
        "list_history_added_message_ids",
        lambda _t, start, label_id=None: (["m-new"], "hist-new"),
    )
    monkeypatch.setattr(
        gmail,
        "get_message_label_ids",
        lambda _t, mid: (
            ["INBOX", "CATEGORY_PERSONAL"]
            if mid == "m-new"
            else ["INBOX", "CATEGORY_PROMOTIONS"]
        ),
    )
    monkeypatch.setattr(gmail, "get_message", lambda _t, mid: _raw(mid))
    monkeypatch.setattr(gmail, "get_history_id", lambda _t: "hist-99")

    result = ingestion.sync_messages(db, user.id)

    assert result.initial_backfill is False
    assert len(result.new_messages) == 1
    assert result.new_messages[0].external_id == "m-new"


def test_incremental_history_expired_falls_back_to_recent_primary(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _connect(db, user, history_id="hist-old")

    def boom(*_a, **_k):
        raise HistoryExpiredError("gone")

    monkeypatch.setattr(gmail, "list_history_added_message_ids", boom)
    monkeypatch.setattr(
        gmail,
        "list_recent_message_ids",
        lambda _t, *, max_results, inbox_tab: ["m-fallback"],
    )
    monkeypatch.setattr(
        gmail,
        "get_message_label_ids",
        lambda _t, mid: ["INBOX", "CATEGORY_PERSONAL"],
    )
    monkeypatch.setattr(gmail, "get_message", lambda _t, mid: _raw(mid))
    monkeypatch.setattr(gmail, "get_history_id", lambda _t: "hist-fresh")

    result = ingestion.sync_messages(db, user.id)

    assert len(result.new_messages) == 1
    assert result.new_messages[0].external_id == "m-fallback"


def test_messages_to_process_includes_pending_unclassified(
    db: Session, user: User
) -> None:
    pending = Message(
        user_id=user.id,
        source="gmail",
        external_id="old-1",
        sender="a@b.com",
        recipients=[],
        subject="Pending",
        classification=None,
    )
    db.add(pending)
    db.commit()

    combined = ingestion.messages_to_process(db, user.id, [])
    assert len(combined) == 1
    assert combined[0].external_id == "old-1"


def test_incremental_sync_skips_catchup_and_unread(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _connect(db, user, history_id="hist-old")
    calls: list[str] = []

    monkeypatch.setattr(
        gmail,
        "list_history_added_message_ids",
        lambda _t, start, label_id=None: (["m-new"], "hist-new"),
    )
    monkeypatch.setattr(
        gmail,
        "get_message_label_ids",
        lambda _t, mid: ["INBOX", "CATEGORY_PERSONAL"],
    )
    monkeypatch.setattr(gmail, "get_message", lambda _t, mid: _raw(mid))
    monkeypatch.setattr(gmail, "get_history_id", lambda _t: "hist-99")

    def track_recent(*_a, **kwargs):
        calls.append("recent")
        return []

    def track_unread_inbox(*_a, **_k):
        calls.append("unread_inbox")
        return []

    monkeypatch.setattr(gmail, "list_recent_message_ids", track_recent)
    monkeypatch.setattr(gmail, "list_unread_inbox_message_ids", track_unread_inbox)

    result = ingestion.sync_messages(db, user.id, incremental=True)

    assert len(result.new_messages) == 1
    assert calls == ["recent"]


def test_deep_sync_runs_catchup_after_initial(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _connect(db, user, history_id="hist-old")
    listed: list[tuple[int, str]] = []

    monkeypatch.setattr(
        gmail,
        "list_history_added_message_ids",
        lambda _t, start, label_id=None: ([], "hist-new"),
    )
    monkeypatch.setattr(
        gmail,
        "list_history_label_affected_message_ids",
        lambda *_a, **_k: (set(), "hist-new"),
    )
    monkeypatch.setattr(gmail, "get_history_id", lambda _t: "hist-99")

    def track_recent(_t, *, max_results, inbox_tab):
        listed.append((max_results, inbox_tab))
        return []

    monkeypatch.setattr(gmail, "list_recent_message_ids", track_recent)
    monkeypatch.setattr(gmail, "list_unread_inbox_message_ids", lambda *_a, **_k: [])
    monkeypatch.setattr(gmail, "list_unread_primary_message_ids", lambda *_a, **_k: [])

    ingestion.sync_messages(db, user.id, incremental=False)

    assert listed == [(40, "primary")]


def test_sync_dedupes_existing_messages(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = _connect(db, user, history_id=None)
    db.add(
        Message(
            user_id=user.id,
            connected_account_id=account.id,
            source="gmail",
            external_id="m1",
            sender="a@b.com",
            recipients=[],
            subject="Existing",
            classification=MessageClassification.informational,
        )
    )
    db.commit()

    monkeypatch.setattr(gmail, "list_recent_message_ids", lambda *_a, **_k: ["m1", "m2"])
    monkeypatch.setattr(
        gmail,
        "get_message_label_ids",
        lambda _t, mid: ["INBOX", "CATEGORY_PERSONAL"],
    )
    monkeypatch.setattr(
        gmail,
        "get_message",
        lambda _t, mid: _raw(mid),
    )
    monkeypatch.setattr(gmail, "get_history_id", lambda _t: "hist-1")

    result = ingestion.sync_messages(db, user.id)
    assert [m.external_id for m in result.new_messages] == ["m2"]


def test_sync_skips_duplicate_ids_in_same_batch(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _connect(db, user, history_id=None)
    monkeypatch.setattr(
        gmail, "list_recent_message_ids", lambda *_a, **_k: ["m1", "m1", "m2"]
    )
    monkeypatch.setattr(
        gmail,
        "get_message_label_ids",
        lambda _t, mid: ["INBOX", "CATEGORY_PERSONAL"],
    )
    monkeypatch.setattr(gmail, "get_message", lambda _t, mid: _raw(mid))
    monkeypatch.setattr(gmail, "get_history_id", lambda _t: "hist-1")

    result = ingestion.sync_messages(db, user.id)
    assert [m.external_id for m in result.new_messages] == ["m1", "m2"]
    assert db.query(Message).count() == 2


def test_incremental_catchup_skips_messages_pending_in_session(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _connect(db, user, history_id="hist-old")
    monkeypatch.setattr(
        gmail,
        "list_history_added_message_ids",
        lambda _t, start, label_id=None: (["m-overlap"], "hist-new"),
    )

    def catchup(_t, *, max_results, inbox_tab):
        assert inbox_tab == "all"
        return ["m-overlap", "m-new"]

    monkeypatch.setattr(gmail, "list_recent_message_ids", catchup)
    monkeypatch.setattr(
        gmail,
        "get_message_label_ids",
        lambda _t, mid: ["INBOX", "CATEGORY_PERSONAL"],
    )
    monkeypatch.setattr(gmail, "get_message", lambda _t, mid: _raw(mid))
    monkeypatch.setattr(gmail, "get_history_id", lambda _t: "hist-99")

    result = ingestion.sync_messages(db, user.id, incremental=True)

    assert [m.external_id for m in result.new_messages] == ["m-overlap", "m-new"]
    assert db.query(Message).count() == 2
