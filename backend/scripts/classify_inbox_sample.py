"""Pull recent Gmail messages, run Albert's classification pipeline, and print a
review report. Intended for local QA before wiring the mobile inbox.

Setup (once):
    cd backend
    cp ../.env.example .env
    # Fill GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ANTHROPIC_API_KEY in .env
    # Must match an Authorized redirect URI on your Google OAuth client exactly.
    # Default in .env.example: http://localhost:8000/api/v1/auth/google/callback
    uv run alembic upgrade head

Run:
    uv run python scripts/classify_inbox_sample.py --max-results 20 --desktop-oauth

Multiple mailboxes (each Gmail = separate local user; data isolated per account):
    --list-accounts              # show connected
    --add-account                # connect another Gmail (keep existing)
    --account user@gmail.com     # test one mailbox
    --all-accounts               # test every connected mailbox
    --reconnect --account ...    # replace one account's token

First run opens a browser for Google consent and stores the token locally.
Use --reclassify to re-run the LLM on messages already in the database.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import webbrowser
from datetime import UTC, date, datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Match app/services/google_oauth.py — avoids scope-mismatch errors on token exchange.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

from google_auth_oauthlib.flow import Flow, InstalledAppFlow  # noqa: E402
from anthropic import APIStatusError  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.llm import get_llm  # noqa: E402
from app.db.base import SessionLocal  # noqa: E402
from app.db.enums import Provider, SyncStatus  # noqa: E402
from app.db.models import Commitment, ConnectedAccount, Message, User  # noqa: E402
from app.services import extraction, gmail, google_oauth, priority, sender_class  # noqa: E402
from app.services.gmail import InboxTab  # noqa: E402
from app.services.crypto import decrypt_token, encrypt_token  # noqa: E402

# Inbox UI bucket mapping (mirrors app/api/v1/messages.py).
_UI_CATEGORY = {
    "needs_reply": "Needs Reply",
    "follow_up_needed": "Needs Reply",
    "needs_decision": "Needs Decision",
    "meeting_scheduling": "Needs Decision",
    "deadline": "Needs Decision",
    "waiting_for_response": "Waiting",
    "informational": "FYI",
    "low_priority": "FYI",
    "sensitive": "FYI",
    "spam_noise": "(filtered)",
}

_EXTRACTION_BLOCKED = {"automated", "bulk", "suspicious", "muted"}


def _oauth_redirect() -> str:
    redirect = get_settings().google_oauth_redirect_uri.strip()
    if not redirect:
        raise SystemExit("Set GOOGLE_OAUTH_REDIRECT_URI in backend/.env")
    return redirect


def _google_settings() -> tuple[str, str, list[str]]:
    settings = get_settings()
    if not settings.google_client_id or not settings.google_client_secret:
        raise SystemExit(
            "Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in backend/.env"
        )
    return settings.google_client_id, settings.google_client_secret, settings.google_scopes


def _client_config_web(redirect_uri: str) -> dict:
    client_id, client_secret, _ = _google_settings()
    return {
        "web": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [redirect_uri],
        }
    }


def _client_config_desktop() -> dict:
    client_id, client_secret, _ = _google_settings()
    return {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }


def _credentials_from_flow(*, desktop: bool):
    """Run Google OAuth in the browser and return credentials."""
    _, _, scopes = _google_settings()

    if desktop:
        client_id, _, _ = _google_settings()
        print("\nDesktop OAuth (no redirect URI registration needed).")
        print(f"Use a **Desktop** OAuth client in Console. Client ID ends with: ...{client_id[-20:]}")
        flow = InstalledAppFlow.from_client_config(_client_config_desktop(), scopes=scopes)
        print("Opening browser…\n")
        try:
            return flow.run_local_server(port=0, open_browser=True)
        except Exception as exc:
            if "invalid_client" in str(exc).lower():
                raise SystemExit(
                    "Google rejected the client secret (invalid_client).\n"
                    "In Console → Credentials → your **Desktop** client, reset the secret\n"
                    "and paste the NEW Client ID + Client secret together into backend/.env."
                ) from exc
            raise

    redirect_uri = _oauth_redirect()
    parsed = urlparse(redirect_uri)
    if parsed.scheme not in ("http", "https") or parsed.hostname not in ("localhost", "127.0.0.1"):
        raise SystemExit(
            "GOOGLE_OAUTH_REDIRECT_URI must be http://localhost:... for Web OAuth.\n"
            f"Got: {redirect_uri}\n"
            "Tip: use --desktop-oauth instead."
        )
    port = parsed.port or 80
    callback_path = parsed.path or "/"

    flow = Flow.from_client_config(
        _client_config_web(redirect_uri),
        scopes=scopes,
        autogenerate_code_verifier=False,
    )
    flow.redirect_uri = redirect_uri
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    client_id, _, _ = _google_settings()
    print(f"\nWeb OAuth — redirect must match Console **exactly**:\n  {redirect_uri}")
    print(f"Client ID ends with: ...{client_id[-20:]}")
    print("Add it under that **Web application** client (not iOS/Android).\n")
    print(f"If the browser does not open, visit:\n{auth_url}\n")
    webbrowser.open(auth_url)

    class _CallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            path_only = urlparse(self.path).path
            if path_only != callback_path:
                self.send_response(404)
                self.end_headers()
                return
            query = parse_qs(urlparse(self.path).query)
            code = query.get("code", [None])[0]
            if code:
                self.server.auth_code = code  # type: ignore[attr-defined]
                body = b"<html><body><h2>Connected. You can close this tab.</h2></body></html>"
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_response(400)
                self.end_headers()

        def log_message(self, _format: str, *_args) -> None:
            return

    bind_host = "localhost"
    httpd = HTTPServer((bind_host, port), _CallbackHandler)  # type: ignore[arg-type]
    httpd.auth_code = None  # type: ignore[attr-defined]
    print(f"Waiting for Google redirect on {redirect_uri} …")
    while httpd.auth_code is None:  # type: ignore[attr-defined]
        httpd.handle_request()
    flow.fetch_token(code=httpd.auth_code)  # type: ignore[attr-defined]
    return flow.credentials


def _connect_google(db, *, desktop: bool) -> User:
    """OAuth via local browser; upsert User + ConnectedAccount."""
    creds = _credentials_from_flow(desktop=desktop)
    import httpx

    resp = httpx.get(
        "https://openidconnect.googleapis.com/v1/userinfo",
        headers={"Authorization": f"Bearer {creds.token}"},
        timeout=10,
    )
    email = resp.json().get("email") if resp.status_code == 200 else None
    if not email:
        raise SystemExit("Google did not return an account email.")

    payload = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes or []),
        "expiry": creds.expiry.isoformat() if creds.expiry else None,
        "email": email,
    }

    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email)
        db.add(user)
        db.flush()

    account = db.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.user_id == user.id,
            ConnectedAccount.provider == Provider.google,
        )
    )
    ciphertext = encrypt_token(payload)
    if account is None:
        account = ConnectedAccount(
            user_id=user.id,
            provider=Provider.google,
            provider_account_email=email,
            scopes=payload.get("scopes", []),
            token_ciphertext=ciphertext,
            sync_status=SyncStatus.never,
        )
        db.add(account)
    else:
        account.token_ciphertext = ciphertext
        account.scopes = payload.get("scopes", [])
    db.commit()
    print(f"Connected as {email}\n")
    return user


def _google_accounts(db) -> list[tuple[User, ConnectedAccount]]:
    accounts = list(
        db.scalars(
            select(ConnectedAccount).where(ConnectedAccount.provider == Provider.google)
        )
    )
    pairs: list[tuple[User, ConnectedAccount]] = []
    for account in accounts:
        user = db.get(User, account.user_id)
        if user is not None:
            pairs.append((user, account))
    return sorted(pairs, key=lambda pair: (pair[0].email or "").lower())


def _print_accounts(pairs: list[tuple[User, ConnectedAccount]]) -> None:
    if not pairs:
        print("No Gmail accounts connected locally.")
        return
    print("Connected Gmail accounts:")
    for user, account in pairs:
        synced = account.last_synced_at.isoformat() if account.last_synced_at else "never"
        print(f"  • {user.email}  (last sync: {synced})")


def _disconnect_local(db, *, email: str | None = None) -> None:
    """Drop a Google connection + that user's local data."""
    pairs = _google_accounts(db)
    if email is not None:
        pairs = [(u, a) for u, a in pairs if u.email and u.email.lower() == email.lower()]
        if not pairs:
            raise SystemExit(f"No connected account for {email}")
    for user, account in pairs:
        try:
            google_oauth.revoke_token(decrypt_token(account.token_ciphertext))
        except Exception:
            pass
        db.delete(user)
        print(f"Disconnected {user.email} — local data cleared.")
    db.commit()
    if pairs:
        print()


def _report_path_for_email(base: Path, email: str) -> Path:
    slug = email.split("@", 1)[0].replace(".", "-")
    return base.parent / f"{base.stem}_{slug}{base.suffix}"


def _upsert_message(db, user: User, raw: dict) -> Message:
    message = db.scalar(
        select(Message).where(
            Message.user_id == user.id,
            Message.external_id == raw["external_id"],
        )
    )
    sent_at = None
    if raw.get("internal_date_ms"):
        sent_at = datetime.fromtimestamp(int(raw["internal_date_ms"]) / 1000, tz=UTC)

    cls = sender_class.classify(
        sender=raw["sender"],
        subject=raw["subject"],
        snippet=raw["snippet"],
        headers=raw.get("headers") or {},
        user=user,
    )

    if message is None:
        message = Message(
            user_id=user.id,
            source="gmail",
            external_id=raw["external_id"],
            thread_id=raw["thread_id"],
            sender=raw["sender"],
            recipients=raw["recipients"],
            subject=raw["subject"],
            snippet=raw["snippet"],
            sent_at=sent_at,
            headers=raw.get("headers") or {},
            sender_classification=cls.cls,
        )
        db.add(message)
        db.flush()
    else:
        message.thread_id = raw["thread_id"]
        message.sender = raw["sender"]
        message.recipients = raw["recipients"]
        message.subject = raw["subject"]
        message.snippet = raw["snippet"]
        message.sent_at = sent_at
        message.headers = raw.get("headers") or {}
        message.sender_classification = cls.cls
        db.flush()
    return message


def _enum_val(v) -> str | None:
    if v is None:
        return None
    return v.value if hasattr(v, "value") else str(v)


def _short(text: str | None, n: int = 72) -> str:
    if not text:
        return ""
    one = " ".join(text.split())
    return one if len(one) <= n else one[: n - 1] + "…"


def _call_with_retry(fn, *, label: str):
    """Retry Anthropic 429/529 with exponential backoff."""
    for attempt in range(1, 13):
        try:
            return fn()
        except APIStatusError as exc:
            if exc.status_code in (429, 529) and attempt < 12:
                wait = min(90, 2**attempt)
                print(f"    {label} busy ({exc.status_code}), retry {attempt}/12 in {wait}s…")
                time.sleep(wait)
                continue
            raise
    raise RuntimeError("unreachable")


def _classify_only(db, message: Message, body: str, *, user: User) -> None:
    """Classify via Haiku only — skips Sonnet commitment extraction."""
    result = _call_with_retry(
        lambda: get_llm().classify_message(
            subject=message.subject,
            body=body,
            sender=message.sender,
            user_email=user.email,
        ),
        label="Classify API",
    )
    message.classification = result.classification
    message.priority = result.priority
    message.action_required = result.action_required
    message.body_summary = result.reason
    db.commit()


def _process_with_retry(db, message: Message, body: str) -> list[Commitment]:
    """Full pipeline: classify (Haiku) + extract commitments (Sonnet)."""
    return _call_with_retry(
        lambda: extraction.process_message(db, message, body=body),
        label="Extract API",
    )


def _classify_inbox_for_user(
    db,
    user: User,
    account: ConnectedAccount,
    *,
    max_results: int,
    reclassify: bool,
    out_path: Path,
    delay: float,
    inbox_tab: InboxTab,
    classify_only: bool,
) -> None:
    token = decrypt_token(account.token_ciphertext)
    print(f"=== {user.email} ===\n")

    ids = gmail.list_recent_message_ids(
        token, max_results=max_results, inbox_tab=inbox_tab
    )
    tab_label = "Primary" if inbox_tab == "primary" else "all Inbox"
    print(f"Fetched {len(ids)} {tab_label} message id(s) from Gmail.")
    if delay > 0:
        mode = "classify-only (Haiku)" if classify_only else "classify + extract (Haiku + Sonnet)"
        print(f"Mode: {mode}. Pausing {delay}s between LLM calls.\n")
    else:
        print()

    rows: list[dict] = []
    for i, message_id in enumerate(ids, start=1):
        raw = gmail.get_message(token, message_id)
        message = _upsert_message(db, user, raw)
        body = raw.get("body") or ""

        llm_status = "classified"
        commitments: list[Commitment] = []
        if message.sender_classification in _EXTRACTION_BLOCKED:
            llm_status = f"skipped ({message.sender_classification})"
        elif reclassify or message.classification is None:
            print(f"[{i}/{len(ids)}] classifying: {_short(message.subject, 50)}")
            if classify_only:
                _classify_only(db, message, body, user=user)
                db.refresh(message)
                llm_status = "classified (haiku only)"
            else:
                commitments = _process_with_retry(db, message, body)
                db.refresh(message)
            if delay > 0:
                time.sleep(delay)
        else:
            llm_status = "cached"
            commitments = list(
                db.scalars(select(Commitment).where(Commitment.source_id == message.id))
            )

        classification = _enum_val(message.classification)
        ui_bucket = _UI_CATEGORY.get(classification or "", "FYI")
        if classification == "spam_noise":
            ui_bucket = "(filtered)"

        row = {
            "account_email": user.email,
            "index": i,
            "message_id": message.id,
            "gmail_id": message.external_id,
            "sent_at": message.sent_at.isoformat() if message.sent_at else "",
            "sender": message.sender,
            "subject": message.subject or "",
            "snippet": message.snippet or "",
            "sender_class": message.sender_classification or "",
            "llm_status": llm_status,
            "classification": classification or "",
            "ui_bucket": ui_bucket,
            "message_priority": _enum_val(message.priority) or "",
            "action_required": message.action_required,
            "take": message.body_summary or "",
            "commitment_count": len(commitments),
        }

        if commitments:
            ctx = priority.build_context(db, user)
            today = date.today()
            scored = [
                priority.score_commitment(c, today=today, context=ctx) for c in commitments
            ]
            best = max(scored, key=lambda s: s.score)
            row["top_commitment"] = _short(best.commitment.description, 120)
            row["top_score"] = round(best.score, 1)
            row["top_priority"] = _enum_val(best.priority) or ""
            row["top_score_reason"] = best.reason
        else:
            row["top_commitment"] = ""
            row["top_score"] = ""
            row["top_priority"] = ""
            row["top_score_reason"] = ""

        rows.append(row)
        db.commit()

    if not rows:
        print("No messages to report.\n")
        return

    by_bucket: dict[str, int] = {}
    by_class: dict[str, int] = {}
    for r in rows:
        by_bucket[r["ui_bucket"]] = by_bucket.get(r["ui_bucket"], 0) + 1
        key = r["classification"] or "(none)"
        by_class[key] = by_class.get(key, 0) + 1

    print("\n=== UI buckets ===")
    for k, v in sorted(by_bucket.items(), key=lambda x: -x[1]):
        print(f"  {k:20s} {v}")

    print("\n=== Raw LLM classifications ===")
    for k, v in sorted(by_class.items(), key=lambda x: -x[1]):
        print(f"  {k:20s} {v}")

    print("\n=== Messages (newest first) ===")
    for r in rows:
        flag = "!" if r["ui_bucket"] in ("Needs Reply", "Needs Decision") else " "
        score = f" score={r['top_score']}" if r["top_score"] != "" else ""
        print(
            f"{flag} [{r['ui_bucket']:14s}] {r['message_priority']:8s} "
            f"{_short(r['sender'], 28):28s} {_short(r['subject'], 40)}{score}"
        )
        if r["take"]:
            print(f"    take: {r['take']}")
        if r["sender_class"] in _EXTRACTION_BLOCKED:
            print(f"    (LLM skipped — sender_class={r['sender_class']})")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    json_path = out_path.with_suffix(".json")
    json_path.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {out_path}")
    print(f"Wrote {json_path}\n")


def run(
    max_results: int,
    *,
    reclassify: bool,
    out_path: Path,
    desktop_oauth: bool,
    delay: float,
    inbox_tab: InboxTab,
    classify_only: bool,
    reconnect: bool,
    add_account: bool,
    list_accounts: bool,
    all_accounts: bool,
    account_email: str | None,
) -> None:
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise SystemExit("Missing ANTHROPIC_API_KEY in backend/.env")

    db = SessionLocal()
    try:
        pairs = _google_accounts(db)
        if list_accounts:
            _print_accounts(pairs)
            return

        if reconnect:
            if account_email:
                _disconnect_local(db, email=account_email)
            elif len(pairs) == 1:
                _disconnect_local(db, email=pairs[0][0].email)
            else:
                _disconnect_local(db)
            pairs = []

        if add_account or reconnect or not pairs:
            _connect_google(db, desktop=desktop_oauth)
            pairs = _google_accounts(db)

        if add_account and not all_accounts and not account_email:
            _print_accounts(pairs)
            print("\nConnected. Run with --account EMAIL or --all-accounts to classify.")
            return

        if all_accounts:
            targets = pairs
        elif account_email:
            targets = [(u, a) for u, a in pairs if u.email and u.email.lower() == account_email.lower()]
            if not targets:
                raise SystemExit(
                    f"Account {account_email} not connected. "
                    "Use --add-account or --list-accounts."
                )
        elif len(pairs) == 1:
            targets = pairs
        else:
            _print_accounts(pairs)
            raise SystemExit(
                "Multiple Gmail accounts connected. "
                "Use --account EMAIL, --all-accounts, or --list-accounts."
            )

        for user, account in targets:
            email_out = (
                out_path
                if len(targets) == 1 and not all_accounts
                else _report_path_for_email(out_path, user.email or "unknown")
            )
            _classify_inbox_for_user(
                db,
                user,
                account,
                max_results=max_results,
                reclassify=reclassify,
                out_path=email_out,
                delay=delay,
                inbox_tab=inbox_tab,
                classify_only=classify_only,
            )

    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Classify recent Gmail inbox messages.")
    parser.add_argument(
        "--max-results",
        type=int,
        default=100,
        help="How many recent INBOX messages to fetch (default: 100)",
    )
    parser.add_argument(
        "--reclassify",
        action="store_true",
        help="Re-run LLM classification even if already classified",
    )
    parser.add_argument(
        "--desktop-oauth",
        action="store_true",
        help="Use a Desktop OAuth client (recommended for local runs; no redirect URI)",
    )
    parser.add_argument(
        "--all-inbox",
        action="store_true",
        help="Include Promotions/Social/Updates (default: Primary tab only)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=2.0,
        help="Seconds to wait after each LLM call (default: 2)",
    )
    parser.add_argument(
        "--full-pipeline",
        action="store_true",
        help="Also run Sonnet commitment extraction (often 529-overloaded; default is classify-only)",
    )
    parser.add_argument(
        "--reconnect",
        action="store_true",
        help="Disconnect (--account if set, else all) and sign in again",
    )
    parser.add_argument(
        "--add-account",
        action="store_true",
        help="Connect another Gmail without removing existing accounts",
    )
    parser.add_argument(
        "--list-accounts",
        action="store_true",
        help="Show locally connected Gmail accounts and exit",
    )
    parser.add_argument(
        "--account",
        metavar="EMAIL",
        help="Run for this connected Gmail only",
    )
    parser.add_argument(
        "--all-accounts",
        action="store_true",
        help="Run classification for every connected Gmail",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("reports/classification_sample.csv"),
        help="CSV output path (JSON written alongside)",
    )
    args = parser.parse_args()
    run(
        args.max_results,
        reclassify=args.reclassify,
        out_path=args.out,
        desktop_oauth=args.desktop_oauth,
        delay=args.delay,
        inbox_tab="all" if args.all_inbox else "primary",
        classify_only=not args.full_pipeline,
        reconnect=args.reconnect,
        add_account=args.add_account,
        list_accounts=args.list_accounts,
        all_accounts=args.all_accounts,
        account_email=args.account,
    )


if __name__ == "__main__":
    main()
