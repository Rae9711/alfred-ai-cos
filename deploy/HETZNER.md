# Albert on Hetzner (Docker Compose + Caddy)

The live production deploy. Albert runs on **its own Hetzner VPS** — hostname
`alfred-ai`, domain **`alfredaitech.com`** (`5.161.58.191`) — as a Docker Compose
stack behind Caddy. This is the canonical operational doc; `deploy/HETZNER-OWN.md`
covers provisioning a VPS from scratch with the same architecture.

> **DR reminder:** the single most important secret is **`TOKEN_ENCRYPTION_KEY`**
> in the live `/opt/albert/repo/.env`. It encrypts every user's Google OAuth tokens
> (Fernet / MultiFernet). If it is lost, all stored tokens are unrecoverable even
> after a perfect DB restore — back it up **offsite, separate from DB backups**.
> See `deploy/DR-RUNBOOK.md`.

## Layout on the box

- Server: `alfredaitech.com` / `5.161.58.191` (hostname `alfred-ai`), `ssh root@alfredaitech.com` (port 22).
- Code: `/opt/albert/repo` (this repo), deployed via `docker-compose.prod.yml`, project `albert`.
- Secrets: `/opt/albert/repo/.env` (mode 600, root). `ENVIRONMENT=production`. Preserved across deploys.
- Runtime: Docker Compose — services `albert_web`, `albert_worker`, `albert_beat`,
  plus `albert_postgres` (`pgvector/pgvector:pg16`, data volume `albert_pgdata`) and `albert_redis`.
- Web: `albert_web` listens on `127.0.0.1:8011` (loopback only).
- Edge: **Caddy** (`/etc/caddy/Caddyfile`): `alfredaitech.com { reverse_proxy 127.0.0.1:8011 }`,
  auto-TLS via Let's Encrypt.

> Not this box: there is **no** systemd `albert-*` unit, no `/root/albert`, and
> cloudflared is inactive. The old shared-box / Cloudflare-Tunnel setup is dead.

## Services

```
# status / logs (run on the box, or via ssh)
docker compose -p albert -f /opt/albert/repo/docker-compose.prod.yml ps
docker compose -p albert -f /opt/albert/repo/docker-compose.prod.yml logs --tail 50 albert_web

# restart after a manual change
docker compose -p albert -f /opt/albert/repo/docker-compose.prod.yml restart albert_web albert_worker albert_beat
```

## Redeploy (push new code)

From a laptop with the repo (SSH key already trusted by the box):

```
export HETZNER_HOST=root@alfredaitech.com
./deploy/hetzner-ship.sh
```

`hetzner-ship.sh` git-archives `master`, rsyncs/extracts into `/opt/albert/repo`
(preserving the live `.env`), then runs `ALBERT_TAG=<sha> ./deploy/albert-deploy.sh`
on the box, which does `docker compose build && up -d`, waits for Postgres to be
healthy, and runs `alembic upgrade head`.

## Rollback

Redeploy a previous known-good git sha (images are tagged per-sha, never `:latest`):

```
# on the box, in /opt/albert/repo
ALBERT_TAG=<old-sha> ./deploy/albert-deploy.sh
```

## Backups

`deploy/albert-backup.sh` runs nightly (root crontab, 03:00) and writes
`/opt/albert/backups/albert-*.sql.gz`, keeping 7 days. `deploy/albert-restore-drill.sh`
verifies the latest backup restores. Full recovery procedure: `deploy/DR-RUNBOOK.md`.

## Remaining steps for full sign-in

1. Google Console → Credentials → add Authorized redirect URI:
   `https://alfredaitech.com/api/v1/auth/google/callback`
   (must also be set as `GOOGLE_OAUTH_REDIRECT_URI` in the live `/opt/albert/repo/.env`).
2. OAuth consent screen → Test users: add each friend's Gmail.
3. The calendar.events scope means everyone re-consents on next sign-in (new prompt).
4. App durability: `cd mobile && eas update --branch preview` (needs an Expo login) so the
   app loads without the Mac. `mobile/app.json` `extra.apiBaseUrl` already points at
   `https://alfredaitech.com`.

## Verify

```
curl -sS https://alfredaitech.com/health          # expect {"status":"ok"} / 200 JSON
docker compose -p albert -f /opt/albert/repo/docker-compose.prod.yml ps
```
