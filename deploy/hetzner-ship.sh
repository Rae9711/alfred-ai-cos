#!/usr/bin/env bash
# Ship the current git tree to your own Hetzner VPS and redeploy.
#
# Usage (from repo root on your laptop):
#   export HETZNER_HOST=root@YOUR_SERVER_IP
#   ./deploy/hetzner-ship.sh
#
# Requires: ssh/scp access, Docker already installed on the server (hetzner-bootstrap.sh).
# Preserves /opt/albert/repo/.env on the server.
set -euo pipefail

: "${HETZNER_HOST:?Set HETZNER_HOST=root@your-server-ip}"

REMOTE_DIR="${HETZNER_REMOTE_DIR:-/opt/albert/repo}"
ARCHIVE="/tmp/albert-src-$$.tar.gz"
BRANCH="${HETZNER_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
LOCAL_SHA="$(git rev-parse --short HEAD)"

cd "$(dirname "$0")/.."

echo "→ archive ${BRANCH} @ ${LOCAL_SHA}"
git archive --format=tar.gz -o "$ARCHIVE" "$BRANCH"

echo "→ ensure remote dir"
ssh "$HETZNER_HOST" "mkdir -p '$REMOTE_DIR'"

echo "→ upload"
scp "$ARCHIVE" "$HETZNER_HOST:/tmp/albert-src.tar.gz"
rm -f "$ARCHIVE"

echo "→ extract + deploy on server"
ssh "$HETZNER_HOST" "set -euo pipefail
  cd '$REMOTE_DIR'
  # Keep .env outside the archive (gitignored).
  if [[ -f .env ]]; then cp .env /tmp/albert-env-backup; fi
  find . -mindepth 1 -maxdepth 1 ! -name .env -exec rm -rf {} + 2>/dev/null || true
  tar -xzf /tmp/albert-src.tar.gz -C '$REMOTE_DIR'
  rm -f /tmp/albert-src.tar.gz
  if [[ -f /tmp/albert-env-backup ]]; then mv /tmp/albert-env-backup .env; fi
  if [[ ! -f .env ]]; then
    echo 'ERROR: no .env on server — copy .env.production.example to .env first' >&2
    exit 1
  fi
  chmod 600 .env
  ALBERT_TAG='${LOCAL_SHA}' ./deploy/albert-deploy.sh
"

echo "✓ deployed to $HETZNER_HOST"
