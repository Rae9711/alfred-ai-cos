"""Single source of truth for stripping sensitive content before it leaves the process.

Two shapes of redaction live here so every sink (audit payloads, structured logs, the
stdlib logging bridge, and Sentry events) scrubs the same way:

  * ``redact_structure`` — key-based recursion over dict/list payloads. This is the
    original audit-log redactor (moved out of ``services.execution``); callers that
    hand us structured data with known-sensitive keys (``body``, ``token``, ``to`` …)
    use it so the *value* never has to be pattern-matched.
  * ``redact_text`` — regex scrubbing of free-form strings (log messages, exception
    text, Sentry ``logentry``) where we cannot know the keys, so we hunt for the
    shapes of secrets instead: emails, phone numbers, ``Bearer`` tokens, and long
    base64/JWT-ish blobs.

Everything is best-effort and must never raise into a logging path: a redactor that
throws would take down the very log line meant to record a failure.
"""

from __future__ import annotations

import logging
import re
from collections.abc import MutableMapping
from typing import Any

# Keys whose values are always sensitive regardless of content. Kept identical to the
# original audit redactor so ``services.execution`` behavior (and its tests) do not change.
_SENSITIVE_KEYS = {
    "body",
    "content",
    "card_number",
    "token",
    "message",
    "payment_method",
    "to",
    "description",
}

_PLACEHOLDER = "[redacted]"

# Free-text patterns. Ordered so the broadest token/JWT sweep runs last, after the more
# specific email/phone/bearer rules have claimed their spans.
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_BEARER_RE = re.compile(r"Bearer\s+[\w\-._~+/]+=*", re.IGNORECASE)
# Phone: optional +, then 7+ digits allowing spaces/dashes/dots/parens between groups.
_PHONE_RE = re.compile(r"(?<!\w)\+?\d[\d\s().-]{6,}\d(?!\w)")
# Long opaque blobs: JWTs (a.b.c) and any 20+ char base64url run — API keys, tokens.
_JWT_RE = re.compile(r"\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")
_LONG_TOKEN_RE = re.compile(r"\b[A-Za-z0-9_\-+/]{20,}={0,2}\b")


def redact_text(value: str) -> str:
    """Scrub email addresses, phone numbers, bearer tokens, and long token/JWT blobs."""
    if not value:
        return value
    value = _BEARER_RE.sub("Bearer [redacted]", value)
    value = _EMAIL_RE.sub(_PLACEHOLDER, value)
    value = _JWT_RE.sub(_PLACEHOLDER, value)
    value = _PHONE_RE.sub(_PLACEHOLDER, value)
    value = _LONG_TOKEN_RE.sub(_PLACEHOLDER, value)
    return value


def redact_structure(value: Any) -> Any:
    """Recursively redact by key: any ``_SENSITIVE_KEYS`` value becomes ``[redacted]``.

    This is the audit-payload redactor; it does not pattern-match values, so non-secret
    keys pass through untouched (callers that also want value scrubbing pair it with
    ``redact_text``)."""
    if isinstance(value, dict):
        return {
            k: _PLACEHOLDER if k in _SENSITIVE_KEYS else redact_structure(v)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [redact_structure(v) for v in value]
    return value


def _redact_event_value(value: Any) -> Any:
    """Scrub a value for structlog: strings via ``redact_text``, containers recursively,
    honoring the sensitive-key rule so bound context like ``body=`` is dropped too."""
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, dict):
        return {
            k: _PLACEHOLDER if k in _SENSITIVE_KEYS else _redact_event_value(v)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_redact_event_value(v) for v in value]
    return value


def structlog_redact_processor(
    _logger: Any, _method_name: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    """structlog processor: scrub every value in the event dict (Phase 1 logging)."""
    return {
        k: _PLACEHOLDER if k in _SENSITIVE_KEYS else _redact_event_value(v)
        for k, v in event_dict.items()
    }


class RedactionFilter(logging.Filter):
    """stdlib logging filter: scrub the rendered message of every record on the root
    logger so ``logging.getLogger(...)`` call sites cannot leak email/token fragments."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            # Render args into msg now, then redact, so %-substituted secrets are caught.
            if record.args:
                record.msg = record.getMessage()
                record.args = None
            if isinstance(record.msg, str):
                record.msg = redact_text(record.msg)
        except Exception:  # noqa: BLE001 - never let redaction break logging
            pass
        return True


def sentry_before_send(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any]:
    """Sentry ``before_send``: scrub the log message and any exception values so an
    error report never carries raw email bodies or tokens off-box."""
    logentry = event.get("logentry")
    if isinstance(logentry, dict) and isinstance(logentry.get("message"), str):
        logentry["message"] = redact_text(logentry["message"])
    exception = event.get("exception")
    if isinstance(exception, dict):
        for entry in exception.get("values", []) or []:
            if isinstance(entry, dict) and isinstance(entry.get("value"), str):
                entry["value"] = redact_text(entry["value"])
    return event
