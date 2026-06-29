"""Task service (PRD 12.4). Create, list, and update tasks. Used by the manual
task routes and by the create_task action executor, so both paths share one
creation code path with consistent provenance."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import or_, select
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
    remind_at: datetime | None = None,
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
        remind_at=remind_at,
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


def list_upcoming_reminders(
    db: Session,
    user_id: str,
    *,
    now: datetime | None = None,
    within_days: int = 14,
) -> list[Task]:
    """Open tasks with a future remind_at or due_date within the window."""
    anchor = now or datetime.now(UTC)
    today = anchor.date()
    horizon = today + timedelta(days=within_days)
    rows = list(
        db.scalars(
            select(Task).where(
                Task.user_id == user_id,
                Task.status == TaskStatus.open,
                or_(
                    Task.remind_at.is_not(None),
                    Task.due_date.is_not(None),
                ),
            )
        )
    )
    upcoming: list[Task] = []
    for task in rows:
        if task.remind_at is not None:
            at = task.remind_at if task.remind_at.tzinfo else task.remind_at.replace(tzinfo=UTC)
            if at >= anchor:
                upcoming.append(task)
                continue
        if task.due_date is not None and today <= task.due_date <= horizon:
            upcoming.append(task)
    upcoming.sort(
        key=lambda t: (
            t.remind_at or datetime.combine(t.due_date or today, datetime.min.time(), tzinfo=UTC)
        )
    )
    return upcoming[:12]


def set_status(db: Session, task: Task, status: TaskStatus) -> Task:
    task.status = status
    db.commit()
    return task
