"""Structured-output schemas the LLM layer returns. These are the validated
shapes every provider implementation must produce (PRD 14.3)."""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from app.db.enums import CommitmentOwner, MessageClassification, Priority


class ClassificationResult(BaseModel):
    classification: MessageClassification
    priority: Priority
    action_required: bool
    reason: str = Field(
        description="Why this classification, in one sentence. Address the recipient as 'you'."
    )
    schedule_candidate: bool = Field(
        default=False,
        description=(
            "True when the email mentions a concrete meeting, meal, or appointment with a "
            "specific date/time the user may want on their calendar (e.g. 'breakfast tomorrow "
            "at 8am', 'see you Tuesday at 3'). False for vague scheduling back-and-forth, "
            "already-confirmed calendar invites with no new time, or purely informational "
            "reminders of events already on the calendar."
        ),
    )


class ExtractedScheduleProposal(BaseModel):
    title: str = Field(description="Short event title for the calendar.")
    start: str = Field(description="Event start as ISO 8601 with timezone offset.")
    end: str = Field(description="Event end as ISO 8601 with timezone offset.")
    timezone: str = Field(description="IANA timezone used to interpret relative times.")
    location: str | None = None
    participants: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)


class ExtractedCommitment(BaseModel):
    description: str
    owner: CommitmentOwner
    counterparty: str | None = None
    due_date: date | None = None
    priority: Priority = Priority.medium
    evidence: str = Field(description="Verbatim quote from the source supporting this commitment.")
    confidence: float = Field(ge=0.0, le=1.0)
    from_automated: bool = Field(
        default=False,
        description=(
            "True if the sender is automated (no-reply, marketing, notification, "
            "newsletter, security alert) rather than a real person expecting a reply."
        ),
    )


class DraftResult(BaseModel):
    subject: str | None = None
    body: str


class MeetingContextSummary(BaseModel):
    summary: str
    open_commitments: list[str] = Field(default_factory=list)
    suggested_questions: list[str] = Field(default_factory=list)


class ParsedTask(BaseModel):
    title: str = Field(description="A concise, actionable task title.")
    due_date: date | None = None
    remind_at: datetime | None = Field(
        default=None,
        description="When to remind the user, as ISO 8601 with timezone offset.",
    )
    priority: Priority = Priority.medium


class CaptureResult(BaseModel):
    tasks: list[ParsedTask] = Field(default_factory=list)
    detected_project: str | None = Field(
        default=None, description="A project name if the note clearly belongs to one."
    )


class ThreadReconciliation(BaseModel):
    """Open commitments in an email thread that a later message resolves."""

    resolved_commitment_ids: list[str] = Field(
        default_factory=list,
        description="Ids of existing open commitments now resolved in later messages.",
    )


class AssistantChatReply(BaseModel):
    reply: str = Field(description="A concise, helpful answer grounded in the provided context.")
    cited_ids: list[str] = Field(
        default_factory=list,
        description=(
            "IDs of the specific messages, tasks, commitments, or calendar events from the "
            "provided context that this reply is based on. Every factual claim in the reply "
            "must trace back to at least one cited id. Leave empty only when has_context is "
            "false."
        ),
    )
    has_context: bool = Field(
        default=True,
        description=(
            "False when there is no relevant context to answer from — e.g. the user's inbox, "
            "calendar, or tasks are empty, or nothing in the context relates to what they asked. "
            "Set this instead of guessing."
        ),
    )


class AssistantInterpretation(BaseModel):
    """How Albert read a free-text request from the Ask screen."""

    intent: str = Field(
        description=(
            "One of: book_calendar, reschedule_calendar, cancel_calendar, check_calendar, "
            "create_task, none."
        )
    )
    reply: str = Field(description="A short, calm one-line reply to show the user.")
    title: str | None = Field(
        default=None,
        description="Event title when booking, or task title when creating a reminder.",
    )
    due_date: date | None = Field(
        default=None,
        description="Task due/reminder date as YYYY-MM-DD when intent is create_task.",
    )
    start: str | None = Field(
        default=None, description="Event start, ISO 8601 with the user's UTC offset."
    )
    end: str | None = Field(
        default=None, description="Event end, ISO 8601 with the user's UTC offset."
    )
    event_id: str | None = Field(
        default=None,
        description="Event id from upcoming-events list (reschedule/cancel).",
    )


# --- Conversation (WeChat paste) LLM shapes ---


class ConversationSource(StrEnum):
    wechat = "wechat"
    unknown = "unknown"


class MessageRole(StrEnum):
    self = "self"
    other = "other"
    unknown = "unknown"


class ConversationActionKind(StrEnum):
    task = "task"
    calendar_event = "calendar_event"
    follow_up = "follow_up"
    commitment = "commitment"


class ConversationActionTier(StrEnum):
    """Notification/UI tier — never auto-notify; guide how strongly to offer confirmation."""

    explicit_time = "explicit_time"  # clear datetime → offer calendar/reminder now
    action_no_time = "action_no_time"  # actionable but no time → Inbox only
    follow_up_suggestion = "follow_up_suggestion"  # inferred follow-up → suggest only


class NormalizedConversationMessage(BaseModel):
    sender: str = Field(description="Display name of the sender as it appears in the chat.")
    content: str = Field(description="Message body text.")
    timestamp: str | None = Field(
        default=None,
        description="Optional timestamp string as copied (e.g. '12:43' or '昨天 21:05').",
    )
    is_noise: bool = Field(
        default=False,
        description="True for clearly irrelevant lines (sticker-only, '已吃', system notices).",
    )


class NormalizedConversation(BaseModel):
    """LLM repair/normalize output for a pasted chat transcript."""

    participants: list[str] = Field(default_factory=list)
    messages: list[NormalizedConversationMessage] = Field(default_factory=list)
    source: ConversationSource = ConversationSource.wechat


class ReplySuggestion(BaseModel):
    tone: str = Field(description="Short tone label, e.g. natural / caring / brief.")
    body: str = Field(description="The reply text ready to insert into the chat input.")


class ConversationRepliesResult(BaseModel):
    replies: list[ReplySuggestion] = Field(default_factory=list)


class ExtractedConversationActionLLM(BaseModel):
    """Raw action extracted by the LLM before tiering / id assignment."""

    type: ConversationActionKind
    title: str
    due_date: date | None = None
    start: str | None = Field(
        default=None, description="ISO 8601 start when type is calendar_event."
    )
    end: str | None = Field(default=None, description="ISO 8601 end when type is calendar_event.")
    suggested_time: str | None = Field(
        default=None,
        description="Relative hint when no absolute time, e.g. 'tonight' or 'tomorrow morning'.",
    )
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: str = Field(description="Verbatim quote from the conversation.")
    evidence_message_indexes: list[int] = Field(
        default_factory=list,
        description="0-based indexes into the selected messages list that support this action.",
    )


class ConversationActionsResult(BaseModel):
    actions: list[ExtractedConversationActionLLM] = Field(default_factory=list)
