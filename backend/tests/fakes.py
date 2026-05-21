"""A fake LLMClient for service-level tests. Returns deterministic structured output
without calling Anthropic, so tests are fast and offline."""

from __future__ import annotations

from datetime import date

from app.db.enums import CommitmentOwner, MessageClassification, Priority
from app.schemas.llm import (
    ClassificationResult,
    DraftResult,
    ExtractedCommitment,
    MeetingContextSummary,
)


class FakeLLM:
    """Implements app.llm.base.LLMClient with canned responses."""

    def __init__(self, *, commitments: list[ExtractedCommitment] | None = None) -> None:
        self._commitments = commitments or []
        self.briefing_calls: list[dict] = []

    def classify_message(
        self, *, subject: str | None, body: str, sender: str
    ) -> ClassificationResult:
        return ClassificationResult(
            classification=MessageClassification.needs_reply,
            priority=Priority.medium,
            action_required=True,
            reason="fake classification",
        )

    def extract_commitments(
        self,
        *,
        subject: str | None,
        body: str,
        sender: str,
        user_email: str,
        reference_date: date,
    ) -> list[ExtractedCommitment]:
        return self._commitments

    def draft_reply(
        self, *, thread_context: str, instruction: str | None, tone: str
    ) -> DraftResult:
        return DraftResult(subject="Re: test", body=f"[{tone}] drafted reply")

    def generate_daily_briefing(self, *, today_payload: dict) -> str:
        self.briefing_calls.append(today_payload)
        return "Good morning. 1 thing matters today."

    def summarize_meeting_context(
        self, *, event_title: str, related_messages: list[str]
    ) -> MeetingContextSummary:
        return MeetingContextSummary(
            summary=f"Context for {event_title}",
            open_commitments=["confirm timing"],
            suggested_questions=["what is the location?"],
        )


def fake_commitment(**kwargs: object) -> ExtractedCommitment:
    defaults: dict[str, object] = {
        "description": "Send the report",
        "owner": CommitmentOwner.user,
        "counterparty": "Dana",
        "due_date": None,
        "priority": Priority.high,
        "evidence": "please send the report",
        "confidence": 0.9,
    }
    defaults.update(kwargs)
    return ExtractedCommitment(**defaults)  # type: ignore[arg-type]
