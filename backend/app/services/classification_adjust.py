"""Post-LLM classification adjustments for obvious automated FYI mail."""

from __future__ import annotations

import re

from app.db.enums import MessageClassification, Priority
from app.schemas.llm import ClassificationResult

# OTP / email verification — require a strong signal unless the full body is scanned.
_VERIFICATION_RE = re.compile(
    r"\b("
    r"verification code|"
    r"one-?time (?:password|code|passcode|pin)|"
    r"sign-?in code|login code|security code|authentication code|"
    r"2fa code|two-?factor(?: code)?|"
    r"your code is|use this code|enter this code|"
    r"do not share this code"
    r")\b",
    re.IGNORECASE,
)
_VERIFICATION_BODY_RE = re.compile(
    r"\b("
    r"verify (?:your )?(?:email|e-mail|login|log-?in|sign-?in|account|identity)|"
    r"email verification|"
    r"confirm your (?:email|e-mail|address)"
    r")\b",
    re.IGNORECASE,
)

# Security / account alerts that are read-only unless the user did not take the action.
_SECURITY_FYI_RE = re.compile(
    r"\b("
    r"(?:a )?device (?:has been|was) added(?: to (?:your )?account)?|"
    r"new device (?:added|detected|registered)|"
    r"device added to (?:your )?account|"
    r"new sign-?in|"
    r"signed in (?:on|from) (?:a )?new device|"
    r"unrecognized (?:device|sign-?in|login)|"
    r"unusual (?:sign-?in|login) activity|"
    r"new login (?:detected|from)|"
    r"password (?:was )?changed|"
    r"if this (?:wasn't|was not|weren't) you"
    r")\b",
    re.IGNORECASE,
)


def _message_text(
    *,
    subject: str | None,
    snippet: str | None = None,
    body: str | None = None,
) -> str:
    return " ".join(filter(None, [subject, snippet, body and body[:2000]])).strip()


def looks_like_verification_code(
    *,
    subject: str | None,
    snippet: str | None = None,
    body: str | None = None,
) -> bool:
    """True for automated OTP / verify-email / sign-in code messages."""
    text = _message_text(subject=subject, snippet=snippet, body=body)
    if not text:
        return False
    if _VERIFICATION_RE.search(text):
        return True
    # Broader phrases only when scanning the full body (extraction time).
    return bool(body and _VERIFICATION_BODY_RE.search(text))


def looks_like_security_fyi(
    *,
    subject: str | None,
    snippet: str | None = None,
    body: str | None = None,
) -> bool:
    """True for device-added / new-sign-in style security notifications."""
    text = _message_text(subject=subject, snippet=snippet, body=body)
    return bool(text and _SECURITY_FYI_RE.search(text))


def looks_like_automated_fyi(
    *,
    subject: str | None,
    snippet: str | None = None,
    body: str | None = None,
) -> bool:
    """Verification codes and read-only security alerts belong in FYI."""
    return looks_like_verification_code(subject=subject, snippet=snippet, body=body) or (
        looks_like_security_fyi(subject=subject, snippet=snippet, body=body)
    )


def automated_fyi_override(
    *,
    subject: str | None,
    snippet: str | None = None,
    body: str | None = None,
) -> ClassificationResult | None:
    """Return an informational classification when rules match; else None."""
    if looks_like_verification_code(subject=subject, snippet=snippet, body=body):
        return ClassificationResult(
            classification=MessageClassification.informational,
            priority=Priority.low,
            action_required=False,
            reason="Verification or sign-in code; read-only, no reply needed.",
        )
    if looks_like_security_fyi(subject=subject, snippet=snippet, body=body):
        return ClassificationResult(
            classification=MessageClassification.informational,
            priority=Priority.low,
            action_required=False,
            reason="Security notification; review only if you did not take this action.",
        )
    return None
