# Deploy plan: Albert → Hetzner (systemd + uv, Cloudflare Tunnel)

REWRITTEN after inspecting the real box (89.167.84.193, root, Ubuntu 24.04). The earlier
Docker plan does NOT fit: no Docker, apps run as systemd, edge is Cloudflare Tunnel, and
:8000 is taken. The Docker artifacts (backend/Dockerfile, docker-compose.prod.yml) are
KEPT in-repo for a future Docker host but are UNUSED here.

## Verified box facts
- Ubuntu 24.04, root. Python 3.12.3. **No Docker.** RAM 3.7G (~1.7G free). Disk 24G free.
- Running: `alfred-wecom` (python, :8000), `paperclip` (node), a node app :8081,
  `cloudflared-alfred` (the public edge).
- **Cloudflare Tunnel** `fca23ba2-...` ingress (/etc/cloudflared/config.yml):
  alfred.→:8081, wecom.→:8000, then http_status:404. Albert ADDS a rule before the 404.
- :8100 is FREE → Albert web there. No Postgres/Redis/uv installed yet.

## Steps (all [C] over SSH unless noted)
1. **Install runtime**: `apt-get install -y postgresql redis-server`; install uv
   (`curl -LsSf https://astral.sh/uv/install.sh | sh`). Enable+start postgres, redis.
2. **DB**: create role `albert` + db `albert` (postgres); `CREATE EXTENSION vector` needs
   pgvector — `apt-get install -y postgresql-16-pgvector` then create the extension.
3. **Code**: clone repo to /root/albert, `uv sync` in backend.
4. **Secrets**: write /root/albert/backend/.env from .env.production.example with real
   values. **[A]** provides: GOOGLE_CLIENT_ID/SECRET, ANTHROPIC_API_KEY. **[C]** generates
   JWT_SECRET (>=32B) + TOKEN_ENCRYPTION_KEY (Fernet) + DB password. APP_BASE_URL +
   redirect = https://albert.alfredassistants.com. ENVIRONMENT=production. DATABASE_URL
   → local postgres, REDIS_URL → local redis (own db index, e.g. /3).
5. **Migrate**: `uv run alembic upgrade head`.
6. **systemd units**: albert-web (uvicorn :8100), albert-worker (celery), albert-beat.
   User=root, WorkingDirectory=/root/albert/backend, EnvironmentFile=.env. Enable+start.
7. **Cloudflare route**: add ingress `albert.alfredassistants.com → http://localhost:8100`
   to /etc/cloudflared/config.yml (BEFORE the 404 rule); `cloudflared tunnel route dns
   alfred albert.alfredassistants.com`; restart cloudflared-alfred. (Backup config first.)
8. **[A] Google Console**: add redirect
   https://albert.alfredassistants.com/api/v1/auth/google/callback; the calendar.events
   scope means everyone re-consents; add friends as test users.
9. **App → prod**: app.json apiBaseUrl = https://albert.alfredassistants.com. EAS Update
   (needs **[A]** Expo login) so the app survives the laptop too. Until EAS, the app still
   loads via the Mac tunnel but talks to the prod backend.
10. **Verify** from outside: /health 200, /assistant/ask 401, a real sign-in + booking.

## Blockers needing [A]
- Google client id/secret + Anthropic key for the prod .env (or confirm I copy from a
  source you point to — I will not read your local .env without you saying so).
- Google Console redirect + test users + re-consent.
- Expo login for EAS (step 9) — optional for a first cut (Mac tunnel serves JS meanwhile).

## Safety
- Back up /etc/cloudflared/config.yml before editing (there's already a .bak from May 18).
- Albert uses its own DB, redis index, port, and systemd units — never touches alfred-wecom
  or paperclip. `systemctl stop albert-*` fully removes it.
