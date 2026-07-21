"""Inbound WhatsApp (Meta Business Cloud API) → shared Message pipeline.

Meta delivers messages by POSTing a webhook to /inbox/whatsapp, signed with the app
secret in the X-Hub-Signature-256 header (HMAC-SHA256 over the raw body). A one-time GET
handshake echoes a challenge when the verify_token matches. Both are verified here; the
parsed messages then flow through the same channel_ingest path as SMS and forwarded email.

Only the official Cloud API is supported — unofficial automation violates Meta's terms
and gets numbers banned (see the WhatsApp send capability)."""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import User
from app.services import channel_ingest


@dataclass
class InboundWhatsApp:
    """One inbound WhatsApp text, flattened from Meta's nested webhook shape."""

    business_phone_number_id: str
    from_number: str
    from_name: str | None
    external_id: str
    body: str
    received_at: datetime | None


def verify_signature(*, app_secret: str, raw_body: bytes, signature_header: str | None) -> bool:
    """Constant-time check of Meta's X-Hub-Signature-256 (``sha256=<hexdigest>``)."""
    if not app_secret or not signature_header:
        return False
    prefix = "sha256="
    if not signature_header.startswith(prefix):
        return False
    expected = hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header[len(prefix) :])


def verify_challenge(
    *, verify_token: str, mode: str | None, token: str | None, challenge: str | None
) -> str | None:
    """Return the challenge to echo when Meta's subscription handshake matches."""
    if mode == "subscribe" and token and verify_token and hmac.compare_digest(token, verify_token):
        return challenge
    return None


def parse_inbound(payload: dict[str, Any]) -> list[InboundWhatsApp]:
    """Flatten Meta's entry→changes→value→messages tree into text messages.

    Non-text messages (status callbacks, media, reactions) are skipped — they carry no
    body to extract from."""
    out: list[InboundWhatsApp] = []
    for entry in payload.get("entry", []) or []:
        for change in entry.get("changes", []) or []:
            value = change.get("value") or {}
            metadata = value.get("metadata") or {}
            phone_number_id = str(metadata.get("phone_number_id") or "")
            names = {
                str(c.get("wa_id")): (c.get("profile") or {}).get("name")
                for c in value.get("contacts", []) or []
            }
            for msg in value.get("messages", []) or []:
                if msg.get("type") != "text":
                    continue
                body = ((msg.get("text") or {}).get("body") or "").strip()
                if not body:
                    continue
                sender = str(msg.get("from") or "")
                out.append(
                    InboundWhatsApp(
                        business_phone_number_id=phone_number_id,
                        from_number=sender,
                        from_name=names.get(sender),
                        external_id=f"wa:{msg.get('id')}",
                        body=body,
                        received_at=_parse_timestamp(msg.get("timestamp")),
                    )
                )
    return out


def _parse_timestamp(raw: Any) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(raw), tz=UTC)
    except (TypeError, ValueError):
        return None


def find_whatsapp_user(db: Session, business_phone_number_id: str) -> User | None:
    """Resolve which Albert user owns a WhatsApp business number.

    Preferred routing is an explicit per-user ``preferences['whatsapp_phone_number_id']``.
    Deployments are single-business-number (the Cloud API config is global), so when no
    user has claimed the number and there is exactly one account, it's the owner."""
    users = list(db.scalars(select(User).order_by(User.created_at)))
    for user in users:
        if user.preferences.get("whatsapp_phone_number_id") == business_phone_number_id:
            return user
    if len(users) == 1:
        return users[0]
    return None


def _display_sender(*, number: str, name: str | None) -> str:
    return f"{name} <{number}>" if name else number


def ingest_inbound(db: Session, *, user: User, inbound: InboundWhatsApp) -> str:
    """Persist one inbound WhatsApp message; returns the Message id."""
    result = channel_ingest.ingest_channel_message(
        db,
        user=user,
        source="whatsapp",
        external_id=inbound.external_id,
        sender=_display_sender(number=inbound.from_number, name=inbound.from_name),
        body=inbound.body,
        thread_id=inbound.from_number,
        received_at=inbound.received_at,
        headers={"whatsapp_from": inbound.from_number},
    )
    return result.message_id
