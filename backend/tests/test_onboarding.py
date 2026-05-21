"""Onboarding preferences round-trip tests against SQLite."""

import pytest
from sqlalchemy.orm import Session

from app.api.v1.me import _is_onboarded, _me, set_onboarding
from app.db.models import User
from app.schemas.api import OnboardingPrefs


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="onboard@example.com")
    db.add(u)
    db.commit()
    return u


def test_new_user_not_onboarded(user: User) -> None:
    assert _is_onboarded(user) is False
    assert _me(user).onboarded is False


def test_onboarding_persists_and_merges(db: Session, user: User) -> None:
    # Pre-existing unrelated preference must survive the merge.
    user.preferences = {"quiet_hours": "22-07"}
    db.commit()
    result = set_onboarding(
        OnboardingPrefs(focus="founder", optimize_for="follow_ups", proactiveness="balanced"),
        user=user,
        db=db,
    )
    assert result.onboarded is True
    assert result.preferences["focus"] == "founder"
    assert result.preferences["quiet_hours"] == "22-07"  # not clobbered


def test_partial_onboarding_counts(db: Session, user: User) -> None:
    set_onboarding(OnboardingPrefs(focus="work"), user=user, db=db)
    assert _is_onboarded(user) is True
