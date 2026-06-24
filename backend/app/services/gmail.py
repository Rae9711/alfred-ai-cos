"""Gmail API wrapper: list recent messages, fetch one, create a draft, and send.

Sending (gmail.send scope) is a level-3 action: it only runs through an approved
ActionProposal via the SendEmail capability, never directly from a route."""

from __future__ import annotations

import base64
import re
from datetime import datetime
from email.message import EmailMessage
from html import unescape
from typing import Any, Literal, cast

from googleapiclient.discovery import build

from app.services.google_oauth import credentials_from_payload


def _service(token_payload: dict[str, Any]) -> Any:
    """Return a Gmail API client. googleapiclient is untyped, hence Any."""
    creds = credentials_from_payload(token_payload)
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


InboxTab = Literal["all", "primary"]

_PRIMARY_LABEL = "CATEGORY_PERSONAL"
_NON_PRIMARY_TABS = frozenset(
    {"CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"}
)


class HistoryExpiredError(Exception):
    """Gmail no longer has history before startHistoryId; caller should fall back."""


def get_history_id(token_payload: dict[str, Any]) -> str:
    """Return the mailbox's current historyId (cursor for incremental sync)."""
    svc = _service(token_payload)
    profile = svc.users().getProfile(userId="me").execute()
    history_id = profile.get("historyId")
    if not history_id:
        raise ValueError("Gmail profile did not return historyId")
    return str(history_id)


def get_message_label_ids(token_payload: dict[str, Any], message_id: str) -> list[str]:
    """Return label ids for a message without fetching the full body."""
    svc = _service(token_payload)
    raw = svc.users().messages().get(userId="me", id=message_id, format="minimal").execute()
    return list(raw.get("labelIds") or [])


def is_primary_inbox(labels: list[str] | None) -> bool:
    if not labels:
        return False
    return "INBOX" in labels and _PRIMARY_LABEL in labels


def is_non_primary_tab(labels: list[str] | None) -> bool:
    if not labels:
        return False
    return bool(_NON_PRIMARY_TABS.intersection(labels))


def list_history_added_message_ids(
    token_payload: dict[str, Any],
    start_history_id: str,
    *,
    label_id: str = "INBOX",
) -> tuple[list[str], str]:
    """Return message ids added since start_history_id and the latest historyId.

    Raises HistoryExpiredError when Gmail has dropped the start cursor (404).
    """
    svc = _service(token_payload)
    seen: list[str] = []
    page_token: str | None = None
    latest_history_id = start_history_id
    while True:
        try:
            resp = (
                svc.users()
                .history()
                .list(
                    userId="me",
                    startHistoryId=start_history_id,
                    labelId=label_id,
                    historyTypes=["messageAdded"],
                    pageToken=page_token,
                )
                .execute()
            )
        except Exception as exc:
            # googleapiclient raises HttpError with status 404 when the cursor expired.
            if getattr(exc, "resp", None) is not None and exc.resp.status == 404:
                raise HistoryExpiredError(str(exc)) from exc
            raise
        latest_history_id = str(resp.get("historyId") or latest_history_id)
        for record in resp.get("history") or []:
            for added in record.get("messagesAdded") or []:
                msg = added.get("message") or {}
                mid = msg.get("id")
                if mid and mid not in seen:
                    seen.append(mid)
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return seen, latest_history_id


def list_message_ids(
    token_payload: dict[str, Any],
    *,
    label_ids: list[str],
    max_results: int = 50,
    query: str | None = None,
) -> list[str]:
    """Return message ids matching label ids (and optional query), newest first."""
    svc = _service(token_payload)
    ids: list[str] = []
    page_token: str | None = None
    while len(ids) < max_results:
        batch = min(max_results - len(ids), 100)
        kwargs: dict[str, Any] = {
            "userId": "me",
            "labelIds": label_ids,
            "maxResults": batch,
        }
        if query:
            kwargs["q"] = query
        if page_token:
            kwargs["pageToken"] = page_token
        resp = svc.users().messages().list(**kwargs).execute()
        for item in resp.get("messages", []) or []:
            mid = item.get("id")
            if mid and mid not in ids:
                ids.append(mid)
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return ids


def list_unread_primary_message_ids(
    token_payload: dict[str, Any], *, max_results: int = 200
) -> list[str]:
    """All unread Primary-tab inbox messages, newest first."""
    return list_message_ids(
        token_payload,
        label_ids=["INBOX", "CATEGORY_PERSONAL", "UNREAD"],
        max_results=max_results,
    )


def modify_message_labels(
    token_payload: dict[str, Any],
    message_id: str,
    *,
    add: list[str] | None = None,
    remove: list[str] | None = None,
) -> list[str]:
    """Add/remove Gmail labels on one message; returns the updated label ids."""
    svc = _service(token_payload)
    body: dict[str, Any] = {}
    if add:
        body["addLabelIds"] = add
    if remove:
        body["removeLabelIds"] = remove
    if not body:
        return get_message_label_ids(token_payload, message_id)
    raw = svc.users().messages().modify(userId="me", id=message_id, body=body).execute()
    return list(raw.get("labelIds") or [])


def list_history_label_affected_message_ids(
    token_payload: dict[str, Any],
    start_history_id: str,
) -> tuple[set[str], str]:
    """Message ids whose labels changed since start_history_id."""
    svc = _service(token_payload)
    affected: set[str] = set()
    page_token: str | None = None
    latest_history_id = start_history_id
    while True:
        try:
            resp = (
                svc.users()
                .history()
                .list(
                    userId="me",
                    startHistoryId=start_history_id,
                    labelId="INBOX",
                    historyTypes=["labelAdded", "labelRemoved"],
                    pageToken=page_token,
                )
                .execute()
            )
        except Exception as exc:
            if getattr(exc, "resp", None) is not None and exc.resp.status == 404:
                raise HistoryExpiredError(str(exc)) from exc
            raise
        latest_history_id = str(resp.get("historyId") or latest_history_id)
        for record in resp.get("history") or []:
            for key in ("labelsAdded", "labelsRemoved"):
                for entry in record.get(key) or []:
                    msg = entry.get("message") or {}
                    mid = msg.get("id")
                    if mid:
                        affected.add(mid)
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return affected, latest_history_id


def list_recent_message_ids(
    token_payload: dict[str, Any],
    *,
    max_results: int = 25,
    inbox_tab: InboxTab = "all",
    after: datetime | None = None,
) -> list[str]:
    """Return ids of recent inbox messages, newest first.

    inbox_tab='primary' limits to Gmail's Primary category (excludes Promotions,
    Social, Updates, Forums tabs). Optional `after` limits to mail on/after that
    calendar day (user-local midnight passed as UTC datetime).
    """
    label_ids = ["INBOX"]
    if inbox_tab == "primary":
        label_ids.append("CATEGORY_PERSONAL")
    query_parts: list[str] = []
    if after is not None:
        query_parts.append(f"after:{after.strftime('%Y/%m/%d')}")
    query = " ".join(query_parts) if query_parts else None
    return list_message_ids(
        token_payload,
        label_ids=label_ids,
        max_results=max_results,
        query=query,
    )


def get_message(token_payload: dict[str, Any], message_id: str) -> dict[str, Any]:
    """Fetch a normalized message: id, threadId, sender, recipients, subject, snippet,
    body, plus a small dict of spam-relevant headers (list-unsubscribe, precedence,
    auto-submitted, reply-to, cc, bcc, x-mailer, feedback-id) that the ranker uses
    to deterministically classify automated / bulk / suspicious senders."""
    svc = _service(token_payload)
    raw = svc.users().messages().get(userId="me", id=message_id, format="full").execute()
    headers = {h["name"].lower(): h["value"] for h in raw.get("payload", {}).get("headers", [])}
    # Preserve the subset of headers the sender classifier reads. Keeping this small
    # so the JSON column stays cheap and the spam signals are auditable per message.
    _PRESERVED = (
        "list-unsubscribe",
        "list-unsubscribe-post",
        "precedence",
        "auto-submitted",
        "reply-to",
        "cc",
        "bcc",
        "x-auto-response-suppress",
        "feedback-id",
        "x-mailer",
        "x-campaign",
        "x-campaign-id",
        "x-mailchimp-id",
        "x-mc-user",
        "x-sg-eid",
        "x-sendgrid-id",
        "return-path",
        "x-original-sender",
    )
    preserved = {k: headers[k] for k in _PRESERVED if k in headers}
    return {
        "external_id": raw["id"],
        "thread_id": raw.get("threadId"),
        "sender": headers.get("from", ""),
        "recipients": [r.strip() for r in headers.get("to", "").split(",") if r.strip()],
        "subject": headers.get("subject"),
        "snippet": raw.get("snippet"),
        "body": _extract_body(raw.get("payload", {})),
        "internal_date_ms": raw.get("internalDate"),
        "headers": preserved,
    }


def _html_to_text(html: str) -> str:
    """Best-effort HTML → plain text for reply drafting."""
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p>", "\n\n", text)
    text = re.sub(r"(?i)</div>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _decode_part_body(payload: dict[str, Any]) -> str:
    data = payload.get("body", {}).get("data")
    if not data:
        return ""
    return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")


def _collect_body_parts(
    payload: dict[str, Any], *, mime_type: str, found: list[str]
) -> None:
    if payload.get("mimeType") == mime_type:
        body = _decode_part_body(payload)
        if body.strip():
            found.append(body)
    for part in payload.get("parts", []) or []:
        _collect_body_parts(part, mime_type=mime_type, found=found)


def _extract_body(payload: dict[str, Any]) -> str:
    """Walk the MIME tree: prefer text/plain, fall back to text/html."""
    plain_parts: list[str] = []
    html_parts: list[str] = []
    _collect_body_parts(payload, mime_type="text/plain", found=plain_parts)
    _collect_body_parts(payload, mime_type="text/html", found=html_parts)
    if plain_parts:
        return plain_parts[0].strip()
    if html_parts:
        return _html_to_text(html_parts[0])
    return ""


def create_draft(
    token_payload: dict[str, Any],
    *,
    to: str,
    subject: str,
    body: str,
    thread_id: str | None = None,
) -> str:
    """Create a Gmail draft and return its draft id. Does not send."""
    svc = _service(token_payload)
    msg = EmailMessage()
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    encoded = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    draft_body: dict[str, Any] = {"message": {"raw": encoded}}
    if thread_id:
        draft_body["message"]["threadId"] = thread_id
    created = svc.users().drafts().create(userId="me", body=draft_body).execute()
    return cast(str, created["id"])


def send_draft(token_payload: dict[str, Any], draft_id: str) -> dict[str, Any]:
    """Send an existing Gmail draft. Returns the sent message {id, threadId}."""
    svc = _service(token_payload)
    sent = svc.users().drafts().send(userId="me", body={"id": draft_id}).execute()
    return {"id": sent.get("id"), "thread_id": sent.get("threadId")}


def send_message(
    token_payload: dict[str, Any],
    *,
    to: str,
    subject: str,
    body: str,
    thread_id: str | None = None,
) -> dict[str, Any]:
    """Compose and send an email directly (no stored draft). Returns {id, threadId}."""
    svc = _service(token_payload)
    msg = EmailMessage()
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    encoded = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    send_body: dict[str, Any] = {"raw": encoded}
    if thread_id:
        send_body["threadId"] = thread_id
    sent = svc.users().messages().send(userId="me", body=send_body).execute()
    return {"id": sent.get("id"), "thread_id": sent.get("threadId")}
