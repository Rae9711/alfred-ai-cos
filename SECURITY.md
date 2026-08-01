# Security

Albert reads people's email. Trust is the product (PRD principle 7). This documents what
the foundation does today and what it owes before it touches real user data at scale.

## What the slice does today

### OAuth, not passwords

Google OAuth and Sign in with Apple mint Albert session JWTs. Albert never sees or
stores a Google or Apple password. Google consent still grants Gmail and Calendar when
the user connects a mailbox; Apple / “continue without Gmail” create a session with no
`ConnectedAccount` until the user links Gmail from Settings.

### Token encryption at rest

Third-party OAuth tokens are encrypted with Fernet (AES-128-CBC + HMAC) before they touch
Postgres, using `MultiFernet` so the key can be rotated without a flag-day re-encrypt.
`TOKEN_ENCRYPTION_KEY` is the primary (encrypt) key; `TOKEN_ENCRYPTION_KEY_PREVIOUS` is an
optional comma-separated list of older keys tried only on decrypt. Plaintext tokens exist
only in process memory during an API call. See `backend/app/services/crypto.py` and the
`connected_accounts.token_ciphertext` column. Key rotation is documented under
[Key rotation](#key-rotation).

### Scopes

The same Google consent grants sign-in, Gmail, and Calendar. The requested scopes are:

- `gmail.modify` — read inbox messages and update labels (e.g. mark-as-read).
- `gmail.compose` — create drafts.
- `gmail.send` — send mail on the user's behalf. This is only ever exercised through an
  **approval-gated** `ActionProposal` (risk level 3), never directly from a route.
- `calendar.readonly` — read events.
- `calendar.events` — create/update/delete events ("book my time"), also approval-gated.
- `openid`, `email`, `profile` — identity.

Scopes are declared in one place: `backend/app/core/config.py::Settings.google_scopes`.
Every mutating scope (`gmail.send`, `calendar.events`) is guarded by the execution layer
below — holding the scope is necessary but not sufficient to act; a logged, user-approved
proposal is also required.

### Storage minimization

Raw email bodies are never written to the database. Ingestion stores a snippet and
metadata only; extraction fetches the full body from Gmail in-process and discards it
after classification. This keeps the most sensitive content out of the data store.

### Human-in-the-loop for external actions

No external action runs without an explicit, logged approval. Every outbound action —
creating/sending a Gmail draft, sending an email, and creating/updating/deleting a
calendar event — requires an `ActionProposal` at an appropriate risk level, a user
approval call, and produces an append-only `ExecutionLog` row. Failures are recorded,
never silently swallowed.

### Session tokens

Albert mints its own JWT after Google login (`core/security.py`), valid for 30 days. Each
token carries a unique `jti` so an individual session can be revoked. The mobile app stores
it in the device secure store (`expo-secure-store`), not plain storage. The client never
holds the Google tokens.

`POST /api/v1/auth/logout` revokes the caller's current session immediately: its `jti` is
added to a Redis denylist with a TTL equal to the token's remaining lifetime, so the entry
self-expires and the set can't grow unbounded. `get_current_user` rejects any token whose
`jti` is on the denylist. The denylist is defense-in-depth and **fails open** if Redis is
unreachable (a Redis outage must not lock every user out); it is not a substitute for the
token's own expiry.

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

The OAuth `state` is a short-lived (10 min) JWT signed with `JWT_SECRET`, carrying a random
nonce and the validated post-login redirect. Google echoes it back to the callback, where we
verify signature + expiry (`jwt.decode` raises on either). Because the app's fetch starts the
flow but a separate in-app browser completes it, a same-browser cookie binding can't survive
that handoff — so the integrity guarantee is the signed, expiring state itself: only the
server can mint a valid state, and it can't be forged or replayed past 10 minutes. Baking the
redirect into the signed state (rather than re-reading it from the callback query) is what
prevents an open redirect. See `backend/app/api/v1/auth.py`.

The environment defaults to `production`, so a deployment that forgets to set `ENVIRONMENT`
keeps the dev-only endpoints (dev-session, seed) disabled rather than exposing them.

### Per-mailbox sync locking

Gmail sync for a given mailbox is guarded by a Redis lock (`app/core/redis.py::redis_lock`)
keyed on the connected-account id. The 60-second beat poller and an interactive `POST /sync`
can otherwise sync the same mailbox concurrently, doubling Gmail API traffic and racing on
the stored `gmail_history_id` cursor. The lock auto-expires (so a crashed worker can't wedge
it) and fails open if Redis is unreachable.

## What this foundation does not yet do

These are required before a real beta, tracked in TODO.md:

- **Role-based backend access.**
- **Multi-currency spend accounting.** The `SpendLimit` is a single-currency per-period cap,
  not a ledger; cross-currency charges are not normalized against the cap.
- **No model training on user data.** The Anthropic API is used for inference only. Make
  this an explicit, enforced policy and surface it in the privacy settings.
- **Broader API rate limits** beyond auth minting and the SMS webhook (Gmail quota
  handling exists separately via sync locks / retries).

### Recently closed

- **Log redaction in app logs.** Structured logging scrubs tokens and sensitive fields via
  `app.core.redaction` (PRD 13.2 baseline).
- **Auth + SMS webhook rate limiting.** Redis fixed-window limits on Apple / anonymous
  session minting and `POST /inbox/sms` (fail-open if Redis is down).
- **Indexed SMS forward tokens.** `users.sms_forward_token` replaces a full-table scan of
  preferences JSON; Settings can rotate the token.
- **OAuth token refresh.** All Gmail/Calendar access goes through
  `connected_accounts.refresh_google_token`, which refreshes the access token when expired,
  re-encrypts and persists the rotated payload, and raises `TokenReconnectRequired` (surfaced
  as a "reconnect your mailbox" sync error) when a grant has been revoked.
- **Session revocation.** `jti` + Redis denylist + `POST /auth/logout` (see
  [Session tokens](#session-tokens)).
- **Key rotation.** `MultiFernet` with `TOKEN_ENCRYPTION_KEY_PREVIOUS` (see below).

### Key rotation

To rotate `TOKEN_ENCRYPTION_KEY` without downtime or a bulk re-encrypt:

1. Generate a new Fernet key.
2. Move the current key into `TOKEN_ENCRYPTION_KEY_PREVIOUS` (comma-separated; keep any
   older keys you still need for decrypt).
3. Set the new key as `TOKEN_ENCRYPTION_KEY` and redeploy.

New writes use the new key; existing rows still decrypt via the previous key and are
transparently upgraded to the new key on their next OAuth refresh (or via
`crypto.reencrypt`). Once every row has been re-encrypted you can drop the old key from
`TOKEN_ENCRYPTION_KEY_PREVIOUS`.

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
