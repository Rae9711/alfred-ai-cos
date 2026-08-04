#!/usr/bin/env python3
"""Smoke-verify the WeChat import MVP against a live DATABASE_URL.

Uses FakeLLM (no Anthropic key required). Proves migration-backed schema works:
parse → analyze → confirm → inbox, with Task.evidence persisted.

Usage:
  cd backend
  DATABASE_URL=postgresql+psycopg://albert:albert@localhost:5432/albert \\
    uv run python scripts/verify_conversation_mvp.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Allow `uv run python scripts/verify_conversation_mvp.py` from backend/
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

# Minimal settings before app imports Settings.
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg://albert:albert@localhost:5432/albert"
)
os.environ.setdefault("JWT_SECRET", "test-secret-at-least-32-bytes-long!!")
os.environ.setdefault(
    "TOKEN_ENCRYPTION_KEY", "ZmDfcTF7_60GrrY167zsiPd67pEvs0aGOv2oasOM1Pg="
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-test-not-used")

from sqlalchemy import select, text

from app.db.base import SessionLocal, engine
from app.db.models import Task, User
from app.schemas.api import ConversationConfirmRequest
from app.schemas.llm import (
    ConversationActionKind,
    ExtractedConversationActionLLM,
    ReplySuggestion,
)
from app.services import conversation as conversation_service
from tests.fakes import FakeLLM

SAMPLE = """6330
我需要审一下

6330
昨晚的感觉还没消化

Rui🌞
一吃一堆

Rui🌞
已吃
"""

EDGE_CASES = {
    "yesterday_ts": """张三 昨天 21:05
明天把合同发我

李四 今天 09:30
好，上午发给你
""",
    "system_noise": """— 昨天 —

6330
我需要审一下

以上是历史消息

Rui🌞
[动画表情]

Rui🌞
一吃一堆
""",
    "inline_colon": """6330：我需要审一下
Rui🌞：一吃一堆
6330：昨晚的感觉还没消化
""",
}


def main() -> int:
    with engine.connect() as conn:
        cols = {
            row[0]
            for row in conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'tasks'"
                )
            )
        }
        if "evidence" not in cols:
            print("FAIL: tasks.evidence missing — run alembic upgrade head")
            return 1
        print("OK  migration: tasks.evidence present")

    fake = FakeLLM(
        conversation_replies=[
            ReplySuggestion(tone="natural", body="那你先慢慢消化，不用急着现在说清楚。"),
            ReplySuggestion(tone="caring", body="昨晚具体是哪部分让你还没缓过来？"),
            ReplySuggestion(tone="brief", body="没事，你慢慢来。"),
        ],
        conversation_actions=[
            ExtractedConversationActionLLM(
                type=ConversationActionKind.follow_up,
                title="晚些时候问对方昨晚的感受",
                suggested_time="tonight",
                confidence=0.84,
                evidence="昨晚的感觉还没消化",
                evidence_message_indexes=[1],
            ),
            ExtractedConversationActionLLM(
                type=ConversationActionKind.task,
                title="把修改后的文件发给 6330",
                confidence=0.72,
                evidence="我需要审一下",
                evidence_message_indexes=[0],
            ),
        ],
    )
    conversation_service.get_llm = lambda: fake  # type: ignore[assignment]

    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.email == "mvp-verify@example.com"))
        if user is None:
            user = User(
                email="mvp-verify@example.com",
                name="Rui",
                timezone="America/New_York",
            )
            db.add(user)
            db.commit()

        parsed = conversation_service.parse_conversation(SAMPLE)
        print(
            f"OK  parse: {len(parsed.messages)} messages, "
            f"{sum(1 for m in parsed.messages if m.is_selected)} selected"
        )

        for name, raw in EDGE_CASES.items():
            edge = conversation_service.parse_wechat_deterministic(raw)
            assert edge is not None and len(edge.messages) >= 2, f"edge case {name} failed"
            print(f"OK  edge[{name}]: {len(edge.messages)} messages")

        analyzed = conversation_service.analyze_conversation(
            parsed, goal="comfort", user=user, timezone="America/New_York"
        )
        print(
            f"OK  analyze: {len(analyzed.reply_suggestions)} replies, "
            f"{len(analyzed.actions)} actions"
        )
        for r in analyzed.reply_suggestions:
            print(f"     reply[{r.tone}]: {r.body[:40]}…")
        for a in analyzed.actions:
            print(f"     action[{a.type}/{a.tier}]: {a.title} ← «{a.evidence}»")

        for action in analyzed.actions:
            set_reminder = action.type.value == "follow_up" and bool(action.suggested_time)
            res = conversation_service.confirm_action(
                db,
                user,
                ConversationConfirmRequest(
                    type=action.type,
                    title=action.title,
                    conversation_id=parsed.id,
                    evidence=action.evidence,
                    evidence_message_ids=action.evidence_message_ids,
                    confidence=action.confidence,
                    suggested_time=action.suggested_time,
                    set_reminder=set_reminder,
                ),
                timezone="America/New_York",
            )
            print(
                f"OK  confirm {res.kind}: id={res.id} "
                f"remind_at={res.remind_at} evidence={res.evidence!r}"
            )

        inbox = conversation_service.list_conversation_inbox(db, user.id)
        print(f"OK  inbox: counts={inbox.counts} items={len(inbox.items)}")
        for item in inbox.items:
            print(f"     • [{item.kind}] {item.title}")
            print(f"       来自：「{item.evidence}」")

        tasks = list(
            db.scalars(
                select(Task).where(Task.user_id == user.id, Task.evidence.is_not(None))
            )
        )
        assert tasks, "expected at least one Task with evidence"
        print(f"OK  db evidence rows: {len(tasks)}")
        print("\nMVP path verified.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
