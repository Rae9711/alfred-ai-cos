"""Task service tests against in-memory SQLite."""

from datetime import date

import pytest
from sqlalchemy.orm import Session

from app.db.enums import Priority, SourceType, TaskStatus
from app.db.models import Task, User
from app.services import tasks as task_service

TODAY = date(2026, 5, 21)


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="tasks@example.com")
    db.add(u)
    db.commit()
    return u


def test_create_task_defaults_to_manual(db: Session, user: User) -> None:
    task = task_service.create_task(db, user.id, title="Call the broker")
    assert task.title == "Call the broker"
    assert task.source_type == SourceType.manual
    assert task.status == TaskStatus.open
    assert task.priority == Priority.medium


def test_create_task_from_gmail_source(db: Session, user: User) -> None:
    task = task_service.create_task(
        db,
        user.id,
        title="Reply to Dana",
        source_type=SourceType.gmail,
        source_id="msg_1",
        confidence=0.8,
    )
    assert task.source_type == SourceType.gmail
    assert task.source_id == "msg_1"
    assert task.confidence == 0.8


def test_list_orders_dated_before_undated(db: Session, user: User) -> None:
    task_service.create_task(db, user.id, title="No date")
    task_service.create_task(db, user.id, title="Due soon", due_date=TODAY)
    titles = [t.title for t in task_service.list_tasks(db, user.id)]
    assert titles[0] == "Due soon"


def test_status_filter(db: Session, user: User) -> None:
    a = task_service.create_task(db, user.id, title="A")
    task_service.create_task(db, user.id, title="B")
    task_service.set_status(db, a, TaskStatus.done)
    open_tasks = task_service.list_tasks(db, user.id, status=TaskStatus.open)
    done_tasks = task_service.list_tasks(db, user.id, status=TaskStatus.done)
    assert {t.title for t in open_tasks} == {"B"}
    assert {t.title for t in done_tasks} == {"A"}


def test_set_status_persists(db: Session, user: User) -> None:
    task = task_service.create_task(db, user.id, title="Done me")
    task_service.set_status(db, task, TaskStatus.done)
    reloaded = db.get(Task, task.id)
    assert reloaded is not None
    assert reloaded.status == TaskStatus.done
