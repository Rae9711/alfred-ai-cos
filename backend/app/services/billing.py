"""Subscription billing. Reads plan state from user.preferences; creates a Stripe
Checkout session when STRIPE_SECRET_KEY and STRIPE_SUBSCRIPTION_PRICE_ID are set."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

import httpx

from app.core.config import get_settings
from app.db.models import User

SubscriptionStatus = Literal["inactive", "trialing", "active", "past_due", "canceled"]

_PLAN_CATALOG: list[dict[str, Any]] = [
    {
        "id": "pro_monthly",
        "name": "Albert Pro",
        "price_label": "$12/mo",
        "price_minor": 1200,
        "currency": "usd",
        "interval": "month",
        "features": [
            "AI inbox, calendar, and drafts — no API keys",
            "Unlimited Gmail sync and SMS forwarding",
            "Priority classification and daily briefings",
        ],
    },
]

_CHECKOUT_ENDPOINT = "https://api.stripe.com/v1/checkout/sessions"


def list_plans() -> list[dict[str, Any]]:
    return [dict(p) for p in _PLAN_CATALOG]


def _parse_iso(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def get_subscription(user: User) -> dict[str, Any]:
    prefs = user.preferences or {}
    plan_id = str(prefs.get("subscription_plan") or "free")
    status = str(prefs.get("subscription_status") or "inactive")
    if status not in ("inactive", "trialing", "active", "past_due", "canceled"):
        status = "inactive"

    catalog = {p["id"]: p for p in _PLAN_CATALOG}
    if plan_id == "free":
        plan_name = "Free"
    else:
        plan_name = str(catalog.get(plan_id, {}).get("name") or "Albert Pro")

    renews_at = _parse_iso(prefs.get("subscription_renews_at"))
    trial_ends_at = _parse_iso(prefs.get("subscription_trial_ends_at"))
    manage_url = prefs.get("subscription_manage_url")
    checkout_available = bool(
        get_settings().stripe_secret_key and get_settings().stripe_subscription_price_id
    )

    return {
        "plan_id": plan_id,
        "plan_name": plan_name,
        "status": status,
        "renews_at": renews_at,
        "trial_ends_at": trial_ends_at,
        "manage_url": manage_url if isinstance(manage_url, str) else None,
        "checkout_available": checkout_available,
    }


def create_checkout_session(
    user: User,
    *,
    success_url: str,
    cancel_url: str,
) -> dict[str, Any]:
    settings = get_settings()
    price_id = settings.stripe_subscription_price_id
    key = settings.stripe_secret_key

    if not key or not price_id:
        return {
            "checkout_url": None,
            "message": (
                "Subscriptions are rolling out soon. You're on the early access list — "
                "we'll notify you when checkout is live."
            ),
        }

    if key.startswith("sk_live_") and not settings.allow_live_payments:
        return {
            "checkout_url": None,
            "message": "Live billing is not enabled on this server yet.",
        }

    resp = httpx.post(
        _CHECKOUT_ENDPOINT,
        auth=(key, ""),
        data={
            "mode": "subscription",
            "success_url": success_url,
            "cancel_url": cancel_url,
            "customer_email": user.email,
            "client_reference_id": user.id,
            "payment_method_types[0]": "card",
            "line_items[0][price]": price_id,
            "line_items[0][quantity]": "1",
            "metadata[user_id]": user.id,
        },
        timeout=30,
    )
    if resp.status_code >= 400:
        return {
            "checkout_url": None,
            "message": f"Could not start checkout ({resp.status_code}). Try again later.",
        }

    session = resp.json()
    url = session.get("url")
    if not isinstance(url, str) or not url:
        return {
            "checkout_url": None,
            "message": "Checkout session created without a URL. Try again later.",
        }
    return {"checkout_url": url, "message": None}
