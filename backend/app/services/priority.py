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
from app.services.learning import LearningView, adjustment_for, get_learning
from app.services.sender_class import (
    PRIORITY_CEILING_FOR_CLASS,
    SCORE_MULTIPLIER_FOR_CLASS,
)

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
    # Map commitment.source_id → sender_classification (one of person/role_account/
    # automated/bulk/suspicious/vip/muted/transactional_critical). The classifier
    # ran at ingest time so this is a pure dict lookup. The ranker uses it to apply
    # hard ceilings and score multipliers — the spam shield.
    sender_class: dict[str, str] = field(default_factory=dict)
    # Outbound replies the user has sent to anyone at a given DOMAIN over the recent
    # window. Used for warm-up detection: if the user has talked with mary@buyer.co,
    # a NEW inbound from john@buyer.co isn't really a "first-time sender" — it's
    # someone at an established contact's company. Halves the cold-contact penalty.
    user_replies_to_domain: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    # Per-user learning snapshot. Bounded score adjustments per sender and per
    # keyword category, derived from the user's accept/dismiss/snooze/act history.
    # The ranker adds adjustment_for(...) to the final score so learning shows up
    # as a small, explainable shift on top of the deterministic rules.
    learning: LearningView | None = None


def build_context(db: Session, user: User, *, now: datetime | None = None) -> ScoringContext:
    """Compute the per-user signal lookups for ranking. Cheap: 3 SQL queries
    regardless of how many commitments exist."""
    now = now or datetime.now(UTC)
    window_start = now - timedelta(days=30)
    user_email = (user.email or "").lower()
    ctx = ScoringContext()
    ctx.learning = get_learning(user)

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
        # the user "replies to" by getting back in touch. Track both the exact
        # address (for VIP boost) and the domain (for warm-up detection of any
        # new contact at the same company).
        if user_email and sender == user_email:
            for r in msg.recipients or []:
                recipient = str(r).lower()
                ctx.user_replies_to[recipient] += 1
                if "@" in recipient:
                    ctx.user_replies_to_domain[recipient.split("@", 1)[1]] += 1
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
            select(
                Message.id,
                Message.sender,
                Message.thread_id,
                Message.sender_classification,
            ).where(Message.id.in_(source_ids))
        ).all()
        for src_id, sender, thread_id, cls in rows:
            ctx.commitment_context[src_id] = (
                (sender or "").lower() or None,
                thread_id,
            )
            if cls:
                ctx.sender_class[src_id] = cls
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

            # Stranger penalty — with two warm-up exceptions:
            # (a) Same-domain warm-up: if the user has replied to ANYONE at this
            #     sender's domain (mary@buyer.co), a new sender at that domain
            #     (john@buyer.co) isn't really a stranger — it's an extended
            #     contact at the same company. Halve the penalty.
            # (b) Repeat-cold warm-up: if the SAME unknown sender has written
            #     2+ times (inbound > 1) and we still haven't replied, drop
            #     the penalty entirely — they're an active conversation we
            #     haven't engaged yet, which is more important than a one-off.
            if inbound <= 1 and replies == 0:
                sender_dom = sender.split("@", 1)[1] if "@" in sender else ""
                same_domain_replies = (
                    context.user_replies_to_domain.get(sender_dom, 0) if sender_dom else 0
                )
                if same_domain_replies >= 1:
                    score -= 5
                    reasons.append(f"new contact at {sender_dom} (you talk with colleagues there)")
                else:
                    score -= 10
                    reasons.append("first-time sender")
            # No `elif`: if inbound >= 2 the stranger penalty doesn't fire at
            # all — repeat-cold warm-up is the absence of a penalty, not a bonus.

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

    # --- learned per-user adjustment (small, bounded, explainable) ---
    if context is not None and context.learning is not None:
        from app.services.learning import _categories_in

        sender = None
        if commitment.source_id:
            sender, _ = context.commitment_context.get(commitment.source_id, (None, None))
        cats = _categories_in(text)
        learn_delta = adjustment_for(context.learning, sender=sender, categories=cats)
        if abs(learn_delta) >= 1.0:
            score += learn_delta
            if learn_delta > 0:
                reasons.append("learned: matches what you usually act on")
            else:
                reasons.append("learned: similar items you usually dismiss")

    # --- bonus cap (anti-stacking guard rail) ---
    # Without a cap, a marketing email can fire money + ask + urgency + LLM-critical
    # + low-stakes deadline and stack to ~90. Capping the ADDITIVE score (before
    # baseline urgency) at 80 means even worst-case stacking can't push spam to
    # critical on its own; the sender class still has to allow it.
    score = min(score, 95.0)

    # --- sender class shield: multiplier + hard ceiling ---
    # The deterministic classifier ran at ingest time. Look it up and apply the
    # class-specific multiplier BEFORE confidence dampening so the score that
    # gets logged in the reason already reflects the spam shield.
    cls = "person"
    if context is not None and commitment.source_id:
        cls = context.sender_class.get(commitment.source_id, "person") or "person"
    multiplier = SCORE_MULTIPLIER_FOR_CLASS.get(cls, 1.0)
    if multiplier != 1.0:
        score *= multiplier
        # Surface the shield in the reason so the user knows WHY a hyped item
        # didn't rank — and so they can VIP the sender if they disagree.
        if cls in {"automated", "bulk"}:
            reasons.append("from an automated / bulk sender (capped)")
        elif cls == "suspicious":
            reasons.append("looks like spam or phishing (suppressed)")
        elif cls == "muted":
            reasons.append("you muted this sender (capped)")
        elif cls == "role_account":
            reasons.append("from a shared inbox / role address")
        elif cls == "vip":
            reasons.append("from a sender you marked VIP")

    # --- confidence dampener ---
    score *= 0.5 + 0.5 * commitment.confidence
    if commitment.confidence < 0.6:
        reasons.append("low confidence, shown as a suggestion")

    score = max(0.0, score)

    priority = _label(score)

    # --- HARD CEILING by sender class ---
    # This is the no-questions-asked spam shield: an automated sender CANNOT
    # produce a critical-priority push, no matter how the additive bonuses
    # stacked. The user retains control via the VIP/muted overrides.
    ceiling_name = PRIORITY_CEILING_FOR_CLASS.get(cls, "critical")
    priority = _apply_ceiling(priority, ceiling_name)

    # --- HARD FLOOR for low-confidence items ---
    # Extraction confidence is the LLM's own self-rated certainty. Anything
    # below 0.5 stays a suggestion (medium at most) even if the keyword signals
    # fired — too uncertain to ping the user.
    if commitment.confidence < 0.5:
        priority = _apply_ceiling(priority, "medium")

    # If the spam shield demoted the bucket, clamp the score to the FLOOR of
    # the new bucket so shield-demoted items always sort BELOW organic items
    # in the same bucket. A "low"-priority real-person item (score 12) will
    # sort above a "low"-priority shielded spam item (score floored to ~5.01).
    organic_bucket = _label(score)
    if _PRIORITY_ORDER[priority] < _PRIORITY_ORDER[organic_bucket]:
        # Shield kicked in. Pin to the floor of the demoted bucket + a small
        # fractional residual derived from raw score, so different spam items
        # still have meaningful within-bucket ordering.
        floor = _SCORE_FLOOR_FOR_BUCKET[priority]
        ceiling = _SCORE_CEILING_FOR_BUCKET[priority]
        residual = min(score, ceiling - floor) * 0.01
        score = floor + residual
    else:
        # Organic — clamp to the top of the bucket so a critical organic item
        # can't outrank a critical organic item from a higher class.
        score = min(score, _SCORE_CEILING_FOR_BUCKET[priority])

    reason = "High priority because " if priority in (Priority.critical, Priority.high) else ""
    reason += ", and ".join(reasons) + "." if reasons else "No strong urgency signals."
    return ScoredCommitment(commitment=commitment, score=score, priority=priority, reason=reason)


# Score ceilings for organic buckets (no shield demotion). Match `_label`'s
# lower bound for the next bucket up, minus 0.01.
_SCORE_CEILING_FOR_BUCKET: dict[Priority, float] = {
    Priority.critical: 100.0,
    Priority.high: 59.99,
    Priority.medium: 39.99,
    Priority.low: 19.99,
    Priority.noise: 4.99,
}

# Score floors for SHIELD-DEMOTED items. A spam item pinned to `low` lands at
# this score plus a tiny residual; this is the floor of the bucket, so any
# organic item in the same bucket sorts above it.
_SCORE_FLOOR_FOR_BUCKET: dict[Priority, float] = {
    Priority.critical: 60.0,
    Priority.high: 40.0,
    Priority.medium: 20.0,
    Priority.low: 5.0,
    Priority.noise: 0.0,
}


# Priority order for the _apply_ceiling helper. Higher = more important.
_PRIORITY_ORDER: dict[Priority, int] = {
    Priority.noise: 0,
    Priority.low: 1,
    Priority.medium: 2,
    Priority.high: 3,
    Priority.critical: 4,
}

# Names exactly as the sender_class ceiling table emits them.
_PRIORITY_BY_NAME: dict[str, Priority] = {
    "noise": Priority.noise,
    "low": Priority.low,
    "medium": Priority.medium,
    "high": Priority.high,
    "critical": Priority.critical,
}


def _apply_ceiling(current: Priority, ceiling_name: str) -> Priority:
    """Clamp `current` down to the named ceiling. Returns the lower of the two."""
    ceiling = _PRIORITY_BY_NAME.get(ceiling_name, Priority.critical)
    return current if _PRIORITY_ORDER[current] <= _PRIORITY_ORDER[ceiling] else ceiling


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
