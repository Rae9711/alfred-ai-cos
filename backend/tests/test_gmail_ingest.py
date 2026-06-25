"""Tests for Gmail ingest eligibility."""

from app.services.gmail import should_ingest_inbox_message


def test_ingest_uncategorized_inbox_unread() -> None:
    assert should_ingest_inbox_message(["INBOX", "UNREAD"]) is True


def test_ingest_primary_tab() -> None:
    assert should_ingest_inbox_message(["INBOX", "CATEGORY_PERSONAL", "UNREAD"]) is True


def test_skip_promotions() -> None:
    assert should_ingest_inbox_message(["INBOX", "CATEGORY_PROMOTIONS", "UNREAD"]) is False


def test_skip_non_inbox() -> None:
    assert should_ingest_inbox_message(["SENT"]) is False
