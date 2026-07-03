#!/usr/bin/env python3
"""Normalize JSON-wrapped SMS bodies already stored in the database."""

from __future__ import annotations

import argparse

from sqlalchemy import select

from app.db.base import SessionLocal
from app.db.models import Message
from app.services.sms_body import normalize_sms_body_text


def backfill_sms_bodies(*, dry_run: bool = True, limit: int | None = None) -> int:
    updated = 0
    with SessionLocal() as db:
        q = select(Message).where(Message.source == "sms").order_by(Message.sent_at.desc())
        if limit:
            q = q.limit(limit)
        for msg in db.scalars(q):
            headers = dict(msg.headers or {})
            raw_body = str(headers.get("sms_body") or msg.snippet or "")
            clean = normalize_sms_body_text(raw_body)
            if not clean or clean == raw_body:
                continue
            if dry_run:
                print(f"would fix {msg.id}: {raw_body[:60]!r} -> {clean[:60]!r}")
            else:
                headers["sms_body"] = clean
                msg.headers = headers
                msg.snippet = clean[:200]
            updated += 1
        if not dry_run:
            db.commit()
    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write changes (default is dry-run)")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    count = backfill_sms_bodies(dry_run=not args.apply, limit=args.limit)
    mode = "updated" if args.apply else "would update"
    print(f"{mode} {count} SMS message(s)")


if __name__ == "__main__":
    main()
