"""Per-user monthly LLM spend quota."""

from types import SimpleNamespace

import pytest
from sqlalchemy.orm import Session

from app.db.models import LlmUsagePeriod, User
from app.services import llm_quota


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="quota@example.com")
    db.add(u)
    db.commit()
    return u


def test_estimate_cost_haiku_rounds_up_cents() -> None:
    # 1M input @ $1 + 1M output @ $5 = $6 → 600 cents
    assert (
        llm_quota.estimate_cost_minor(
            model="claude-haiku-4-5", input_tokens=1_000_000, output_tokens=1_000_000
        )
        == 600
    )


def test_estimate_cost_tiny_call_at_least_one_cent() -> None:
    assert (
        llm_quota.estimate_cost_minor(
            model="claude-sonnet-4-6", input_tokens=100, output_tokens=50
        )
        >= 1
    )


def test_record_and_assert_quota(db: Session, user: User, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm_quota, "monthly_cap_minor", lambda: 5)  # 5 cents

    status = llm_quota.record_usage(
        db,
        user.id,
        model="claude-sonnet-4-6",
        input_tokens=10_000,
        output_tokens=2_000,
    )
    db.commit()
    assert status.used_minor >= 1
    assert status.period  # YYYY-MM

    # Force used to the cap.
    row = db.query(LlmUsagePeriod).filter_by(user_id=user.id).one()
    row.spend_minor = 5
    db.commit()

    with pytest.raises(llm_quota.LlmQuotaExceeded):
        llm_quota.assert_quota_available(db, user.id)

    view = llm_quota.get_quota_status(db, user.id)
    assert view.capped is True
    assert view.remaining_minor == 0
    assert view.used_pct == 100.0


def test_charge_bound_user_uses_request_session(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(llm_quota, "monthly_cap_minor", lambda: 10_000)
    with llm_quota.llm_user_scope(user.id, db=db):
        llm_quota.charge_bound_user_usage(
            model="claude-haiku-4-5",
            usage=SimpleNamespace(input_tokens=50_000, output_tokens=10_000),
        )
    db.commit()
    status = llm_quota.get_quota_status(db, user.id)
    assert status.used_minor > 0
    assert status.input_tokens == 50_000


def test_zero_cap_disables_enforcement(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(llm_quota, "monthly_cap_minor", lambda: 0)
    llm_quota.assert_quota_available(db, user.id)  # must not raise
