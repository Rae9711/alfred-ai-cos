"""Structured-output schemas the LLM layer returns. These are the validated
shapes every provider implementation must produce (PRD 14.3)."""

from __future__ import annotations

from datetime import date

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
        description="Ids of existing open commitments now satisfied or cancelled in the thread.",
    )


class AssistantChatReply(BaseModel):
    reply: str = Field(description="A concise, helpful answer grounded in the provided context.")


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
        default=None, description="Event title when booking, or task title when creating a reminder."
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
