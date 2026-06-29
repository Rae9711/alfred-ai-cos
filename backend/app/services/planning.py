"""Planning suggestions (PRD Agent 4): time-block fits and quick wins.

Rule-based v1: detect calendar gaps, estimate effort heuristically, match open
commitments and tasks to available time. No LLM — deterministic and testable."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import CommitmentOwner, CommitmentStatus, Priority, TaskStatus
from app.db.models import CalendarEvent, Commitment, Task, User
from app.schemas.today import PlanningItemType, QuickWin, TimeBlockSuggestion
from app.services.inbox_view import needs_action_message_ids
from app.services.meeting_prep import today_events
from app.services.priority import ScoredCommitment, score_commitment
from app.services.tasks import list_tasks

MIN_GAP_MINUTES = 15
MAX_SUGGESTIONS = 2
MAX_QUICK_WINS = 3
QUICK_WIN_MAX_MINUTES = 5

_QUICK_PATTERNS = re.compile(
    r"\b(confirm|rsvp|mark|paid|okay?|yes/no|reply ok|one.?line|quick)\b",
    re.IGNORECASE,
)
_REPLY_PATTERNS = re.compile(r"\b(reply|respond|email|text|send)\b", re.IGNORECASE)


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


@dataclass(frozen=True)
class TimeGap:
    start: datetime
    end: datetime

    @property
    def duration_minutes(self) -> int:
        return max(0, int((self.end - self.start).total_seconds() // 60))


@dataclass(frozen=True)
class PlanCandidate:
    item_id: str
    item_type: PlanningItemType
    title: str
    estimated_minutes: int
    score: float


def _local_tz(timezone: str | None):
    try:
        return ZoneInfo(timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return UTC


def estimate_effort_minutes(text: str) -> int:
    """Heuristic effort estimate when no explicit duration exists."""
    t = text.strip()
    if not t:
        return 20
    if _QUICK_PATTERNS.search(t):
        return 5
    if _REPLY_PATTERNS.search(t) and len(t) < 100:
        return 15
    if len(t) <= 40:
        return 5
    if len(t) > 140:
        return 30
    return 20


def find_free_gaps(
    events: list[CalendarEvent],
    *,
    now: datetime,
    day_end: datetime,
    min_minutes: int = MIN_GAP_MINUTES,
) -> list[TimeGap]:
    """Gaps from now through end of local day, including between meetings."""
    min_delta = timedelta(minutes=min_minutes)
    now = _as_utc(now)
    day_end = _as_utc(day_end)
    upcoming = sorted(
        (
            e
            for e in events
            if e.start_time is not None
            and e.end_time is not None
            and _as_utc(e.end_time) > now
            and _as_utc(e.start_time) < day_end
        ),
        key=lambda e: _as_utc(e.start_time),  # type: ignore[arg-type]
    )

    gaps: list[TimeGap] = []
    cursor = now
    for event in upcoming:
        start = _as_utc(event.start_time)  # type: ignore[arg-type]
        end = _as_utc(event.end_time)  # type: ignore[arg-type]
        if start > cursor and start - cursor >= min_delta:
            gaps.append(TimeGap(start=cursor, end=start))
        cursor = max(cursor, end)

    if day_end > cursor and day_end - cursor >= min_delta:
        gaps.append(TimeGap(start=cursor, end=day_end))
    return gaps


def _format_time(dt: datetime, tz: ZoneInfo) -> str:
    return dt.astimezone(tz).strftime("%H:%M")


def _gap_reason(gap: TimeGap, estimated: int, tz: ZoneInfo) -> str:
    start = _format_time(gap.start, tz)
    end = _format_time(gap.end, tz)
    return (
        f"You have {gap.duration_minutes} min free ({start}–{end}); "
        f"suggest finishing this (~{estimated} min)"
    )


def _candidates_from_commitments(
    scored: list[ScoredCommitment],
    *,
    needs_action_ids: set[str],
) -> list[PlanCandidate]:
    out: list[PlanCandidate] = []
    for s in scored:
        if s.commitment.owner != CommitmentOwner.user:
            continue
        if s.priority == Priority.noise:
            continue
        source_id = s.commitment.source_id
        if not source_id or source_id not in needs_action_ids:
            continue
        title = s.commitment.description
        out.append(
            PlanCandidate(
                item_id=s.commitment.id,
                item_type="commitment",
                title=title,
                estimated_minutes=estimate_effort_minutes(title),
                score=float(s.score),
            )
        )
    return out


def _candidates_from_tasks(
    tasks: list[Task],
    *,
    needs_action_ids: set[str],
) -> list[PlanCandidate]:
    out: list[PlanCandidate] = []
    for task in tasks:
        if task.status != TaskStatus.open:
            continue
        if not task.source_id or task.source_id not in needs_action_ids:
            continue
        title = task.title
        priority_bonus = {
            Priority.critical: 40.0,
            Priority.high: 30.0,
            Priority.medium: 20.0,
            Priority.low: 10.0,
            Priority.noise: 0.0,
        }[task.priority]
        out.append(
            PlanCandidate(
                item_id=task.id,
                item_type="task",
                title=title,
                estimated_minutes=estimate_effort_minutes(title),
                score=priority_bonus,
            )
        )
    return out


def _pick_time_block_suggestions(
    gaps: list[TimeGap],
    candidates: list[PlanCandidate],
    *,
    tz: ZoneInfo,
    used_ids: set[str],
) -> list[TimeBlockSuggestion]:
    if not gaps or not candidates:
        return []

    suggestions: list[TimeBlockSuggestion] = []
    ranked = sorted(candidates, key=lambda c: (-c.score, c.estimated_minutes))

    for gap in gaps:
        for cand in ranked:
            if cand.item_id in used_ids:
                continue
            if cand.estimated_minutes > gap.duration_minutes:
                continue
            suggestions.append(
                TimeBlockSuggestion(
                    gap_start=gap.start.isoformat(),
                    gap_end=gap.end.isoformat(),
                    duration_minutes=gap.duration_minutes,
                    item_id=cand.item_id,
                    item_type=cand.item_type,
                    title=cand.title,
                    estimated_minutes=cand.estimated_minutes,
                    reason=_gap_reason(gap, cand.estimated_minutes, tz),
                )
            )
            used_ids.add(cand.item_id)
            break
        if len(suggestions) >= MAX_SUGGESTIONS:
            break
    return suggestions


def _pick_quick_wins(
    candidates: list[PlanCandidate],
    *,
    used_ids: set[str],
) -> list[QuickWin]:
    quick = [
        c
        for c in sorted(candidates, key=lambda c: (-c.score, len(c.title)))
        if c.estimated_minutes <= QUICK_WIN_MAX_MINUTES and c.item_id not in used_ids
    ]
    return [
        QuickWin(
            id=c.item_id,
            title=c.title,
            item_type=c.item_type,
            estimated_minutes=c.estimated_minutes,
        )
        for c in quick[:MAX_QUICK_WINS]
    ]


def build_planning_suggestions(
    db: Session,
    user_id: str,
    *,
    today: date,
    scored: list[ScoredCommitment] | None = None,
    now: datetime | None = None,
) -> tuple[list[TimeBlockSuggestion], list[QuickWin]]:
    """Return time-block suggestions and quick wins for the current local day."""
    now = now or datetime.now(UTC)
    user = db.get(User, user_id)
    tz = _local_tz(user.timezone if user else None)

    local_now = now.astimezone(tz)
    day_end = local_now.replace(hour=23, minute=59, second=59, microsecond=0)

    events = today_events(db, user_id, timezone=user.timezone if user else None)
    gaps = find_free_gaps(events, now=now, day_end=day_end.astimezone(UTC))

    if scored is None:
        open_commitments = list(
            db.scalars(
                select(Commitment).where(
                    Commitment.user_id == user_id,
                    Commitment.status == CommitmentStatus.open,
                )
            )
        )
        from app.services.priority import build_context

        context = build_context(db, user) if user is not None else None
        scored = [
            score_commitment(c, today=today, context=context) for c in open_commitments
        ]

    tasks = list_tasks(db, user_id, status=TaskStatus.open)
    needs_action_ids = needs_action_message_ids(db, user_id)
    candidates = _candidates_from_commitments(
        scored,
        needs_action_ids=needs_action_ids,
    ) + _candidates_from_tasks(tasks, needs_action_ids=needs_action_ids)

    used_ids: set[str] = set()
    suggestions = _pick_time_block_suggestions(gaps, candidates, tz=tz, used_ids=used_ids)
    quick_wins = _pick_quick_wins(candidates, used_ids=used_ids)
    return suggestions, quick_wins
