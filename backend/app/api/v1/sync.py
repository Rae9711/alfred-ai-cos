"""Trigger ingestion + extraction (PRD 12.2, 12.5).

Synchronous for the slice so the flow is easy to demo end to end. In production
this enqueues a Celery task (app.workers.tasks.sync_user) instead; the worker path
is wired and ready (see docs/ARCHITECTURE.md)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import User
from app.schemas.api import SyncResponse
from app.services import calendar
from app.services.mail_sync import run_mail_sync

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("", response_model=SyncResponse)
def sync_now(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SyncResponse:
    result, processed, commitments = run_mail_sync(db, user.id)
    events = calendar.sync_calendar(db, user.id)
    return SyncResponse(
        ingested=len(result.new_messages),
        processed=processed,
        commitments_found=commitments,
        events_synced=len(events),
        initial_backfill=result.initial_backfill,
    )
