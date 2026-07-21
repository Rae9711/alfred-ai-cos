"""Trigger ingestion + extraction (PRD 12.2, 12.5).

Mobile refresh uses background=true to queue incremental sync and return immediately.
ingest_only=true runs incremental Gmail pull on the request path (classify in Celery).
calendar_only=true syncs Google Calendar without touching Gmail (fast home refresh)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from google.auth.exceptions import RefreshError
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import User
from app.schemas.api import SyncResponse
from app.services import calendar
from app.services.connected_accounts import TokenReconnectRequired
from app.services.mail_sync import run_mail_sync
from app.workers.tasks import classify_pending_messages, sync_user

router = APIRouter(prefix="/sync", tags=["sync"])

# A revoked/expired Google grant can surface either as our typed TokenReconnectRequired
# (raised by the sync pipeline) or as a raw RefreshError bubbling out of a Calendar call.
_RECONNECT_EXCEPTIONS = (TokenReconnectRequired, RefreshError)


def _reconnect_response() -> SyncResponse:
    """Graceful sync result when the Google grant needs reconnecting.

    The affected mailbox already carries sync_status=error / sync_error for the UI's
    reconnect prompt, so returning zeros here keeps the inbox screen loading its cached
    mail instead of turning a re-auth condition into a 502 that reads as an outage."""
    return SyncResponse(
        ingested=0,
        processed=0,
        commitments_found=0,
        events_synced=0,
        initial_backfill=False,
    )


@router.post("", response_model=SyncResponse)
def sync_now(
    ingest_only: bool = Query(
        default=False,
        description="Pull Gmail only (fast). Classify in background when true.",
    ),
    calendar_only: bool = Query(
        default=False,
        description="Sync Google Calendar only (fast). Skips Gmail.",
    ),
    background: bool = Query(
        default=False,
        description="Queue incremental sync in Celery and return immediately (mobile refresh).",
    ),
    reclassify: bool = Query(
        default=False,
        description="Re-run classification on recent already-classified Primary mail.",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SyncResponse:
    if background:
        sync_user.delay(user.id)
        return SyncResponse(
            ingested=0,
            processed=0,
            commitments_found=0,
            events_synced=0,
            initial_backfill=False,
        )

    if calendar_only:
        try:
            events = calendar.sync_calendar(db, user.id)
        except _RECONNECT_EXCEPTIONS:
            return _reconnect_response()
        return SyncResponse(
            ingested=0,
            processed=0,
            commitments_found=0,
            events_synced=len(events),
            initial_backfill=False,
        )

    try:
        result, processed, commitments = run_mail_sync(
            db, user.id, ingest_only=ingest_only, reclassify=reclassify
        )
    except _RECONNECT_EXCEPTIONS:
        # A revoked/expired grant (typed TokenReconnectRequired, or a raw RefreshError
        # that escaped a path we didn't wrap) can never succeed on retry — degrade to a
        # zeroed 200 so the home/inbox screens keep loading their cached data instead of
        # surfacing a 502/500 outage. The mailbox's sync_status drives the reconnect prompt.
        return _reconnect_response()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if ingest_only:
        classify_pending_messages.delay(user.id)
    events = []
    if not ingest_only:
        try:
            events = calendar.sync_calendar(db, user.id)
        except _RECONNECT_EXCEPTIONS:
            events = []
    return SyncResponse(
        ingested=len(result.new_messages),
        processed=processed,
        commitments_found=commitments,
        events_synced=len(events),
        initial_backfill=result.initial_backfill,
    )
