"""Calendar ingestion (PRD 12.3). Pulls upcoming Google Calendar events and upserts
CalendarEvent rows. An event is flagged prep_required when it has external attendees,
which is the signal meeting-prep (A3) keys off."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.enums import Provider
from app.db.models import CalendarEvent, ConnectedAccount, User
from app.services import gcal
from app.services.crypto import decrypt_token, encrypt_token
from app.services.google_oauth import fresh_credentials
from app.services.gmail import use_gmail_credentials


def _local_tz(timezone: str | None):
    try:
        return ZoneInfo(timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return UTC


def _sync_window_utc(timezone: str | None) -> tuple[datetime, datetime]:
    """Local calendar month start through end of month + one week (for home month view)."""
    tz = _local_tz(timezone)
    local_now = datetime.now(tz)
    month_start = local_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if month_start.month == 12:
        month_end = month_start.replace(year=month_start.year + 1, month=1)
    else:
        month_end = month_start.replace(month=month_start.month + 1)
    window_end = month_end + timedelta(days=7)
    return month_start.astimezone(UTC), window_end.astimezone(UTC)


def _account(db: Session, user_id: str) -> ConnectedAccount:
    account = db.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.user_id == user_id,
            ConnectedAccount.provider == Provider.google,
        )
    )
    if account is None:
        raise ValueError("No connected Google account for user")
    return account


def _token_for_account(account: ConnectedAccount) -> dict:
    stored = decrypt_token(account.token_ciphertext)
    _creds, token = fresh_credentials(stored)
    return token


def _prep_required(event: dict, user_email: str) -> bool:
    """True when the event has at least one attendee other than the user."""
    others = [a for a in event.get("attendees", []) if a and a != user_email]
    return len(others) > 0


def get_event(db: Session, user_id: str, event_id: str) -> CalendarEvent:
    event = db.get(CalendarEvent, event_id)
    if event is None or event.user_id != user_id:
        raise ValueError("Event not found")
    return event


def sync_calendar(db: Session, user_id: str, *, days_ahead: int = 14) -> list[CalendarEvent]:
    """Fetch events for the user's local month window, upsert, and prune stale rows."""
    account = _account(db, user_id)
    user = db.get(User, user_id)
    user_email = user.email if user else ""
    token = _token_for_account(account)

    touched: list[CalendarEvent] = []
    seen_external: set[str] = set()
    window_start, window_end = _sync_window_utc(user.timezone if user else None)

    for raw in gcal.list_upcoming_events(
        token, time_min=window_start, time_max=window_end
    ):
        seen_external.add(raw["external_id"])
        touched.append(_upsert_event(db, user_id, raw, user_email))

    # Drop local copies of events removed or moved out of the sync window.
    stale = list(
        db.scalars(
            select(CalendarEvent).where(
                CalendarEvent.user_id == user_id,
                CalendarEvent.start_time.is_not(None),
                CalendarEvent.start_time >= window_start,
                CalendarEvent.start_time < window_end,
            )
        )
    )
    for event in stale:
        if event.external_id not in seen_external:
            db.delete(event)

    db.commit()
    return touched


def book_event(
    db: Session,
    user_id: str,
    *,
    title: str,
    start: datetime,
    end: datetime,
    description: str | None = None,
    location: str | None = None,
) -> CalendarEvent:
    """Create a calendar event on the user's primary calendar and persist it locally."""
    account = _account(db, user_id)
    user = db.get(User, user_id)
    user_email = user.email if user else ""
    stored = decrypt_token(account.token_ciphertext)
    creds, token = fresh_credentials(stored)

    with use_gmail_credentials(creds):
        raw = gcal.create_event(
            token,
            title=title,
            start=start,
            end=end,
            description=description,
            location=location,
        )
    if token != stored:
        account.token_ciphertext = encrypt_token(token)
    event = _upsert_event(db, user_id, raw, user_email)
    db.commit()
    return event


def update_event(
    db: Session,
    user_id: str,
    event_id: str,
    *,
    title: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    description: str | None = None,
    location: str | None = None,
) -> CalendarEvent:
    """Update an event on Google Calendar and refresh the local row."""
    account = _account(db, user_id)
    user = db.get(User, user_id)
    user_email = user.email if user else ""
    event = get_event(db, user_id, event_id)
    stored = decrypt_token(account.token_ciphertext)
    creds, token = fresh_credentials(stored)

    with use_gmail_credentials(creds):
        raw = gcal.update_event(
            token,
            event.external_id,
            title=title,
            start=start,
            end=end,
            description=description,
            location=location,
        )
    if token != stored:
        account.token_ciphertext = encrypt_token(token)
    _apply_raw(event, raw, user_email)
    db.commit()
    db.refresh(event)
    return event


def delete_event(db: Session, user_id: str, event_id: str) -> None:
    """Delete an event from Google Calendar and remove the local row."""
    account = _account(db, user_id)
    event = get_event(db, user_id, event_id)
    stored = decrypt_token(account.token_ciphertext)
    creds, token = fresh_credentials(stored)

    with use_gmail_credentials(creds):
        gcal.delete_event(token, event.external_id)
    if token != stored:
        account.token_ciphertext = encrypt_token(token)
    db.execute(delete(CalendarEvent).where(CalendarEvent.id == event_id))
    db.commit()


def upsert_seed_event(
    db: Session, user_id: str, raw: dict, user_email: str
) -> CalendarEvent:
    """Upsert a single normalized event. Used by the dev seed path (no Google call)."""
    event = _upsert_event(db, user_id, raw, user_email)
    db.commit()
    return event


def _upsert_event(db: Session, user_id: str, raw: dict, user_email: str) -> CalendarEvent:
    existing = db.scalar(
        select(CalendarEvent).where(
            CalendarEvent.user_id == user_id,
            CalendarEvent.external_id == raw["external_id"],
        )
    )
    if existing is None:
        event = CalendarEvent(
            user_id=user_id,
            external_id=raw["external_id"],
        )
        db.add(event)
        _apply_raw(event, raw, user_email)
        return event
    _apply_raw(existing, raw, user_email)
    return existing


def _apply_raw(event: CalendarEvent, raw: dict, user_email: str) -> None:
    event.title = raw["title"]
    event.start_time = raw["start_time"]
    event.end_time = raw["end_time"]
    event.location = raw["location"]
    event.description = raw["description"]
    event.attendees = raw["attendees"]
    event.prep_required = _prep_required(raw, user_email)
    if raw.get("html_link"):
        event.html_link = raw["html_link"]
