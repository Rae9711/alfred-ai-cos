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

import structlog
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

# WeChat system / meta lines — skip as messages (not real chat content).
_SYSTEM_LINE_RE = re.compile(
    r"^("
    r"以上是历史消息|"
    r".*撤回了一条消息|"
    r".*拍了拍.*|"
    r"消息已发出，但被对方拒收|"
    r"\[图片\]|\[视频\]|\[语音\]|\[文件\]|\[动画表情\]|\[贴纸\]|"
    r"—"  # date separators like "— 昨天 —" handled separately
    r")$"
)

_DATE_SEPARATOR_RE = re.compile(r"^[\-—–]+\s*(昨天|今天|星期[一二三四五六日天]|\d{1,2}月\d{1,2}日).*$")

# WeChat-ish sender line: optional timestamp after the name.
# Examples: "6330", "Rui🌞", "张三 12:43", "Alex 昨天 21:05"
_SENDER_LINE_RE = re.compile(
    r"^(?P<sender>.+?)(?:\s+(?P<ts>\d{1,2}:\d{2}|昨天\s*\d{1,2}:\d{2}|今天\s*\d{1,2}:\d{2}))?$"
)

# Fallback: "Name：message" / "Name: message" on one line (some export styles).
# Avoid treating "张三 12:43" (time) as "张三 12" + content "43".
_INLINE_SENDER_RE = re.compile(
    r"^(?P<sender>[^:：\n]{1,40})(?:：|:(?!\d))\s*(?P<content>.+)$"
)

# Tab-separated "Name\tmessage" (some iOS clipboard representations).
_TAB_INLINE_RE = re.compile(r"^(?P<sender>[^\t\n]{1,40})\t+(?P<content>.+)$")

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
    today = datetime.now(UTC).date()
    # HH:MM only — attach today's UTC date as a best-effort placeholder.
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", raw)
    if m:
        return datetime(
            today.year, today.month, today.day, int(m.group(1)), int(m.group(2)), tzinfo=UTC
        )
    # 昨天 21:05 / 今天 09:30
    m = re.fullmatch(r"(昨天|今天)\s*(\d{1,2}):(\d{2})", raw)
    if m:
        day = today if m.group(1) == "今天" else today - timedelta(days=1)
        return datetime(
            day.year, day.month, day.day, int(m.group(2)), int(m.group(3)), tzinfo=UTC
        )
    return None


def _is_system_or_media_placeholder(content: str) -> bool:
    text = content.strip()
    if not text:
        return True
    if _DATE_SEPARATOR_RE.match(text):
        return True
    if _SYSTEM_LINE_RE.match(text):
        return True
    return False


def _is_probable_sender(line: str) -> bool:
    """Heuristic: short line without sentence punctuation is likely a sender name."""
    if not line or len(line) > 40:
        return False
    if any(ch in line for ch in "。！？.!?，,"):
        return False
    # Pure timestamps / date separators are not senders.
    if re.fullmatch(r"\d{1,2}:\d{2}", line):
        return False
    if _DATE_SEPARATOR_RE.match(line) or _SYSTEM_LINE_RE.match(line):
        return False
    return True


def _normalize_paste_text(text: str) -> str:
    """Normalize clipboard quirks before parsing (CRLF, unicode separators, NBSP)."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u2028", "\n").replace("\u2029", "\n\n")
    text = text.replace("\u00a0", " ")
    return text.strip()


def _blank_blocks(text: str) -> list[str]:
    return [b.strip() for b in re.split(r"\n\s*\n", text.strip()) if b.strip()]


def _looks_like_wechat_blocks(text: str) -> bool:
    """True when the paste has alternating short sender lines and content blocks."""
    blocks = _blank_blocks(text)
    if len(blocks) < 2:
        return False
    senderish = 0
    for block in blocks:
        first = block.splitlines()[0].strip()
        if _is_probable_sender(first):
            senderish += 1
    return senderish >= max(2, len(blocks) // 2)


def _sender_match(line: str) -> re.Match[str] | None:
    """Return a sender-line match when `line` looks like a WeChat display name."""
    m = _SENDER_LINE_RE.match(line)
    if not m:
        return None
    sender = m.group("sender").strip()
    if not _is_probable_sender(sender):
        return None
    return m


def _parse_dense_alternating(lines: list[str]) -> list[tuple[str, str, str | None]]:
    """Parse sender/content pairs without requiring blank-line separators.

    WeChat multi-select often pastes as::

        Charlie 孙嘉谦 0608
        感觉很牛逼诶
        Rae
        谢谢
        Alex 12:43
        明天下午见

    i.e. contiguous lines with no blank separators. After a sender line the next
    non-media line is always content (even if it looks sender-ish — short Chinese
    replies often match the sender heuristic).
    """
    pairs: list[tuple[str, str, str | None]] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if _DATE_SEPARATOR_RE.match(line) or _SYSTEM_LINE_RE.match(line):
            i += 1
            continue
        m = _sender_match(line)
        if not m:
            i += 1
            continue
        sender = m.group("sender").strip()
        ts_raw = m.group("ts")
        i += 1
        # Skip media/system placeholders that stand alone as the bubble body.
        skipped_media = False
        while i < len(lines) and (
            _SYSTEM_LINE_RE.match(lines[i]) or _is_system_or_media_placeholder(lines[i])
        ):
            skipped_media = True
            i += 1
        if i >= len(lines):
            break
        if _DATE_SEPARATOR_RE.match(lines[i]):
            i += 1
            continue
        # Media-only bubble (e.g. name + [图片] + next name): skip empty message.
        if skipped_media and _sender_match(lines[i]):
            continue
        # First content line is mandatory — never reclassify as a sender
        # (short Chinese replies often match the sender heuristic).
        content_parts = [lines[i]]
        i += 1
        while i < len(lines):
            nxt = lines[i]
            if _DATE_SEPARATOR_RE.match(nxt):
                i += 1
                break
            if _sender_match(nxt):
                break
            if _SYSTEM_LINE_RE.match(nxt) or _is_system_or_media_placeholder(nxt):
                i += 1
                continue
            content_parts.append(nxt)
            i += 1
        content = "\n".join(content_parts).strip()
        if content:
            pairs.append((sender, content, ts_raw))
    return pairs


def _parse_blank_separated_blocks(text: str) -> list[tuple[str, str, str | None]]:
    """Parse blank-line separated bubbles; densify multi-bubble blocks.

    A single stray blank line used to merge the rest of a dense paste into one
    blob (→ selected_count=1/2). When a block has 3+ lines, re-run dense
    alternating inside it. Single-line blocks are treated as content-only
    messages (WeChat sometimes copies bodies without sender names).
    """
    pairs: list[tuple[str, str, str | None]] = []
    for block in _blank_blocks(text):
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        first = lines[0]
        if _DATE_SEPARATOR_RE.match(first) and len(lines) == 1:
            continue
        if len(lines) >= 3:
            dense = _parse_dense_alternating(lines)
            if len(dense) >= 2:
                pairs.extend(dense)
                continue
        if len(lines) == 1:
            # Content-only multi-select: each blank-separated line is one bubble.
            if _is_system_or_media_placeholder(first):
                continue
            pairs.append(("Unknown", first, None))
            continue
        m = _sender_match(first)
        if m:
            content = "\n".join(lines[1:]).strip()
            if content:
                pairs.append((m.group("sender").strip(), content, m.group("ts")))
            continue
        pairs.append(("Unknown", "\n".join(lines), None))
    return pairs


def _parse_inline_exports(lines: list[str]) -> list[tuple[str, str, str | None]]:
    """Colon / tab single-line export styles."""
    pairs: list[tuple[str, str, str | None]] = []
    for line in lines:
        if _DATE_SEPARATOR_RE.match(line) or _SYSTEM_LINE_RE.match(line):
            continue
        m = _TAB_INLINE_RE.match(line)
        if m and _is_probable_sender(m.group("sender").strip()):
            pairs.append((m.group("sender").strip(), m.group("content").strip(), None))
            continue
        m = _INLINE_SENDER_RE.match(line)
        if m and _is_probable_sender(m.group("sender").strip()):
            pairs.append((m.group("sender").strip(), m.group("content").strip(), None))
    return pairs


def _score_pairs(pairs: list[tuple[str, str, str | None]]) -> tuple[int, int, int]:
    """Prefer more messages, then more distinct senders, then less Unknown."""
    if not pairs:
        return (0, 0, 0)
    senders = {s for s, _, _ in pairs}
    named = sum(1 for s, _, _ in pairs if s != "Unknown")
    return (len(pairs), len(senders), named)


def parse_wechat_deterministic(text: str) -> ParsedConversationOut | None:
    """Parse WeChat multi-select copy without an LLM.

    Tries several paste shapes and keeps the richest coherent split:
      - blank-line bubbles (with inner dense repair)
      - dense alternating sender/content (no blank lines)
      - inline Name：/Name:/tab exports
    """
    text = _normalize_paste_text(text)
    if not text:
        return None

    all_lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    candidates: list[list[tuple[str, str, str | None]]] = [
        _parse_blank_separated_blocks(text),
        _parse_dense_alternating(all_lines),
        _parse_inline_exports(all_lines),
    ]
    best = max(candidates, key=_score_pairs)
    if _score_pairs(best)[0] < 1:
        return None
    # A single-pair result is only useful when the paste is truly one bubble.
    # If other strategies found nothing better, still accept it.
    if _score_pairs(best)[0] == 1 and len(all_lines) >= 4:
        # Likely under-split; prefer any candidate with >=2 if present.
        multi = [c for c in candidates if len(c) >= 2]
        if multi:
            best = max(multi, key=_score_pairs)

    messages: list[ConversationMessageOut] = []
    names: list[str] = []

    for sender, content, ts_raw in best:
        content = content.strip()
        if not content or _is_system_or_media_placeholder(content):
            continue
        if sender not in names and sender != "Unknown":
            names.append(sender)
        weight = 0.3 if _NOISE_RE.match(content) else 1.0
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
    log = structlog.get_logger("conversation.parse")
    raw_lines = len([ln for ln in (text or "").splitlines() if ln.strip()])
    parsed = parse_wechat_deterministic(text)
    if parsed is not None:
        selected = sum(1 for m in parsed.messages if m.is_selected)
        log.info(
            "parse_deterministic",
            messages=len(parsed.messages),
            selected=selected,
            raw_lines=raw_lines,
        )
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
    llm_parsed = _from_normalized(normalized)
    # If the LLM collapsed a multi-line paste into one blob, split lines so the
    # keyboard never shows 「已选 1 条」 for an obvious multi-message copy.
    if len(llm_parsed.messages) <= 1 and raw_lines >= 4:
        lines = [ln.strip() for ln in _normalize_paste_text(text).splitlines() if ln.strip()]
        lines = [ln for ln in lines if not _is_system_or_media_placeholder(ln)]
        if len(lines) >= 2:
            msgs = [
                ConversationMessageOut(
                    id=str(uuid.uuid4()),
                    sender="Unknown",
                    timestamp=None,
                    content=ln,
                    role=MessageRole.unknown,
                    is_selected=(0.3 if _NOISE_RE.match(ln) else 1.0) >= 1.0,
                    weight=0.3 if _NOISE_RE.match(ln) else 1.0,
                )
                for ln in lines
            ]
            log.info(
                "parse_llm_line_split_fallback",
                llm_messages=len(llm_parsed.messages),
                line_messages=len(msgs),
                raw_lines=raw_lines,
            )
            return ParsedConversationOut(
                id=str(uuid.uuid4()),
                source=ConversationSource.wechat,
                participants=[],
                messages=msgs,
                imported_at=_utcnow(),
            )
    log.info(
        "parse_llm",
        messages=len(llm_parsed.messages),
        selected=sum(1 for m in llm_parsed.messages if m.is_selected),
        raw_lines=raw_lines,
    )
    return llm_parsed


# Soft cap so a huge paste cannot blow the reply/action prompt; prefer the
# most recent thread window when over the limit.
_MAX_ANALYZE_MESSAGES = 24


def _selected_messages(conversation: ParsedConversationOut) -> list[ConversationMessageOut]:
    selected = [m for m in conversation.messages if m.is_selected]
    msgs = selected or list(conversation.messages)
    if len(msgs) > _MAX_ANALYZE_MESSAGES:
        return msgs[-_MAX_ANALYZE_MESSAGES:]
    return msgs


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

    insight = _derive_insight(selected=selected, actions=actions, goal=goal_text)
    return ConversationAnalyzeResponse(
        reply_suggestions=replies,
        actions=actions,
        insight=insight,
    )


def _derive_insight(
    *,
    selected: list,
    actions: list[ConversationActionOut],
    goal: str,
) -> str:
    """Thin one-line understanding without an extra LLM call."""
    if actions:
        title = (actions[0].title or "").strip()
        if title:
            n = len(selected)
            if n >= 2:
                return f"已读 {n} 条 · {title[:56]}"
            return title[:80]
    if selected:
        n = len(selected)
        last = selected[-1]
        snippet = (getattr(last, "content", "") or "").strip().replace("\n", " ")
        if n >= 2 and snippet:
            return f"已读 {n} 条消息，结合整段对话回复（最新：「{snippet[:28]}」）"
        if snippet:
            return f"围绕「{snippet[:36]}」继续推进"
    goal_clean = (goal or "").strip()
    if goal_clean and goal_clean != "custom":
        return f"按目标「{goal_clean[:24]}」生成回复"
    return "已分析对话，可插入回复"


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
        # Timed follow-ups become Tasks so local reminders can fire after confirm.
        # Untimed follow-ups / commitments stay as Commitments in the conversation inbox.
        wants_reminder = bool(payload.set_reminder) or bool(payload.remind_at)
        if kind == ConversationActionKind.follow_up and wants_reminder:
            remind_at = payload.remind_at
            if remind_at is None:
                remind_at = _resolve_suggested_time(payload.suggested_time, tz=tz)
                if remind_at is None:
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
                detail="Saved to Alfred with reminder",
            )

        commitment = Commitment(
            user_id=user.id,
            description=title,
            owner=CommitmentOwner.user,
            counterparty=payload.counterparty,
            due_date=payload.due_date,
            priority=Priority.medium,
            status=CommitmentStatus.open,
            source_type=SourceType.conversation,
            source_id=payload.conversation_id,
            evidence=evidence,
            confidence=payload.confidence,
            # Marker so the conversation inbox can distinguish follow-ups from
            # open-loop commitments without a schema change.
            reason=f"conversation:{kind.value}",
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
        desc = c.description or ""
        desc_lower = desc.lower()
        reason = c.reason or ""
        if reason.endswith(":follow_up") or "跟进" in desc or "询问" in desc or "ask" in desc_lower:
            kind = "follow_up"
        else:
            kind = "commitment"
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
