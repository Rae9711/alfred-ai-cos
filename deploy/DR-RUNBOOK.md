# Albert — Disaster Recovery Runbook

Operational guide for recovering Albert after a host loss, data-corruption event, or a
bad deploy. Keep a copy off the production host (it references the very secrets whose
loss would block recovery).

**Production setup:** own Hetzner VPS `alfredaitech.com` (`5.161.58.191`, hostname
`alfred-ai`), Docker Compose (project `albert`, `docker-compose.prod.yml`) at
`/opt/albert/repo`, behind Caddy (`alfredaitech.com` → `127.0.0.1:8011`). Postgres runs
in-compose as `albert_postgres` (`pgvector/pgvector:pg16`, data volume `albert_pgdata`).

---

## 1. Triggers & severity

| Severity | Trigger | Target response |
| --- | --- | --- |
| **SEV-1** | Host down / unreachable; total data loss; DB corruption | Immediate full recovery (this runbook end-to-end) |
| **SEV-2** | Bad deploy, app crash-looping, migration failure | Rollback (§6) — no data restore needed |
| **SEV-3** | Degraded (Gmail sync failing, Sentry error spike) | Investigate; usually no DR action |

Declare SEV-1 if the Caddy health check (`https://alfredaitech.com/health`) has been
failing for >10 min and a restart does not recover it.

## 2. Contacts & access

- **On-call / owner:** _<fill in: name, phone, email>_
- **Hosting:** Hetzner Cloud console — _<account/login location>_
- **DNS:** _<registrar / Cloudflare account>_
- **Secrets vault (offsite):** _<where `TOKEN_ENCRYPTION_KEY`, `.env`, backups live>_
- **SSH:** `ssh root@alfredaitech.com` (`5.161.58.191`, key in _<location>_). Bootstrap key
  is in the Hetzner project; see `deploy/hetzner-cloud-init.yaml`.

## 3. What must exist to recover

You cannot recover without **all three**:

1. The latest **Postgres backup** (`albert-*.sql.gz`, from `deploy/albert-backup.sh`).
2. The **`/opt/albert/repo/.env`** file — specifically `TOKEN_ENCRYPTION_KEY`.
3. A pinned **image tag** (git sha) known to be healthy.

> [!CAUTION]
> **`TOKEN_ENCRYPTION_KEY` is the single most important secret.** Every user's Google
> OAuth tokens are encrypted at rest with it (Fernet / MultiFernet — see
> `app.services.crypto`). **If it is lost, every stored token is unrecoverable** and all
> users must re-connect their mailboxes from scratch, even after a perfect DB restore.
> Back it up **offsite, separately from the database backups** (a DB backup does not
> contain it). During a key rotation, keep the previous key in
> `TOKEN_ENCRYPTION_KEY_PREVIOUS` until every token has re-encrypted.

## 4. Recovery steps (SEV-1, full rebuild)

1. **Provision a host.** Recreate the VPS from `deploy/hetzner-cloud-init.yaml` (or run
   `deploy/hetzner-bootstrap.sh` on a fresh Ubuntu box). This installs Docker + Caddy and
   creates `/opt/albert`.
2. **Restore secrets.** Copy the offsite `.env` to `/opt/albert/repo/.env`. Confirm
   `TOKEN_ENCRYPTION_KEY` matches the value in effect when the backup was taken (a
   mismatch bricks all encrypted tokens — see §3). Verify DB creds match `DATABASE_URL`.
3. **Get the code.** Clone the repo to `/opt/albert/repo` (or restore it) and `cd` in.
4. **Restore the database.**
   ```bash
   # Bring up just Postgres first so the schema target exists.
   docker compose -p albert -f docker-compose.prod.yml up -d albert_postgres
   # Load the newest backup into it.
   LATEST=$(ls -1t /opt/albert/backups/albert-*.sql.gz | head -n1)
   gunzip -c "$LATEST" | docker exec -i albert_postgres psql -U albert -d albert
   ```
5. **Bring up the stack on a pinned, known-good tag.**
   ```bash
   ALBERT_TAG=<known-good-sha> docker compose -p albert -f docker-compose.prod.yml up -d
   ```
   (`deploy/albert-deploy.sh` wraps this and waits for Postgres health before migrating.)
6. **Apply migrations** (safe/idempotent):
   ```bash
   docker compose -p albert -f docker-compose.prod.yml run --rm --no-deps albert_web alembic upgrade head
   ```
7. **Point DNS** at the new host IP if it changed; wait for propagation + Caddy to issue
   the TLS cert.

## 5. Verification checklist

- [ ] `curl -fsS https://alfredaitech.com/health` returns `{"status":"ok"}`.
- [ ] `docker compose -p albert -f docker-compose.prod.yml ps` — all services healthy.
- [ ] `select count(*) from users;` > 0 (the restore drill, §8, automates this).
- [ ] A test user can sign in and their inbox loads (tokens decrypt → key is correct).
- [ ] Celery worker + beat are running (`/metrics` on the worker exposes queue depth).
- [ ] Sentry receiving events (if `SENTRY_DSN` set); no crash loop in logs.

## 6. Rollback (SEV-2, bad deploy)

No data restore needed — just redeploy the previous image tag:

```bash
ALBERT_TAG=<previous-good-sha> ./deploy/albert-deploy.sh
```

If a **migration** is the culprit, roll the app back first, then downgrade only if the
migration is safely reversible:

```bash
docker compose -p albert -f docker-compose.prod.yml run --rm --no-deps albert_web alembic downgrade -1
```

Prefer rolling forward with a fix over downgrading a destructive migration.

## 7. RPO / RTO

- **RPO (max data loss):** ≤ 24h — backups run nightly (`albert-backup.sh`, 03:00). To
  tighten, increase backup frequency and ship dumps offsite immediately.
- **RTO (time to recover):** ~1–2h for a full SEV-1 rebuild assuming host provisioning,
  a valid backup, and the `.env`/`TOKEN_ENCRYPTION_KEY` on hand. SEV-2 rollback: minutes.

## 8. Backup health

`deploy/albert-restore-drill.sh` restores the latest backup into a throwaway container
weekly and asserts `users` is non-empty. A failing drill is an early warning that a real
recovery would fail — treat a non-zero exit as SEV-2.

## 9. Postmortem template

```
# Incident: <short title> — <date>
- Severity:
- Detected: <how / when>  |  Resolved: <when>  |  Duration:
- User impact:
- Timeline (UTC):
- Root cause:
- Data loss (vs RPO):  |  Recovery time (vs RTO):
- What went well:
- What didn't:
- Action items (owner, due date):
```
