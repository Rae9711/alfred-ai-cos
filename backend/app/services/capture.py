"""Capture service (PRD 10.3, journey 6). Parse a messy note into structured tasks
and persist them. Used by both text capture (A6) and voice capture (A7, after
transcription)."""

from __future__ import annotations

from datetime import UTC, date as date_type, datetime

from sqlalchemy.orm import Session

from app.db.enums import SourceType
from app.db.models import Task
from app.llm import get_llm
from app.schemas.llm import ParsedTask
from app.services import tasks as task_service
from app.services.assistant import (
    _default_remind_at,
    _fallback_reminder_from_text,
    _now_in_tz,
)


def _resolve_task_schedule(
    parsed: ParsedTask,
    *,
    text: str,
    reference_date: date_type,
    timezone: str,
    single_task: bool,
) -> tuple[date_type | None, datetime | None]:
    """Fill due_date / remind_at for reminder-style captures when the LLM omitted them."""
    due_date = parsed.due_date
    remind_at = parsed.remind_at
    anchor_now = datetime.combine(reference_date, datetime.min.time(), tzinfo=UTC)

    if single_task and remind_at is None and due_date is None:
        fallback = _fallback_reminder_from_text(text, now=anchor_now)
        if fallback is not None:
            _, due_date = fallback

    if due_date is None and remind_at is not None:
        due_date = remind_at.astimezone(_now_in_tz(timezone).tzinfo or UTC).date()

    if due_date is None and single_task and ("提醒" in text or "remind me" in text.lower()):
        due_date = reference_date

    if remind_at is None and due_date is not None:
        remind_at = _default_remind_at(due_date, timezone)

    return due_date, remind_at


def capture_text(
    db: Session,
    user_id: str,
    *,
    text: str,
    reference_date: date_type,
    source_type: SourceType = SourceType.manual,
    timezone: str = "UTC",
) -> tuple[list[Task], str | None]:
    """Parse `text` into tasks, persist them, and return (tasks, detected_project)."""
    result = get_llm().parse_capture(text=text, reference_date=reference_date)
    created: list[Task] = []
    single_task = len(result.tasks) == 1
    for parsed in result.tasks:
        due_date, remind_at = _resolve_task_schedule(
            parsed,
            text=text,
            reference_date=reference_date,
            timezone=timezone,
            single_task=single_task,
        )
        created.append(
            task_service.create_task(
                db,
                user_id,
                title=parsed.title,
                due_date=due_date,
                remind_at=remind_at,
                priority=parsed.priority,
                source_type=source_type,
            )
        )
    return created, result.detected_project
