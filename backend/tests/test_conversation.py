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


SAMPLE_LONG_THREAD = """Alice
早上好呀
Bob
今天开会吗
Alice
下午三点吧
Bob
会议室定了吗
Alice
A栋302可以
Bob
好的我带电脑
Alice
记得带充电器
Bob
投影怎么连
Alice
HDMI线在桌子抽屉里
Bob
收到谢谢
Charlie
我也去旁听
Alice
那就下午见
"""

SAMPLE_TEN_GROUP = """Charlie 孙嘉谦 0608
感觉很牛逼诶
Rae
晚上一起看看这个界面
Alex
布局压缩之后还能编辑吗
Charlie 孙嘉谦 0608
再发一个版本
Rae
我再试一下导入
Alex
好的可以继续
Bob
我也看看这个
Charlie 孙嘉谦 0608
晚上九点同步一下
Rae
收到了吗那边
Alex
没问题可以开
"""

SAMPLE_MIXED_BLANK = """Charlie 孙嘉谦 0608
感觉很牛逼诶
Rae
晚上一起看看这个界面

Alex
布局压缩之后还能编辑吗
Charlie 孙嘉谦 0608
再发一个版本
Rae
我再试一下导入
Alex
好的可以继续
Bob
我也看看这个
Charlie 孙嘉谦 0608
晚上九点同步一下
Rae
收到了吗那边
Alex
没问题可以开
"""

SAMPLE_CONTENT_ONLY_BLANK = """感觉很牛逼诶

晚上一起看看这个界面

布局压缩之后还能编辑吗

再发一个版本

我再试一下导入

好的可以继续

我也看看这个

晚上九点同步一下

收到了吗那边

没问题可以开
"""

SAMPLE_TAB_INLINE = """Charlie 孙嘉谦 0608\t感觉很牛逼诶
Rae\t晚上一起看看这个界面
Alex\t布局压缩之后还能编辑吗
Charlie 孙嘉谦 0608\t再发一个版本
Rae\t我再试一下导入
Alex\t好的可以继续
Bob\t我也看看这个
Charlie 孙嘉谦 0608\t晚上九点同步一下
Rae\t收到了吗那边
Alex\t没问题可以开
"""


def test_long_paste_selects_nearly_all_messages() -> None:
    """~12-message multi-select should keep almost all bubbles selected by default."""
    parsed = conversation_service.parse_wechat_deterministic(SAMPLE_LONG_THREAD)
    assert parsed is not None
    assert len(parsed.messages) >= 10
    selected = [m for m in parsed.messages if m.is_selected]
    # Only exact noise acks (e.g. bare 收到) are deselected — contentful lines stay on.
    assert len(selected) >= 10
    assert len(selected) == sum(1 for m in parsed.messages if m.weight >= 1.0)


def test_ten_line_group_chat_selected_count_at_least_eight() -> None:
    """Realistic group paste must yield selected_count >= 8 (keyboard 「已选 N 条」)."""
    parsed = conversation_service.parse_wechat_deterministic(SAMPLE_TEN_GROUP)
    assert parsed is not None
    assert len(parsed.messages) >= 8
    selected = sum(1 for m in parsed.messages if m.is_selected)
    assert selected >= 8
    assert "Charlie 孙嘉谦 0608" in {m.sender for m in parsed.messages}


def test_mixed_blank_line_does_not_collapse_thread() -> None:
    """A single stray blank line must not merge the rest into 1–2 blobs."""
    parsed = conversation_service.parse_wechat_deterministic(SAMPLE_MIXED_BLANK)
    assert parsed is not None
    selected = sum(1 for m in parsed.messages if m.is_selected)
    assert len(parsed.messages) >= 8
    assert selected >= 8


def test_content_only_blank_separated_bodies() -> None:
    """WeChat sometimes copies message bodies without sender names."""
    parsed = conversation_service.parse_wechat_deterministic(SAMPLE_CONTENT_ONLY_BLANK)
    assert parsed is not None
    selected = sum(1 for m in parsed.messages if m.is_selected)
    assert len(parsed.messages) >= 8
    assert selected >= 8


def test_tab_separated_inline_export() -> None:
    parsed = conversation_service.parse_wechat_deterministic(SAMPLE_TAB_INLINE)
    assert parsed is not None
    selected = sum(1 for m in parsed.messages if m.is_selected)
    assert len(parsed.messages) >= 8
    assert selected >= 8
    assert parsed.messages[0].sender == "Charlie 孙嘉谦 0608"
    assert parsed.messages[0].content == "感觉很牛逼诶"


# Real WeChat iOS multi-select Copy format (production collapse root cause):
# Nickname → YYYY/MM/DD HH:MM → Content → repeat. Timestamps were previously
# misread as senders ("2026/07/21" + ts "23:14"), scrambling or collapsing.
SAMPLE_WECHAT_IOS_MULTISELECT = """哪个方面 automate
Leo
2026/07/21 23:14
就是自动 select previous x number of messages
Leo
2026/07/21 23:14
不用用户去一个一个点
Rui ☀️
2026/07/21 23:14
[Video] Weixin video_20260721233539_1913.mp4
Rui ☀️
2026/07/21 23:15
这个微信自己就可以
Rui ☀️
2026/07/21 23:15
你滑到那 左上角 有个 select 一键全选
"""


def test_wechat_ios_multiselect_sender_timestamp_content() -> None:
    """Production clipboard: Sender → YYYY/MM/DD HH:MM → body (≥5 msgs)."""
    parsed = conversation_service.parse_wechat_deterministic(SAMPLE_WECHAT_IOS_MULTISELECT)
    assert parsed is not None
    assert len(parsed.messages) >= 5
    selected = sum(1 for m in parsed.messages if m.is_selected)
    assert selected >= 5
    senders = {m.sender for m in parsed.messages}
    assert "Leo" in senders
    assert "Rui ☀️" in senders
    contents = [m.content for m in parsed.messages]
    assert any("就是自动 select previous x number of messages" in c for c in contents)
    assert any("不用用户去一个一个点" in c for c in contents)
    assert any("这个微信自己就可以" in c for c in contents)
    assert any("一键全选" in c for c in contents)
    # Timestamps must not appear as senders or as message bodies.
    assert not any(m.sender.startswith("2026") for m in parsed.messages)
    assert not any("2026/07/21" in m.content for m in parsed.messages)
    # Media-only bubble dropped.
    assert not any("[Video]" in c for c in contents)
    # Strategy should be the iOS multiselect path.
    assert getattr(conversation_service.parse_wechat_deterministic, "last_strategy", "") == (
        "ios_multiselect"
    )


def test_wechat_ios_single_bubble_strips_timestamp_from_content() -> None:
    """3-line first pasteboard item must not keep the date line inside content."""
    raw = """Rui ☀️
2026/07/21 23:08
我想的是比如我选十条 比如我有十条未读消息"""
    parsed = conversation_service.parse_wechat_deterministic(raw)
    assert parsed is not None
    assert len(parsed.messages) == 1
    assert parsed.messages[0].sender == "Rui ☀️"
    assert parsed.messages[0].content == "我想的是比如我选十条 比如我有十条未读消息"
    assert "2026" not in parsed.messages[0].content
    assert parsed.messages[0].timestamp is not None


def test_collapsed_blob_with_embedded_ios_turns_resplits() -> None:
    """One logical paste containing many Sender/TS/Content turns must split ≥5."""
    # Same bytes as multi-select; ensures we never return a single merged blob.
    parsed = conversation_service.parse_conversation(
        SAMPLE_WECHAT_IOS_MULTISELECT, use_llm_fallback=False
    )
    assert len(parsed.messages) >= 5
    assert sum(1 for m in parsed.messages if m.is_selected) >= 5


def test_analyze_context_includes_full_selected_thread(
    monkeypatch: pytest.MonkeyPatch, user: User
) -> None:
    """Analyze must send the whole selected set into the reply LLM, not one cherry-pick."""
    fake = FakeLLM(
        conversation_replies=[
            ReplySuggestion(tone="natural", body="好，下午见。"),
            ReplySuggestion(tone="caring", body="到时候见，我带好充电器。"),
            ReplySuggestion(tone="brief", body="下午见。"),
        ],
        conversation_actions=[],
    )
    monkeypatch.setattr(conversation_service, "get_llm", lambda: fake)
    parsed = conversation_service.parse_conversation(SAMPLE_LONG_THREAD, use_llm_fallback=False)
    selected = [m for m in parsed.messages if m.is_selected]
    assert len(selected) >= 10

    result = conversation_service.analyze_conversation(
        parsed, goal="confirm", user=user, timezone="America/New_York"
    )
    assert result.reply_suggestions
    assert fake.conversation_reply_calls
    context = fake.conversation_reply_calls[0]["context"]
    # Numbered indexes for each selected message should appear.
    for i in range(min(len(selected), 10)):
        assert f"[{i}]" in context
    assert "下午三点吧" in context
    assert "HDMI线在桌子抽屉里" in context
    assert "那就下午见" in context
    # Insight should acknowledge the multi-message thread, not only the last bubble.
    assert result.insight
    assert "条" in result.insight or len(selected) == 1


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
