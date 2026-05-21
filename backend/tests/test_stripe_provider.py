"""Stripe payment provider tests. Mocks httpx so no network or real Stripe is touched.
Verifies test-mode PaymentIntent creation, live-key refusal, and validation."""

from typing import Any

import httpx
import pytest
from sqlalchemy.orm import Session

from app.capabilities.base import CapabilityError
from app.capabilities.providers import stripe_payment
from app.db.enums import ActionType, RiskLevel
from app.db.models import User


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any]) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self) -> dict[str, Any]:
        return self._payload


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="pay@example.com")
    db.add(u)
    db.commit()
    return u


def _payload() -> dict[str, Any]:
    return {"amount_minor": 2500, "currency": "eur", "payment_method": "pm_card_visa"}


def test_describe_is_level_4() -> None:
    desc = stripe_payment.StripePaymentCapability().describe()
    assert desc.action_type == ActionType.make_payment
    assert desc.risk_level == RiskLevel.financial_legal


def test_test_mode_payment_succeeds(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(stripe_payment.settings, "stripe_secret_key", "sk_test_abc")
    captured: dict[str, Any] = {}

    def fake_post(url: str, **kwargs: Any) -> _FakeResponse:
        captured["auth"] = kwargs.get("auth")
        captured["data"] = kwargs.get("data")
        return _FakeResponse(200, {"id": "pi_123", "status": "succeeded"})

    monkeypatch.setattr(httpx, "post", fake_post)

    cap = stripe_payment.StripePaymentCapability()
    cap.validate(db, user, _payload())
    result = cap.execute(db, user, _payload())

    assert result.amount_minor == 2500
    assert result.currency == "EUR"
    assert result.reversible is False
    assert result.data["payment_intent_id"] == "pi_123"
    assert captured["auth"] == ("sk_test_abc", "")  # test key used
    assert captured["data"]["amount"] == 2500


def test_live_key_refused_without_flag(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(stripe_payment.settings, "stripe_secret_key", "sk_live_real")
    monkeypatch.setattr(stripe_payment.settings, "allow_live_payments", False)
    cap = stripe_payment.StripePaymentCapability()
    with pytest.raises(CapabilityError, match="Refusing a live Stripe key"):
        cap.validate(db, user, _payload())


def test_validation_rejects_bad_amount(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(stripe_payment.settings, "stripe_secret_key", "sk_test_abc")
    cap = stripe_payment.StripePaymentCapability()
    with pytest.raises(CapabilityError, match="positive amount_minor"):
        cap.validate(db, user, {"amount_minor": 0, "payment_method": "pm_card_visa"})


def test_stripe_error_surfaces(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(stripe_payment.settings, "stripe_secret_key", "sk_test_abc")
    monkeypatch.setattr(
        httpx, "post", lambda *a, **k: _FakeResponse(402, {"error": "card_declined"})
    )
    cap = stripe_payment.StripePaymentCapability()
    with pytest.raises(CapabilityError, match="Stripe error"):
        cap.execute(db, user, _payload())
