"""Refused capabilities are registered (boundary explicit) and raise a sourced error
pointing to the documentation, rather than faking success."""

import pytest
from sqlalchemy.orm import Session

from app.capabilities import get_capability
from app.capabilities.base import CapabilityError
from app.capabilities.providers.browser_action import BrowserActionCapability
from app.capabilities.providers.delivery_order import DeliveryOrderCapability
from app.db.enums import ActionType
from app.db.models import User


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="refused@example.com")
    db.add(u)
    db.commit()
    return u


def test_browser_and_delivery_are_registered() -> None:
    assert get_capability(ActionType.browser_action) is not None
    assert get_capability(ActionType.place_order) is not None


def test_browser_action_refuses_with_pointer(db: Session, user: User) -> None:
    cap = BrowserActionCapability()
    with pytest.raises(CapabilityError, match="REFUSED.md"):
        cap.validate(db, user, {})
    with pytest.raises(CapabilityError, match="trust model"):
        cap.execute(db, user, {})


def test_delivery_order_refuses_with_pointer(db: Session, user: User) -> None:
    cap = DeliveryOrderCapability()
    with pytest.raises(CapabilityError, match="REFUSED.md"):
        cap.validate(db, user, {})
    with pytest.raises(CapabilityError, match="no public partner ordering API"):
        cap.execute(db, user, {})
