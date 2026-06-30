"""Per-day dismissals for habit and planning suggestions on the Home screen."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.db.models import User

_PREF_KEY = "planning_dismissals"
_RETENTION_DAYS = 14


def _dismissal_key(*, kind: str, item_id: str, day: date) -> str:
    return f"{kind}:{item_id}:{day.isoformat()}"


def _load_dismissals(user: User) -> set[str]:
    raw = (user.preferences or {}).get(_PREF_KEY) or []
    return set(raw) if isinstance(raw, list) else set()


def is_dismissed(
    user: User,
    *,
    kind: str,
    item_id: str,
    day: date,
) -> bool:
    return _dismissal_key(kind=kind, item_id=item_id, day=day) in _load_dismissals(user)


def dismiss_suggestion(
    db: Session,
    user: User,
    *,
    kind: str,
    item_id: str,
    day: date,
) -> None:
    """Hide a habit or planning suggestion for the given local day."""
    prefs = dict(user.preferences or {})
    dismissals = list(_load_dismissals(user))
    key = _dismissal_key(kind=kind, item_id=item_id, day=day)
    if key not in dismissals:
        dismissals.append(key)

    cutoff = (day - timedelta(days=_RETENTION_DAYS)).isoformat()
    dismissals = [k for k in dismissals if k.rsplit(":", 1)[-1] >= cutoff]

    prefs[_PREF_KEY] = dismissals
    user.preferences = prefs
    db.commit()
