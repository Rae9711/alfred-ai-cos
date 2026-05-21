"""Task service (PRD 12.4). Create, list, and update tasks. Used by the manual
task routes and by the create_task action executor, so both paths share one
creation code path with consistent provenance."""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import Priority, SourceType, TaskStatus
from app.db.models import Task


def create_task(
    db: Session,
    user_id: str,
    *,
    title: str,
    description: str | None = None,
    due_date: date | None = None,
    priority: Priority = Priority.medium,
    source_type: SourceType = SourceType.manual,
    source_id: str | None = None,
    confidence: float | None = None,
) -> Task:
    task = Task(
        user_id=user_id,
        title=title,
        description=description,
        due_date=due_date,
        priority=priority,
        source_type=source_type,
        source_id=source_id,
        confidence=confidence,
    )
    db.add(task)
    db.commit()
    return task


def list_tasks(db: Session, user_id: str, *, status: TaskStatus | None = None) -> list[Task]:
    stmt = select(Task).where(Task.user_id == user_id)
    if status is not None:
        stmt = stmt.where(Task.status == status)
    return list(db.scalars(stmt.order_by(Task.due_date.is_(None), Task.due_date)))


def set_status(db: Session, task: Task, status: TaskStatus) -> Task:
    task.status = status
    db.commit()
    return task
