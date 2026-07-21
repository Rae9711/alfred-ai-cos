#!/usr/bin/env bash
# Weekly restore drill for Albert's Postgres backups. A backup you have never restored
# is not a backup — this proves the latest dump actually loads and contains real data.
#
# It restores the newest albert-*.sql.gz into a THROWAWAY Postgres container (never the
# live DB), asserts the users table is non-empty, then tears the container down. Exits
# non-zero on any failure so a cron wrapper / alert can catch a broken backup.
#
# Install on the VPS via cron (after the nightly backup):
#   30 3 * * 0 /opt/albert/repo/deploy/albert-restore-drill.sh >> /var/log/albert-restore-drill.log 2>&1
set -euo pipefail

BACKUP_DIR="${ALBERT_BACKUP_DIR:-/opt/albert/backups}"
PG_IMAGE="${ALBERT_PG_IMAGE:-pgvector/pgvector:pg16}"
DB_USER="${POSTGRES_USER:-albert}"
DB_NAME="${POSTGRES_DB:-albert}"
CONTAINER="albert_restore_drill_$$"
PASSWORD="drill"

log() { echo "[$(date +%H:%M:%S)] $*"; }

# Find the newest backup.
LATEST="$(ls -1t "$BACKUP_DIR"/albert-*.sql.gz 2>/dev/null | head -n1 || true)"
if [[ -z "$LATEST" ]]; then
  echo "✗ no backups found in $BACKUP_DIR" >&2
  exit 1
fi
log "→ restoring latest backup: $LATEST"

# Always clean up the throwaway container, even on failure.
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Start a disposable Postgres. No published port — we exec into it directly.
log "→ starting throwaway Postgres ($PG_IMAGE)"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_PASSWORD="$PASSWORD" \
  -e POSTGRES_DB="$DB_NAME" \
  "$PG_IMAGE" >/dev/null

# Wait for readiness.
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U "$DB_USER" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker exec "$CONTAINER" pg_isready -U "$DB_USER" >/dev/null 2>&1; then
  echo "✗ throwaway Postgres never became ready" >&2
  exit 1
fi

# Restore the dump.
log "→ loading dump"
gunzip -c "$LATEST" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" >/dev/null

# Assert the users table has rows.
COUNT="$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc 'select count(*) from users' | tr -d '[:space:]')"
log "→ users row count: ${COUNT:-<none>}"
if [[ -z "$COUNT" || "$COUNT" -le 0 ]]; then
  echo "✗ restore drill FAILED: users table empty or missing" >&2
  exit 1
fi

log "✓ restore drill passed (users=$COUNT from $(basename "$LATEST"))"
