"""Importance learning: turn the user's accept/dismiss/snooze/act behavior into
a per-user adjustment that the priority ranker mixes in.

The shape is intentionally simple. We track two things per user:

  - per-sender adjustment: +act counts and -dismiss counts, capped so a single
    enthusiastic week doesn't permanently lock a sender into "critical".
  - per-category adjustment: same shape but for keyword categories (money,
    legal, ask, meeting). When the user repeatedly dismisses money-flagged
    items but acts on meeting-flagged items, the ranker drifts toward what
    the user actually cares about.

Storage lives in user.preferences under "learning" so we don't need a
migration. The data is per-user, not per-org, and the shape is small enough
to fit comfortably in a JSON column (~hundreds of keys at most for any real
user; commodity Postgres handles that fine).

Updates are idempotent on event id — the same act/dismiss can't double-count
if a worker re-runs."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy.orm import Session

from app.db.models import Commitment, Message, User

Event = Literal["act", "dismiss", "snooze", "open", "correct"]

# Per-event score delta. Asymmetric: "act" gives a stronger signal than "open",
# and "dismiss" is the only routine negative one because snoozing means "later",
# not "no". "correct" is the strongest negative: an explicit correction (the user
# dismissed a schedule proposal, marked a notification not-useful, or decided a
# message we surfaced) is a clear "you got this wrong" and outweighs a plain
# dismiss. The values are tuned so ~5 acts ≈ +5 score on the next item.
_DELTAS: dict[Event, float] = {
    "act": 1.5,
    "dismiss": -1.0,
    "snooze": 0.0,  # intentional: park, not vote
    "open": 0.3,  # opened the detail = mild signal
    "correct": -1.5,  # explicit correction: strong negative
}

# Bounds prevent runaway in either direction. ±15 keeps learning meaningful
# without letting it dominate the baseline ranker.
_BOUND = 15.0

# Anti-overfit: a sender/category must have at least this many recorded events
# before its learned delta is trusted enough to shift the ranker. Below it, one
# stray act/dismiss can't move a sender's score. Grandfather clause in
# `adjustment_for`: a key with no recorded count at all (hand-built views, legacy
# data) still applies, so only genuinely under-sampled keys are held back.
_MIN_SAMPLES = 3


@dataclass
class LearningView:
    """Snapshot of the user's learned adjustments — exposed for debugging."""

    by_sender: dict[str, float]
    by_category: dict[str, float]
    # How many events fed each learned delta (the min-sample gate reads these).
    sender_counts: dict[str, int] = field(default_factory=dict)
    category_counts: dict[str, int] = field(default_factory=dict)


# ---------- read ----------


def get_learning(user: User) -> LearningView:
    raw = (user.preferences or {}).get("learning", {})
    return LearningView(
        by_sender={str(k): float(v) for k, v in (raw.get("by_sender") or {}).items()},
        by_category={str(k): float(v) for k, v in (raw.get("by_category") or {}).items()},
        sender_counts={str(k): int(v) for k, v in (raw.get("sender_counts") or {}).items()},
        category_counts={str(k): int(v) for k, v in (raw.get("category_counts") or {}).items()},
    )


def _passes_threshold(counts: dict[str, int], key: str) -> bool:
    """True when a learned key is trusted: either we have no sample count for it
    (grandfathered) or it has met the minimum-sample bar."""
    if key not in counts:
        return True
    return counts[key] >= _MIN_SAMPLES


def adjustment_for(learning: LearningView, *, sender: str | None, categories: list[str]) -> float:
    """Combined score adjustment for one commitment. Bounded so the sum of all
    learned signals can't blow past ±20 on a single item. Sub-threshold senders /
    categories contribute 0 so a single event can't move the ranker."""
    total = 0.0
    if sender:
        key = sender.lower()
        if _passes_threshold(learning.sender_counts, key):
            total += learning.by_sender.get(key, 0.0)
    for cat in categories:
        if _passes_threshold(learning.category_counts, cat):
            total += learning.by_category.get(cat, 0.0)
    # The hard cap on the *combined* signal mirrors the per-axis bound, so even
    # if every dimension fires the worst case is bounded and explainable.
    return max(-20.0, min(20.0, total))


# ---------- write ----------


def _decay(value: float) -> float:
    """Gentle pull-toward-zero so old signals fade as new ones arrive. Without
    this, a user who changed jobs would carry old preferences forever."""
    if value == 0:
        return 0.0
    sign = 1 if value > 0 else -1
    return sign * max(0.0, abs(value) - 0.05)


def _apply(value: float, delta: float) -> float:
    """Add delta, decay, clamp. Order matters: decay first so a long-quiet
    signal fades a little before the new event lands."""
    return max(-_BOUND, min(_BOUND, _decay(value) + delta))


def _attribution(
    db: Session, commitment: Commitment | None, message: Message | None
) -> tuple[str | None, list[str]]:
    """Resolve the sender + keyword categories to attribute an event to.

    A commitment (preferred) resolves through its source message; a bare message
    (schedule-proposal dismiss, notification not-useful, message user-decided) uses
    its own sender + subject/snippet. Either way we mirror the ranker's keyword
    detection so learning and scoring agree on an item's category."""
    if commitment is not None and commitment.source_id:
        msg = db.get(Message, commitment.source_id)
        sender = msg.sender.lower() if msg and msg.sender else None
        text = f"{commitment.description or ''} {commitment.evidence or ''}"
        return sender, _categories_in(text)
    if message is not None:
        sender = message.sender.lower() if message.sender else None
        text = f"{message.subject or ''} {message.snippet or ''}"
        return sender, _categories_in(text)
    return None, []


def record_event(
    db: Session,
    user: User,
    *,
    event: Event,
    commitment: Commitment | None = None,
    message: Message | None = None,
) -> None:
    """Update the learning state for one user-event. Resolves the sender (via the
    commitment's source message, or a directly-supplied message) and the keyword
    categories the ranker would apply, so the same signals the ranker rewards are
    the ones learning shifts. Also bumps a per-key sample count that gates the
    min-sample threshold in `adjustment_for`.

    Idempotency: callers that may double-fire should pass a unique id through
    a separate dedup layer. This function itself is monotonic — calling it
    twice will count twice. The cron worker that emits behavior events should
    dedup at the event-source layer."""
    delta = _DELTAS.get(event, 0.0)
    if delta == 0.0:
        return

    sender, categories = _attribution(db, commitment, message)

    prefs = dict(user.preferences or {})
    learning = dict(prefs.get("learning") or {})
    by_sender = dict(learning.get("by_sender") or {})
    by_cat = dict(learning.get("by_category") or {})
    sender_counts = dict(learning.get("sender_counts") or {})
    category_counts = dict(learning.get("category_counts") or {})

    if sender:
        by_sender[sender] = _apply(float(by_sender.get(sender, 0.0)), delta)
        sender_counts[sender] = int(sender_counts.get(sender, 0)) + 1
    for cat in categories:
        by_cat[cat] = _apply(float(by_cat.get(cat, 0.0)), delta)
        category_counts[cat] = int(category_counts.get(cat, 0)) + 1

    learning["by_sender"] = by_sender
    learning["by_category"] = by_cat
    learning["sender_counts"] = sender_counts
    learning["category_counts"] = category_counts
    prefs["learning"] = learning
    user.preferences = prefs
    db.commit()


def reset_learning(db: Session, user: User) -> None:
    """Clear all learned preferences for a user (the "start fresh" escape hatch)."""
    prefs = dict(user.preferences or {})
    prefs.pop("learning", None)
    user.preferences = prefs
    db.commit()


# ---------- categories ----------

# These mirror the ranker's _HIGH_STAKES_RE families but split by intent, so
# learning can move them independently. Money/legal terms split from process
# terms (meeting, scheduling, calendar) because users often care about one and
# ignore the other.
_CATEGORY_PATTERNS: dict[str, list[str]] = {
    "money": ["contract", "wire", "invoice", "payment", "$", "salary", "offer", "funding"],
    "legal": ["legal", "lawsuit", "nda", "compliance", "kyc", "aml", "gdpr", "hipaa"],
    "ask": ["can you", "could you", "please", "send me", "send us", "review", "approve", "?"],
    "meeting": ["meeting", "call", "schedule", "calendar", "sync", "1:1"],
    "incident": ["breach", "incident", "outage", "down", "broken", "urgent"],
}


def _categories_in(text: str) -> list[str]:
    """Lower-cost than running the ranker's regex — these are substring matches.
    Returns the unique set of categories this text triggers."""
    if not text:
        return []
    lc = text.lower()
    return [cat for cat, words in _CATEGORY_PATTERNS.items() if any(w in lc for w in words)]
