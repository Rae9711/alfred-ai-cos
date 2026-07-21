"""API-level E2E for the in-app WeChat import path.

Calls the route handlers directly (same pattern as other API tests) so we don't
hit SQLite thread / StaticPool issues with TestClient.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.api.v1 import conversations as conversations_api
from app.db.models import User
from app.schemas.api import (
    ConversationAnalyzeRequest,
    ConversationConfirmRequest,
    ConversationParseRequest,
)
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


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="import-mvp@example.com", name="Rui", timezone="America/New_York")
    db.add(u)
    db.commit()
    return u


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch) -> FakeLLM:
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
    monkeypatch.setattr(conversation_service, "get_llm", lambda: fake)
    return fake


def test_import_mvp_parse_analyze_confirm_inbox(
    db: Session, user: User, fake_llm: FakeLLM
) -> None:
    # 1. Parse WeChat multi-select paste
    parsed = conversations_api.parse_conversation(
        ConversationParseRequest(text=SAMPLE), user=user
    )
    assert parsed.source.value == "wechat"
    assert len(parsed.messages) == 4
    assert sum(1 for m in parsed.messages if m.is_selected) >= 2
    eaten = next(m for m in parsed.messages if m.content == "已吃")
    assert eaten.is_selected is False

    # 2. Analyze (parallel replies + actions)
    analyzed = conversations_api.analyze_conversation(
        ConversationAnalyzeRequest(
            conversation=parsed, goal="comfort", timezone="America/New_York"
        ),
        user=user,
    )
    assert len(analyzed.reply_suggestions) == 3
    tones = {r.tone for r in analyzed.reply_suggestions}
    assert tones == {"natural", "caring", "brief"}
    assert len(analyzed.actions) == 2
    follow = next(a for a in analyzed.actions if a.type == ConversationActionKind.follow_up)
    assert follow.tier.value == "follow_up_suggestion"
    assert follow.evidence == "昨晚的感觉还没消化"
    assert follow.evidence_message_ids
    task_action = next(a for a in analyzed.actions if a.type == ConversationActionKind.task)

    # 3. Confirm — no reminder for action_no_time (Inbox only)
    confirmed_task = conversations_api.confirm_conversation_action(
        ConversationConfirmRequest(
            type=ConversationActionKind.task,
            title=task_action.title,
            conversation_id=parsed.id,
            evidence=task_action.evidence,
            evidence_message_ids=task_action.evidence_message_ids,
            confidence=task_action.confidence,
            set_reminder=False,
        ),
        user=user,
        db=db,
    )
    assert confirmed_task.kind == "task"
    assert confirmed_task.evidence == "我需要审一下"
    assert confirmed_task.remind_at is None

    confirmed_follow = conversations_api.confirm_conversation_action(
        ConversationConfirmRequest(
            type=ConversationActionKind.follow_up,
            title=follow.title,
            conversation_id=parsed.id,
            evidence=follow.evidence,
            confidence=follow.confidence,
        ),
        user=user,
        db=db,
    )
    assert confirmed_follow.kind == "follow_up"

    # 4. Home "从对话中发现"
    inbox = conversations_api.conversation_inbox(user=user, db=db)
    assert inbox.counts["tasks"] == 1
    assert len(inbox.items) == 2
    evidences = {i.evidence for i in inbox.items}
    assert "我需要审一下" in evidences
    assert "昨晚的感觉还没消化" in evidences


def test_parse_rejects_empty(db: Session, user: User) -> None:
    with pytest.raises(HTTPException) as exc:
        conversations_api.parse_conversation(
            ConversationParseRequest(text="   "), user=user
        )
    assert exc.value.status_code == 400
