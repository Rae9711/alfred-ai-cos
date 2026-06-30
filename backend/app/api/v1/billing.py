"""Subscription billing routes (status, plans, checkout)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import User
from app.schemas.billing import CheckoutOut, CheckoutRequest, PlanOut, SubscriptionOut
from app.services import billing

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/subscription", response_model=SubscriptionOut)
def get_subscription(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),  # noqa: ARG001 - parity with other authenticated routes
) -> SubscriptionOut:
    return SubscriptionOut(**billing.get_subscription(user))


@router.get("/plans", response_model=list[PlanOut])
def get_plans(
    user: User = Depends(get_current_user),  # noqa: ARG001
) -> list[PlanOut]:
    return [PlanOut(**p) for p in billing.list_plans()]


@router.post("/checkout", response_model=CheckoutOut)
def start_checkout(
    body: CheckoutRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),  # noqa: ARG001
) -> CheckoutOut:
    return CheckoutOut(**billing.create_checkout_session(
        user,
        success_url=body.success_url,
        cancel_url=body.cancel_url,
    ))
