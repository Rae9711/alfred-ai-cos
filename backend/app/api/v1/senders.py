"""Sender overrides — the escape hatch for the spam shield.

The deterministic classifier in `sender_class` is conservative: when in doubt,
it demotes. Real life will always produce edge cases (a vendor's marketing
domain that happens to send the user a real contract; a personal newsletter
the user actually wants pinged about). These endpoints let the user pin
those overrides.

Storage lives in `user.preferences.sender_overrides`:

    {"vip": ["board@brand.co", "buyer.co"], "muted": ["news@x.io", "alerts.io"]}

Each entry can be either an exact email address or a bare domain (matches
every address at that domain, including subdomains).

After updating the overrides we also REBUILD `sender_classification` on
every existing Message from the affected senders so live commitments reflect
the new policy without a re-ingest."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import Message, User
from app.services import sender_class

router = APIRouter(prefix="/senders", tags=["senders"])

Bucket = Literal["vip", "muted"]


class SenderOverrideRequest(BaseModel):
    address: str  # email or domain (case-insensitive)
    bucket: Bucket


class SenderOverridesOut(BaseModel):
    vip: list[str]
    muted: list[str]


def _current(user: User) -> SenderOverridesOut:
    raw = (user.preferences or {}).get("sender_overrides") or {}
    return SenderOverridesOut(
        vip=sorted({str(s).lower() for s in (raw.get("vip") or []) if s}),
        muted=sorted({str(s).lower() for s in (raw.get("muted") or []) if s}),
    )


def _rebuild_classifications(db: Session, user: User, address: str) -> int:
    """Reclassify any existing Message rows whose sender matches `address`.
    Keeps the dashboard's ranking and the user's override in lockstep without
    a full re-ingest."""
    pattern = f"%{address.lower()}%"
    msgs = list(
        db.scalars(
            select(Message).where(
                Message.user_id == user.id,
                Message.sender.ilike(pattern),
            )
        )
    )
    for m in msgs:
        m.sender_classification = sender_class.classify(
            sender=m.sender or "",
            subject=m.subject,
            snippet=m.snippet,
            headers=m.headers,
            user=user,
        ).cls
    return len(msgs)


@router.get("/overrides", response_model=SenderOverridesOut)
def list_overrides(
    user: User = Depends(get_current_user),
) -> SenderOverridesOut:
    return _current(user)


@router.post("/overrides", response_model=SenderOverridesOut)
def add_override(
    payload: SenderOverrideRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SenderOverridesOut:
    """Add or move an address into the vip or muted bucket. The two buckets
    are mutually exclusive — adding the same address to one removes it from
    the other (the user can't simultaneously VIP and mute someone)."""
    addr = payload.address.strip().lower()
    if not addr:
        return _current(user)

    prefs = dict(user.preferences or {})
    overrides = dict(prefs.get("sender_overrides") or {})
    vip = list(overrides.get("vip") or [])
    muted = list(overrides.get("muted") or [])

    # Remove from the opposite bucket; add to the target.
    if payload.bucket == "vip":
        muted = [a for a in muted if a.lower() != addr]
        if addr not in {a.lower() for a in vip}:
            vip.append(addr)
    else:
        vip = [a for a in vip if a.lower() != addr]
        if addr not in {a.lower() for a in muted}:
            muted.append(addr)

    overrides["vip"] = sorted(set(vip))
    overrides["muted"] = sorted(set(muted))
    prefs["sender_overrides"] = overrides
    user.preferences = prefs
    db.commit()

    _rebuild_classifications(db, user, addr)
    db.commit()
    return _current(user)


@router.delete("/overrides/{address:path}", response_model=SenderOverridesOut)
def remove_override(
    address: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SenderOverridesOut:
    """Remove any override (vip or muted) for the given address. After removal
    the classifier falls back to the deterministic rules."""
    addr = address.strip().lower()
    if not addr:
        return _current(user)
    prefs = dict(user.preferences or {})
    overrides = dict(prefs.get("sender_overrides") or {})
    overrides["vip"] = [a for a in (overrides.get("vip") or []) if a.lower() != addr]
    overrides["muted"] = [a for a in (overrides.get("muted") or []) if a.lower() != addr]
    prefs["sender_overrides"] = overrides
    user.preferences = prefs
    db.commit()
    _rebuild_classifications(db, user, addr)
    db.commit()
    return _current(user)
