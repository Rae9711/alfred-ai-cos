"""Task routes (PRD 12.4)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.enums import TaskStatus
from app.db.models import Task, User
from app.schemas.api import TaskCreateRequest, TaskOut
from app.services import tasks as task_service

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.post("", response_model=TaskOut)
def create(
    payload: TaskCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Task:
    return task_service.create_task(
        db,
        user.id,
        title=payload.title,
        description=payload.description,
        due_date=payload.due_date,
        remind_at=payload.remind_at,
        priority=payload.priority,
    )


@router.get("", response_model=list[TaskOut])
def list_all(
    status: TaskStatus | None = None,
    upcoming: bool = Query(default=False),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Task]:
    if upcoming:
        return task_service.list_upcoming_reminders(db, user.id)
    return task_service.list_tasks(db, user.id, status=status)


@router.post("/{task_id}/status", response_model=TaskOut)
def update_status(
    task_id: str,
    status: TaskStatus,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Task:
    task = db.get(Task, task_id)
    if task is None or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task not found")
    return task_service.set_status(db, task, status)
