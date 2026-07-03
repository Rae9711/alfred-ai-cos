"""Tests for SMS body normalization."""

from app.services.sms_body import normalize_sms_body_text


def test_normalize_sms_body_extracts_text_from_json_string() -> None:
    raw = (
        '{"body":"Ray, what did you dream about?",'
        '"text":"Ray, what did you dream about?",'
        '"shortcut_input":"Ray, what did you dream about?"}'
    )
    assert normalize_sms_body_text(raw) == "Ray, what did you dream about?"


def test_normalize_sms_body_leaves_plain_text() -> None:
    assert normalize_sms_body_text("Hello there") == "Hello there"
