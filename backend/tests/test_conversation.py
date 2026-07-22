"""WeChat conversation parse / analyze / confirm tests."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy.orm import Session

from app.db.enums import SourceType, TaskStatus
from app.db.models import Commitment, Task, User
from app.schemas.api import ConversationConfirmRequest
from app.schemas.llm import (
    ConversationActionKind,
    ConversationActionTier,
    ExtractedConversationActionLLM,
    ReplySuggestion,
)
from app.services import conversation as conversation_service
from tests.fakes import FakeLLM

SAMPLE_WECHAT = """6330
我需要审一下

6330
昨晚的感觉还没消化

Rui🌞
一吃一堆

Rui🌞
已吃
"""

SAMPLE_WITH_MEETING = """Alex
明天下午三点见

我
好的，会议室见
"""

SAMPLE_WITH_YESTERDAY_TS = """张三 昨天 21:05
明天把合同发我

李四 今天 09:30
好，上午发给你
"""

SAMPLE_WITH_SYSTEM_NOISE = """— 昨天 —

6330
我需要审一下

以上是历史消息

Rui🌞
[动画表情]

Rui🌞
一吃一堆
"""

SAMPLE_INLINE_COLON = """6330：我需要审一下
Rui🌞：一吃一堆
6330：昨晚的感觉还没消化
"""


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="chat@example.com", name="Rui", timezone="America/New_York")
    db.add(u)
    db.commit()
    return u


def test_parse_wechat_deterministic_extracts_messages() -> None:
    parsed = conversation_service.parse_wechat_deterministic(SAMPLE_WECHAT)
    assert parsed is not None
    assert parsed.source.value == "wechat"
    assert len(parsed.messages) == 4
    senders = [m.sender for m in parsed.messages]
    assert "6330" in senders
    assert "Rui🌞" in senders
    # "已吃" should be down-weighted / deselected
    eaten = next(m for m in parsed.messages if m.content == "已吃")
    assert eaten.weight < 1.0
    assert eaten.is_selected is False


def test_parse_yesterday_today_timestamps() -> None:
    parsed = conversation_service.parse_wechat_deterministic(SAMPLE_WITH_YESTERDAY_TS)
    assert parsed is not None
    assert len(parsed.messages) == 2
    assert parsed.messages[0].timestamp is not None
    assert parsed.messages[1].timestamp is not None
    # 昨天 should be earlier than 今天
    assert parsed.messages[0].timestamp < parsed.messages[1].timestamp


def test_parse_skips_system_and_media_placeholders() -> None:
    parsed = conversation_service.parse_wechat_deterministic(SAMPLE_WITH_SYSTEM_NOISE)
    assert parsed is not None
    contents = [m.content for m in parsed.messages]
    assert "我需要审一下" in contents
    assert "一吃一堆" in contents
    assert "以上是历史消息" not in contents
    assert "[动画表情]" not in contents


def test_parse_inline_colon_export_style() -> None:
    parsed = conversation_service.parse_wechat_deterministic(SAMPLE_INLINE_COLON)
    assert parsed is not None
    assert len(parsed.messages) == 3
    assert parsed.messages[0].sender == "6330"
    assert parsed.messages[0].content == "我需要审一下"


SAMPLE_DENSE_GROUP = """Charlie 孙嘉谦 0608
感觉很牛逼诶
Rae
晚上一起看看这个界面
Alex
布局压缩之后还能编辑吗
Charlie 孙嘉谦 0608
[图片]
Rae
我再试一下导入
"""

SAMPLE_DENSE_WITH_TS = """张三 12:43
合同发我一下
李四 昨天 21:05
好，晚上发你
王五
收到
"""


def test_parse_dense_group_chat_no_blank_lines() -> None:
    """WeChat multi-select often omits blank lines between bubbles."""
    parsed = conversation_service.parse_wechat_deterministic(SAMPLE_DENSE_GROUP)
    assert parsed is not None
    assert len(parsed.messages) >= 4
    senders = [m.sender for m in parsed.messages]
    assert "Charlie 孙嘉谦 0608" in senders
    assert "Rae" in senders
    assert "Alex" in senders
    contents = [m.content for m in parsed.messages]
    assert "感觉很牛逼诶" in contents
    assert "布局压缩之后还能编辑吗" in contents
    assert "[图片]" not in contents


def test_parse_dense_with_timestamps() -> None:
    parsed = conversation_service.parse_wechat_deterministic(SAMPLE_DENSE_WITH_TS)
    assert parsed is not None
    assert len(parsed.messages) == 3
    assert parsed.messages[0].sender == "张三"
    assert parsed.messages[0].timestamp is not None
    assert parsed.messages[1].sender == "李四"
    assert parsed.messages[2].content == "收到"


def test_parse_meeting_sample() -> None:
    parsed = conversation_service.parse_wechat_deterministic(SAMPLE_WITH_MEETING)
    assert parsed is not None
    assert any("明天下午三点见" in m.content for m in parsed.messages)


def test_parse_conversation_uses_deterministic_path(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeLLM()
    monkeypatch.setattr(conversation_service, "get_llm", lambda: fake)
    parsed = conversation_service.parse_conversation(SAMPLE_WECHAT)
    assert len(parsed.messages) >= 3
    assert fake.normalize_calls == []  # deterministic path, no LLM


def test_assign_tier_explicit_calendar() -> None:
    tier = conversation_service._assign_tier(
        kind=ConversationActionKind.calendar_event,
        confidence=0.9,
        start="2026-07-22T15:00:00-04:00",
        due_date=None,
        suggested_time=None,
    )
    assert tier == ConversationActionTier.explicit_time


def test_assign_tier_follow_up_suggestion() -> None:
    tier = conversation_service._assign_tier(
        kind=ConversationActionKind.follow_up,
        confidence=0.84,
        start=None,
        due_date=None,
        suggested_time="tonight",
    )
    assert tier == ConversationActionTier.follow_up_suggestion


def test_analyze_runs_replies_and_actions_in_parallel(
    monkeypatch: pytest.MonkeyPatch, user: User
) -> None:
    fake = FakeLLM(
        conversation_replies=[
            ReplySuggestion(tone="natural", body="那你先慢慢消化。"),
            ReplySuggestion(tone="caring", body="昨晚哪部分让你不舒服？"),
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
                confidence=0.7,
                evidence="我需要审一下",
                evidence_message_indexes=[0],
            ),
        ],
    )
    monkeypatch.setattr(conversation_service, "get_llm", lambda: fake)
    parsed = conversation_service.parse_conversation(SAMPLE_WECHAT, use_llm_fallback=False)
    result = conversation_service.analyze_conversation(
        parsed, goal="comfort", user=user, timezone="America/New_York"
    )
    assert len(result.reply_suggestions) == 3
    assert len(result.actions) == 2
    follow = next(a for a in result.actions if a.type == ConversationActionKind.follow_up)
    assert follow.tier == ConversationActionTier.follow_up_suggestion
    assert follow.evidence == "昨晚的感觉还没消化"
    assert follow.evidence_message_ids  # provenance linked
    assert fake.conversation_reply_calls
    assert fake.conversation_action_calls


def test_confirm_task_persists_with_evidence(db: Session, user: User) -> None:
    res = conversation_service.confirm_action(
        db,
        user,
        ConversationConfirmRequest(
            type=ConversationActionKind.task,
            title="把文件发给 6330",
            conversation_id="conv-1",
            evidence="我需要审一下",
            confidence=0.8,
            set_reminder=True,
            suggested_time="tonight",
        ),
        timezone="America/New_York",
    )
    assert res.kind == "task"
    task = db.get(Task, res.id)
    assert task is not None
    assert task.source_type == SourceType.conversation
    assert task.evidence == "我需要审一下"
    assert task.remind_at is not None  # tonight reminder set only on confirm


def test_confirm_follow_up_creates_commitment(db: Session, user: User) -> None:
    res = conversation_service.confirm_action(
        db,
        user,
        ConversationConfirmRequest(
            type=ConversationActionKind.follow_up,
            title="今晚询问对方状态",
            conversation_id="conv-2",
            evidence="我之后再告诉你",
            confidence=0.7,
        ),
    )
    assert res.kind == "follow_up"
    c = db.get(Commitment, res.id)
    assert c is not None
    assert c.source_type == SourceType.conversation
    assert c.evidence == "我之后再告诉你"


def test_confirm_follow_up_with_reminder_creates_task(db: Session, user: User) -> None:
    res = conversation_service.confirm_action(
        db,
        user,
        ConversationConfirmRequest(
            type=ConversationActionKind.follow_up,
            title="今晚询问对方状态",
            conversation_id="conv-2b",
            evidence="我之后再告诉你",
            confidence=0.7,
            set_reminder=True,
            suggested_time="tonight",
        ),
        timezone="America/New_York",
    )
    assert res.kind == "task"
    assert res.remind_at is not None
    task = db.get(Task, res.id)
    assert task is not None
    assert task.evidence == "我之后再告诉你"
    assert task.remind_at is not None


def test_conversation_inbox_lists_open_items(db: Session, user: User) -> None:
    conversation_service.confirm_action(
        db,
        user,
        ConversationConfirmRequest(
            type=ConversationActionKind.task,
            title="发文件",
            evidence="把文件发给我",
            confidence=0.9,
        ),
    )
    conversation_service.confirm_action(
        db,
        user,
        ConversationConfirmRequest(
            type=ConversationActionKind.follow_up,
            title="询问对方状态",
            evidence="我之后再告诉你",
            confidence=0.8,
        ),
    )
    inbox = conversation_service.list_conversation_inbox(db, user.id)
    assert inbox.counts["tasks"] == 1
    assert len(inbox.items) == 2
    assert all(i.evidence for i in inbox.items)


def test_create_task_with_evidence_column(db: Session, user: User) -> None:
    from app.services import tasks as task_service

    task = task_service.create_task(
        db,
        user.id,
        title="From chat",
        source_type=SourceType.conversation,
        evidence="明天下午三点见",
        confidence=0.95,
    )
    assert task.evidence == "明天下午三点见"
    assert task.status == TaskStatus.open
    assert task.due_date is None or isinstance(task.due_date, date)


def test_conversation_replies_result_coerces_json_string() -> None:
    """Anthropic occasionally returns `replies` as a JSON-encoded string."""
    from app.schemas.llm import ConversationRepliesResult

    raw = {
        "replies": '[\n  {"tone": "natural", "body": "那你先慢慢来"},\n'
        '  {"tone": "brief", "body": "好的"}\n]'
    }
    result = ConversationRepliesResult.model_validate(raw)
    assert len(result.replies) == 2
    assert result.replies[0].tone == "natural"
    assert result.replies[1].body == "好的"


def test_conversation_actions_result_coerces_json_string() -> None:
    from app.schemas.llm import ConversationActionsResult

    raw = {
        "actions": '[{"type": "task", "title": "发合同", "confidence": 0.8, '
        '"evidence": "合同发我", "evidence_message_indexes": [0]}]'
    }
    result = ConversationActionsResult.model_validate(raw)
    assert len(result.actions) == 1
    assert result.actions[0].title == "发合同"
