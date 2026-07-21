#!/usr/bin/env python3
"""One-off, idempotent backfill: treat already-read and stale Gmail/email as handled.

Behaviour change context: a Gmail message that is already read (no UNREAD label) or
older than settings.email_handled_age_days (default 30) is now treated as already
handled — it is not surfaced as needs-action and generates no reminders. The runtime
rule (app.services.inbox_view.gmail_read_or_stale) already enforces this for live
requests the moment the new code deploys. This script fixes the *stored* data so the
change is durable and complete:

  1. Marks each qualifying Gmail/email Message as user_decided (the existing "handled"
     flag), so it stays handled even if only the age/label predicate would otherwise
     apply, and so it is queryable.
  2. Closes (status -> done) any OPEN Commitment / Task sourced solely from such a
     message, so nothing lingers as an open loop.

Safety / scope:
  - Gmail/email only. SMS and WhatsApp rows are never touched (their read semantics
    differ).
  - Only status / header flag updates. Nothing is deleted. No secrets are read/written.
  - Idempotent: re-running makes no further changes once applied.
  - Defaults to a DRY RUN that only counts what WOULD change. Pass --apply to commit.

Known coverage limitation: "read" is judged from the last-known gmail_labels captured
at ingest / the most recent label sync. If a grant is revoked we cannot re-fetch Gmail,
so messages the user read in Gmail AFTER the last successful label sync are NOT detected
as read here — but the >30-day age cutoff still catches old items, and newly-synced mail
picks up the rule going forward once grants are restored.

Usage (prod):
  docker compose -p albert -f docker-compose.prod.yml run --rm albert_web \
      python -m app.scripts.backfill_read_handled            # dry run (counts only)
  docker compose -p albert -f docker-compose.prod.yml run --rm albert_web \
      python -m app.scripts.backfill_read_handled --apply    # commit changes
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.base import SessionLocal
from app.db.enums import CommitmentStatus, TaskStatus
from app.db.models import Commitment, Message, Task
from app.services.inbox_view import (
    gmail_read_or_stale,
    mark_message_user_decided,
    message_user_decided,
)

_EMAIL_SOURCES = frozenset({"gmail", "email"})


@dataclass
class BackfillCounts:
    messages_scanned: int = 0
    messages_read: int = 0
    messages_stale_only: int = 0
    messages_already_decided: int = 0
    messages_marked_decided: int = 0
    commitments_closed: int = 0
    tasks_closed: int = 0
    qualifying_message_ids: set[str] = field(default_factory=set)


def _is_read(message: Message) -> bool:
    """Read == Gmail dropped the UNREAD label. Unknown labels count as unread."""
    labels = message.gmail_labels
    if not labels:
        return False
    return "UNREAD" not in labels


def run_backfill(db: Session, *, apply: bool, user_id: str | None = None) -> BackfillCounts:
    counts = BackfillCounts()
    stmt = select(Message).where(Message.source.in_(tuple(_EMAIL_SOURCES)))
    if user_id:
        stmt = stmt.where(Message.user_id == user_id)

    for message in db.scalars(stmt):
        counts.messages_scanned += 1
        if not gmail_read_or_stale(message):
            continue
        counts.qualifying_message_ids.add(message.id)
        if _is_read(message):
            counts.messages_read += 1
        else:
            counts.messages_stale_only += 1
        if message_user_decided(message):
            counts.messages_already_decided += 1
        else:
            counts.messages_marked_decided += 1
            if apply:
                mark_message_user_decided(message)

    if counts.qualifying_message_ids:
        ids = list(counts.qualifying_message_ids)
        open_commitments = list(
            db.scalars(
                select(Commitment).where(
                    Commitment.status == CommitmentStatus.open,
                    Commitment.source_id.in_(ids),
                )
            )
        )
        counts.commitments_closed = len(open_commitments)
        open_tasks = list(
            db.scalars(
                select(Task).where(
                    Task.status == TaskStatus.open,
                    Task.source_id.in_(ids),
                )
            )
        )
        counts.tasks_closed = len(open_tasks)
        if apply:
            for commitment in open_commitments:
                commitment.status = CommitmentStatus.done
            for task in open_tasks:
                task.status = TaskStatus.done

    if apply:
        db.commit()
    else:
        db.rollback()
    return counts


def _print_report(counts: BackfillCounts, *, apply: bool) -> None:
    mode = "APPLIED" if apply else "DRY RUN (no changes committed)"
    settings = get_settings()
    print(f"=== backfill_read_handled — {mode} ===")
    print(f"age cutoff: {settings.email_handled_age_days} days")
    print(f"Gmail/email messages scanned:        {counts.messages_scanned}")
    print(f"qualifying (read or stale):          {len(counts.qualifying_message_ids)}")
    print(f"  - already read:                    {counts.messages_read}")
    print(f"  - stale-only (unread but >cutoff):  {counts.messages_stale_only}")
    print(f"  - already marked handled:          {counts.messages_already_decided}")
    print(f"  - newly marked handled:            {counts.messages_marked_decided}")
    print(f"open commitments closed:             {counts.commitments_closed}")
    print(f"open tasks closed:                   {counts.tasks_closed}")
    if not apply:
        print("\nRe-run with --apply to commit these changes.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Commit changes. Without this flag the script only counts (dry run).",
    )
    parser.add_argument(
        "--user",
        dest="user_id",
        default=None,
        help="Restrict to a single user id (optional).",
    )
    args = parser.parse_args(argv)

    db = SessionLocal()
    try:
        counts = run_backfill(db, apply=args.apply, user_id=args.user_id)
    finally:
        db.close()
    _print_report(counts, apply=args.apply)
    return 0


if __name__ == "__main__":
    sys.exit(main())
