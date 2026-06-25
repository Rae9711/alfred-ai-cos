"""Google Calendar API wrapper. Reads (calendar.readonly) and creates events
(calendar.events scope).

Lists upcoming events from the primary calendar and normalizes them into the shape
CalendarEvent expects, and creates new events ("book my time"). Like the Gmail wrapper,
this is the only place the Calendar API surface is touched, so the rest of the app stays
provider-agnostic about Google."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from googleapiclient.discovery import build

from app.services.google_oauth import credentials_from_payload


def _service(token_payload: dict[str, Any]) -> Any:
    """Return a Calendar API client. googleapiclient is untyped, hence Any."""
    creds = credentials_from_payload(token_payload)
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def list_upcoming_events(
    token_payload: dict[str, Any], *, days_ahead: int = 14, max_results: int = 50
) -> list[dict[str, Any]]:
    """Return normalized upcoming events from now to now + days_ahead.

    Each dict: external_id, title, start_time (datetime|None), end_time, location,
    description, attendees (list[str] of emails). All-day events have date-only
    start/end, which we coerce to midnight UTC so the model's DateTime columns hold.
    Cancelled events are omitted.
    """
    svc = _service(token_payload)
    now = datetime.now(UTC)
    time_min = now.isoformat()
    time_max = (now + timedelta(days=days_ahead)).isoformat()

    resp = (
        svc.events()
        .list(
            calendarId="primary",
            timeMin=time_min,
            timeMax=time_max,
            singleEvents=True,
            orderBy="startTime",
            maxResults=max_results,
        )
        .execute()
    )
    items: list[dict[str, Any]] = []
    for item in resp.get("items", []):
        if item.get("status") == "cancelled":
            continue
        items.append(_normalize(item))
    return items


def get_event(token_payload: dict[str, Any], external_id: str) -> dict[str, Any]:
    """Fetch one event by Google id."""
    svc = _service(token_payload)
    raw = svc.events().get(calendarId="primary", eventId=external_id).execute()
    if raw.get("status") == "cancelled":
        raise ValueError("Event was cancelled in Google Calendar")
    return _normalize(raw)


def create_event(
    token_payload: dict[str, Any],
    *,
    title: str,
    start: datetime,
    end: datetime,
    description: str | None = None,
    location: str | None = None,
) -> dict[str, Any]:
    """Create an event on the user's primary calendar and return it normalized.

    start/end must be timezone-aware (they carry the user's intended wall-clock time
    as an offset). Google reads the offset, so we don't pass a separate timeZone.
    """
    svc = _service(token_payload)
    body: dict[str, Any] = {
        "summary": title,
        "start": {"dateTime": start.isoformat()},
        "end": {"dateTime": end.isoformat()},
    }
    if description:
        body["description"] = description
    if location:
        body["location"] = location

    created = svc.events().insert(calendarId="primary", body=body).execute()
    return _normalize(created)


def update_event(
    token_payload: dict[str, Any],
    external_id: str,
    *,
    title: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    description: str | None = None,
    location: str | None = None,
) -> dict[str, Any]:
    """Patch fields on an existing primary-calendar event."""
    svc = _service(token_payload)
    existing = svc.events().get(calendarId="primary", eventId=external_id).execute()
    if title is not None:
        existing["summary"] = title
    if description is not None:
        existing["description"] = description
    if location is not None:
        existing["location"] = location
    if start is not None:
        existing.setdefault("start", {})["dateTime"] = start.isoformat()
    if end is not None:
        existing.setdefault("end", {})["dateTime"] = end.isoformat()
    updated = (
        svc.events()
        .update(calendarId="primary", eventId=external_id, body=existing)
        .execute()
    )
    return _normalize(updated)


def delete_event(token_payload: dict[str, Any], external_id: str) -> None:
    """Delete an event from the user's primary calendar."""
    svc = _service(token_payload)
    svc.events().delete(calendarId="primary", eventId=external_id).execute()


def _normalize(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "external_id": item["id"],
        "title": item.get("summary"),
        "start_time": _parse_when(item.get("start", {})),
        "end_time": _parse_when(item.get("end", {})),
        "location": item.get("location"),
        "description": item.get("description"),
        "attendees": [a["email"] for a in item.get("attendees", []) or [] if a.get("email")],
        "html_link": item.get("htmlLink"),
        "status": item.get("status", "confirmed"),
    }


def _parse_when(when: dict[str, Any]) -> datetime | None:
    """Parse a Google event start/end. 'dateTime' is RFC3339; 'date' is all-day."""
    if "dateTime" in when:
        return datetime.fromisoformat(when["dateTime"])
    if "date" in when:
        return datetime.fromisoformat(when["date"]).replace(tzinfo=UTC)
    return None
