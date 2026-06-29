"""Verification / OTP / security alerts classify as FYI, not Needs Reply."""

from app.services.classification_adjust import (
    automated_fyi_override,
    looks_like_automated_fyi,
    looks_like_security_fyi,
    looks_like_verification_code,
    subject_implies_action_required,
)


def test_verification_subject_matches() -> None:
    assert looks_like_verification_code(subject="Your verification code is 482913")


def test_device_added_matches() -> None:
    assert looks_like_security_fyi(subject="A Device Has Been Added To Your Account")


def test_device_added_via_automated_fyi() -> None:
    assert looks_like_automated_fyi(
        subject="A Device Has Been Added To Your Account",
        snippet="A new device was added to your account. If this wasn't you, contact support.",
    )


def test_sign_in_code_matches() -> None:
    assert looks_like_verification_code(
        subject="Sign in to Alfred",
        snippet="Your one-time code is 123456. Do not share this code.",
    )


def test_human_reply_does_not_match() -> None:
    assert not looks_like_automated_fyi(
        subject="Please send the signed letter",
        snippet="When you have a moment, reply with the document.",
    )


def test_past_due_subject_implies_action() -> None:
    assert subject_implies_action_required(
        subject="Action needed, your balance is now past due",
    )


def test_verify_account_phrase_without_code_does_not_match() -> None:
    assert not looks_like_verification_code(
        subject="Action needed",
        snippet="Please verify your account details before we can proceed.",
    )


def test_verify_account_phrase_matches_with_body() -> None:
    assert looks_like_verification_code(
        subject="Confirm your email",
        snippet="Tap to finish signup.",
        body="Please verify your email address to activate your account.",
    )


def test_security_override_is_informational() -> None:
    result = automated_fyi_override(subject="A Device Has Been Added To Your Account")
    assert result is not None
    assert result.classification.value == "informational"
    assert result.action_required is False


def test_upgrade_human_fyi_with_question() -> None:
    from app.db.enums import MessageClassification
    from app.services.classification_adjust import upgrade_human_misclassified_as_fyi

    result = upgrade_human_misclassified_as_fyi(
        classification=MessageClassification.informational,
        action_required=False,
        sender_classification="person",
        subject="Quick question",
        snippet="Can you send the signed letter today?",
    )
    assert result == MessageClassification.needs_reply
