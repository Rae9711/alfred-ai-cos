"""End-to-end reply test against a real connected Gmail account.

Runs sync → pick a Needs Reply message → draft with LLM → optionally send.

Setup:
    cd backend && uv run alembic upgrade head

Dry run (draft only, no send):
    uv run python scripts/test_reply_flow.py --desktop-oauth

Send for real (approval-gated, same path as the app):
    uv run python scripts/test_reply_flow.py --account you@gmail.com --send

Use --message-index N to pick from the Needs Reply list (default: first).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

from sqlalchemy import select  # noqa: E402

from app.db.base import SessionLocal  # noqa: E402
from app.db.enums import ActionStatus, ActionType, MessageClassification, Provider  # noqa: E402
from app.db.models import ConnectedAccount, DraftReply, Message, User  # noqa: E402
from app.llm import get_llm  # noqa: E402
from app.services import execution, extraction, ingestion  # noqa: E402
from app.services.actions import propose_action_internal  # noqa: E402

# Reuse OAuth helpers from the classification QA script.
from scripts.classify_inbox_sample import (  # noqa: E402
    _connect_google,
    _google_accounts,
    _print_accounts,
)


def _needs_reply_messages(db, user_id: str) -> list[Message]:
    return list(
        db.scalars(
            select(Message)
            .where(
                Message.user_id == user_id,
                Message.classification.in_(
                    [
                        MessageClassification.needs_reply,
                        MessageClassification.follow_up_needed,
                    ]
                ),
            )
            .order_by(Message.sent_at.desc().nullslast())
        )
    )


def _run_sync(db, user: User) -> None:
    result = ingestion.sync_messages(db, user.id)
    to_process = ingestion.messages_to_process(db, user.id, result.new_messages)
    print(
        f"Sync: initial_backfill={result.initial_backfill}, "
        f"ingested={len(result.new_messages)}, processed={len(to_process)}"
    )
    for message in to_process:
        extraction.process_message(db, message)


def main() -> None:
    parser = argparse.ArgumentParser(description="Test Albert reply draft + send flow")
    parser.add_argument("--desktop-oauth", action="store_true", help="Connect via Desktop OAuth")
    parser.add_argument("--account", help="Email of connected account to use")
    parser.add_argument("--message-index", type=int, default=0, help="Pick from Needs Reply list")
    parser.add_argument("--instruction", default="Reply briefly and politely.")
    parser.add_argument("--tone", default="professional")
    parser.add_argument("--send", action="store_true", help="Actually send after drafting")
    parser.add_argument("--dry-run-body", help="Override draft body (skip LLM)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.desktop_oauth:
            user = _connect_google(db, desktop=True)
        else:
            pairs = _google_accounts(db)
            if not pairs:
                raise SystemExit("No connected account. Run with --desktop-oauth first.")
            _print_accounts(pairs)
            if args.account:
                match = [p for p in pairs if p[0].email.lower() == args.account.lower()]
                if not match:
                    raise SystemExit(f"Account not found: {args.account}")
                user = match[0][0]
            else:
                user = pairs[0][0]
            print(f"Using {user.email}\n")

        account = db.scalar(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == user.id,
                ConnectedAccount.provider == Provider.google,
            )
        )
        if account is None:
            raise SystemExit("No ConnectedAccount for user.")

        print("=== Step 1: Sync ===")
        _run_sync(db, user)

        print("\n=== Step 2: Pick message ===")
        candidates = _needs_reply_messages(db, user.id)
        if not candidates:
            raise SystemExit("No Needs Reply messages after sync. Try another account or send yourself a test email.")
        if args.message_index < 0 or args.message_index >= len(candidates):
            raise SystemExit(f"--message-index must be 0..{len(candidates) - 1}")

        for i, m in enumerate(candidates[:10]):
            print(f"  [{i}] {m.subject or '(no subject)'} — {m.sender}")
        message = candidates[args.message_index]
        print(f"\nSelected: {message.subject}\nFrom: {message.sender}")
        print(f"Take: {message.body_summary or '(none)'}")

        print("\n=== Step 3: Draft reply ===")
        if args.dry_run_body:
            body = args.dry_run_body
            subject = f"Re: {message.subject or ''}".strip()
        else:
            context = (
                f"Subject: {message.subject or '(none)'}\n"
                f"From: {message.sender}\n\n{message.snippet or ''}"
            )
            drafted = get_llm().draft_reply(
                thread_context=context,
                instruction=args.instruction,
                tone=args.tone,
                user_name=user.name,
            )
            body = drafted.body
            subject = drafted.subject or f"Re: {message.subject or ''}".strip()

        draft = DraftReply(
            user_id=user.id,
            message_id=message.id,
            subject=subject,
            body=body,
            tone=args.tone,
        )
        db.add(draft)
        db.commit()
        print(f"Subject: {subject}")
        print(f"Body:\n{body}\n")
        print(f"Draft id: {draft.id}")

        if not args.send:
            print("Dry run complete. Re-run with --send to send via Gmail (level-3 approval path).")
            return

        print("=== Step 4: Propose + approve send ===")
        proposal = propose_action_internal(
            db,
            user,
            action_type=ActionType.send_email,
            target={"draft_reply_id": draft.id},
            proposed_content=body,
            reason="Send this reply from your Gmail account.",
        )
        proposal.status = ActionStatus.approved
        db.commit()

        result = execution.execute_proposal(db, user, proposal)
        print(f"Sent: {result.detail}")
        if result.data:
            print(f"Gmail message id: {result.data.get('gmail_message_id')}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
