# Albert

Mobile-first AI chief of staff. Albert connects to Gmail and Calendar, finds what
you are forgetting, ranks what matters today, prepares drafts and follow-ups, briefs
you each morning, prepares you for meetings, and executes approved actions through a
strict, audited permission system.

The core wedge, end to end:

```
Gmail OAuth → email ingestion → commitment extraction → Today priorities → draft reply
```

On top of that: calendar sync and meeting prep, daily briefings, text and voice capture,
a waiting-for tracker, onboarding calibration, smart notifications with quiet hours,
account deletion, and an execution layer (capability framework with risk classification,
spend limits, audit log, Stripe test-mode payments, WhatsApp sandbox messaging). Browser
automation and food-delivery ordering are deliberately refused, not faked, see
[docs/integrations/REFUSED.md](./docs/integrations/REFUSED.md).

See [TODO.md](./TODO.md) for what is built and what remains, and
[ARCHITECTURE.md](./ARCHITECTURE.md) for why it is shaped this way.

## Layout

```
backend/              FastAPI app, Postgres models, AI pipeline, Celery workers
  app/api/v1/         HTTP routes (auth, sync, today, commitments, drafts, actions,
                        meetings, briefings, tasks, capture, waiting, me, notifications)
  app/db/             SQLAlchemy models + enums
  app/llm/            Provider-agnostic LLM interface; Anthropic impl isolated in providers/
  app/transcription/  Provider-agnostic transcription seam (voice capture)
  app/capabilities/   CapabilityProvider framework + providers (gmail draft, task, Stripe,
                        WhatsApp, refused stubs)
  app/services/       OAuth, Gmail, calendar, ingestion, extraction, priority, today,
                        meeting prep, briefing, tasks, capture, waiting, notifications, execution
  app/workers/        Celery app + tasks (sync, briefings, notification scan) + beat schedule
  migrations/         Alembic
mobile/               React Native / Expo app (Expo Router, tab navigator)
  app/                Routes: (tabs)/{index,capture,waiting,settings}, connect, onboarding,
                        approvals, meeting/[id]
  src/                api client, screens, components, theme
packages/shared-types/  TypeScript types mirrored from backend schemas
docs/integrations/    Per-integration notes (stripe, whatsapp, REFUSED)
```

## Prerequisites

- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- [bun](https://bun.sh)
- Docker (for local Postgres + Redis)
- A Google Cloud OAuth client (Gmail + Calendar scopes)
- An Anthropic API key

## Setup

```bash
# 1. Infra
docker compose up -d

# 2. Secrets
cp .env.example .env       # fill in Google + Anthropic credentials
cp .env backend/.env       # backend reads its own .env

# 3. Backend
cd backend
uv sync
uv run alembic revision --autogenerate -m "initial schema"
uv run alembic upgrade head
uv run uvicorn app.main:app --reload

# 4. Worker (separate shell, for background sync)
uv run celery -A app.workers.celery_app worker --loglevel=info

# 5. Mobile (separate shell)
cd mobile
bun install
bun run start
```

The mobile app's API base URL is set in `mobile/app.json` under `extra.apiBaseUrl`.
For a device or simulator, point it at your machine's LAN IP, not `localhost`.

## The slice, end to end

1. **Connect.** The app calls `GET /api/v1/auth/google/start`, opens Google consent,
   and the backend redirects to `albert://auth?token=...` with an Albert session JWT.
2. **Sync.** `POST /api/v1/sync` ingests recent Gmail messages, classifies each, and
   extracts commitments with evidence and confidence.
3. **Today.** `GET /api/v1/today` ranks open commitments with a transparent, explainable
   priority engine and returns the dashboard.
4. **Draft.** `POST /api/v1/drafts` generates a reply (no approval needed; it is internal
   preparation).
5. **Approve.** `POST /api/v1/actions/propose-draft-to-gmail/{id}` then
   `POST /api/v1/actions/{id}/approve` pushes the draft into Gmail. Albert never sends.

## Verification

```bash
cd backend && uv run ruff check app tests && uv run mypy app && uv run pytest
cd ../packages/shared-types && bunx tsc --noEmit
cd ../../mobile && bunx tsc --noEmit
```

For local development without Google, mint a session in development mode:

```bash
curl -X POST "http://localhost:8000/api/v1/auth/dev-session?email=you@example.com"
```
