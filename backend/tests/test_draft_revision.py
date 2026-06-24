"""Tests for cumulative draft revision prompts."""

from app.services.draft_revision import build_draft_user_content, format_revision_notes


def test_format_revision_notes_merges_history_and_latest() -> None:
    notes = format_revision_notes(
        ["shorter", "mention Tuesday"],
        "sound warmer",
    )
    assert notes == "1. shorter\n2. mention Tuesday\n3. sound warmer"


def test_build_draft_user_content_revision_includes_all_notes() -> None:
    content = build_draft_user_content(
        thread_context="Subject: Hi\n\nPlease send the doc.",
        tone="concise",
        user_name="Rae",
        instruction="sound warmer",
        current_draft="Hi — I'll send it soon.",
        revision_history=["shorter", "mention Tuesday"],
    )
    assert "apply ALL of them" in content
    assert "1. shorter" in content
    assert "2. mention Tuesday" in content
    assert "3. sound warmer" in content
    assert "Current draft:" in content
    assert "Hi — I'll send it soon." in content
    assert "Original email:" in content


def test_build_draft_user_content_initial_draft_unchanged() -> None:
    content = build_draft_user_content(
        thread_context="Subject: Hi\n\nBody",
        tone="concise",
        user_name=None,
        instruction="keep it brief",
    )
    assert "Current draft:" not in content
    assert "User instruction: keep it brief" in content
