"""Post-LLM classification adjustments for obvious automated mail."""

from __future__ import annotations

import re

from app.db.enums import MessageClassification, Priority
from app.schemas.llm import ClassificationResult

# OTP / email verification / sign-in codes — FYI only, never Needs Reply.
_VERIFICATION_RE = re.compile(
    r"\b("
    r"verification code|"
    r"verify (?:your )?(?:email|e-mail|login|log-?in|sign-?in|account|identity)|"
    r"email verification|"
    r"confirm your (?:email|e-mail|address)|"
    r"one-?time (?:password|code|passcode|pin)|"
    r"sign-?in code|login code|security code|authentication code|"
    r"2fa code|two-?factor(?: code)?|"
    r"your code is|use this code|enter this code|"
    r"do not share this code"
    r")\b",
    re.IGNORECASE,
)


def looks_like_verification_code(
    *,
    subject: str | None,
    snippet: str | None = None,
    body: str | None = None,
) -> bool:
    """True for automated OTP / verify-email / sign-in code messages."""
    text = " ".join(filter(None, [subject, snippet, body and body[:2000]]))
    if not text.strip():
        return False
    return bool(_VERIFICATION_RE.search(text))


def verification_code_classification() -> ClassificationResult:
    return ClassificationResult(
        classification=MessageClassification.informational,
        priority=Priority.low,
        action_required=False,
        reason="Verification or sign-in code; read-only, no reply needed.",
    )
