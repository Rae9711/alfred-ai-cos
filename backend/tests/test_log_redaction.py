"""Log redaction: sensitive shapes never reach a log sink or a scrubbed structure."""

from __future__ import annotations

import logging

from app.core.redaction import (
    RedactionFilter,
    redact_structure,
    redact_text,
    sentry_before_send,
    structlog_redact_processor,
)


def test_redact_text_scrubs_email_phone_and_token() -> None:
    scrubbed = redact_text(
        "mail alice@example.com phone +1 (555) 123-4567 auth Bearer sk-abc123def456ghi789xyz"
    )
    assert "alice@example.com" not in scrubbed
    assert "555" not in scrubbed
    assert "sk-abc123def456ghi789xyz" not in scrubbed
    assert "Bearer [redacted]" in scrubbed


def test_redact_text_scrubs_jwt() -> None:
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0"
    assert jwt not in redact_text(f"token={jwt}")


def test_redact_structure_drops_sensitive_keys() -> None:
    redacted = redact_structure(
        {"to": "a@b.com", "subject": "hi", "nested": {"body": "secret text"}, "ok": "v"}
    )
    assert redacted["to"] == "[redacted]"
    assert redacted["nested"]["body"] == "[redacted]"
    assert redacted["ok"] == "v"


def test_structlog_processor_redacts_message_and_bound_body() -> None:
    event = structlog_redact_processor(
        None,
        "info",
        {"event": "reply to bob@example.com", "body": "private note"},
    )
    assert "bob@example.com" not in event["event"]
    assert event["body"] == "[redacted]"


def test_logging_filter_scrubs_record_message() -> None:
    record = logging.LogRecord(
        name="t",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg="SMS from %s body=%s",
        args=("+15551234567", "meet at carol@example.com"),
        exc_info=None,
    )
    assert RedactionFilter().filter(record) is True
    rendered = record.getMessage()
    assert "carol@example.com" not in rendered
    assert "5551234567" not in rendered


def test_sentry_before_send_scrubs_logentry_and_exception() -> None:
    event = sentry_before_send(
        {
            "logentry": {"message": "failed for dave@example.com"},
            "exception": {"values": [{"value": "token Bearer sk-secretsecretsecret123456"}]},
        },
        {},
    )
    assert "dave@example.com" not in event["logentry"]["message"]
    assert "sk-secretsecretsecret123456" not in event["exception"]["values"][0]["value"]
