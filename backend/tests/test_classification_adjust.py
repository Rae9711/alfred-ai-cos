"""Verification / OTP emails classify as FYI, not Needs Reply."""

from app.services.classification_adjust import (
    looks_like_verification_code,
    verification_code_classification,
)


def test_verification_subject_matches() -> None:
    assert looks_like_verification_code(subject="Your verification code is 482913")


def test_sign_in_code_matches() -> None:
    assert looks_like_verification_code(
        subject="Sign in to Alfred",
        snippet="Your one-time code is 123456. Do not share this code.",
    )


def test_human_reply_does_not_match() -> None:
    assert not looks_like_verification_code(
        subject="Please send the signed letter",
        snippet="When you have a moment, reply with the document.",
    )


def test_verification_result_is_informational() -> None:
    result = verification_code_classification()
    assert result.classification.value == "informational"
    assert result.action_required is False
