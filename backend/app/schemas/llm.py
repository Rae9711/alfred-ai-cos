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
    reason: str = Field(description="Why this classification, in one sentence.")


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


class AssistantInterpretation(BaseModel):
    """How Albert read a free-text request from the Ask screen. `intent` decides the
    action; `book_calendar` fills the event fields (ISO 8601 with the user's offset)."""

    intent: str = Field(
        description="One of: book_calendar, none. 'book_calendar' when the user asks to "
        "schedule/book/block time. 'none' for anything else."
    )
    reply: str = Field(
        description="A short, calm one-line reply to show the user (e.g. confirmation, "
        "or — when intent is none — an honest note that this isn't supported yet)."
    )
    title: str | None = Field(default=None, description="Event title when booking.")
    start: str | None = Field(
        default=None, description="Event start, ISO 8601 with the user's UTC offset."
    )
    end: str | None = Field(
        default=None, description="Event end, ISO 8601 with the user's UTC offset."
    )
