# Albert on Hetzner (systemd + uv + Cloudflare Tunnel)

> **Own VPS?** If you are provisioning a **new** Hetzner server you control, use
> **[HETZNER-OWN.md](./HETZNER-OWN.md)** (Docker Compose + Caddy) instead of this doc.

The live production deploy. Albert runs as three systemd services on the shared box
(89.167.84.193), alongside Alfred + Paperclip, behind the existing Cloudflare Tunnel.
No Docker (the box doesn't use it). Public at **https://albert.alfredassistants.com**.

## Layout on the box

- Code: `/root/albert` (backend at `/root/albert/backend`), deps via `uv sync`.
- Secrets: `/root/albert/backend/.env` (mode 600, root). `ENVIRONMENT=production`.
- DB: local Postgres, role+db `albert`, `vector` extension. Redis db index `/3`.
- Web: uvicorn on `127.0.0.1:8100` (8000 is alfred-wecom; 8081 is alfred).
- Edge: Cloudflare Tunnel `fca23ba2-…`, ingress rule `albert.alfredassistants.com →
localhost:8100` (added before the 404 catch-all in `/root/.cloudflared/config.yml`).

## Services

```
systemctl status  albert-web albert-worker albert-beat
systemctl restart albert-web            # after a code change
journalctl -u albert-web -n 50 --no-pager
```

## Redeploy (push new code)

From a laptop with the repo (no creds on the box — ship a clean archive):

```
git archive --format=tar.gz -o /tmp/albert-src.tar.gz master
scp /tmp/albert-src.tar.gz root@89.167.84.193:/tmp/
ssh root@89.167.84.193 'set -e
  cd /root/albert && find . -mindepth 1 -maxdepth 1 ! -name backend -exec rm -rf {} + 2>/dev/null || true
  tar -xzf /tmp/albert-src.tar.gz -C /root/albert
  cd backend && /root/.local/bin/uv sync --no-dev
  /root/.local/bin/uv run alembic upgrade head
  systemctl restart albert-web albert-worker albert-beat'
```

(The `.env` is preserved — the archive has no .env, it's gitignored.)

## Backups

Nightly pg_dump (add to root crontab):

```
0 3 * * * sudo -u postgres pg_dump albert | gzip > /root/albert-backups/albert-$(date +\%F).sql.gz && find /root/albert-backups -name 'albert-*.sql.gz' -mtime +7 -delete
```

## Remaining [Adam] steps for full sign-in

1. Google Console → Credentials → add Authorized redirect URI:
   `https://albert.alfredassistants.com/api/v1/auth/google/callback`
2. OAuth consent screen → Test users: add each friend's Gmail.
3. The calendar.events scope means everyone re-consents on next sign-in (new prompt).
4. App durability: `eas update` (needs an Expo login) so the app loads without the Mac.
   Until then the app loads via the Mac's Metro tunnel but talks to this prod backend.

## Safety / rollback

- cloudflared config backed up to `config.yml.bak.*` before editing.
- Albert is fully isolated: own db, redis index, port, systemd units. To remove:
  `systemctl disable --now albert-web albert-worker albert-beat` + drop the ingress rule.
- The Docker artifacts (backend/Dockerfile, docker-compose.prod.yml) are kept for a future
  Docker host but are NOT used in this deploy.
