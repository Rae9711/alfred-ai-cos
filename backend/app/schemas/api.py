"""Request/response schemas for API routes outside the Today dashboard."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, computed_field

from app.db.enums import (
    ActionStatus,
    ActionType,
    CommitmentOwner,
    CommitmentStatus,
    Priority,
    SourceType,
    TaskStatus,
)
from app.schemas.llm import (
    ConversationActionKind,
    ConversationActionTier,
    ConversationSource,
    MessageRole,
)


# --- Auth ---
class AuthStartResponse(BaseModel):
    authorization_url: str
    state: str


class SessionToken(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AppleSignInRequest(BaseModel):
    """Native Sign in with Apple identity token + optional name (first grant only)."""

    identity_token: str
    full_name: str | None = None
    # Optional Apple-provided email from the credential (may be omitted on later sign-ins).
    email: str | None = None


# --- Commitments ---
class CommitmentOut(BaseModel):
    id: str
    description: str
    owner: CommitmentOwner
    counterparty: str | None
    due_date: date | None
    priority: Priority
    status: CommitmentStatus
    evidence: str | None
    confidence: float
    snooze_until: date | None = None
    snooze_until_reply: bool = False

    model_config = {"from_attributes": True}


class SnoozeRequest(BaseModel):
    """Snooze a commitment until a wake condition fires. Either a parsed
    natural-language phrase or an explicit date / reply flag."""

    phrase: str | None = None  # "monday", "tomorrow", "next week", "until reply", "+3d"
    until: date | None = None  # explicit date overrides the phrase
    until_reply: bool = False


class SnoozeOut(BaseModel):
    commitment: CommitmentOut
    interpreted_as: str


# --- Drafts ---
class DraftCreateRequest(BaseModel):
    message_id: str
    tone: str = "concise"
    instruction: str | None = None
    current_draft_body: str | None = None
    revision_history: list[str] = []


class DraftOut(BaseModel):
    id: str
    message_id: str
    subject: str | None
    body: str
    tone: str
    gmail_draft_id: str | None

    model_config = {"from_attributes": True}


class ComposeDraftCreateRequest(BaseModel):
    recipient_email: str
    recipient_name: str | None = None
    intent: str
    tone: str = "concise"


class ComposeDraftOut(BaseModel):
    id: str
    recipient_email: str
    recipient_name: str | None
    subject: str
    body: str
    tone: str
    gmail_draft_id: str | None

    model_config = {"from_attributes": True}


class InboxMessageOut(BaseModel):
    """One inbox message for the Inbox screen. `category` collapses the backend's
    fine-grained MessageClassification into the four UI buckets; `take` is the
    extraction pipeline's one-line reason (stored as body_summary)."""

    id: str
    sender: str
    subject: str | None
    snippet: str | None
    take: str | None  # Albert's one-line read (body_summary)
    category: str  # "Needs Reply" | "Needs Decision" | "Waiting" | "FYI"
    sent_at: datetime | None
    action_required: bool
    mailbox_email: str = ""
    is_unread: bool = True
    user_replied: bool = False
    user_decided: bool = False
    source: str = "gmail"
    reply_phone: str | None = None


class InboxOut(BaseModel):
    messages: list[InboxMessageOut]
    filtered_count: int  # spam/noise filtered out (the "I filtered N" line)
    mailboxes: list[str] = []  # connected Gmail addresses for inbox tabs


class MessageDetailOut(BaseModel):
    """Full message for reply drafting. Body is fetched from Gmail on demand."""

    id: str
    sender: str
    subject: str | None
    snippet: str | None
    take: str | None
    body: str
    category: str
    sent_at: datetime | None
    mailbox_email: str = ""
    source: str = "gmail"
    reply_phone: str | None = None


class SmsForwardingOut(BaseModel):
    webhook_url: str
    token: str


class SmsInstallOut(BaseModel):
    import_url: str
    shortcut_url: str
    token: str


class SmsIngestOut(BaseModel):
    message_id: str
    commitments_extracted: int
    deduped: bool
    draft_created: bool


class MessageReadOut(BaseModel):
    id: str
    is_unread: bool
    gmail_synced: bool = True
    user_decided: bool = False
    category: str | None = None


class BookMessageRequest(BaseModel):
    # The device timezone, so the event lands in the user's wall clock.
    timezone: str | None = None


class BookMessageResponse(BaseModel):
    booked: bool  # true if an event was created
    reply: str  # what to show the user (confirmation, or why nothing was booked)
    detail: str | None = None


class MessageRemindLaterOut(BaseModel):
    task_id: str
    remind_at: datetime
    title: str


class ScheduleBlockRequest(BaseModel):
    title: str
    start: str  # ISO 8601 with timezone
    end: str
    timezone: str | None = None
    # When "apple", skip Google write — device creates via EventKit.
    write_target: str | None = None


class ScheduleBlockResponse(BaseModel):
    booked: bool
    reply: str
    detail: str | None = None
    event_id: str | None = None


class AcceptScheduleProposalRequest(BaseModel):
    timezone: str | None = None
    start: str | None = None
    end: str | None = None
    write_target: str | None = None


class AcceptScheduleProposalResponse(BaseModel):
    accepted: bool
    reply: str
    detail: str | None = None
    event_id: str | None = None


class DeviceCalendarEventOut(BaseModel):
    title: str
    start: str
    end: str
    location: str | None = None


class AssistantAskRequest(BaseModel):
    text: str
    # The device's IANA timezone (e.g. "Europe/Paris"). Sent so "5pm" resolves to the
    # user's wall clock, not the server default. Persisted to the user when provided.
    timezone: str | None = None


class AssistantAskResponse(BaseModel):
    reply: str  # one-line message to show the user
    action: str  # "booked" | "updated" | "cancelled" | "created" | "device_book" | "none"
    detail: str | None = None  # execution detail when an action ran
    task_id: str | None = None
    task_title: str | None = None
    remind_at: datetime | None = None
    device_calendar: DeviceCalendarEventOut | None = None


class AssistantChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class AssistantChatRequest(BaseModel):
    text: str
    history: list[AssistantChatMessage] = []
    timezone: str | None = None


class AssistantChatResponse(BaseModel):
    reply: str
    action: str = "none"
    detail: str | None = None
    task_id: str | None = None
    task_title: str | None = None
    remind_at: datetime | None = None
    device_calendar: DeviceCalendarEventOut | None = None


class UpdateMeetingRequest(BaseModel):
    title: str | None = None
    start: datetime | None = None
    end: datetime | None = None
    location: str | None = None
    description: str | None = None


class CommitmentDraftRequest(BaseModel):
    tone: str = "concise"
    instruction: str | None = None


class CommitmentDraftOut(BaseModel):
    """A drafted reply for a commitment. Carries what the approval sheet renders.

    When the commitment came from an email (a source Message exists), a real DraftReply
    is persisted and `draft_reply_id` is set, so the reply can be SENT (threaded onto the
    original message). For non-email commitments there's no thread to send onto, so
    draft_reply_id is null and the sheet stays save-only."""

    recipient: str | None
    subject: str
    body: str
    tone: str
    evidence: str | None
    draft_reply_id: str | None = None


# --- Action approval (the capability spine) ---
class ActionProposalOut(BaseModel):
    id: str
    action_type: str
    risk_level: int
    reason: str | None
    proposed_content: str | None = None
    approval_required: bool = True
    status: ActionStatus

    model_config = {"from_attributes": True}

    @computed_field  # type: ignore[prop-decorator]
    @property
    def strong_confirmation(self) -> bool:
        # Mirrors execution.requires_strong_confirmation: levels 4-5.
        return self.risk_level >= 4


class ProposeActionRequest(BaseModel):
    action_type: ActionType
    target: dict[str, object]
    reason: str | None = None


class SyncResponse(BaseModel):
    ingested: int
    commitments_found: int
    events_synced: int = 0
    processed: int = 0
    initial_backfill: bool = False


# --- Meetings ---
class UpcomingMeeting(BaseModel):
    id: str
    title: str | None
    start_time: datetime | None
    end_time: datetime | None
    location: str | None
    attendees: list[str]
    prep_required: bool
    html_link: str | None = None
    source: str | None = "google"

    model_config = {"from_attributes": True}


class MeetingPrepOut(BaseModel):
    event: UpcomingMeeting
    summary: str
    open_commitments: list[str]
    suggested_questions: list[str]
    related_message_count: int


# --- Briefing ---
class BriefingOut(BaseModel):
    id: str
    date: date
    summary: str
    user_feedback: str | None

    model_config = {"from_attributes": True}


class BriefingFeedbackRequest(BaseModel):
    useful: bool


# --- Tasks ---
class TaskCreateRequest(BaseModel):
    title: str
    description: str | None = None
    due_date: date | None = None
    remind_at: datetime | None = None
    priority: Priority = Priority.medium


class TaskOut(BaseModel):
    id: str
    title: str
    description: str | None
    due_date: date | None
    remind_at: datetime | None
    priority: Priority
    status: TaskStatus
    source_type: SourceType
    source_id: str | None
    evidence: str | None = None
    confidence: float | None = None

    model_config = {"from_attributes": True}


# --- Notifications ---
class DeviceRegisterRequest(BaseModel):
    push_token: str
    platform: str | None = None


class NotificationOut(BaseModel):
    id: str
    type: str
    title: str
    body: str
    status: str
    useful: bool | None

    model_config = {"from_attributes": True}


class NotificationFeedbackRequest(BaseModel):
    useful: bool


class NotificationPrefs(BaseModel):
    # Stored in User.preferences. quiet_hours is "HH-HH" or "HH:MM-HH:MM".
    quiet_hours: str | None = None
    # "google" | "apple" — primary calendar for new events (writes only).
    calendar_write_primary: str | None = None


# --- Onboarding / account ---
class OnboardingPrefs(BaseModel):
    # PRD 9.1 calibration questions. Free-form strings so the option set can evolve
    # without a migration; the mobile app supplies the choices.
    name: str | None = None  # the user's name, used to sign drafts
    focus: str | None = None  # work | school | personal | founder | all
    optimize_for: str | None = None  # deadlines | priorities | follow_ups | meetings | inbox
    proactiveness: str | None = None  # quiet | balanced | very_proactive


class LlmQuotaOut(BaseModel):
    """Monthly AI budget remaining (estimated USD from Anthropic token rates)."""

    period: str  # YYYY-MM
    cap_usd: float
    used_usd: float
    remaining_usd: float
    used_pct: float
    capped: bool


class MeOut(BaseModel):
    id: str
    email: str
    name: str | None
    timezone: str
    preferences: dict[str, object]
    onboarded: bool
    connected_mailboxes: list[ConnectedMailboxOut] = []
    llm_quota: LlmQuotaOut | None = None


class ConnectedMailboxOut(BaseModel):
    id: str
    email: str
    sync_status: str
    last_synced_at: datetime | None = None
    gmail_modify: bool = False

    model_config = {"from_attributes": True}


# --- Waiting-for ---
class WaitingEntryOut(BaseModel):
    id: str
    description: str
    counterparty: str | None
    due_date: date | None
    age_days: int
    source_type: SourceType
    source_id: str | None


class WaitingView(BaseModel):
    waiting_on_you: list[WaitingEntryOut]
    you_are_waiting_on: list[WaitingEntryOut]


# --- Capture ---
class CaptureRequest(BaseModel):
    text: str


class CaptureResponse(BaseModel):
    tasks: list[TaskOut]
    detected_project: str | None
    transcript: str | None = None


class TranscribeResponse(BaseModel):
    """Raw speech-to-text for composer dictation (no task persistence)."""

    transcript: str


# --- Conversation (WeChat paste workflow) ---


class ParticipantOut(BaseModel):
    name: str
    is_self: bool = False


class ConversationMessageOut(BaseModel):
    id: str
    sender: str
    timestamp: datetime | None = None
    content: str
    role: MessageRole = MessageRole.unknown
    is_selected: bool = True
    weight: float = 1.0


class ParsedConversationOut(BaseModel):
    id: str
    source: ConversationSource
    participants: list[ParticipantOut]
    messages: list[ConversationMessageOut]
    imported_at: datetime


class ConversationParseRequest(BaseModel):
    text: str
    self_aliases: list[str] | None = None


class ReplySuggestionOut(BaseModel):
    tone: str
    body: str


class ConversationActionOut(BaseModel):
    id: str
    type: ConversationActionKind
    title: str
    due_date: date | None = None
    start: str | None = None
    end: str | None = None
    suggested_time: str | None = None
    confidence: float
    evidence: str
    evidence_message_ids: list[str] = []
    tier: ConversationActionTier
    status: str = "suggested"


class ConversationAnalyzeRequest(BaseModel):
    conversation: ParsedConversationOut
    goal: str = "custom"  # comfort | follow_up | confirm | custom
    tones: list[str] | None = None
    timezone: str | None = None
    self_aliases: list[str] | None = None


class ConversationAnalyzeResponse(BaseModel):
    reply_suggestions: list[ReplySuggestionOut]
    actions: list[ConversationActionOut]
    insight: str | None = None


class ConversationConfirmRequest(BaseModel):
    type: ConversationActionKind
    title: str
    conversation_id: str | None = None
    evidence: str | None = None
    evidence_message_ids: list[str] = []
    confidence: float = 0.0
    due_date: date | None = None
    start: str | None = None
    end: str | None = None
    suggested_time: str | None = None
    remind_at: datetime | None = None
    set_reminder: bool = False
    description: str | None = None
    counterparty: str | None = None
    timezone: str | None = None


class ConversationConfirmResponse(BaseModel):
    kind: str
    id: str
    title: str
    evidence: str | None = None
    remind_at: datetime | None = None
    detail: str | None = None


class ConversationInboxItem(BaseModel):
    id: str
    kind: str  # task | follow_up | commitment | calendar_event
    title: str
    evidence: str | None = None
    due_date: date | None = None
    remind_at: datetime | None = None
    created_at: datetime | None = None
    source_label: str = "微信对话"


class ConversationInboxResponse(BaseModel):
    items: list[ConversationInboxItem]
    counts: dict[str, int]
