"""Trigger ingestion + extraction (PRD 12.2, 12.5).

Mobile refresh uses ingest_only=true for a fast Gmail pull; classification runs
in a Celery task afterward. Background poll uses the full path."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import User
from app.schemas.api import SyncResponse
from app.services import calendar
from app.services.mail_sync import run_mail_sync
from app.workers.tasks import classify_pending_messages

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("", response_model=SyncResponse)
def sync_now(
    ingest_only: bool = Query(
        default=False,
        description="Pull Gmail only (fast). Classify in background when true.",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SyncResponse:
    result, processed, commitments = run_mail_sync(
        db, user.id, ingest_only=ingest_only, light=ingest_only
    )
    if ingest_only:
        classify_pending_messages.delay(user.id)
    events = calendar.sync_calendar(db, user.id) if not ingest_only else []
    return SyncResponse(
        ingested=len(result.new_messages),
        processed=processed,
        commitments_found=commitments,
        events_synced=len(events),
        initial_backfill=result.initial_backfill,
    )
