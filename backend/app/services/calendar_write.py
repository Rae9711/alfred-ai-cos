"""Calendar write-target preference (Google vs Apple device calendar).

Reads merge both on the client. Writes go to a single primary chosen in Settings.
"""

from __future__ import annotations

from typing import Literal

from app.db.models import User

CalendarWritePrimary = Literal["google", "apple"]

_PREF_KEY = "calendar_write_primary"


def get_calendar_write_primary(user: User) -> CalendarWritePrimary:
    raw = (user.preferences or {}).get(_PREF_KEY)
    if raw == "apple":
        return "apple"
    return "google"


def should_write_apple(
    user: User,
    *,
    write_target: str | None = None,
) -> bool:
    """True when this mutation should skip Google and let the device write."""
    if write_target == "apple":
        return True
    if write_target == "google":
        return False
    return get_calendar_write_primary(user) == "apple"
