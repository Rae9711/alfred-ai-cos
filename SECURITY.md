# Security

Albert reads people's email. Trust is the product (PRD principle 7). This documents what
the foundation does today and what it owes before it touches real user data at scale.

## What the slice does today

### OAuth, not passwords

Google OAuth is the only login. Albert never sees or stores a Google password. The same
consent grants Gmail and Calendar and serves as Albert's sign-in.

### Token encryption at rest

Third-party OAuth tokens are encrypted with Fernet (AES-128-CBC + HMAC) before they touch
Postgres. The key comes from `TOKEN_ENCRYPTION_KEY`. Plaintext tokens exist only in
process memory during an API call. See `backend/app/services/crypto.py` and the
`connected_accounts.token_ciphertext` column.

### Minimal scopes

The slice requests the narrowest scopes that make it work:

- `gmail.readonly` — read inbox messages.
- `gmail.compose` — create drafts. **Not** `gmail.send`. Albert cannot send mail.
- `calendar.readonly` — read events.
- `openid`, `email`, `profile` — identity.

Scopes are declared in one place: `backend/app/core/config.py::Settings.google_scopes`.

### Storage minimization

Raw email bodies are never written to the database. Ingestion stores a snippet and
metadata only; extraction fetches the full body from Gmail in-process and discards it
after classification. This keeps the most sensitive content out of the data store.

### Human-in-the-loop for external actions

No external action runs without an explicit, logged approval. Pushing a draft into Gmail
(the only external action in the slice) requires an `ActionProposal` at risk level 3, a
user approval call, and produces an append-only `ExecutionLog` row. Failures are recorded,
never silently swallowed.

### Session tokens

Albert mints its own short-lived JWT after Google login (`core/security.py`). The mobile
app stores it in the device secure store (`expo-secure-store`), not plain storage. The
client never holds the Google tokens.

### Account deletion and integration revocation

`DELETE /api/v1/me` deletes every user-scoped row across all tables (the full list is
maintained in `_USER_SCOPED`, including `SpendLimit` and `AuditLog`) and revokes the Google
OAuth grant via Google's revoke endpoint. `DELETE /api/v1/connected-accounts/{provider}`
revokes and removes a single integration without deleting the account. Revocation is
best-effort and never blocks deletion: a failed revoke still removes the local data. A test
asserts no orphan rows remain after deletion (`tests/test_account_deletion.py`).

### Execution-layer safety

Any action that touches the outside world runs through `app/services/execution.py`, which:

- **Classifies by risk** (0-5) and requires approval accordingly; level 4-5 (financial,
  sensitive) require a second strong confirmation (`?confirm=true`, HTTP 428 otherwise).
- **Gates spend** for financial actions against a per-user `SpendLimit`, blocked by default
  when no limit is set. The limit row is locked (`SELECT ... FOR UPDATE`) during execution
  so concurrent approvals cannot both pass the cap.
- **Claims proposals atomically**: the `proposed -> approved` transition is a conditional
  `UPDATE ... WHERE status='proposed'`, so a proposal is never executed (or charged) twice.
- **Audits every attempt**: success, error, and blocked all write an `AuditLog` row, even on
  unexpected provider/network exceptions; the proposal never stays stuck in `approved`.
- **Uses idempotency keys**: the proposal id is passed to providers (Stripe) so retries and
  lost-response cases do not double-charge.
- **Redacts** sensitive fields (recursively) from the stored audit payload.

### OAuth CSRF binding

The OAuth `state` nonce is set in an HttpOnly cookie at `/auth/google/start` and required to
match the state token at the callback (constant-time compare), so a signed state alone,
replayed or forged for a victim, is rejected. The environment defaults to `production`, so a
deployment that forgets to set `ENVIRONMENT` keeps the dev-only endpoints (dev-session, seed)
disabled rather than exposing them.

## What this foundation does not yet do

These are required before a real beta, tracked in TODO.md:

- **OAuth token refresh.** The slice rebuilds credentials from the stored payload but does
  not yet refresh expired access tokens and re-encrypt them. Long-lived sessions will fail
  on expiry until this lands.
- **Session revocation.** The JWT is valid until expiry (30 days); there is no logout/revoke
  list. Add a `jti` denylist or short-lived tokens + refresh.
- **Log redaction in app logs.** Audit-payload redaction exists; a structured app-logging
  policy that scrubs email content, tokens, and PII does not yet (PRD 13.2).
- **Rate limiting** on the API and on Gmail calls.
- **Role-based backend access.**
- **Key rotation** for `TOKEN_ENCRYPTION_KEY` (re-encryption path).
- **Multi-currency spend accounting.** The `SpendLimit` is a single-currency per-period cap,
  not a ledger; cross-currency charges are not normalized against the cap.
- **No model training on user data.** The Anthropic API is used for inference only. Make
  this an explicit, enforced policy and surface it in the privacy settings.

## Secrets

All secrets live in `.env` (gitignored). `.env.example` documents every one. Generate the
token encryption key with:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Never commit `.env`, service-account JSON, or any `*.pem`/`*.key`. The `.gitignore`
enforces this.

## Reporting

This is pre-beta. There is no external security contact yet. Add one
(`security@…`) and a disclosure policy before any public exposure.
