"""Tests for meeting-prep email matching. Pure helper logic, no DB or LLM."""

from app.services.meeting_prep import _emails_in


def test_extracts_bare_email() -> None:
    assert _emails_in("celine@example.com") == {"celine@example.com"}


def test_extracts_email_from_display_name() -> None:
    assert _emails_in("Celine Kasparian <celine@example.com>") == {"celine@example.com"}


def test_lowercases() -> None:
    assert _emails_in("Celine@Example.COM") == {"celine@example.com"}


def test_multiple_emails() -> None:
    text = "from a@x.com to b@y.com and c@z.org"
    assert _emails_in(text) == {"a@x.com", "b@y.com", "c@z.org"}


def test_none_and_empty() -> None:
    assert _emails_in(None) == set()
    assert _emails_in("") == set()
    assert _emails_in("no emails here") == set()
