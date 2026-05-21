"""Stripe payment capability (level 4, financial). TEST MODE by default.

Creates a Stripe PaymentIntent. Refuses a live key (sk_live_) unless ALLOW_LIVE_PAYMENTS
is explicitly true, so real money cannot move by accident. Even then, the execution
service's spend limit and strong-confirmation gates still apply. The only place the
Stripe API is touched. See docs/integrations/stripe.md for compliance prerequisites."""

from __future__ import annotations

from typing import Any, cast

import httpx
from sqlalchemy.orm import Session

from app.capabilities.base import (
    CapabilityDescription,
    CapabilityError,
    ExecutionResult,
)
from app.core.config import get_settings
from app.db.enums import ActionType, RiskLevel
from app.db.models import User

settings = get_settings()
_ENDPOINT = "https://api.stripe.com/v1/payment_intents"


def _guard_key() -> str:
    key = settings.stripe_secret_key
    if not key:
        raise CapabilityError("Stripe is not configured (no secret key).")
    if key.startswith("sk_live_") and not settings.allow_live_payments:
        raise CapabilityError(
            "Refusing a live Stripe key. Set ALLOW_LIVE_PAYMENTS=true only after the "
            "compliance steps in docs/integrations/stripe.md."
        )
    return key


class StripePaymentCapability:
    def describe(self) -> CapabilityDescription:
        return CapabilityDescription(
            action_type=ActionType.make_payment,
            risk_level=RiskLevel.financial_legal,
            title="Make a payment",
            summary="Charge a payment method through Stripe.",
        )

    def validate(self, db: Session, user: User, payload: dict[str, Any]) -> None:  # noqa: ARG002
        amount = payload.get("amount_minor")
        if not isinstance(amount, int) or amount <= 0:
            raise CapabilityError("A positive amount_minor is required.")
        if not payload.get("payment_method"):
            raise CapabilityError("A payment_method is required.")
        _guard_key()

    def execute(self, db: Session, user: User, payload: dict[str, Any]) -> ExecutionResult:  # noqa: ARG002
        key = _guard_key()
        amount = int(payload["amount_minor"])
        currency = str(payload.get("currency", "eur")).lower()
        headers: dict[str, str] = {}
        # An idempotency key (the proposal id, injected by the execution service) makes
        # retries and the lost-response case safe: Stripe returns the original charge
        # instead of creating a second one.
        idem = payload.get("idempotency_key")
        if idem:
            headers["Idempotency-Key"] = str(idem)
        resp = httpx.post(
            _ENDPOINT,
            auth=(key, ""),
            headers=headers,
            data={
                "amount": amount,
                "currency": currency,
                "payment_method": payload["payment_method"],
                "confirm": "true",
                "description": payload.get("description", "Albert payment"),
            },
            timeout=30,
        )
        if resp.status_code >= 400:
            raise CapabilityError(f"Stripe error: {resp.text}")
        intent = resp.json()
        return ExecutionResult(
            detail=f"Payment {intent.get('status', 'created')} ({amount} {currency.upper()})",
            reversible=False,
            amount_minor=amount,
            currency=currency.upper(),
            data={"payment_intent_id": cast(str, intent.get("id"))},
        )
