#!/usr/bin/env bash
# Albert deploy / redeploy on the Hetzner VPS. Idempotent: pull, build a git-sha-tagged
# image, bring the stack up, run migrations once the DB is healthy. Run from the repo
# root on the server. Requires /opt/albert/.env (or a .env beside the compose file).
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -p albert -f docker-compose.prod.yml"

# Tag images by git sha so a rollback is just ALBERT_TAG=<old-sha> ./albert-deploy.sh.
# hetzner-ship.sh passes ALBERT_TAG; on a git clone we derive it and pull latest.
if [[ -z "${ALBERT_TAG:-}" ]]; then
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    export ALBERT_TAG="$(git rev-parse --short HEAD)"
  else
    export ALBERT_TAG="archive-$(date -u +%Y%m%d%H%M%S)"
  fi
fi
echo "→ deploying albert @ ${ALBERT_TAG}"

if [[ -d .git ]]; then
  git pull --ff-only
fi
$COMPOSE build
$COMPOSE up -d

# Wait for Postgres to report healthy before migrating.
echo "→ waiting for albert_postgres to be healthy…"
until [ "$(docker inspect -f '{{.State.Health.Status}}' albert_postgres 2>/dev/null)" = "healthy" ]; do
  sleep 2
done

echo "→ running migrations (alembic upgrade head)"
# `run --rm` uses a one-off container, so migrations don't depend on albert_web already
# being up/healthy (it may still be starting, or crash-looping on a stale schema).
$COMPOSE run --rm --no-deps albert_web alembic upgrade head

echo "✓ albert @ ${ALBERT_TAG} is live on 127.0.0.1:${ALBERT_WEB_PORT:-8011} (behind Caddy)"
$COMPOSE ps
