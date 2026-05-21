"""Account routes: profile, onboarding calibration (PRD 9.1, 12.1).

Account deletion and integration revocation are added in A11."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import User
from app.schemas.api import MeOut, OnboardingPrefs

router = APIRouter(tags=["account"])

_ONBOARDING_KEYS = ("focus", "optimize_for", "proactiveness")


def _is_onboarded(user: User) -> bool:
    return any(user.preferences.get(k) for k in _ONBOARDING_KEYS)


def _me(user: User) -> MeOut:
    return MeOut(
        id=user.id,
        email=user.email,
        name=user.name,
        timezone=user.timezone,
        preferences=dict(user.preferences),
        onboarded=_is_onboarded(user),
    )


@router.get("/me", response_model=MeOut)
def get_me(user: User = Depends(get_current_user)) -> MeOut:
    return _me(user)


@router.post("/onboarding", response_model=MeOut)
def set_onboarding(
    prefs: OnboardingPrefs,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeOut:
    # Merge into preferences so notification/approval settings added later coexist.
    merged = dict(user.preferences)
    merged.update({k: v for k, v in prefs.model_dump().items() if v is not None})
    user.preferences = merged
    db.commit()
    return _me(user)
