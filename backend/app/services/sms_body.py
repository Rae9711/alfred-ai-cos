"""Normalize SMS body text from iOS Shortcut payloads."""

from __future__ import annotations

import json
from typing import Any

_SMS_BODY_KEYS = ("text", "body", "shortcut_input", "message", "content")


def normalize_sms_body_text(text: str) -> str:
    """Extract plain text when Shortcuts stored the whole JSON payload as a string."""
    stripped = text.strip()
    if not stripped.startswith("{"):
        return stripped
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        return stripped
    extracted = _extract_from_parsed(parsed)
    return extracted if extracted else stripped


def _extract_from_parsed(value: Any) -> str | None:
    if isinstance(value, str):
        inner = value.strip()
        if inner.startswith("{"):
            nested = normalize_sms_body_text(inner)
            return nested if nested else None
        return inner or None
    if isinstance(value, dict):
        for key in _SMS_BODY_KEYS:
            if key not in value:
                continue
            extracted = _extract_from_parsed(value[key])
            if extracted:
                return extracted
    return None
