"""Create-task capability (level 2 reversible write). Turns an approved proposal into
a task via the task service, so AI-suggested tasks share the manual creation path."""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.capabilities.base import (
    CapabilityDescription,
    CapabilityError,
    ExecutionResult,
)
from app.db.enums import ActionType, RiskLevel, SourceType
from app.db.models import User
from app.services import tasks as task_service


class CreateTaskCapability:
    def describe(self) -> CapabilityDescription:
        return CapabilityDescription(
            action_type=ActionType.create_task,
            risk_level=RiskLevel.reversible_write,
            title="Create a task",
            summary="Add a task to your list.",
        )

    def validate(self, db: Session, user: User, payload: dict[str, Any]) -> None:
        if not payload.get("title"):
            raise CapabilityError("A task title is required")

    def execute(self, db: Session, user: User, payload: dict[str, Any]) -> ExecutionResult:
        due_date = payload.get("due_date")
        if isinstance(due_date, str):
            due_date = date.fromisoformat(due_date)
        source_raw = payload.get("source_type", SourceType.manual.value)
        source_type = (
            source_raw if isinstance(source_raw, SourceType) else SourceType(str(source_raw))
        )
        task = task_service.create_task(
            db,
            user.id,
            title=str(payload["title"]),
            description=payload.get("description"),
            due_date=due_date,
            source_type=source_type,
            source_id=payload.get("source_id"),
            confidence=payload.get("confidence"),
        )
        detail = f"Created task: {task.title}"
        if task.due_date:
            detail += f" (due {task.due_date.isoformat()})"
        return ExecutionResult(detail=detail, reversible=True)
