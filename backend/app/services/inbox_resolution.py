"""Close the loop when inbox mail is handled (marked decided or replied).

Commitments and tasks extracted from email keep source_id → message.id. When the
user marks a message handled or sends a reply, those derivatives should leave Today,
Ask, planning, and notification scans."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import CommitmentStatus, SourceType, TaskStatus
from app.db.models import Commitment, Message, Task
from app.services.inbox_view import message_is_handled, user_replied_message_ids


def handled_message_ids(db: Session, user_id: str) -> set[str]:
    """Message ids treated as handled for the purpose of surfacing commitments/tasks.

    Includes messages the user explicitly marked decided or replied to, plus Gmail/email
    that is already read or older than the age cutoff (message_is_handled). Any commitment
    or task sourced solely from such a message drops out of Today, Waiting, the assistant,
    and every reminder scan."""
    ids = user_replied_message_ids(db, user_id)
    for message in db.scalars(select(Message).where(Message.user_id == user_id)):
        if message_is_handled(message):
            ids.add(message.id)
    return ids


def user_message_ids(db: Session, user_id: str) -> set[str]:
    """All message ids currently stored for the user (for orphan-source filtering)."""
    return set(db.scalars(select(Message.id).where(Message.user_id == user_id)))


def is_source_message_handled(source_id: str | None, handled_ids: set[str]) -> bool:
    return bool(source_id and source_id in handled_ids)


def filter_actionable_commitments(
    commitments: list[Commitment],
    handled_ids: set[str],
    *,
    known_message_ids: set[str] | None = None,
) -> list[Commitment]:
    """Drop commitments sourced from handled mail, or from deleted Gmail messages.

    Missing source messages are treated as non-actionable: chase/Today should not
    keep looping on loops whose email is gone (e.g. purged after the user read it).
    """
    out: list[Commitment] = []
    for c in commitments:
        if is_source_message_handled(c.source_id, handled_ids):
            continue
        if (
            known_message_ids is not None
            and c.source_type == SourceType.gmail
            and c.source_id
            and c.source_id not in known_message_ids
        ):
            continue
        out.append(c)
    return out


def filter_actionable_tasks(tasks: list[Task], handled_ids: set[str]) -> list[Task]:
    return [t for t in tasks if not is_source_message_handled(t.source_id, handled_ids)]


def resolve_derivatives_for_message(db: Session, user_id: str, message_id: str) -> int:
    """Mark open commitments and tasks sourced from this message as done."""
    changed = 0
    for commitment in db.scalars(
        select(Commitment).where(
            Commitment.user_id == user_id,
            Commitment.source_id == message_id,
            Commitment.status == CommitmentStatus.open,
        )
    ):
        commitment.status = CommitmentStatus.done
        changed += 1
    for task in db.scalars(
        select(Task).where(
            Task.user_id == user_id,
            Task.source_id == message_id,
            Task.status == TaskStatus.open,
        )
    ):
        task.status = TaskStatus.done
        changed += 1
    if changed:
        db.commit()
    return changed
