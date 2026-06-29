"""Anthropic implementation of LLMClient. The only place the anthropic SDK is imported.

Structured extraction uses tool-use: we hand Claude a single tool whose input schema
is the target Pydantic model's JSON schema, force that tool, then validate the tool
input back into the model. System prompts are marked cache-eligible so repeated calls
in a sync batch reuse the prompt prefix (Anthropic prompt caching, 5-minute TTL)."""

from __future__ import annotations

import json
from datetime import date
from typing import Any, cast

from anthropic import Anthropic
from anthropic.types import (
    MessageParam,
    TextBlockParam,
    ToolChoiceToolParam,
    ToolParam,
)
from pydantic import BaseModel

from app.core.config import get_settings
from app.schemas.llm import (
    AssistantChatReply,
    AssistantInterpretation,
    CaptureResult,
    ClassificationResult,
    DraftResult,
    ExtractedCommitment,
    MeetingContextSummary,
    ThreadReconciliation,
)
from app.services.draft_revision import build_draft_user_content

settings = get_settings()

_CLASSIFY_SYSTEM = (
    "You are Albert's classification agent. Classify a single email into exactly one "
    "category and a priority. Optimize for precision: prefer low_priority over a false "
    "urgent. Always explain your reasoning in one sentence.\n\n"
    "The message is addressed TO the user (their email is given when available). Classify "
    "from the user's perspective: who must act next?\n\n"
    "Category rules:\n"
    "- needs_reply: a real person expects the USER to reply or provide something "
    "(documents, answers, confirmation). Use when the ball is in the user's court.\n"
    "- needs_decision: the USER must choose among options (approve/decline, pick a path, "
    "archive vs continue). Not when someone else must decide.\n"
    "- meeting_scheduling: the USER must pick/confirm a time or date that is still open. "
    "NOT for meetings already agreed — see informational below.\n"
    "- follow_up_needed: the user should chase a delegated or stalled thread, but no "
    "immediate reply is strictly required.\n"
    "- waiting_for_response: the USER already acted and is waiting on someone else; "
    "no user action is needed right now. Never use this if the user still owes a reply "
    "or a decision.\n"
    "- informational: FYI only — case closed, receipt, confirmed appointment reminder, "
    "Zoom/calendar link for an already-scheduled meeting, 'see you then', logistics "
    "with no open choice, verification/sign-in codes, OTP emails, and read-only security "
    "alerts (device added, new sign-in). Set action_required=false.\n"
    "- low_priority: optional/vanity contact (thank-you, survey, referral) with no real "
    "obligation.\n"
    "- deadline: explicit due date the user must meet.\n"
    "- spam_noise: marketing, newsletters, bulk promos.\n\n"
    "Disambiguation:\n"
    "- Confirmed time + reminder ('see you tomorrow at 9am', 'sounds good see you then') "
    "→ informational, not meeting_scheduling.\n"
    "- Zoom link / calendar invite for a fixed date-time already set → informational.\n"
    "- Verification code, OTP, 'confirm your email', sign-in code, one-time password "
    "→ informational (never needs_reply); user only reads the code.\n"
    "- Device added to account, new sign-in, new device detected, password changed "
    "→ informational (not needs_decision); only act if you did not do it.\n"
    "- 'Please let me know which dates work' / pick 1 of N slots → meeting_scheduling.\n"
    "- Request directed at user ('please provide the letter', 'send your hours') → "
    "needs_reply, even if a third party must eventually approve.\n"
    "- Counterparty just said 'no' or closed a request → not waiting_for_response; use "
    "needs_decision (what next) or informational if truly done.\n"
    "- Email primarily TO someone else with user only CC'd → informational unless the "
    "user is explicitly asked.\n\n"
    "In reason: refer to 'you' or the user's name from the To field — never 'Albert'."
)
_EXTRACT_SYSTEM = (
    "You are Albert's extraction agent. Find commitments (open loops) in an email: things "
    "the user owes someone, or someone owes the user. Quote verbatim evidence for each. "
    "If unsure, lower the confidence rather than inventing a commitment. Return an empty "
    "list when there is nothing actionable.\n"
    "Always set due_date when the email implies any deadline. Resolve relative dates "
    "('tomorrow', 'by Friday', 'end of week', 'before Thursday') against the reference "
    "date given in the message, and return them as absolute YYYY-MM-DD. Set the priority "
    "field: 'critical' or 'high' when a near deadline meets a waiting counterparty or a "
    "blocked deal, 'medium' for routine asks, 'low' for soft or open-ended ones.\n"
    "Set from_automated=true when the sender is automated (no-reply, marketing, "
    "newsletter, notification, security alert, receipt). A 'subscription expires' or "
    "'verify your login' nudge from a service is from_automated=true, not a person "
    "waiting on the user. Set it false only for a real human who expects a response."
)
_DRAFT_SYSTEM = (
    "You are Albert's drafting agent. Write a reply that matches the requested tone, is "
    "concise by default, and never invents facts not present in the thread. Sign off as "
    "the user whose name is given; if no name is given, omit the signature line entirely "
    "rather than inventing one. Do not send; you only draft. When revising an existing "
    "draft, keep what already works and apply every user note from the conversation — "
    "do not drop earlier preferences when a new note arrives."
)
_CAPTURE_SYSTEM = (
    "You are Albert's capture agent. The user dumped a messy note (typed or transcribed "
    "speech). Split it into distinct, actionable tasks with concise titles. Resolve "
    "relative dates ('tomorrow', 'Friday', 'next week') against the reference date as "
    "absolute YYYY-MM-DD. Infer priority from urgency words. If the note clearly belongs "
    "to one project, set detected_project. Do not invent tasks the user did not imply."
)
_INTERPRET_SYSTEM = (
    "You are Albert's assistant agent. Read one free-text request and decide what to do.\n"
    "If the user asks to schedule, book, block, or hold time on their calendar, set "
    "intent='book_calendar' and fill title, start, and end.\n"
    "If they ask to move, reschedule, or change the time of an existing event, set "
    "intent='reschedule_calendar', pick event_id from the upcoming-events list, and "
    "fill the new start/end (and title only if they rename it).\n"
    "If they ask to cancel or delete a calendar event, set intent='cancel_calendar' "
    "and pick event_id from the upcoming-events list.\n"
    "If they ask what's on their calendar, when a meeting is, what's coming up, or "
    "similar read-only schedule questions (including Chinese like 有什么安排 / 明天下午), "
    "set intent='check_calendar' and write a concise reply summarizing the matching "
    "events from the upcoming-events list. If nothing fits their timeframe, say so.\n"
    "Resolve relative phrasing ('tomorrow', 'this evening', '5 to 6pm', 'Friday morning') "
    "against the given current local time, and return start/end as ISO 8601 WITH the "
    "user's UTC offset (e.g. 2026-05-28T17:00:00+02:00). Default an event to 1 hour "
    "if only a start is given. Put a short confirmation in reply.\n"
    "For texting/SMS (e.g. 'text Mom: hi', '给 Mom 发：明天见'): set intent='none' and "
    "tell them to phrase it that way — Albert drafts the text locally from contacts.\n"
    "For email or inbox-thread replies: set intent='none' and point them to Inbox.\n"
    "For other general chat: set intent='none' and answer their question directly in a "
    "brief, natural way. Do not list Albert's features unless they ask what you can do "
    "or request something you cannot handle. Never say you can ONLY help with calendar "
    "events. Never invent times or events."
)
_RECONCILE_SYSTEM = (
    "You are Albert's commitment tracker. Given an email thread and a list of open "
    "commitments tied to that thread, mark which commitments are now resolved — "
    "because the user replied, the counterparty confirmed, the task was completed, "
    "or the request was explicitly cancelled. Only return ids when the thread clearly "
    "closes the loop. When unsure, leave the commitment open."
)
_CHAT_SYSTEM = (
    "You are Albert, a calm executive assistant. Answer the user's question using ONLY "
    "the context provided (today priorities, inbox, waiting loops, calendar). Be concise "
    "and specific. If the context lacks an answer, say so honestly. Never invent emails, "
    "people, or deadlines. Match the user's language (English or Chinese)."
)


def _tool_for(model: type[BaseModel], name: str, description: str) -> ToolParam:
    return ToolParam(name=name, description=description, input_schema=model.model_json_schema())


class AnthropicLLMClient:
    """Implements app.llm.base.LLMClient."""

    def __init__(self) -> None:
        self._client = Anthropic(api_key=settings.anthropic_api_key)

    def _structured(
        self,
        *,
        model: str,
        system: str,
        user_content: str,
        tool: ToolParam,
    ) -> dict[str, Any]:
        """Force a single tool and return its validated raw input dict."""
        response = self._client.messages.create(
            model=model,
            max_tokens=2048,
            system=[TextBlockParam(type="text", text=system, cache_control={"type": "ephemeral"})],
            tools=[tool],
            tool_choice=ToolChoiceToolParam(type="tool", name=tool["name"]),
            messages=[MessageParam(role="user", content=user_content)],
        )
        for block in response.content:
            if block.type == "tool_use":
                return cast(dict[str, Any], block.input)
        raise ValueError("Anthropic response contained no tool_use block")

    def classify_message(
        self, *, subject: str | None, body: str, sender: str, user_email: str | None = None
    ) -> ClassificationResult:
        user_line = f"The user's email: {user_email}\n" if user_email else ""
        raw = self._structured(
            model=settings.llm_classify_model,
            system=_CLASSIFY_SYSTEM,
            user_content=(f"{user_line}From: {sender}\nSubject: {subject or '(none)'}\n\n{body}"),
            tool=_tool_for(ClassificationResult, "classify", "Record the classification."),
        )
        return ClassificationResult.model_validate(raw)

    def extract_commitments(
        self,
        *,
        subject: str | None,
        body: str,
        sender: str,
        user_email: str,
        reference_date: date,
    ) -> list[ExtractedCommitment]:
        # Wrap the list in an object: tool input schemas must be objects, not arrays.
        class _Wrapper(BaseModel):
            commitments: list[ExtractedCommitment]

        raw = self._structured(
            model=settings.llm_extract_model,
            system=_EXTRACT_SYSTEM,
            user_content=(
                f"Reference date (today): {reference_date.isoformat()}.\n"
                f"The user's email address is {user_email}.\n"
                f"From: {sender}\nSubject: {subject or '(none)'}\n\n{body}"
            ),
            tool=_tool_for(_Wrapper, "record_commitments", "Record extracted commitments."),
        )
        return _Wrapper.model_validate(raw).commitments

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
        user_content = build_draft_user_content(
            thread_context=thread_context,
            tone=tone,
            user_name=user_name,
            instruction=instruction,
            current_draft=current_draft,
            revision_history=revision_history,
        )
        raw = self._structured(
            model=settings.llm_draft_model,
            system=_DRAFT_SYSTEM,
            user_content=user_content,
            tool=_tool_for(DraftResult, "record_draft", "Record the drafted reply."),
        )
        return DraftResult.model_validate(raw)

    def generate_daily_briefing(self, *, today_payload: dict[str, Any]) -> str:
        response = self._client.messages.create(
            model=settings.llm_extract_model,
            max_tokens=600,
            system=[
                TextBlockParam(
                    type="text",
                    text=(
                        "You are Albert. Write a calm morning briefing in under 90 seconds of "
                        "reading. Lead with what matters today. No more than 5 priorities."
                    ),
                    cache_control={"type": "ephemeral"},
                )
            ],
            messages=[MessageParam(role="user", content=json.dumps(today_payload, default=str))],
        )
        return "".join(b.text for b in response.content if b.type == "text")

    def summarize_meeting_context(
        self, *, event_title: str, related_messages: list[str]
    ) -> MeetingContextSummary:
        joined = "\n---\n".join(related_messages) or "(no related messages found)"
        raw = self._structured(
            model=settings.llm_extract_model,
            system=(
                "You are Albert's meeting-prep agent. Summarize context for an upcoming meeting."
            ),
            user_content=f"Meeting: {event_title}\n\nRelated messages:\n{joined}",
            tool=_tool_for(MeetingContextSummary, "record_summary", "Record the meeting summary."),
        )
        return MeetingContextSummary.model_validate(raw)

    def parse_capture(self, *, text: str, reference_date: date) -> CaptureResult:
        raw = self._structured(
            model=settings.llm_extract_model,
            system=_CAPTURE_SYSTEM,
            user_content=f"Reference date (today): {reference_date.isoformat()}.\n\nNote:\n{text}",
            tool=_tool_for(CaptureResult, "record_tasks", "Record the parsed tasks."),
        )
        return CaptureResult.model_validate(raw)

    def interpret_request(
        self, *, text: str, now_iso: str, timezone: str, upcoming_events: str = ""
    ) -> AssistantInterpretation:
        events_block = (
            "\n\nUpcoming events (use event_id when rescheduling or cancelling):\n"
            f"{upcoming_events}"
            if upcoming_events
            else ""
        )
        raw = self._structured(
            model=settings.llm_extract_model,
            system=_INTERPRET_SYSTEM,
            user_content=(
                f"Current local time: {now_iso} (timezone {timezone}).{events_block}\n\n"
                f"Request:\n{text}"
            ),
            tool=_tool_for(
                AssistantInterpretation, "record_interpretation", "Record the interpretation."
            ),
        )
        return AssistantInterpretation.model_validate(raw)

    def reconcile_thread_commitments(
        self,
        *,
        thread_context: str,
        open_commitments: list[dict[str, str]],
    ) -> ThreadReconciliation:
        if not open_commitments:
            return ThreadReconciliation()
        lines = "\n".join(f"- id={c['id']}: {c['description']}" for c in open_commitments)
        raw = self._structured(
            model=settings.llm_extract_model,
            system=_RECONCILE_SYSTEM,
            user_content=f"Thread:\n{thread_context}\n\nOpen commitments:\n{lines}",
            tool=_tool_for(
                ThreadReconciliation,
                "record_resolved",
                "Record commitment ids resolved in this thread.",
            ),
        )
        return ThreadReconciliation.model_validate(raw)

    def answer_contextual_question(
        self,
        *,
        question: str,
        context: str,
        history: list[dict[str, str]] | None = None,
    ) -> AssistantChatReply:
        history_block = ""
        if history:
            turns = "\n".join(f"{m['role']}: {m['content']}" for m in history[-6:])
            history_block = f"\n\nRecent conversation:\n{turns}\n"
        raw = self._structured(
            model=settings.llm_extract_model,
            system=_CHAT_SYSTEM,
            user_content=f"Context:\n{context}{history_block}\n\nQuestion:\n{question}",
            tool=_tool_for(AssistantChatReply, "record_reply", "Record the assistant reply."),
        )
        return AssistantChatReply.model_validate(raw)
