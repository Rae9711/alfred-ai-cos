"""Billing / subscription wire shapes."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

SubscriptionStatus = Literal["inactive", "trialing", "active", "past_due", "canceled"]


class PlanOut(BaseModel):
    id: str
    name: str
    price_label: str
    price_minor: int
    currency: str
    interval: Literal["month", "year"]
    features: list[str]


class SubscriptionOut(BaseModel):
    plan_id: str
    plan_name: str
    status: SubscriptionStatus
    renews_at: datetime | None = None
    trial_ends_at: datetime | None = None
    manage_url: str | None = None
    checkout_available: bool = False


class CheckoutRequest(BaseModel):
    success_url: str = Field(min_length=1)
    cancel_url: str = Field(min_length=1)


class CheckoutOut(BaseModel):
    checkout_url: str | None = None
    message: str | None = None
