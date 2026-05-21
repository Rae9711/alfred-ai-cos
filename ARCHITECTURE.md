# Architecture

This documents the shape of Albert and the decisions behind it. It maps to the PRD
(`albert_ai_assistant_prd.md`) so the two stay aligned.

## What is built

The original wedge (PRD section 28), end to end:

```
Gmail OAuth → ingestion → classification + commitment extraction → priority → Today → draft → approve
```

On top of that, the Phase 1 MVP layer (calendar sync, meeting prep, daily briefing,
manual + voice capture, waiting-for tracker, onboarding, smart notifications, account
deletion) and the execution layer (a capability framework with risk classification,
spend limits, an audit log, real Stripe test-mode payments, real WhatsApp sandbox
messaging, and documented refusals for browser automation and food delivery). See the
"Phase 1 features" and "Execution layer" sections below.

## System shape

```
┌─────────────┐      HTTPS (JWT)      ┌──────────────────────────────────────┐
│  Expo app   │ ───────────────────► │  FastAPI (app.main)                    │
│  Today/     │ ◄─────────────────── │   api/v1: auth, sync, today,           │
│  Connect    │   albert:// deeplink │           commitments, drafts, actions │
└─────────────┘                      └───────────────┬────────────────────────┘
                                                     │
              ┌──────────────────────────────────────┼───────────────────────┐
              │                                       │                        │
        ┌─────▼──────┐                        ┌───────▼────────┐       ┌───────▼───────┐
        │ services   │                        │  LLMClient     │       │  Celery worker │
        │ oauth,gmail│                        │  (Protocol)    │       │  sync_user     │
        │ ingestion, │                        │   └ Anthropic  │       └───────┬───────┘
        │ extraction,│                        │     provider   │               │
        │ priority,  │                        └────────────────┘               │
        │ today      │                                                          │
        └─────┬──────┘                                                          │
              │                                                                 │
        ┌─────▼─────────────────── Postgres (pgvector) ──────────────────┐      │
        │ users · connected_accounts · messages · calendar_events ·      │◄─────┘
        │ commitments · tasks · draft_replies · action_proposals ·       │
        │ execution_logs                                                 │
        └────────────────────────────────────────────────────────────────┘
        Redis ── Celery broker + result backend
```

## Backend layering

Routes → services → models. Routes are thin: they authenticate, call a service, and
shape the response. Business logic lives in `app/services`. The AI pipeline maps to the
PRD's agent model (section 14.1):

- **Ingestion** (`services/ingestion.py`) — agent 1. Pulls Gmail, normalizes, dedupes.
- **Extraction** (`services/extraction.py`) — agent 2. Classifies and extracts commitments.
- **Priority** (`services/priority.py`) — agent 3. Transparent weighted scoring with reasons.
- **Today** (`services/today.py`) — assembles the dashboard.
- **Execution** (`api/v1/actions.py::_execute`) — agent 8. Pushes approved Gmail drafts.
- **Safety/Approval** (`ActionProposal` + the actions routes) — agent 9. Gates level-3 actions.

Drafting, planning, meeting-prep, and memory agents are defined in the LLM interface or
deferred (see TODO).

## Key decisions

### Provider-agnostic LLM layer

App services depend on `app.llm.base.LLMClient` (a `Protocol`), never on a vendor SDK.
The Anthropic implementation is the only place `anthropic` is imported
(`app/llm/providers/anthropic_client.py`). Structured extraction uses tool-use: the
target Pydantic model's JSON schema becomes a forced tool, and the tool input is
validated back into the model. System prompts are marked cache-eligible so a sync batch
reuses the prompt prefix. Adding OpenAI or Mistral means writing one new provider module
and a branch in `app/llm/__init__.py`.

### Model strategy

Per PRD 14.2, classification uses a cheap model (`claude-haiku-4-5`) and extraction and
drafting use a stronger one (`claude-sonnet-4-6`). The priority engine is rules-based and
deterministic, not an LLM call, so rankings are debuggable and explainable.

### Privacy by storage minimization

Raw email bodies are never persisted. Ingestion stores a snippet and metadata; the
extraction pipeline fetches the full body from Gmail in-process and discards it. OAuth
tokens are encrypted with Fernet (`services/crypto.py`) before they touch Postgres. See
SECURITY.md.

### The approval spine

Internal preparation (creating a draft, classifying, extracting) is risk level 1 and
needs no approval. Anything that touches the outside world is level 3+ and must exist as
an `ActionProposal`, be approved, then produce an `ExecutionLog`. The slice's one
external action is pushing a draft into Gmail. Sending email outright is deliberately not
built: it needs the `gmail.send` scope and stronger confirmation.

### Data model scope

Modeled: `User`, `ConnectedAccount`, `Message`, `CalendarEvent`, `Commitment`, `Task`,
`DraftReply`, `DailyBriefing`, `Device`, `Notification`, `ActionProposal`, `ExecutionLog`,
`SpendLimit`, `AuditLog`. The PRD's `Person` and `Project` entities are deferred until the
features that need them land.

### Sync is synchronous now, async-ready

`POST /api/v1/sync` runs ingestion and extraction inline so the flow is easy to demo end
to end. The same logic is wrapped in Celery tasks (`app/workers/tasks.py`) for the
production path: `sync_user`, plus beat-scheduled `generate_all_briefings` (06:00 UTC) and
`scan_notifications` (every 30 min).

## Phase 1 features

Each is a thin vertical slice over the foundation:

- **Calendar** (`services/gcal.py`, `services/calendar.py`): read-only Google Calendar
  ingestion into `CalendarEvent`, flagging `prep_required` when an event has attendees.
- **Meeting prep** (`services/meeting_prep.py`): matches related messages to an event by
  attendee-email overlap, calls `summarize_meeting_context`. Feeds the Today section and a
  dedicated screen.
- **Briefing** (`services/briefing.py`): builds the Today payload, calls
  `generate_daily_briefing`, persists one row per user per day for explainability.
- **Capture** (`services/capture.py`, LLM `parse_capture`): messy text or transcribed voice
  becomes structured tasks. Voice uses a provider-agnostic transcription seam
  (`app/transcription/`) that returns 501 when no provider is configured.
- **Waiting-for** (`services/waiting.py`): derives both directions of open loops from
  commitments, age-sorted.
- **Notifications** (`services/notifications.py`): pure quiet-hours/importance/dedup logic,
  a `NotificationProvider` (Expo Push), and a beat scan. High-importance items escalate
  through quiet hours; the rest batch.
- **Account** (`api/v1/me.py`): onboarding calibration into `User.preferences`, plus
  deletion and integration revocation.

## Execution layer

The PRD's agentic ambition (agents 8-9), built as a safety system every external action
runs through.

- **CapabilityProvider** (`app/capabilities/base.py`): a Protocol mirroring `LLMClient`.
  Each capability declares its `RiskLevel` and `ActionType`, validates a payload, executes.
  Real SDK code stays inside the provider; the registry (`app/capabilities/__init__.py`) is
  the single switch that turns one on.
- **Execution service** (`app/services/execution.py`): the enforced wrapper. Maps risk to
  approval (0-1 auto, 2 configurable, 3 approve, 4-5 strong confirmation), checks the
  `SpendLimit` for financial actions (blocked by default with no limit set), executes via
  the registry, and writes an `AuditLog` row on every attempt including blocked/error.
- **Providers**: `gmail_draft` (level 3), `create_task` (level 2), `stripe_payment`
  (level 4, test mode, refuses live keys without a flag), `whatsapp_message` (level 3,
  official Cloud API). Real providers register only when their keys are present.
- **Refused** (`browser_action`, `delivery_order`): registered unconditionally and raise a
  sourced `CapabilityError` pointing to `docs/integrations/REFUSED.md`. The boundary is
  explicit in code, not a silent gap.

Adding a real capability later (a partner delivery API, say) means implementing the same
Protocol and registering it; it inherits approval, spend limits, and audit automatically.

## Shared types

`packages/shared-types` mirrors the backend enums and DTOs in TypeScript. It is the single
source the mobile app imports. When a backend schema changes, update the mirror. There is
no codegen yet; see TODO for the OpenAPI-to-types follow-up.
