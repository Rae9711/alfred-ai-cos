"""Tests for Gmail body extraction (plain + HTML)."""

from app.services.gmail import _extract_body, _html_to_text


def test_html_to_text_strips_tags() -> None:
    html = "<p>Step 1: do A</p><p>Step 2: do <b>B</b></p>"
    text = _html_to_text(html)
    assert "Step 1" in text
    assert "Step 2" in text
    assert "B" in text
    assert "<p>" not in text


def test_extract_body_prefers_plain() -> None:
    payload = {
        "mimeType": "multipart/alternative",
        "parts": [
            {
                "mimeType": "text/plain",
                "body": {"data": "aGVsbG8="},  # hello
            },
            {
                "mimeType": "text/html",
                "body": {"data": "PGgxPmh0bWw8L2gxPg=="},  # <h1>html</h1>
            },
        ],
    }
    assert _extract_body(payload) == "hello"


def test_extract_body_falls_back_to_html() -> None:
    payload = {
        "mimeType": "multipart/alternative",
        "parts": [
            {
                "mimeType": "text/html",
                "body": {"data": "PHA+U3RlcCAxPC9wPg=="},  # <p>Step 1</p>
            },
        ],
    }
    assert "Step 1" in _extract_body(payload)


def test_extract_body_skips_empty_plain_part() -> None:
    payload = {
        "mimeType": "multipart/alternative",
        "parts": [
            {
                "mimeType": "text/plain",
                "body": {"data": "ICA="},  # whitespace only
            },
            {
                "mimeType": "text/html",
                "body": {"data": "PHA+UGF5IG5vdy48L3A+"},  # <p>Pay now.</p>
            },
        ],
    }
    assert "Pay now" in _extract_body(payload)
