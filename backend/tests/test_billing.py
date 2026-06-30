"""Billing service tests."""

from typing import Any

import httpx
import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import User
from app.services import billing


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="bill@example.com")
    db.add(u)
    db.commit()
    return u


def test_default_subscription_is_free_inactive(user: User) -> None:
    sub = billing.get_subscription(user)
    assert sub["plan_id"] == "free"
    assert sub["status"] == "inactive"
    assert sub["checkout_available"] is False


def test_subscription_reads_preferences(user: User) -> None:
    user.preferences = {
        "subscription_plan": "pro_monthly",
        "subscription_status": "active",
        "subscription_renews_at": "2026-07-01T00:00:00+00:00",
    }
    sub = billing.get_subscription(user)
    assert sub["plan_id"] == "pro_monthly"
    assert sub["status"] == "active"
    assert sub["plan_name"] == "Albert Pro"
    assert sub["renews_at"] is not None


def test_checkout_stub_without_stripe(user: User, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "stripe_secret_key", "")
    monkeypatch.setattr(get_settings(), "stripe_subscription_price_id", "")
    out = billing.create_checkout_session(
        user,
        success_url="albert://settings?billing=success",
        cancel_url="albert://settings?billing=cancel",
    )
    assert out["checkout_url"] is None
    assert out["message"]


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any]) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self) -> dict[str, Any]:
        return self._payload


def test_checkout_creates_stripe_session(
    user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "stripe_secret_key", "sk_test_abc")
    monkeypatch.setattr(
        get_settings(), "stripe_subscription_price_id", "price_test_pro"
    )
    captured: dict[str, Any] = {}

    def fake_post(url: str, **kwargs: Any) -> _FakeResponse:
        captured["url"] = url
        captured["data"] = kwargs.get("data")
        return _FakeResponse(200, {"id": "cs_test", "url": "https://checkout.stripe.test/cs"})

    monkeypatch.setattr(httpx, "post", fake_post)

    out = billing.create_checkout_session(
        user,
        success_url="https://app/success",
        cancel_url="https://app/cancel",
    )
    assert out["checkout_url"] == "https://checkout.stripe.test/cs"
    assert captured["data"]["mode"] == "subscription"
    assert captured["data"]["line_items[0][price]"] == "price_test_pro"
