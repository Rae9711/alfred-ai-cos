"""Integration: a Stripe test-mode charge through the payment capability.

Scaffolding — skipped unless STRIPE_SECRET_KEY (an ``sk_test_`` key) is set. Uses
Stripe's canonical test payment method so no real money moves. Never runs in ordinary CI.
"""

from __future__ import annotations

import pytest


@pytest.mark.integration
def test_stripe_test_mode_payment(stripe_test_key: str) -> None:
    from app.capabilities.providers.stripe_payment import StripePaymentCapability

    cap = StripePaymentCapability()
    payload = {
        "amount_minor": 100,
        "currency": "usd",
        # Stripe's always-succeeds test payment method.
        "payment_method": "pm_card_visa",
        "description": "albert integration test",
    }
    result = cap.execute(db=None, user=None, payload=payload)  # type: ignore[arg-type]
    assert result.amount_minor == 100
    assert result.currency == "USD"
