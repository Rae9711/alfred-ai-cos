"""Smart notifications (PRD 12.8). Calm, not noisy: importance thresholds, quiet
hours, batching, and dedup. The decision logic is pure and tested; delivery goes
through a NotificationProvider so the transport (Expo Push now) is swappable."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from datetime import date as date_type
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import (
    ActionStatus,
    CommitmentOwner,
    CommitmentStatus,
    NotificationImportance,
    NotificationStatus,
    NotificationType,
    Priority,
)
from app.db.models import (
    ActionProposal,
    CalendarEvent,
    Commitment,
    Device,
    Notification,
    User,
)
from app.services.inbox_resolution import (
    filter_actionable_commitments,
    filter_actionable_tasks,
    handled_message_ids,
)

# Notification types that may reach the user's device. Everything else is
# still enqueued for in-app history but never pushed (distraction-minimal policy).
_PUSH_ALLOWED: frozenset[NotificationType] = frozenset(
    {
        NotificationType.needs_action_mail,
        NotificationType.meeting_prep,
        NotificationType.reminder,
    }
)

# How far ahead of remind_at we enqueue the push (beat runs every 30 min).
REMINDER_LEAD = timedelta(minutes=35)
# the synchronous propose-then-approve flows (Ask screen booking, Today Act send) where
# the user is already looking and a push would be noise.
PENDING_APPROVAL_GRACE = timedelta(minutes=2)

# How far ahead of an event we push the prep nudge. The window is wide enough to
# survive a missed beat tick (beat runs every 30 min, the window is 35 min) and dedup
# guarantees one push per event regardless of how many ticks see it.
MEETING_PREP_LEAD = timedelta(minutes=35)

# How stale a "user owes someone" commitment has to get before we push a follow-up
# nudge. Skips items with an imminent due date — those already trigger deadline_risk.
WAITING_AGING_DAYS = 3

# How long a "someone owes YOU" loop can sit before we nudge the user to chase it.
# Mirrors WAITING_AGING_DAYS so the two follow-up rails fire on the same rhythm.
STALE_WAITING_DAYS = 3


def _notification_exists(db: Session, user_id: str, dedup_key: str) -> bool:
    return (
        db.scalar(
            select(Notification.id).where(
                Notification.user_id == user_id, Notification.dedup_key == dedup_key
            )
        )
        is not None
    )


def scan_pending_approvals(db: Session, user_id: str, *, now: datetime) -> int:
    """Enqueue an approval_needed notification for proposals that have been waiting on
    the user beyond the grace window. Deduped per proposal id so a re-scan does not
    re-notify. Returns the count enqueued.

    The grace window (PENDING_APPROVAL_GRACE) skips the synchronous propose-then-approve
    flows (Ask screen booking, Today Act send) where the user is right there and a push
    would be noise."""
    cutoff = now - PENDING_APPROVAL_GRACE
    waiting = list(
        db.scalars(
            select(ActionProposal).where(
                ActionProposal.user_id == user_id,
                ActionProposal.status == ActionStatus.proposed,
                ActionProposal.approval_required.is_(True),
                ActionProposal.created_at <= cutoff,
            )
        )
    )
    enqueued = 0
    for p in waiting:
        title = "Alfred wants your approval"
        body = (p.reason or "").strip() or f"Approve a {p.action_type.value.replace('_', ' ')}."
        created = enqueue(
            db,
            user_id,
            ntype=NotificationType.approval_needed,
            title=title,
            body=body[:160],
            payload={"action_id": p.id, "deep_link": "/approvals"},
            dedup_key=f"approval:{p.id}",
        )
        if created is not None:
            enqueued += 1
    return enqueued


def scan_upcoming_meetings(db: Session, user_id: str, *, now: datetime) -> int:
    """Enqueue a meeting_prep notification for events starting within MEETING_PREP_LEAD.
    Deduped per event id so re-scans across overlapping windows do not re-push. Returns
    the count enqueued.

    The window is `now` → `now + MEETING_PREP_LEAD`: with a 30-min beat cadence and a
    35-min lead, every event gets exactly one push roughly 5-35 min before it starts."""
    horizon = now + MEETING_PREP_LEAD
    events = list(
        db.scalars(
            select(CalendarEvent).where(
                CalendarEvent.user_id == user_id,
                CalendarEvent.start_time.is_not(None),
                CalendarEvent.start_time >= now,
                CalendarEvent.start_time <= horizon,
            )
        )
    )
    enqueued = 0
    for e in events:
        dedup_key = f"prep:{e.id}"
        # Pre-check so we don't burn an LLM brief regenerating for an event we've already
        # notified about across overlapping scan windows.
        if _notification_exists(db, user_id, dedup_key):
            continue
        title = e.title or "(untitled meeting)"
        assert e.start_time is not None
        # SQLite drops tzinfo on round-trip even with DateTime(timezone=True); treat the
        # column as UTC if it comes back naive so arithmetic against `now` works.
        start = e.start_time if e.start_time.tzinfo else e.start_time.replace(tzinfo=UTC)
        minutes = max(1, int((start - now).total_seconds() // 60))
        body = f"Starts in {minutes} min" + (f" at {e.location}" if e.location else "")
        payload: dict[str, Any] = {"event_id": e.id, "deep_link": f"/meeting/{e.id}"}
        # If the meeting has no prep yet, generate a short brief and carry it in the
        # notification so the user walks in prepared (best-effort, risk 0).
        brief = _maybe_meeting_brief(db, user_id, e)
        if brief:
            payload["brief"] = brief
            body = f"{body} — {brief}"[:160]
        created = enqueue(
            db,
            user_id,
            ntype=NotificationType.meeting_prep,
            title=f"Prep: {title[:50]}",
            body=body[:160],
            payload=payload,
            dedup_key=dedup_key,
        )
        if created is not None:
            enqueued += 1
    return enqueued


def _maybe_meeting_brief(db: Session, user_id: str, event: CalendarEvent) -> str | None:
    """Generate a one-line meeting brief when the event has attendees we can find context
    for. Returns None (no LLM call) for attendee-less events, and swallows any generation
    error so a flaky LLM never blocks the prep push."""
    if not event.attendees:
        return None
    from app.services import meeting_prep

    try:
        summary = meeting_prep.prepare(db, user_id, event)
    except Exception:  # noqa: BLE001 - brief is optional; the push still fires
        return None
    text = (summary.summary or "").strip()
    return text[:180] or None


# Importance of each notification type. Below the user's threshold => batched.
_IMPORTANCE: dict[NotificationType, NotificationImportance] = {
    NotificationType.approval_needed: NotificationImportance.high,
    NotificationType.deadline_risk: NotificationImportance.high,
    NotificationType.schedule_conflict: NotificationImportance.high,
    NotificationType.meeting_prep: NotificationImportance.normal,
    NotificationType.follow_up_due: NotificationImportance.normal,
    # An unanswered_email push only fires when the priority ranker flags a commitment
    # as critical; treat it as high-importance so the user sees it past the threshold.
    NotificationType.unanswered_email: NotificationImportance.high,
    NotificationType.reminder: NotificationImportance.normal,
    NotificationType.new_mail: NotificationImportance.normal,
    NotificationType.needs_action_mail: NotificationImportance.high,
    NotificationType.daily_briefing: NotificationImportance.low,
}

# Proactiveness preference -> minimum importance that sends immediately.
_THRESHOLD: dict[str, NotificationImportance] = {
    "quiet": NotificationImportance.high,
    "balanced": NotificationImportance.normal,
    "very_proactive": NotificationImportance.low,
}


@dataclass
class DeliveryDecision:
    send_now: bool
    reason: str


def importance_of(ntype: NotificationType) -> NotificationImportance:
    return _IMPORTANCE.get(ntype, NotificationImportance.normal)


def _parse_quiet_hours(raw: object) -> tuple[time, time] | None:
    """Parse a 'HH-HH' or 'HH:MM-HH:MM' quiet-hours string into (start, end)."""
    if not isinstance(raw, str) or "-" not in raw:
        return None
    start_s, end_s = raw.split("-", 1)

    def _t(s: str) -> time | None:
        s = s.strip()
        try:
            if ":" in s:
                h, m = s.split(":")
                return time(int(h), int(m))
            return time(int(s))
        except (ValueError, TypeError):
            return None

    start, end = _t(start_s), _t(end_s)
    if start is None or end is None:
        return None
    return start, end


def in_quiet_hours(now: time, quiet: tuple[time, time] | None) -> bool:
    """True if `now` falls in the quiet window. Handles windows that cross midnight."""
    if quiet is None:
        return False
    start, end = quiet
    if start <= end:
        return start <= now < end
    # Crosses midnight, e.g. 22:00-07:00.
    return now >= start or now < end


def decide_delivery(
    *,
    ntype: NotificationType,
    now: time,
    proactiveness: str | None,
    quiet_hours_raw: object,
) -> DeliveryDecision:
    """Decide whether to send immediately or hold/batch a notification."""
    # Allowed push types always clear the proactiveness gate; quiet hours still apply.
    if ntype in _PUSH_ALLOWED:
        threshold = NotificationImportance.low
    else:
        threshold = _THRESHOLD.get(proactiveness or "balanced", NotificationImportance.normal)
    if importance_of(ntype) < threshold:
        return DeliveryDecision(False, "below importance threshold; batched")
    if in_quiet_hours(now, _parse_quiet_hours(quiet_hours_raw)):
        # High-importance items still send during quiet hours (escalation).
        if importance_of(ntype) >= NotificationImportance.high:
            return DeliveryDecision(True, "high importance overrides quiet hours")
        return DeliveryDecision(False, "held by quiet hours")
    return DeliveryDecision(True, "sent")


class NotificationProvider(Protocol):
    """Sends a push notification to a device token."""

    def send(self, *, push_token: str, title: str, body: str, data: dict[str, Any]) -> None: ...


def enqueue(
    db: Session,
    user_id: str,
    *,
    ntype: NotificationType,
    title: str,
    body: str,
    payload: dict[str, Any] | None = None,
    dedup_key: str | None = None,
) -> Notification | None:
    """Create a notification unless one with the same dedup_key already exists.
    Returns None when deduplicated (PRD 12.8 do not notify twice for the same thing)."""
    if dedup_key is not None:
        existing = db.scalar(
            select(Notification).where(
                Notification.user_id == user_id, Notification.dedup_key == dedup_key
            )
        )
        if existing is not None:
            return None
    notification = Notification(
        user_id=user_id,
        type=ntype,
        title=title,
        body=body,
        payload=payload or {},
        dedup_key=dedup_key,
        status=NotificationStatus.pending,
    )
    db.add(notification)
    db.commit()
    return notification


def devices_for(db: Session, user_id: str) -> list[Device]:
    return list(db.scalars(select(Device).where(Device.user_id == user_id)))


def quiet_hours_pref(user: User) -> object:
    return user.preferences.get("quiet_hours")


def proactiveness_pref(user: User) -> str | None:
    value = user.preferences.get("proactiveness")
    return value if isinstance(value, str) else None


def dispatch_pending(
    db: Session, user: User, *, now: time, provider: NotificationProvider
) -> dict[str, int]:
    """Send pending notifications that clear the user's threshold and quiet hours;
    leave the rest pending. Returns counts. Idempotent: only touches pending rows."""
    pending = list(
        db.scalars(
            select(Notification).where(
                Notification.user_id == user.id,
                Notification.status == NotificationStatus.pending,
            )
        )
    )
    if not pending:
        return {"sent": 0, "held": 0}

    targets = devices_for(db, user.id)
    sent = held = 0
    for n in pending:
        if n.type not in _PUSH_ALLOWED:
            n.status = NotificationStatus.suppressed
            held += 1
            continue
        decision = decide_delivery(
            ntype=n.type,
            now=now,
            proactiveness=proactiveness_pref(user),
            quiet_hours_raw=quiet_hours_pref(user),
        )
        if not decision.send_now:
            held += 1
            continue
        for device in targets:
            provider.send(
                push_token=device.push_token,
                title=n.title,
                body=n.body,
                data={"type": str(n.type), **n.payload},
            )
        n.status = NotificationStatus.sent
        n.sent_at = datetime.now(UTC)
        sent += 1
    db.commit()
    return {"sent": sent, "held": held}


def scan_task_reminders(db: Session, user_id: str, *, now: datetime) -> int:
    """Enqueue reminder notifications for tasks whose remind_at is approaching."""
    from app.db.enums import TaskStatus
    from app.db.models import Task

    horizon = now + REMINDER_LEAD
    tasks = filter_actionable_tasks(
        list(
            db.scalars(
                select(Task).where(
                    Task.user_id == user_id,
                    Task.status == TaskStatus.open,
                    Task.remind_at.is_not(None),
                    Task.remind_at >= now,
                    Task.remind_at <= horizon,
                )
            )
        ),
        handled_message_ids(db, user_id),
    )
    enqueued = 0
    for task in tasks:
        assert task.remind_at is not None
        at = task.remind_at if task.remind_at.tzinfo else task.remind_at.replace(tzinfo=UTC)
        minutes = max(1, int((at - now).total_seconds() // 60))
        body = (
            f"In {minutes} min"
            if minutes < 60
            else (f"Due {task.due_date}" if task.due_date else "Reminder")
        )
        created = enqueue(
            db,
            user_id,
            ntype=NotificationType.reminder,
            title=task.title[:80],
            body=body[:160],
            payload={"task_id": task.id, "deep_link": "/today"},
            dedup_key=f"reminder:{task.id}:{at.date().isoformat()}",
        )
        if created is not None:
            enqueued += 1
    return enqueued


def scan_for_risks(db: Session, user_id: str, *, today: date_type) -> int:
    """Enqueue notifications for at-risk open loops (PRD 12.8). Deduped per
    commitment+type so a rescan does not re-notify. Returns the count enqueued."""
    open_commitments = filter_actionable_commitments(
        list(
            db.scalars(
                select(Commitment).where(
                    Commitment.user_id == user_id,
                    Commitment.status == CommitmentStatus.open,
                    Commitment.due_date.is_not(None),
                )
            )
        ),
        handled_message_ids(db, user_id),
    )
    enqueued = 0
    for c in open_commitments:
        assert c.due_date is not None
        days = (c.due_date - today).days
        # Deadline risk: the user owes something due within a day or overdue.
        if c.owner == CommitmentOwner.user and days <= 1:
            label = "overdue" if days < 0 else ("due today" if days == 0 else "due tomorrow")
            created = enqueue(
                db,
                user_id,
                ntype=NotificationType.deadline_risk,
                title=f"{label.capitalize()}: {c.description[:60]}",
                body=c.reason or f"This is {label} and {c.counterparty or 'someone'} is waiting.",
                payload={"commitment_id": c.id},
                dedup_key=f"deadline:{c.id}",
            )
            if created is not None:
                enqueued += 1
    return enqueued


def scan_waiting_aging(db: Session, user_id: str, *, now: datetime) -> int:
    """Push a follow_up_due for commitments the user owes that have been sitting for
    WAITING_AGING_DAYS+ days. Skips items with an imminent due date (those already get
    a deadline_risk). Skips automated senders. Deduped per commitment id."""
    today = now.date()
    cutoff_dt = now - timedelta(days=WAITING_AGING_DAYS)
    stale = filter_actionable_commitments(
        list(
            db.scalars(
                select(Commitment).where(
                    Commitment.user_id == user_id,
                    Commitment.status == CommitmentStatus.open,
                    Commitment.owner == CommitmentOwner.user,
                    Commitment.counterparty.is_not(None),
                    Commitment.from_automated.is_(False),
                    Commitment.created_at <= cutoff_dt,
                )
            )
        ),
        handled_message_ids(db, user_id),
    )
    enqueued = 0
    for c in stale:
        # Skip when deadline_risk would (or will) fire for the same commitment.
        if c.due_date is not None and (c.due_date - today).days <= 1:
            continue
        # _age_days mirrors waiting.build_waiting so the push text matches the screen.
        created_at = c.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)
        age = max((now - created_at).days, 0)
        title = f"{c.counterparty} is still waiting"
        body = f"{age} days on: {c.description[:80]}"
        created = enqueue(
            db,
            user_id,
            ntype=NotificationType.follow_up_due,
            title=title[:80],
            body=body[:160],
            payload={"commitment_id": c.id, "deep_link": "/waiting"},
            dedup_key=f"aging:{c.id}",
        )
        if created is not None:
            enqueued += 1
    return enqueued


def _prepare_follow_up_action(db: Session, user: User, commitment: Commitment) -> str | None:
    """Auto-draft a chase reply (internal prep, risk 1) and stage a SEND as a risk-3
    ActionProposal that requires user approval. Returns the proposal id, or None when no
    draft could be generated. Never auto-sends: the send flows through the normal
    execution spine only after the user approves.

    Best-effort — a failure here must not stop the notification from going out."""
    from app.db.enums import ActionType
    from app.services import prep_draft
    from app.services.actions import propose_action_internal

    try:
        draft_id = prep_draft.ensure_draft_for(db, user, commitment=commitment)
        if draft_id is None:
            return None
        proposal = propose_action_internal(
            db,
            user,
            action_type=ActionType.send_email,
            target={"draft_reply_id": draft_id},
            reason=(
                f"Follow up with {commitment.counterparty or 'them'} on: "
                f"{commitment.description[:80]}"
            ),
        )
        return proposal.id
    except Exception:  # noqa: BLE001 - proactivity is a nice-to-have, never a blocker
        db.rollback()
        return None


def scan_stale_waiting(
    db: Session, user: User, *, now: datetime, auto_follow_up: bool = True
) -> int:
    """Nudge the user to chase loops where SOMEONE OWES THEM and the item has been open
    for STALE_WAITING_DAYS+ days (the `you_are_waiting_on` direction of build_waiting).

    For each newly-nudged item we also auto-draft a follow-up and stage a risk-3 send
    proposal for approval (see _prepare_follow_up_action). Deduped per commitment id, so
    the draft/proposal is created at most once per stale loop."""
    from app.services.waiting import build_waiting

    view = build_waiting(db, user.id)
    enqueued = 0
    for entry in view.you_are_waiting_on:
        c = entry.commitment
        # Recompute age against the caller's `now` (build_waiting ages against wall-clock),
        # so the beat and tests agree on staleness.
        created_at = c.created_at if c.created_at.tzinfo else c.created_at.replace(tzinfo=UTC)
        age = max((now - created_at).days, 0)
        if age < STALE_WAITING_DAYS:
            continue
        dedup_key = f"chase:{c.id}"
        if _notification_exists(db, user.id, dedup_key):
            continue
        title = f"Chase {c.counterparty}" if c.counterparty else "Chase a stalled reply"
        body = f"{age} days waiting: {c.description[:80]}"
        payload: dict[str, Any] = {"commitment_id": c.id, "deep_link": "/waiting"}
        if auto_follow_up:
            proposal_id = _prepare_follow_up_action(db, user, c)
            if proposal_id is not None:
                payload["action_id"] = proposal_id
                payload["deep_link"] = "/approvals"
        created = enqueue(
            db,
            user.id,
            ntype=NotificationType.follow_up_due,
            title=title[:80],
            body=body[:160],
            payload=payload,
            dedup_key=dedup_key,
        )
        if created is not None:
            enqueued += 1
    return enqueued


def scan_schedule_conflicts(db: Session, user_id: str, *, now: datetime) -> int:
    """Detect overlapping calendar events in the next 48 hours and push a
    schedule_conflict for each pair. Deduped per ordered (id_a, id_b) pair so a
    later scan doesn't re-fire. Skips all-day events (start_time is required)."""
    horizon = now + timedelta(hours=48)
    events = list(
        db.scalars(
            select(CalendarEvent)
            .where(
                CalendarEvent.user_id == user_id,
                CalendarEvent.start_time.is_not(None),
                CalendarEvent.end_time.is_not(None),
                CalendarEvent.start_time >= now,
                CalendarEvent.start_time <= horizon,
            )
            .order_by(CalendarEvent.start_time)
        )
    )
    enqueued = 0
    for i, a in enumerate(events):
        assert a.start_time is not None and a.end_time is not None
        a_start = a.start_time if a.start_time.tzinfo else a.start_time.replace(tzinfo=UTC)
        a_end = a.end_time if a.end_time.tzinfo else a.end_time.replace(tzinfo=UTC)
        for b in events[i + 1 :]:
            assert b.start_time is not None and b.end_time is not None
            b_start = b.start_time if b.start_time.tzinfo else b.start_time.replace(tzinfo=UTC)
            b_end = b.end_time if b.end_time.tzinfo else b.end_time.replace(tzinfo=UTC)
            # Once a's end <= b's start, all subsequent b's start later → no further
            # overlap with a is possible (events are sorted by start). Bail early.
            if a_end <= b_start:
                break
            if b_end <= a_start:
                continue
            # Overlap. Push one notification per ordered pair (lexicographic on id
            # so the dedup key is stable regardless of which event we saw first).
            id_lo, id_hi = sorted([a.id, b.id])
            title = "Calendar conflict"
            body = f"{a.title or '(untitled)'} overlaps with {b.title or '(untitled)'}"
            created = enqueue(
                db,
                user_id,
                ntype=NotificationType.schedule_conflict,
                title=title,
                body=body[:160],
                payload={
                    "event_ids": [a.id, b.id],
                    "deep_link": f"/meeting/{a.id}",
                },
                dedup_key=f"conflict:{id_lo}:{id_hi}",
            )
            if created is not None:
                enqueued += 1
    return enqueued


def scan_top_priorities(db: Session, user: User, *, today: date_type) -> int:
    """Push for open commitments the priority ranker now considers critical. The
    ranker reads sender history, dismissal patterns, thread depth, and content
    signals — so this fires only when something genuinely important rises to the
    top, not for every new email. Dedup per commitment id ensures one push per
    item across re-scans.

    When the commitment came from an email, pre-generate a draft reply so the
    push deep-links to a review-and-send screen — the user gets to act in one
    screen, not bounce through inbox → message → draft."""
    # Local imports to avoid the notifications/priority + notifications/draft
    # module cycles.
    from app.services import prep_draft, priority

    context = priority.build_context(db, user)
    open_commitments = filter_actionable_commitments(
        list(
            db.scalars(
                select(Commitment).where(
                    Commitment.user_id == user.id,
                    Commitment.status == CommitmentStatus.open,
                )
            )
        ),
        handled_message_ids(db, user.id),
    )
    enqueued = 0
    for c in open_commitments:
        scored = priority.score_commitment(c, today=today, context=context)
        if scored.priority != Priority.critical:
            continue
        counterparty = c.counterparty or "Someone"
        title = f"Top priority: {counterparty} — {c.description[:60]}"
        body = scored.reason
        # Try to pre-draft a reply. If anything goes wrong (no source message,
        # LLM unavailable), fall back to the original "/today" deep link.
        draft_id = prep_draft.ensure_draft_for(db, user, commitment=c)
        deep_link = f"/draft/{draft_id}" if draft_id else "/today"
        payload: dict[str, Any] = {"commitment_id": c.id, "deep_link": deep_link}
        if draft_id:
            payload["draft_reply_id"] = draft_id
        created = enqueue(
            db,
            user.id,
            ntype=NotificationType.unanswered_email,
            title=title[:80],
            body=body[:160],
            payload=payload,
            dedup_key=f"top:{c.id}",
        )
        if created is not None:
            enqueued += 1
    return enqueued
