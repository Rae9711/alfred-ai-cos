# Plan: Build out the rest of Albert per the PRD

**Status:** complete (all 16 slices shipped; gate green)
**Created:** 2026-05-21
**Owner:** Azzbee

## Goal

Take Albert from the working Phase 0 slice (Gmail → commitments → Today → draft → approve)
to a usable Phase 1 product plus a real execution layer. Done looks like: a user gets a
daily briefing and calm batched notifications, sees meeting prep before calls, tracks what
they are waiting on, captures tasks by text and voice, completes onboarding calibration,
and can delete their account. On top of that, Albert can execute approved actions through a
typed, risk-classified, spend-limited, audited capability system, with real Stripe (test
mode) and real WhatsApp Business API (sandbox) wired, and the integrations that have no
compliant API (browser automation, Deliveroo/Uber Eats ordering) refused and documented
rather than faked. The verification gate (ruff, mypy strict, pytest, tsc on shared-types
and mobile) stays green at every slice boundary.

## Context

Foundation is solid and verified. Key facts from investigation:

- **Backend:** FastAPI + SQLAlchemy 2.0 (`app/db/base.py` Base has UUID PK + timestamps),
  Celery (`app/workers/celery_app.py`, no beat schedule yet), provider-agnostic LLM
  (`app/llm/base.py` Protocol, `providers/anthropic_client.py` impl). Routes registered in
  `app/api/v1/__init__.py`; auth via `get_current_user` in `app/core/security.py`.
- **LLM methods already implemented but unwired:** `generate_daily_briefing` and
  `summarize_meeting_context` exist in the Anthropic client. Briefing has no route/task.
  Meeting prep has no route/service/calendar data.
- **Gaps confirmed:** no calendar sync (CalendarEvent model exists, never populated), no
  task executor (`ActionType.create_task` enum exists, `actions.py::_execute` only handles
  draft→Gmail), no notifications, no beat schedule, `meetings_to_prepare` hardcoded empty
  in `app/services/today.py`.
- **Enums to extend:** `RiskLevel` (0-5 already defined), `ActionType` (only send_email,
  create_draft, create_task), `SourceType` (has voice, manual). `app/db/enums.py`.
- **Mobile:** Expo Router stack, single `app/index.tsx` route swapping ConnectScreen/
  TodayScreen on auth. No tab navigator. No expo-notifications or audio packages yet.
  Theme tokens in `src/theme/theme.ts`. API client in `src/api/client.ts`. Path aliases
  `@/` and `@albert/shared-types` work.
- **Shared types:** `packages/shared-types/src/{enums,models}.ts` hand-mirrored from backend.

Constraints: voice rules (no em dashes, no AI vocabulary). Strict typing, no `any`. Every
external action stays behind the approval spine. No raw email bodies persisted (current
privacy posture). Lockfiles committed.

## Approach

Build in thin vertical slices, each crossing backend + shared-types + mobile and each
independently shippable and gate-green. Track A (Phase 1 features) first because it is pure
value with no legal risk and exercises the unwired LLM methods already present. Track B
(execution layer) second, built as a generalization of the existing ActionProposal spine:
a `CapabilityProvider` Protocol mirroring the `LLMClient` pattern, with the risk taxonomy,
spend limits, and audit log enforced centrally so every provider (real or mock) inherits
the safety system. Real integrations (Stripe test, WhatsApp sandbox) are separate slices
gated behind documented prerequisites. The two refused integrations (browser automation,
food delivery) get a written `docs/integrations/REFUSED.md` and a provider stub that raises
a clear `NotImplementedError` with the reason, so the seam exists but nothing fakes success.

Chosen over the alternatives because it keeps the gate green continuously, reuses the two
proven patterns (Protocol-based providers, the approval spine), and puts the safety system
in one enforced place rather than per-integration.

## Alternatives considered

- **Horizontal phases (all models, then all services, then all UI):** lost because nothing
  is shippable or testable until the end, and the gate would stay red for a long stretch.
- **Build execution layer first (Track B before A):** lost because it is the riskier, more
  abstract work and delivers no user value until a provider is real; A derisks the cadence.
- **One mega capability model with a JSON blob per action:** lost because it defeats strict
  typing; per-provider typed payloads validated by Pydantic are safer and match the
  `ExtractedCommitment`/structured-output pattern already in use.
- **Skip mocks, only build real integrations:** lost because two of the four have no
  compliant API, so the execution layer could not be exercised end to end without them.

## Vertical slices

Each slice ends with: ruff + mypy strict + pytest green on backend, tsc green on
shared-types and mobile, and a manual check noted. New shared-types added in the same slice
that introduces the backend shape.

### Track A: Phase 1 MVP layer

- [ ] **A1: Mobile tab navigation shell.** Convert the single-route app to an Expo Router
      tab navigator (Today, Capture, Waiting, Settings) so later slices have a home. Files:
      `mobile/app/_layout.tsx`, new `mobile/app/(tabs)/_layout.tsx`, move Today into
      `(tabs)/index.tsx`, add placeholder `(tabs)/{capture,waiting,settings}.tsx`. Auth gating
      moves to a guard in the tabs layout. Acceptance: app boots to a tab bar, Today still
      works, other tabs show "coming soon".

- [ ] **A2: Calendar sync.** Populate CalendarEvent (prerequisite for meeting prep and the
      meetings_to_prepare section). New `app/services/calendar.py` (list_events via the Google
      Calendar API using the existing `calendar.readonly` scope and stored token), extend
      `ingestion.py` or add `sync_calendar`, wire into `POST /sync`. Add seed calendar events
      to `dev.py`. Tests: a calendar normalization test. Acceptance: after sync, CalendarEvent
      rows exist; `/today` meetings_to_prepare can be populated.

- [ ] **A3: Meeting prep.** New `app/services/meeting_prep.py` that, for an upcoming event,
      finds related messages (by attendee email match) and calls the existing
      `summarize_meeting_context`. New route `GET /api/v1/meetings/upcoming` and
      `GET /api/v1/meetings/{id}/prep`. New schema `MeetingPrepOut`. Populate
      `today.py::meetings_to_prepare`. Shared-types: `MeetingPrep`. Mobile: `MeetingPrepScreen`
  - a Today section that deep-links to it. Tests: related-message matching. Acceptance:
    a seeded meeting shows a brief with context, open commitments, suggested questions.

- [ ] **A4: Daily briefing.** Wire the existing `generate_daily_briefing`. New
      `DailyBriefing` model (date, summary, generated_at, user_feedback), new
      `app/services/briefing.py` (build today_payload, call LLM, persist), routes
      `POST /api/v1/briefings/generate` and `GET /api/v1/briefings/today`. Celery task
      `albert.generate_briefing` + a beat schedule entry. Migration. Shared-types: `Briefing`.
      Mobile: briefing card at top of Today. Tests: payload assembly. Acceptance: a briefing
      generates and renders under the 5-priority / 90-second bound.

- [ ] **A5: Manual task creation + tasks view.** Task model exists; add CRUD. New
      `app/api/v1/tasks.py` (`POST /tasks`, `GET /tasks`, `POST /tasks/{id}/status`). Build the
      missing `create_task` executor path so AI-suggested tasks also work (extend
      `actions.py::_execute` for `ActionType.create_task`, risk level 2). Shared-types: `Task`,
      `TaskCreateRequest`, `TaskStatus`. Mobile: tasks list, integrate into Capture/Today.
      Tests: task CRUD, create_task executor. Acceptance: user creates a task, sees it, marks
      it done.

- [ ] **A6: Capture (text) → structured tasks.** New LLM method `parse_capture` on the
      Protocol + Anthropic impl (messy text → list of tasks/commitments with dates/people).
      Route `POST /api/v1/capture`. Shared-types: `CaptureResult`. Mobile: CaptureScreen text
      input → confirm screen → creates tasks. Tests: a parse_capture structured-output test
      (mocked LLM). Acceptance: typing "remind me to call the broker tomorrow and review the
      CBRE valuation" creates two tasks with the right dates.

- [ ] **A7: Voice capture.** Add `expo-audio` (record) to mobile, send audio to a new
      `POST /api/v1/capture/voice` that transcribes (Whisper-class via a transcription provider,
      or Anthropic if audio input is supported, decided at build time) then reuses A6's
      parse_capture. Flag: needs a transcription provider key. Mobile: mic button on
      CaptureScreen. Acceptance: a spoken note becomes structured tasks. (If no transcription
      provider is configured, the endpoint returns a clear 501 and the mic is hidden.)

- [ ] **A8: Waiting-for tracker view.** Backend already computes you_are_waiting_on in
      `today.py`. Add `GET /api/v1/waiting` (both directions, with age/last-contact) and a
      follow-up draft action reusing the draft path. Mobile: WaitingScreen (the Waiting tab).
      Tests: waiting query. Acceptance: the Waiting tab lists both directions and offers
      "draft a follow-up".

- [ ] **A9: Onboarding calibration.** Three calibration questions (PRD 9.1) writing to
      `User.preferences`. New schema `OnboardingPrefs`, route `POST /api/v1/onboarding` +
      `GET /api/v1/me`. Mobile: OnboardingScreen shown after first connect, before Today.
      Tests: prefs round-trip. Acceptance: answers persist and are readable.

- [ ] **A10: Smart notifications + quiet hours.** New `app/services/notifications.py` with a
      `NotificationProvider` Protocol (push via Expo Push API; provider abstraction so email/
      SMS can slot later). New `Notification` model (type, payload, sent_at, useful_feedback).
      Batching + importance threshold + quiet-hours logic reads `User.preferences`. Celery beat
      task scanning for deadline risk / meeting prep / unanswered email / follow-up due. Routes
      `POST /api/v1/devices` (register push token), `POST /api/v1/notifications/{id}/feedback`.
      Mobile: add `expo-notifications`, register token, settings for quiet hours + style.
      Migration. Tests: batching + quiet-hours logic (pure functions). Acceptance: a deadline-
      risk notification fires outside quiet hours, batches low-priority items, respects the
      quiet window.

- [ ] **A11: Account deletion + integration revocation.** `DELETE /api/v1/me` (cascade
      delete all user rows, revoke Google token via Google's revoke endpoint),
      `DELETE /api/v1/connected-accounts/{provider}` (revoke + delete tokens). Mobile: Settings
      screen actions with strong confirmation. Tests: cascade delete leaves no orphan rows;
      revocation calls the revoke endpoint. Acceptance: deleting an account removes all data and
      revokes Google access. (Closes a SECURITY.md gap.)

### Track B: Execution layer + integrations

- [ ] **B1: Capability framework + risk/spend/audit.** The core. New
      `app/capabilities/base.py` with a `CapabilityProvider` Protocol (mirrors `LLMClient`):
      `describe()`, `validate(payload)`, `execute(payload) -> ExecutionResult`, each declaring
      its `RiskLevel`. New models: `SpendLimit` (user_id, period, cap, spent), `AuditLog`
      (generalizes ExecutionLog: actor, capability, payload_redacted, result, reversible). New
      `app/services/execution.py` that enforces: risk → approval requirement (levels 0-1 auto,
      2 configurable, 3 approve, 4-5 strong-confirm), spend-limit check for financial actions,
      audit write on every attempt. Generalize the existing `ActionProposal` flow to route
      through this. Extend `ActionType` enum (add_send_message, make_payment, place_order, etc.)
      and add `RiskLevel`-aware `requires_strong_confirmation`. Shared-types: extend ActionType,
      add SpendLimit, AuditLogEntry. Migration. Tests: risk classification table, spend-limit
      enforcement, audit-on-failure. Acceptance: a level-4 action without an under-cap spend
      limit is blocked with a clear reason; every attempt writes an audit row.

- [ ] **B2: Strong-confirmation approval UI.** Extend the approval card (PRD 17.3) to show
      action type, recipient/platform, content, cost, reversibility, evidence, reason,
      alternatives. Level 4-5 require a typed/explicit second confirmation. Route changes:
      generalize `actions.py` to any capability proposal. Mobile: ActionApprovalScreen.
      Acceptance: approving a level-4 action requires the strong-confirm step; level-3 does not.

- [ ] **B3: Stripe payments (TEST MODE).** New `app/capabilities/providers/stripe_provider.py`
      using Stripe test keys, level 4. Creates a PaymentIntent in test mode only; refuses if
      `STRIPE_LIVE` is ever set without an explicit, separate compliance flag. Spend limit
      enforced. Shared-types: payment payload. Mobile: payment approval card. Tests: test-mode
      PaymentIntent creation (mocked), refusal on live key. **Legal prerequisites documented in
      docs/integrations/stripe.md (see Hidden assumptions).** Acceptance: a test-mode payment
      runs through propose → strong-confirm → execute → audit, no live money.

- [ ] **B4: WhatsApp Business API (SANDBOX).** New
      `app/capabilities/providers/whatsapp_provider.py` using the official Cloud API sandbox,
      level 3. Sends only template/session messages the sandbox permits. Refuses any unofficial
      automation path. Shared-types: message payload. Mobile: message approval card. Tests:
      sandbox send (mocked). **Legal prerequisites in docs/integrations/whatsapp.md.**
      Acceptance: a sandbox message sends through the approval spine. Hard note in code: no
      unsolicited automation, ever.

- [ ] **B5: Refused integrations, documented.** New `docs/integrations/REFUSED.md` covering
      browser automation (credential-proxying breaks the OAuth-only trust model; PRD risk 5) and
      food delivery (no public partner ordering API; Phase 4 BD, not engineering). Provider
      stubs `browser_provider.py` and `delivery_provider.py` that raise `NotImplementedError`
      with the documented reason and a pointer to the doc. No mock that fakes success.
      Acceptance: calling either provider raises a clear, sourced error; the doc explains why.

## Hidden assumptions surfaced

Review these before approving. Several change scope or need a real-world action from you.

1. **"Real integrations where legally possible" still needs accounts and keys you must
   create.** I cannot create a Stripe account, a Meta WhatsApp Business app, or an Expo push
   credential for you. Each real slice (B3, B4, A10) will be code-complete and tested against
   mocks, but going live needs: Stripe test (then live) keys + a legal entity for live;
   a Meta Business account + verified WhatsApp sender + approved message templates; Apple/
   Google push setup for production notifications. The plan builds the code; you supply
   credentials and do the compliance steps. Is that the division you expect?

2. **WhatsApp sandbox is real but narrow.** The Cloud API sandbox only sends to pre-verified
   test numbers and only template messages outside a 24-hour session window. "WhatsApp
   automation" as the PRD imagines (proactive messaging anyone) is not compliant and will not
   be built. B4 sends sandbox messages through approval only. Confirm that is acceptable.

3. **Voice capture (A7) needs a transcription provider.** Anthropic models do not currently
   take raw audio. So A7 needs either a Whisper-class API (OpenAI Whisper, Deepgram, etc.) or
   on-device transcription. This adds a new provider key and arguably a new provider seam.
   If you do not want a second AI vendor, A7 ships as on-device transcription only or is
   deferred. Which?

4. **Notifications need a push provider decision.** Expo Push is the path of least resistance
   for an Expo app and needs no Apple/Google certs for development. Production push does need
   APNs/FCM setup. Plan assumes Expo Push for now. OK?

5. **Calendar sync uses the scope you already requested.** `calendar.readonly` is already in
   `google_scopes`, so no re-consent. Good. But the seed/dev path has no real calendar; A2
   adds seeded calendar events for the no-Google flow.

6. **Generalizing ActionProposal is a refactor of working code.** B1 changes the existing
   draft→Gmail approval path to route through the new execution service. This touches
   `actions.py` which is tested and working. Risk of regression; mitigated by keeping the
   existing endpoints and tests green through the refactor.

7. **Spend limits assume a single currency and no real ledger.** B1 models a simple per-period
   cap, not a double-entry ledger or multi-currency. Fine for test-mode Stripe; flagged so you
   know it is not production-grade accounting.

8. **No teams.** Per your decision, every model stays single-user (user_id scoped). If teams
   come later, every table needs a tenant boundary retrofit. Noted, not built.

9. **Migrations stack up.** Each model-adding slice generates an Alembic migration. They must
   be applied in order. The plan assumes a dev database that can be migrated freely; no
   production data to preserve yet.

10. **Slice count is large (16 slices).** This is multi-session work. The plan is structured
    so you can stop after any slice with a green gate and a shippable increment. Track A alone
    (A1-A11) is the defensible "usable beta". Track B is the ambitious execution layer.

## Verification

- **Per slice:** `cd backend && uv run ruff check app tests && uv run mypy app && uv run
pytest` green; `cd packages/shared-types && bunx tsc --noEmit` green; `cd mobile && bunx
tsc --noEmit` green.
- **New unit tests** per slice as listed (priority-engine-style pure-logic tests where
  possible; mocked-LLM and mocked-provider tests for the AI/integration paths).
- **Manual end-to-end** via the dev seed path (no Google needed) extended per slice: seed
  calendar events (A2), generate a briefing (A4), capture text (A6), fire a notification in a
  forced window (A10), run a test-mode Stripe payment through approval (B3).
- **Refusal check (B5):** calling the browser/delivery providers raises the documented error.
- **Security check (A11):** after account deletion, a DB query shows zero rows for that user
  across all tables, and the Google revoke endpoint was called.

## Risks

- **Regression in the working approval path (B1).** Highest risk. The draft→Gmail flow is
  live and tested; generalizing it could break it. Mitigation: keep existing endpoints and
  their tests; add the execution service alongside, migrate the draft path last, run the full
  suite at each step.
- **Real-integration drift.** Stripe/WhatsApp/Expo APIs change. Mitigation: pin SDK versions,
  isolate each in its provider module (the established pattern), test against mocks so the
  suite does not depend on live services.
- **Migration ordering / dev DB state.** Multiple new tables. Mitigation: one migration per
  slice, autogenerate + review, apply in order.
- **Scope creep into fenced-off territory.** Mitigation: B5 documents the hard line; providers
  refuse rather than fake.
- **Privacy regressions.** Voice audio and capture text are new sensitive inputs. Mitigation:
  do not persist raw audio; redact capture text in audit logs (extends the existing
  no-raw-bodies posture); document in SECURITY.md.
- **Notification spam (PRD risk 3).** Mitigation: batching + thresholds + quiet hours are part
  of A10's core logic and tested, not bolted on.
- **Cost.** More LLM calls (briefing, capture, meeting prep) per user per day. Mitigation:
  cheap model for parsing where quality allows; briefing once daily; flagged for the unit-
  economics model later.

## Out of scope

- Teams, organizations, RBAC, admin console, seat billing (deferred by your decision).
- Live (non-test) Stripe payments, real money movement (test mode only; live needs legal
  entity + compliance you perform).
- Production WhatsApp messaging beyond the sandbox; any unofficial WhatsApp automation
  (not compliant, refused).
- Browser automation and Deliveroo/Uber Eats real ordering (no compliant API; refused and
  documented in B5).
- Web app (Next.js), widgets, share-sheet (PRD later phases).
- Notion / Todoist / Slack / Drive integrations (PRD Phase 3).
- Production push certificates (APNs/FCM), App Store submission.
- A real double-entry ledger or multi-currency spend accounting.
- Replacing the hand-mirrored shared-types with OpenAPI codegen (tracked separately in TODO).
