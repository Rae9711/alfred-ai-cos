#!/usr/bin/env python3
"""Compare Gmail inbox vs local DB for sync debugging."""

from __future__ import annotations

import sys
from datetime import UTC, datetime

from sqlalchemy import select

from app.db.base import SessionLocal
from app.db.models import ConnectedAccount, Message
from app.services import gmail
from app.services.crypto import decrypt_token


def main() -> int:
    db = SessionLocal()
    try:
        accounts = list(db.scalars(select(ConnectedAccount)))
        for account in accounts:
            email = account.provider_account_email or account.id
            print(f"\n=== {email} (status={account.sync_status.value}) ===")
            if account.sync_error:
                print(f"  sync_error: {account.sync_error[:200]}")
            token = decrypt_token(account.token_ciphertext)
            try:
                recent = gmail.list_recent_message_ids(
                    token, max_results=8, inbox_tab="primary"
                )
                unread = gmail.list_unread_inbox_message_ids(token, max_results=8)
                print(f"  Gmail recent primary: {len(recent)} ids")
                print(f"  Gmail unread inbox: {len(unread)} ids")
                for mid in recent[:5]:
                    labels = gmail.get_message_label_ids(token, mid)
                    raw = gmail.get_message(token, mid)
                    sent = ""
                    if raw.get("internal_date_ms"):
                        sent = datetime.fromtimestamp(
                            int(raw["internal_date_ms"]) / 1000, tz=UTC
                        ).isoformat()
                    in_db = db.scalar(
                        select(Message.id).where(
                            Message.connected_account_id == account.id,
                            Message.external_id == mid,
                        )
                    )
                    print(
                        f"    {mid} in_db={bool(in_db)} labels={labels[:4]} "
                        f"sent={sent[:19]} subj={(raw.get('subject') or '')[:50]}"
                    )
            except Exception as exc:
                print(f"  Gmail API error: {exc}")
            total = len(
                list(
                    db.scalars(
                        select(Message).where(
                            Message.connected_account_id == account.id
                        )
                    )
                )
            )
            print(f"  DB messages: {total}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
