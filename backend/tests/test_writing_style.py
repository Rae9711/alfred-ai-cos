"""Tests for writing-style extraction and draft prompt injection."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.models import User
from app.services import writing_style
from app.services.draft_revision import build_draft_user_content


def test_extract_writing_style_casual_short() -> None:
    bodies = [
        "Hey!\n\nSounds good — let's do Tuesday.\n\nThanks!",
        "Hey there,\n\nYep, works for me.\n\nCheers",
    ]
    style = writing_style.extract_writing_style_from_bodies(bodies)
    assert style["greeting"].lower().startswith("hey")
    assert style["tone"] == "casual"
    assert style["length"] == "short"
    assert style["emoji_usage"] == "rare"


def test_extract_writing_style_professional() -> None:
    bodies = [
        "Dear team,\n\nPlease find the attached report for your review.\n\nBest regards,\nAlex",
    ]
    style = writing_style.extract_writing_style_from_bodies(bodies)
    assert style["tone"] == "professional"
    assert "Dear" in style["greeting"]


def test_format_writing_style_prompt() -> None:
    prompt = writing_style.format_writing_style_prompt(
        {
            "greeting": "Hi",
            "tone": "casual",
            "length": "short",
            "avg_length_chars": 80,
            "emoji_usage": "rare",
            "sample_phrases": ["Sounds good"],
        }
    )
    assert prompt is not None
    assert "Write like this user" in prompt
    assert "casual" in prompt


def test_build_draft_user_content_includes_style() -> None:
    content = build_draft_user_content(
        thread_context="From: boss\nSubject: Update",
        tone="concise",
        user_name="Rae",
        writing_style_prompt="Write like this user:\n- Tone: casual",
    )
    assert "Write like this user" in content


def test_refresh_writing_style_persists(db: Session) -> None:
    user = User(email="style@example.com")
    db.add(user)
    db.commit()

    bodies = ["Hi!\n\nThanks for the note.\n\nCheers"]
    style = writing_style.refresh_writing_style(db, user, bodies=bodies)
    assert style is not None
    db.refresh(user)
    stored = writing_style.get_writing_style(user)
    assert stored is not None
    assert stored["tone"] in ("casual", "neutral")


def test_incorporate_sent_reply_merges_phrases(db: Session) -> None:
    user = User(
        email="sent@example.com",
        preferences={
            "writing_style": {
                "greeting": "Hi",
                "tone": "casual",
                "sample_phrases": ["Thanks"],
                "updated_at": datetime.now(UTC).isoformat(),
            }
        },
    )
    db.add(user)
    db.commit()

    writing_style.incorporate_sent_reply(
        db, user, "Hey!\n\nAbsolutely — I'll send it over today.\n\nBest"
    )
    db.refresh(user)
    phrases = writing_style.get_writing_style(user)["sample_phrases"]
    assert any("Absolutely" in p or "Hey" in p for p in phrases)


def test_should_refresh_after_week() -> None:
    user = User(
        email="old@example.com",
        preferences={
            "writing_style": {
                "updated_at": (datetime.now(UTC) - timedelta(days=8)).isoformat(),
            }
        },
    )
    assert writing_style.should_refresh_writing_style(user)
