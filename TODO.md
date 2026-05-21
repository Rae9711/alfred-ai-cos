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

- [ ] Full-thread retrieval for drafting (currently uses the stored snippet).
- [ ] Idempotent, incremental Gmail sync (history API / `historyId`) instead of refetch.
- [ ] Priority engine learns from feedback (PRD 16.1); feedback is recorded but not yet fed back.
- [ ] Per-user-timezone briefing/notification delivery (currently a fixed UTC schedule).
- [ ] Real spend-limit policy with resets/ledger (current SpendLimit is a single-period cap).
- [ ] Integration tests against Gmail / Calendar / Stripe / WhatsApp sandboxes with live keys.
- [ ] OpenAPI-to-TypeScript codegen so `packages/shared-types` is generated, not hand-mirrored.

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
