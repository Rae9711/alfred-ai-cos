"""A fake LLMClient for service-level tests. Returns deterministic structured output
without calling Anthropic, so tests are fast and offline."""

from __future__ import annotations

from datetime import date

from app.db.enums import CommitmentOwner, MessageClassification, Priority
from app.schemas.llm import (
    AssistantChatReply,
    AssistantInterpretation,
    CaptureResult,
    ClassificationResult,
    DraftResult,
    ExtractedCommitment,
    ExtractedScheduleProposal,
    MeetingContextSummary,
    ParsedTask,
    ThreadReconciliation,
)


class FakeLLM:
    """Implements app.llm.base.LLMClient with canned responses."""

    def __init__(
        self,
        *,
        commitments: list[ExtractedCommitment] | None = None,
        capture_tasks: list[ParsedTask] | None = None,
        detected_project: str | None = None,
        interpretation: AssistantInterpretation | None = None,
        chat_reply: str = "You have 2 open loops today.",
        schedule_candidate: bool = False,
        schedule_proposal: ExtractedScheduleProposal | None = None,
    ) -> None:
        self._commitments = commitments or []
        self._capture_tasks = capture_tasks or []
        self._detected_project = detected_project
        self._interpretation = interpretation
        self.briefing_calls: list[dict] = []
        self.interpret_calls: list[dict] = []
        self.chat_calls: list[dict] = []
        self.chat_reply = chat_reply
        self._schedule_candidate = schedule_candidate
        self._schedule_proposal = schedule_proposal

    def classify_message(
        self, *, subject: str | None, body: str, sender: str, user_email: str | None = None
    ) -> ClassificationResult:
        return ClassificationResult(
            classification=MessageClassification.needs_reply,
            priority=Priority.medium,
            action_required=True,
            reason="fake classification",
            schedule_candidate=self._schedule_candidate,
        )

    def extract_schedule_proposal(
        self,
        *,
        subject: str | None,
        body: str,
        sender: str,
        user_email: str,
        user_timezone: str,
        reference_date: date,
    ) -> ExtractedScheduleProposal | None:
        del subject, body, sender, user_email, user_timezone, reference_date
        return self._schedule_proposal

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
        self,
        *,
        thread_context: str,
        instruction: str | None,
        tone: str,
        user_name: str | None,
        current_draft: str | None = None,
        revision_history: list[str] | None = None,
    ) -> DraftResult:
        del current_draft, revision_history
        sig = f"\n{user_name}" if user_name else ""
        return DraftResult(subject="Re: test", body=f"[{tone}] drafted reply{sig}")

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

    def parse_capture(self, *, text: str, reference_date: date) -> CaptureResult:
        return CaptureResult(tasks=self._capture_tasks, detected_project=self._detected_project)

    def interpret_request(
        self, *, text: str, now_iso: str, timezone: str, upcoming_events: str = ""
    ) -> AssistantInterpretation:
        self.interpret_calls.append(
            {
                "text": text,
                "now_iso": now_iso,
                "timezone": timezone,
                "upcoming_events": upcoming_events,
            }
        )
        if self._interpretation is not None:
            return self._interpretation
        return AssistantInterpretation(intent="none", reply="I can book calendar time.")

    def reconcile_thread_commitments(
        self,
        *,
        thread_context: str,
        open_commitments: list[dict[str, str]],
    ) -> ThreadReconciliation:
        del thread_context
        return ThreadReconciliation()

    def answer_contextual_question(
        self,
        *,
        question: str,
        context: str,
        history: list[dict[str, str]] | None = None,
    ) -> AssistantChatReply:
        self.chat_calls.append({"question": question, "context": context, "history": history})
        return AssistantChatReply(reply=self.chat_reply)


class FakeNotifier:
    """Implements app.services.notifications.NotificationProvider; records sends."""

    def __init__(self) -> None:
        self.sent: list[dict[str, object]] = []

    def send(self, *, push_token: str, title: str, body: str, data: dict) -> None:
        self.sent.append({"push_token": push_token, "title": title, "body": body, "data": data})


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
