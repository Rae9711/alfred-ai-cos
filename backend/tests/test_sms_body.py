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


def test_normalize_sms_body_empty_json_payload_returns_empty() -> None:
    # A broken iOS Shortcut posts the dictionary with all fields empty. Returning the
    # raw JSON would surface literal braces as the message body; it must resolve to "".
    raw = '{"body":"","text":"","shortcut_input":""}'
    assert normalize_sms_body_text(raw) == ""


def test_normalize_sms_body_nested_empty_json_returns_empty() -> None:
    raw = '{"body":"{\\"body\\":\\"\\",\\"text\\":\\"\\"}"}'
    assert normalize_sms_body_text(raw) == ""
