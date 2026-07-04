# TODO

What is built, what remains, and what is deliberately refused. Ordered by what matters
next to reach a real beta.

## Built

### Phase 0 foundation (the original slice)

- [x] Monorepo: backend (FastAPI), mobile (Expo), shared-types, docs.
- [x] Google OAuth (Gmail + Calendar), Fernet-encrypted token storage.
- [x] Gmail ingestion (snippet + metadata, no raw bodies stored).
- [x] Classification + commitment extraction via provider-agnostic LLM layer (Anthropic).
- [x] Transparent, explainable priority engine with date anchoring.
- [x] Today dashboard, draft reply generation, propose → approve → push-Gmail-draft → audit.

### Track A: Phase 1 MVP layer

- [x] Mobile tab navigation (Today / Capture / Waiting / Settings) with auth + onboarding gating.
- [x] Calendar sync (Google Calendar → CalendarEvent, prep_required flagging).
- [x] Meeting prep: related-message matching + LLM brief; Today "meetings to prepare" + screen.
- [x] Daily briefing: model, service, routes, Celery beat (06:00 UTC), Today card with feedback.
- [x] Manual task creation + tasks view; create_task executor.
- [x] Text capture → structured tasks (`parse_capture` LLM method).
- [x] Voice capture: provider-agnostic transcription seam (Whisper), degrades to 501 unconfigured.
- [x] Waiting-for tracker (both directions, age-sorted) + one-tap follow-up draft.
- [x] Onboarding calibration (3 questions → User.preferences).
- [x] Smart notifications: importance thresholds, quiet hours, batching, dedup, Expo Push,
      Celery beat scan every 30 min.
- [x] Account deletion + integration revocation (Google token revoke, no orphan rows).

### Track B: execution layer + integrations

- [x] Capability framework: `CapabilityProvider` Protocol, registry, risk taxonomy (0-5),
      `SpendLimit`, `AuditLog`. Execution service enforces approval-by-risk + spend + audit.
- [x] Strong-confirmation approval UI: pending queue, level 4-5 second confirm (HTTP 428),
      ActionApprovalScreen, Today banner.
- [x] Stripe payments (test mode), refuses live keys without an explicit flag + compliance.
- [x] WhatsApp Business Cloud API (sandbox), official API only.
- [x] Refused integrations documented: browser automation + food delivery, registered stubs
      that raise a sourced error (docs/integrations/REFUSED.md).

Gate green throughout: ruff, mypy strict, 73 pytest, tsc (shared + mobile).

## Next, to reach a production beta

### Security (see SECURITY.md)

- [ ] OAuth access-token refresh + re-encryption on expiry.
- [ ] Bind OAuth `state` to the initiating client (PKCE-style).
- [ ] Log redaction policy: scrub email content, tokens, PII from logs.
- [ ] API and Gmail-call rate limiting.
- [ ] `TOKEN_ENCRYPTION_KEY` rotation path.
- [ ] Role-based backend access.

### Correctness and quality

- [x] **Thread-aware extraction (trust-critical, found in live testing 2026-05-22).**
      Extraction runs per-message in isolation, so a commitment raised early in a thread
      stays flagged even after it was resolved later in the SAME thread (e.g. the user
      replied with the doc, or the sender said "never mind"). Fix: fetch the full Gmail
      thread (`gmail.users.threads.get`) and extract over the whole conversation, marking
      a commitment resolved/closed when a later message in the thread settles it. Touches
      `app/services/extraction.py` and `app/services/gmail.py`. *(Verified done —
      `_reconcile_thread_commitments` in `extraction.py` is implemented and called from
      both extraction entry points; found stale during /plan-eng-review 2026-07-02.)*
- [ ] Full-thread retrieval for drafting (currently uses the stored snippet).
- [ ] Idempotent, incremental Gmail sync (history API / `historyId`) instead of refetch.
- [ ] Priority engine learns from feedback (PRD 16.1); feedback is recorded but not yet fed back.
- [ ] Per-user-timezone briefing/notification delivery (currently a fixed UTC schedule).
- [ ] Real spend-limit policy with resets/ledger (current SpendLimit is a single-period cap).
- [ ] Integration tests against Gmail / Calendar / Stripe / WhatsApp sandboxes with live keys.
- [ ] OpenAPI-to-TypeScript codegen so `packages/shared-types` is generated, not hand-mirrored.
- [ ] **Document all input channels in one place** (Gmail, Calendar, SMS today; WhatsApp
      planned) — what flows into `Message`/extraction/`assistant.py` context and how.
      Both the design doc and /plan-eng-review independently rediscovered that SMS
      (`sms_inbox.py`, `sms_shortcut.py`, 8+ mobile files) is a deep, already-wired third
      channel, after the fact. P2, effort S. *(Added via /plan-eng-review 2026-07-02.)*
- [ ] **Per-account sync lock.** Nothing prevents two Celery workers from syncing the
      same account concurrently — during the planned concierge test (3-5 more accounts
      within 2 weeks), simultaneous syncs of one account could double-hit Gmail's rate
      limit right as the new retry/backoff logic depends on that limit behaving
      predictably. Pre-existing gap, not introduced by this plan, but real at pilot
      scale. P2. *(Added via /plan-eng-review 2026-07-02.)*
- [ ] **Generalize the "announce state changes, not routine ticks" a11y pattern.**
      The level-up-only accessibility announcement (see avatar/XP feedback spec) should
      become the standard rule for any future meaningful-but-infrequent avatar state
      change (e.g. a streak-broken state), not a one-off special case. No other such
      states exist yet — low urgency. P4. *(Added via /plan-design-review 2026-07-02.)*
- [ ] Define a real, distinct trigger for the `tool_used` XP event type (mobile
      `agentMeta.ts`) once a genuine use case exists — currently defined with real
      XP/cap values but deliberately left unwired (only `task_completed` fires) to avoid
      double-counting against an undefined boundary. P4/someday, no current urgency.
      *(Added via /plan-eng-review 2026-07-02.)*

## Later (PRD roadmap Phase 2-3)

- [ ] Notion / Todoist / Slack / Google Drive integrations.
- [ ] Project grouping, people memory (the `Person` / `Project` entities).
- [ ] Subscription billing.
- [ ] Web app (Next.js), share sheet, widgets.

## Refused (built as a documented boundary, not a gap)

See docs/integrations/REFUSED.md. The capability seam exists; the providers raise a
sourced error rather than faking success.

- Browser automation: breaks the OAuth-only, no-raw-credentials trust model (PRD risk 5).
- Deliveroo / Uber Eats ordering: no public partner API; Phase 4 business development.
- Unofficial WhatsApp automation: violates Meta's terms, bans numbers. The official Cloud
  API (sandbox) is what is built instead.

## Operator-gated (built, but you supply credentials + compliance)

- Real Stripe payments: needs a legal entity, KYC, ToS, PCI scope (docs/integrations/stripe.md).
- Production WhatsApp: needs a verified WABA, approved templates, opt-in (docs/integrations/whatsapp.md).
- Voice transcription: needs a transcription provider key (e.g. OpenAI Whisper).
- Production push: needs APNs/FCM configured in the Expo project.
