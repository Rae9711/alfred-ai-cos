"""WeChat (and similar) conversation import: parse → analyze → confirm.

Raw pasted chats are never persisted. Only user-confirmed actions become Tasks,
Commitments, or calendar events (via the approval spine), each with evidence.
"""

from __future__ import annotations

import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import (
    ActionType,
    CommitmentOwner,
    CommitmentStatus,
    Priority,
    SourceType,
    TaskStatus,
)
from app.db.models import Commitment, Task, User
from app.llm import get_llm
from app.schemas.api import (
    ConversationActionOut,
    ConversationAnalyzeResponse,
    ConversationConfirmRequest,
    ConversationConfirmResponse,
    ConversationInboxItem,
    ConversationInboxResponse,
    ConversationMessageOut,
    ParsedConversationOut,
    ParticipantOut,
    ReplySuggestionOut,
)
from app.schemas.llm import (
    ConversationActionKind,
    ConversationActionTier,
    ConversationSource,
    MessageRole,
    NormalizedConversation,
)
from app.services import execution
from app.services import tasks as task_service
from app.services.actions import propose_action_internal

# Short acknowledgements / stickers that should be down-weighted in context.
_NOISE_RE = re.compile(
    r"^("
    r"好|嗯|哦|噢|ok|okay|kk|收到|哈哈+|呵呵+|已吃|已读|\[.*?\]|（.*?）"
    r")$",
    re.IGNORECASE,
)

# WeChat-ish sender line: optional timestamp after the name.
# Examples: "6330", "Rui🌞", "张三 12:43", "Alex 昨天 21:05"
_SENDER_LINE_RE = re.compile(
    r"^(?P<sender>.+?)(?:\s+(?P<ts>\d{1,2}:\d{2}|昨天\s*\d{1,2}:\d{2}|今天\s*\d{1,2}:\d{2}))?$"
)

_DEFAULT_TONES = ["natural", "caring", "brief"]

_GOAL_LABELS = {
    "comfort": "安慰 / comfort the other person",
    "follow_up": "继续追问 / ask a thoughtful follow-up question",
    "confirm": "确认安排 / confirm plans or logistics",
    "custom": "natural continuation matching the conversation",
}


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _parse_optional_timestamp(raw: str | None) -> datetime | None:
    if not raw:
        return None
    raw = raw.strip()
    # HH:MM only — attach today's UTC date as a best-effort placeholder.
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", raw)
    if m:
        today = datetime.now(UTC).date()
        return datetime(
            today.year, today.month, today.day, int(m.group(1)), int(m.group(2)), tzinfo=UTC
        )
    return None


def _is_probable_sender(line: str) -> bool:
    """Heuristic: short line without sentence punctuation is likely a sender name."""
    if not line or len(line) > 40:
        return False
    if any(ch in line for ch in "。！？.!?，,"):
        return False
    # Pure timestamps are not senders.
    if re.fullmatch(r"\d{1,2}:\d{2}", line):
        return False
    return True


def _looks_like_wechat_blocks(text: str) -> bool:
    """True when the paste has alternating short sender lines and content blocks."""
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text.strip()) if b.strip()]
    if len(blocks) < 2:
        return False
    senderish = 0
    for block in blocks:
        first = block.splitlines()[0].strip()
        if _is_probable_sender(first):
            senderish += 1
    return senderish >= max(2, len(blocks) // 2)


def parse_wechat_deterministic(text: str) -> ParsedConversationOut | None:
    """Parse WeChat multi-select copy without an LLM.

    Expected shape (blank-line separated blocks):
        Sender
        message content
        (optional more content lines)

    Or:
        Sender 12:43
        message content
    """
    text = text.strip()
    if not text:
        return None
    if not _looks_like_wechat_blocks(text):
        return None

    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    messages: list[ConversationMessageOut] = []
    names: list[str] = []

    for block in blocks:
        lines = [ln.rstrip() for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        first = lines[0].strip()
        m = _SENDER_LINE_RE.match(first)
        if m and _is_probable_sender(m.group("sender").strip()):
            sender = m.group("sender").strip()
            ts_raw = m.group("ts")
            content = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""
            if not content:
                # Single-line block: treat whole thing as content from unknown if
                # it doesn't look like name-only.
                continue
        else:
            sender = "Unknown"
            ts_raw = None
            content = "\n".join(lines).strip()

        if not content:
            continue
        if sender not in names and sender != "Unknown":
            names.append(sender)

        weight = 0.3 if _NOISE_RE.match(content.strip()) else 1.0
        messages.append(
            ConversationMessageOut(
                id=str(uuid.uuid4()),
                sender=sender,
                timestamp=_parse_optional_timestamp(ts_raw),
                content=content,
                role=MessageRole.unknown,
                is_selected=weight >= 1.0,
                weight=weight,
            )
        )

    if len(messages) < 1:
        return None

    participants = [ParticipantOut(name=n, is_self=False) for n in names]
    return ParsedConversationOut(
        id=str(uuid.uuid4()),
        source=ConversationSource.wechat,
        participants=participants,
        messages=messages,
        imported_at=_utcnow(),
    )


def _from_normalized(normalized: NormalizedConversation) -> ParsedConversationOut:
    messages: list[ConversationMessageOut] = []
    for msg in normalized.messages:
        content = (msg.content or "").strip()
        if not content:
            continue
        is_noise = bool(msg.is_noise) or bool(_NOISE_RE.match(content))
        messages.append(
            ConversationMessageOut(
                id=str(uuid.uuid4()),
                sender=msg.sender.strip() or "Unknown",
                timestamp=_parse_optional_timestamp(msg.timestamp),
                content=content,
                role=MessageRole.unknown,
                is_selected=not is_noise,
                weight=0.3 if is_noise else 1.0,
            )
        )
    names = list(normalized.participants) or sorted(
        {m.sender for m in messages if m.sender != "Unknown"}
    )
    return ParsedConversationOut(
        id=str(uuid.uuid4()),
        source=normalized.source or ConversationSource.wechat,
        participants=[ParticipantOut(name=n, is_self=False) for n in names],
        messages=messages,
        imported_at=_utcnow(),
    )


def parse_conversation(text: str, *, use_llm_fallback: bool = True) -> ParsedConversationOut:
    """Parse pasted chat text. Prefer deterministic WeChat parser; LLM repairs messy copy."""
    parsed = parse_wechat_deterministic(text)
    if parsed is not None:
        return parsed
    if not use_llm_fallback:
        # Last resort: treat whole paste as one message.
        return ParsedConversationOut(
            id=str(uuid.uuid4()),
            source=ConversationSource.unknown,
            participants=[],
            messages=[
                ConversationMessageOut(
                    id=str(uuid.uuid4()),
                    sender="Unknown",
                    timestamp=None,
                    content=text.strip(),
                    role=MessageRole.unknown,
                    is_selected=True,
                    weight=1.0,
                )
            ],
            imported_at=_utcnow(),
        )
    normalized = get_llm().normalize_conversation(raw_text=text)
    return _from_normalized(normalized)


def _selected_messages(conversation: ParsedConversationOut) -> list[ConversationMessageOut]:
    selected = [m for m in conversation.messages if m.is_selected]
    return selected or list(conversation.messages)


def _format_context(messages: list[ConversationMessageOut]) -> str:
    lines: list[str] = []
    for i, m in enumerate(messages):
        ts = f" ({m.timestamp.isoformat()})" if m.timestamp else ""
        lines.append(f"[{i}] {m.sender}{ts}: {m.content}")
    return "\n".join(lines)


def _assign_tier(
    *,
    kind: ConversationActionKind,
    confidence: float,
    start: str | None,
    due_date: date | None,
    suggested_time: str | None,
) -> ConversationActionTier:
    has_explicit_time = bool(start) or due_date is not None
    if kind == ConversationActionKind.follow_up and not has_explicit_time:
        return ConversationActionTier.follow_up_suggestion
    if kind == ConversationActionKind.calendar_event and start and confidence >= 0.7:
        return ConversationActionTier.explicit_time
    if has_explicit_time and confidence >= 0.75:
        return ConversationActionTier.explicit_time
    if kind == ConversationActionKind.follow_up:
        return ConversationActionTier.follow_up_suggestion
    if suggested_time and not has_explicit_time:
        return ConversationActionTier.action_no_time
    if not has_explicit_time:
        return ConversationActionTier.action_no_time
    return ConversationActionTier.explicit_time


def analyze_conversation(
    conversation: ParsedConversationOut,
    *,
    goal: str = "custom",
    tones: list[str] | None = None,
    user: User | None = None,
    timezone: str = "UTC",
) -> ConversationAnalyzeResponse:
    """Run reply generation and action extraction in parallel over the same context."""
    selected = _selected_messages(conversation)
    context = _format_context(selected)
    tone_options = tones or list(_DEFAULT_TONES)
    goal_text = _GOAL_LABELS.get(goal, goal) if goal else _GOAL_LABELS["custom"]
    user_name = user.name if user else None
    reference_date = datetime.now(UTC).date()
    try:
        ZoneInfo(timezone)
        tz = timezone
    except (ZoneInfoNotFoundError, ValueError):
        tz = "UTC"

    llm = get_llm()

    def _replies() -> list[ReplySuggestionOut]:
        result = llm.draft_conversation_replies(
            context=context,
            goal=goal_text,
            tone_options=tone_options,
            user_name=user_name,
        )
        return [ReplySuggestionOut(tone=r.tone, body=r.body) for r in result.replies]

    def _actions() -> list[ConversationActionOut]:
        result = llm.extract_conversation_actions(
            context=context,
            reference_date=reference_date,
            user_timezone=tz,
            user_name=user_name,
        )
        out: list[ConversationActionOut] = []
        for raw in result.actions:
            evidence_ids: list[str] = []
            for idx in raw.evidence_message_indexes:
                if 0 <= idx < len(selected):
                    evidence_ids.append(selected[idx].id)
            if not evidence_ids and selected:
                # Fall back to last selected message so provenance is never empty.
                evidence_ids = [selected[-1].id]
            tier = _assign_tier(
                kind=raw.type,
                confidence=raw.confidence,
                start=raw.start,
                due_date=raw.due_date,
                suggested_time=raw.suggested_time,
            )
            out.append(
                ConversationActionOut(
                    id=str(uuid.uuid4()),
                    type=raw.type,
                    title=raw.title,
                    due_date=raw.due_date,
                    start=raw.start,
                    end=raw.end,
                    suggested_time=raw.suggested_time,
                    confidence=raw.confidence,
                    evidence=raw.evidence,
                    evidence_message_ids=evidence_ids,
                    tier=tier,
                    status="suggested",
                )
            )
        return out

    with ThreadPoolExecutor(max_workers=2) as pool:
        replies_fut = pool.submit(_replies)
        actions_fut = pool.submit(_actions)
        replies = replies_fut.result()
        actions = actions_fut.result()

    return ConversationAnalyzeResponse(reply_suggestions=replies, actions=actions)


def _default_remind_at(due: date, tz: str) -> datetime:
    try:
        local = datetime(due.year, due.month, due.day, 9, 0, tzinfo=ZoneInfo(tz))
    except (ZoneInfoNotFoundError, ValueError):
        local = datetime(due.year, due.month, due.day, 9, 0, tzinfo=UTC)
    return local.astimezone(UTC)


def _resolve_suggested_time(hint: str | None, *, tz: str) -> datetime | None:
    """Best-effort mapping of relative hints like 'tonight' into a remind_at."""
    if not hint:
        return None
    lower = hint.lower().strip()
    try:
        now = datetime.now(ZoneInfo(tz))
    except (ZoneInfoNotFoundError, ValueError):
        now = datetime.now(UTC)
    today = now.date()
    if lower in {"tonight", "今晚", " tonight"}:
        return datetime(today.year, today.month, today.day, 20, 0, tzinfo=now.tzinfo).astimezone(
            UTC
        )
    if lower in {"tomorrow", "明天", "tomorrow morning", "明天早上"}:
        d = today + timedelta(days=1)
        hour = 9 if "morning" in lower or "早" in lower else 10
        return datetime(d.year, d.month, d.day, hour, 0, tzinfo=now.tzinfo).astimezone(UTC)
    return None


def confirm_action(
    db: Session,
    user: User,
    payload: ConversationConfirmRequest,
    *,
    timezone: str = "UTC",
) -> ConversationConfirmResponse:
    """Persist a user-confirmed action. Never called automatically from extraction."""
    try:
        ZoneInfo(timezone)
        tz = timezone
    except (ZoneInfoNotFoundError, ValueError):
        tz = user.timezone or "UTC"

    kind = payload.type
    evidence = payload.evidence
    title = payload.title.strip()
    if not title:
        raise ValueError("Action title is required")

    if kind == ConversationActionKind.calendar_event:
        start = payload.start
        end = payload.end
        if not start:
            raise ValueError("calendar_event requires start")
        if not end:
            # Default 1 hour.
            try:
                start_dt = datetime.fromisoformat(start)
                end = (start_dt + timedelta(hours=1)).isoformat()
            except ValueError as exc:
                raise ValueError("Invalid start datetime") from exc
        proposal = propose_action_internal(
            db,
            user,
            action_type=ActionType.create_calendar_event,
            target={"title": title, "start": start, "end": end},
            reason=f"From conversation: {evidence[:120]}" if evidence else "From conversation",
        )
        result = execution.execute_proposal(db, user, proposal)
        event_id = (result.data or {}).get("event_id") if result.data else None
        return ConversationConfirmResponse(
            kind="calendar_event",
            id=str(event_id) if event_id else proposal.id,
            title=title,
            evidence=evidence,
            remind_at=None,
            detail=result.detail,
        )

    if kind in (ConversationActionKind.follow_up, ConversationActionKind.commitment):
        owner = (
            CommitmentOwner.user
            if kind == ConversationActionKind.commitment
            else CommitmentOwner.user
        )
        commitment = Commitment(
            user_id=user.id,
            description=title,
            owner=owner,
            counterparty=payload.counterparty,
            due_date=payload.due_date,
            priority=Priority.medium,
            status=CommitmentStatus.open,
            source_type=SourceType.conversation,
            source_id=payload.conversation_id,
            evidence=evidence,
            confidence=payload.confidence,
        )
        db.add(commitment)
        db.commit()
        return ConversationConfirmResponse(
            kind=kind.value,
            id=commitment.id,
            title=title,
            evidence=evidence,
            remind_at=None,
            detail="Saved to Alfred",
        )

    # task (default)
    remind_at = payload.remind_at
    if remind_at is None and payload.due_date is not None:
        remind_at = _default_remind_at(payload.due_date, tz)
    if remind_at is None and payload.set_reminder:
        remind_at = _resolve_suggested_time(payload.suggested_time, tz=tz)
        if remind_at is None and payload.suggested_time:
            # Fall back to tonight if user asked for a reminder without a parseable hint.
            remind_at = _resolve_suggested_time("tonight", tz=tz)

    task = task_service.create_task(
        db,
        user.id,
        title=title,
        description=payload.description,
        due_date=payload.due_date,
        remind_at=remind_at,
        priority=Priority.medium,
        source_type=SourceType.conversation,
        source_id=payload.conversation_id,
        confidence=payload.confidence,
        evidence=evidence,
    )
    return ConversationConfirmResponse(
        kind="task",
        id=task.id,
        title=task.title,
        evidence=evidence,
        remind_at=task.remind_at,
        detail="Saved to Alfred",
    )


def list_conversation_inbox(db: Session, user_id: str) -> ConversationInboxResponse:
    """Open tasks and commitments sourced from conversations, newest first."""
    tasks = list(
        db.scalars(
            select(Task)
            .where(
                Task.user_id == user_id,
                Task.source_type == SourceType.conversation,
                Task.status == TaskStatus.open,
            )
            .order_by(Task.created_at.desc())
        )
    )
    commitments = list(
        db.scalars(
            select(Commitment)
            .where(
                Commitment.user_id == user_id,
                Commitment.source_type == SourceType.conversation,
                Commitment.status == CommitmentStatus.open,
            )
            .order_by(Commitment.created_at.desc())
        )
    )

    items: list[ConversationInboxItem] = []
    for t in tasks:
        items.append(
            ConversationInboxItem(
                id=t.id,
                kind="task",
                title=t.title,
                evidence=t.evidence,
                due_date=t.due_date,
                remind_at=t.remind_at,
                created_at=t.created_at,
                source_label="微信对话",
            )
        )
    for c in commitments:
        desc_lower = (c.description or "").lower()
        kind = (
            "follow_up"
            if (
                "跟进" in (c.description or "")
                or "ask" in desc_lower
                or "询问" in (c.description or "")
            )
            else "commitment"
        )
        items.append(
            ConversationInboxItem(
                id=c.id,
                kind=kind,
                title=c.description,
                evidence=c.evidence,
                due_date=c.due_date,
                remind_at=None,
                created_at=c.created_at,
                source_label="微信对话",
            )
        )
    items.sort(key=lambda i: i.created_at or _utcnow(), reverse=True)

    counts = {
        "tasks": sum(1 for i in items if i.kind == "task"),
        "follow_ups": sum(1 for i in items if i.kind == "follow_up"),
        "commitments": sum(1 for i in items if i.kind == "commitment"),
        "calendar_events": 0,
    }
    return ConversationInboxResponse(items=items, counts=counts)
