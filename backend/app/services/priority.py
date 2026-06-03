"""Priority Agent (PRD 14.1 agent 3, 16.1): transparent weighted scoring.

The scoring is rule-based and explainable (PRD 16.1: start transparent, refine
with behavior). On top of the baseline urgency/owner/confidence signals, this
version composes a per-user ScoringContext that captures relational signals the
old scorer was blind to:

  - VIP boost: senders the user replies to often.
  - Stranger penalty: first-time senders.
  - Engagement velocity: dampen senders the user habitually ignores.
  - Money / legal / question keyword hits in the commitment text.
  - Thread depth in the last week (escalating threads outrank one-offs).
  - Dismissal history per sender (repeat-dismissals push future items down).

Context is built ONCE per dashboard render, not per commitment, so the upgrade
adds three constant-cost queries to build_today and nothing per item.

The LLM is not used here; priority is deterministic and debuggable. Every score
carries a reason string so the user can see why an item ranks where it does."""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import CommitmentOwner, CommitmentStatus, Priority
from app.db.models import Commitment, Message, User

# ---------- weights (one place to tune the ranker) ----------

# How much the model's own priority read contributes to the score.
_llm_priority_bonus: dict[Priority, int] = {
    Priority.critical: 25,
    Priority.high: 15,
    Priority.medium: 5,
    Priority.low: 0,
    Priority.noise: 0,
}

# Money / legal / contract words. Hit on any → +12.
_HIGH_STAKES_RE = re.compile(
    r"\b(contract|wire|invoice|payment|legal|lawsuit|compliance|sign(ed|ature)?|"
    r"nda|term ?sheet|funding|board|investor|tax|audit|deadline|salary|offer|"
    r"acquisition|due diligence|kyc|aml|gdpr|hipaa|breach|incident|outage|"
    r"\$[0-9])\b",
    re.IGNORECASE,
)

# A direct ask is usually phrased as a question or imperative.
_DIRECT_ASK_RE = re.compile(
    r"(\?\s*$|^(can you|could you|will you|please|pls|need(ed)? (your|the)|"
    r"send (me|us) |sign |approve |review |confirm ))",
    re.IGNORECASE,
)

# Senders are "automated" by class (newsletter, billing) — but the relationship
# signals are about REAL people, so we exclude automated counterparties from the
# VIP/stranger/dismissal stats. Reply behavior to a transactional email tells us
# nothing about whether the sender is important.


# ---------- context ----------


@dataclass
class ScoringContext:
    """Per-user signal lookups, computed in bulk so per-commitment scoring is O(1).

    All maps are keyed by lowercased counterparty email. Missing → defaults that
    cancel out (no bonus, no penalty)."""

    # Times the user replied to a thread originated by this sender, over the recent
    # window. Higher → user cares about this sender.
    user_replies_to: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    # Total inbound messages from this sender. Used to detect first-time senders.
    inbound_count: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    # Commitments from this sender previously dismissed. Higher → user keeps killing
    # things from them, so future ones from the same sender should rank lower.
    dismissed_count: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    # Messages received per thread in the last 7 days. An escalating thread (4+
    # messages in a week) signals an active back-and-forth.
    thread_depth: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    # Map commitment.source_id → (sender, thread_id) so the scorer can find the
    # message context for a commitment in O(1).
    commitment_context: dict[str, tuple[str | None, str | None]] = field(default_factory=dict)


def build_context(db: Session, user: User, *, now: datetime | None = None) -> ScoringContext:
    """Compute the per-user signal lookups for ranking. Cheap: 3 SQL queries
    regardless of how many commitments exist."""
    now = now or datetime.now(UTC)
    window_start = now - timedelta(days=30)
    user_email = (user.email or "").lower()
    ctx = ScoringContext()

    # 1) Messages in the recent window: drive inbound_count, thread_depth, and
    # user_replies_to. One scan, all three indexes.
    recent_messages = list(
        db.scalars(
            select(Message).where(
                Message.user_id == user.id,
                Message.sent_at.is_not(None),
                Message.sent_at >= window_start,
            )
        )
    )
    week_ago = now - timedelta(days=7)
    for msg in recent_messages:
        sender = (msg.sender or "").lower()
        # Outbound messages are messages the user sent — recipients are the senders
        # the user "replies to" by getting back in touch.
        if user_email and sender == user_email:
            for r in msg.recipients or []:
                ctx.user_replies_to[str(r).lower()] += 1
        else:
            if sender:
                ctx.inbound_count[sender] += 1
            assert msg.sent_at is not None
            sent_at = msg.sent_at if msg.sent_at.tzinfo else msg.sent_at.replace(tzinfo=UTC)
            if msg.thread_id and sent_at >= week_ago:
                ctx.thread_depth[msg.thread_id] += 1

    # 2) Previously dismissed commitments per sender, all-time.
    dismissed_links = list(
        db.execute(
            select(Commitment.source_id, Message.sender)
            .join(Message, Commitment.source_id == Message.id)
            .where(
                Commitment.user_id == user.id,
                Commitment.status == CommitmentStatus.dismissed,
            )
        )
    )
    sender_counts: Counter[str] = Counter()
    for _src_id, sender in dismissed_links:
        if sender:
            sender_counts[sender.lower()] += 1
    ctx.dismissed_count.update(sender_counts)

    # 3) Pre-resolve every open commitment's source message so per-commitment lookups
    # don't hit the DB. Cheap because we already need the messages above; here we
    # query just the open commitments' sources (which may be older than 30 days).
    open_commitments = list(
        db.scalars(
            select(Commitment).where(
                Commitment.user_id == user.id,
                Commitment.status == CommitmentStatus.open,
                Commitment.source_id.is_not(None),
            )
        )
    )
    source_ids = [c.source_id for c in open_commitments if c.source_id]
    if source_ids:
        rows = db.execute(
            select(Message.id, Message.sender, Message.thread_id).where(Message.id.in_(source_ids))
        ).all()
        for src_id, sender, thread_id in rows:
            ctx.commitment_context[src_id] = (
                (sender or "").lower() or None,
                thread_id,
            )
    return ctx


# ---------- scoring ----------


@dataclass
class ScoredCommitment:
    commitment: Commitment
    score: float
    priority: Priority
    reason: str


def _days_until(due: date | None, today: date) -> int | None:
    if due is None:
        return None
    return (due - today).days


def score_commitment(
    commitment: Commitment,
    *,
    today: date,
    context: ScoringContext | None = None,
) -> ScoredCommitment:
    """Return a 0-100 score, a derived priority label, and a reason string. Context
    is optional — without it, only the baseline urgency/owner/confidence signals
    apply (preserved for tests and ad-hoc callers)."""
    score = 0.0
    reasons: list[str] = []

    # --- baseline: time pressure ---
    days = _days_until(commitment.due_date, today)
    if days is not None:
        if days < 0:
            score += 50
            reasons.append(f"overdue by {abs(days)} day(s)")
        elif days == 0:
            score += 45
            reasons.append("due today")
        elif days == 1:
            score += 35
            reasons.append("due tomorrow")
        elif days <= 3:
            score += 20
            reasons.append(f"due in {days} days")
        else:
            score += 5

    # --- baseline: owner direction ---
    if commitment.from_automated:
        score += 8
    elif commitment.owner == CommitmentOwner.user:
        score += 20
        if commitment.counterparty:
            reasons.append(f"{commitment.counterparty} is waiting on you")
    else:
        score += 5
        if commitment.counterparty:
            reasons.append(f"you are waiting on {commitment.counterparty}")

    # --- baseline: LLM's own priority read (one signal, not the verdict) ---
    score += _llm_priority_bonus.get(commitment.priority, 0)

    # --- relational signals (need context) ---
    if context is not None and not commitment.from_automated:
        sender, thread_id = (None, None)
        if commitment.source_id:
            sender, thread_id = context.commitment_context.get(commitment.source_id, (None, None))

        if sender:
            replies = context.user_replies_to.get(sender, 0)
            inbound = context.inbound_count.get(sender, 0)
            dismissed = context.dismissed_count.get(sender, 0)

            # VIP: user replies often → up to +30. Capped so a single chatty
            # contact doesn't dominate.
            if replies >= 1:
                vip = min(30, 6 * replies)
                score += vip
                if replies >= 3:
                    reasons.append(f"you regularly reply to {sender}")
                elif replies >= 1:
                    reasons.append(f"you've been talking with {sender}")

            # Engagement velocity: lots of inbound, no replies → dampen.
            if inbound >= 5 and replies == 0:
                score -= 10
                reasons.append(f"you usually don't reply to {sender}")

            # Stranger: first time ever (inbound exactly 1, no prior replies) →
            # small penalty so unknowns don't outrank real conversations.
            if inbound <= 1 and replies == 0:
                score -= 10
                reasons.append("first-time sender")

            # Dismissal history: each prior dismissal from this sender is -5,
            # capped at -20 so the ranker doesn't bury a genuine new ask buried
            # under historical noise from the same address.
            if dismissed > 0:
                penalty = min(20, 5 * dismissed)
                score -= penalty
                reasons.append(f"you've dismissed {dismissed} earlier item(s) from {sender}")

        # Thread depth: an active escalating thread is worth knowing about.
        if thread_id:
            depth = context.thread_depth.get(thread_id, 0)
            if depth >= 4:
                score += 10
                reasons.append(f"{depth} messages in this thread this week")
            elif depth >= 2:
                score += 4

    # --- content signals (no context required, regex over the commitment text) ---
    text = f"{commitment.description or ''} {commitment.evidence or ''}"
    if _HIGH_STAKES_RE.search(text):
        score += 12
        reasons.append("contains money/legal/contract language")
    if _DIRECT_ASK_RE.search(commitment.description or ""):
        score += 8
        # Phrased as part of the reason rather than its own clause — feels less robotic.
        if not any("waiting" in r for r in reasons):
            reasons.append("a direct ask")

    # --- confidence dampener ---
    score *= 0.5 + 0.5 * commitment.confidence
    if commitment.confidence < 0.6:
        reasons.append("low confidence, shown as a suggestion")

    score = max(0.0, score)

    priority = _label(score)
    reason = "High priority because " if priority in (Priority.critical, Priority.high) else ""
    reason += ", and ".join(reasons) + "." if reasons else "No strong urgency signals."
    return ScoredCommitment(commitment=commitment, score=score, priority=priority, reason=reason)


def _label(score: float) -> Priority:
    if score >= 60:
        return Priority.critical
    if score >= 40:
        return Priority.high
    if score >= 20:
        return Priority.medium
    if score >= 5:
        return Priority.low
    return Priority.noise
