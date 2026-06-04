"""Tests for the sender classifier — the spam shield.

Each test exercises one realistic class of email so the suite reads like a
spec of what counts as a person, a role account, automated, bulk, or
suspicious. New observed spam patterns should land here as fixtures.
"""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.db.models import User
from app.services import sender_class as sc


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="me@adam.dev")
    db.add(u)
    db.commit()
    return u


# --- address parsing ---


def test_parse_display_and_email() -> None:
    d, e = sc.parse_address("Mary Smith <mary@buyer.co>")
    assert d == "Mary Smith"
    assert e == "mary@buyer.co"


def test_parse_bare_email() -> None:
    assert sc.parse_address("mary@buyer.co") == ("", "mary@buyer.co")


def test_parse_quoted_display() -> None:
    d, e = sc.parse_address('"Mary Smith" <mary@buyer.co>')
    assert d == "Mary Smith"
    assert e == "mary@buyer.co"


def test_parse_lowercases_email() -> None:
    _, e = sc.parse_address("Mary <MARY@Buyer.CO>")
    assert e == "mary@buyer.co"


def test_domain_of() -> None:
    assert sc.domain_of("mary@buyer.co") == "buyer.co"
    assert sc.domain_of("garbage") == ""


# --- person: the default for normal humans ---


def test_normal_human_is_person() -> None:
    out = sc.classify(
        sender="Mary Smith <mary@buyer.co>",
        subject="Quote on the contract",
        snippet="Adam, can you send the signed contract by Friday?",
        headers={},
    )
    assert out.cls == "person"


def test_gmail_human_is_person() -> None:
    # A free-mail Gmail address with a personal display name → person.
    out = sc.classify(
        sender="Lucas Jung <lucas.jung@gmail.com>",
        subject="Re: paper draft",
        snippet="thoughts on section 4?",
        headers={},
    )
    assert out.cls == "person"


# --- role accounts ---


@pytest.mark.parametrize(
    "local",
    [
        "info",
        "support",
        "hello",
        "team",
        "contact",
        "sales",
        "billing",
        "legal",
        "hr",
        "press",
    ],
)
def test_role_local_parts(local: str) -> None:
    out = sc.classify(
        sender=f"<{local}@company.io>",
        subject="Following up",
        snippet="hi adam",
        headers={},
    )
    assert out.cls == "role_account"


# --- automated by local part ---


@pytest.mark.parametrize(
    "local",
    [
        "noreply",
        "no-reply",
        "do-not-reply",
        "notifications",
        "alerts",
        "newsletter",
        "marketing",
        "promo",
        "news",
        "digest",
        "campaigns",
        "mailer-daemon",
    ],
)
def test_automated_local_parts(local: str) -> None:
    out = sc.classify(
        sender=f"{local}@brand.io",
        subject="Your account",
        snippet="ok",
        headers={},
    )
    assert out.cls == "automated"


def test_automated_prefix() -> None:
    out = sc.classify(
        sender="bounce-12345@sender.mailchimpapp.com",
        subject="Open this!",
        snippet="ok",
        headers={},
    )
    assert out.cls == "automated"


# --- bulk by headers ---


def test_list_unsubscribe_is_bulk() -> None:
    out = sc.classify(
        sender="Sarah Updates <sarah@news.com>",
        subject="Your weekly insider digest",
        snippet="Hi readers",
        headers={"list-unsubscribe": "<https://x.io/u/1>"},
    )
    assert out.cls == "bulk"
    assert any("List-Unsubscribe" in r for r in out.reasons)


def test_precedence_bulk_is_bulk() -> None:
    out = sc.classify(
        sender="ops@something.io",
        subject="System maintenance",
        snippet="...",
        headers={"precedence": "bulk"},
    )
    assert out.cls == "bulk"


def test_auto_submitted_is_bulk() -> None:
    out = sc.classify(
        sender="bot@svc.io",
        subject="Daily report",
        snippet="...",
        headers={"auto-submitted": "auto-generated"},
    )
    assert out.cls == "bulk"


def test_feedback_id_is_bulk() -> None:
    out = sc.classify(
        sender="x@y.co",
        subject="hi",
        snippet="hi",
        headers={"feedback-id": "12345:ses-customer"},
    )
    assert out.cls == "bulk"


def test_sendgrid_header_is_bulk() -> None:
    out = sc.classify(
        sender="x@y.co",
        subject="hi",
        snippet="hi",
        headers={"x-sg-eid": "abcdef"},
    )
    assert out.cls == "bulk"


# --- automated by platform domain ---


def test_mailchimp_domain_is_automated() -> None:
    out = sc.classify(
        sender="hello@brand.us4.mailchimpapp.com",
        subject="ok",
        snippet="ok",
        headers={},
    )
    assert out.cls == "automated"


def test_sendgrid_domain_is_automated() -> None:
    out = sc.classify(
        sender="hello@em.sendgrid.net",
        subject="ok",
        snippet="ok",
        headers={},
    )
    assert out.cls == "automated"


def test_intercom_domain_is_automated() -> None:
    out = sc.classify(
        sender="Brand <hello@notifications.intercom-mail.com>",
        subject="A new feature",
        snippet="ok",
        headers={},
    )
    assert out.cls == "automated"


# --- newsletter subject heuristic ---


def test_newsletter_subject_is_automated() -> None:
    out = sc.classify(
        sender="newsletter@anyone.com",
        subject="Your weekly digest from Stratechery",
        snippet="...",
        headers={},
    )
    assert out.cls == "automated"


def test_digest_in_brackets_is_automated() -> None:
    out = sc.classify(
        sender="any@any.io",
        subject="[The Algorithm] Digest - June 4",
        snippet="...",
        headers={},
    )
    assert out.cls == "automated"


# --- transactional subdomains ---


def test_transactional_subdomain_with_receipt_is_automated() -> None:
    out = sc.classify(
        sender="receipts@email.stripe.com",
        subject="Your receipt from Acme Co",
        snippet="ok",
        headers={},
    )
    assert out.cls == "automated"


def test_transactional_subdomain_with_personal_subject_is_role_account() -> None:
    # A real human at a marketing subdomain (e.g., a salesperson) is still
    # role_account, not person.
    out = sc.classify(
        sender="Jane Doe <jane@email.startup.io>",
        subject="Can we hop on a call?",
        snippet="Hi Adam",
        headers={},
    )
    assert out.cls == "role_account"


# --- suspicious ---


def test_brand_impersonation_is_suspicious() -> None:
    out = sc.classify(
        sender="PayPal <support@paypa1.scam-tld.tk>",
        subject="Re: payment",
        snippet="please verify",
        headers={},
    )
    assert out.cls == "suspicious"
    assert any("paypal" in r.lower() for r in out.reasons)


def test_legit_paypal_email_is_person() -> None:
    # If PayPal email is from paypal.com it's legit. (Even though it's
    # transactional, the brand-impersonation rule shouldn't fire.)
    out = sc.classify(
        sender="PayPal <service@paypal.com>",
        subject="Re: payment",
        snippet="...",
        headers={},
    )
    assert out.cls != "suspicious"


def test_screaming_subject_is_suspicious() -> None:
    out = sc.classify(
        sender="John Smith <john@startup.io>",
        subject="URGENT ACT NOW LIMITED TIME OFFER",
        snippet="claim now",
        headers={},
    )
    assert out.cls == "suspicious"


def test_urgency_spam_phrase_is_suspicious() -> None:
    out = sc.classify(
        sender="x@unknown.io",
        subject="Verify your account today",
        snippet="...",
        headers={},
    )
    assert out.cls == "suspicious"


def test_phishy_snippet_no_display_name_is_suspicious() -> None:
    out = sc.classify(
        sender="x@unknown.io",
        subject="Hi",
        snippet="Click here to verify your account before it is suspended.",
        headers={},
    )
    assert out.cls == "suspicious"


def test_real_email_with_question_mark_is_not_suspicious() -> None:
    # A direct question from a person shouldn't be flagged as urgency-spam.
    out = sc.classify(
        sender="Mary Smith <mary@buyer.co>",
        subject="Quick question about the contract?",
        snippet="Adam, do you have the latest version?",
        headers={},
    )
    assert out.cls == "person"


# --- user overrides ---


def test_vip_override_promotes_a_marketer(user: User) -> None:
    user.preferences = {"sender_overrides": {"vip": ["board@brand.co"]}}
    out = sc.classify(
        sender="board@brand.co",
        subject="Your weekly digest",
        snippet="...",
        headers={"list-unsubscribe": "<https://x>"},
        user=user,
    )
    # Even though headers say bulk, the VIP override wins.
    assert out.cls == "vip"


def test_muted_override_buries_a_person(user: User) -> None:
    user.preferences = {"sender_overrides": {"muted": ["noisy@person.co"]}}
    out = sc.classify(
        sender="Noisy <noisy@person.co>",
        subject="Sign the contract",
        snippet="Hi adam",
        headers={},
        user=user,
    )
    assert out.cls == "muted"


def test_domain_only_vip_override(user: User) -> None:
    # Bare domain in the override → matches everyone at that domain.
    user.preferences = {"sender_overrides": {"vip": ["board.co"]}}
    out = sc.classify(
        sender="anyone@board.co",
        subject="hi",
        snippet="ok",
        headers={},
        user=user,
    )
    assert out.cls == "vip"


def test_subdomain_matches_domain_override(user: User) -> None:
    user.preferences = {"sender_overrides": {"muted": ["news.io"]}}
    out = sc.classify(
        sender="alerts@daily.news.io",
        subject="hi",
        snippet="ok",
        headers={},
        user=user,
    )
    assert out.cls == "muted"


# --- helpers ---


def test_screaming_detects_all_caps() -> None:
    assert sc._is_screaming("URGENT ACT NOW LIMITED")
    assert not sc._is_screaming("Re: URGENT ACT NOW")  # Re prefix excluded
    assert not sc._is_screaming("Quick question")  # mixed case


def test_phishy_snippet_detection() -> None:
    assert sc._is_phishy_snippet("click here to verify your account")
    assert sc._is_phishy_snippet("Your account has been suspended")
    assert not sc._is_phishy_snippet("can you confirm Friday?")  # genuine ask


def test_impersonation_detection() -> None:
    assert sc._impersonated_brand("PayPal", "paypa1.scam.tk") == "paypal"
    assert sc._impersonated_brand("PayPal Inc", "paypal.com") is None
    assert sc._impersonated_brand("PayPal Inc", "support.paypal.com") is None
    assert sc._impersonated_brand("Mary Smith", "buyer.co") is None
