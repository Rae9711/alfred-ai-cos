#!/usr/bin/env bash
# One-time bootstrap for a fresh Ubuntu 24.04 Hetzner VPS.
# Installs Docker, Docker Compose plugin, Caddy, and prepares /opt/albert.
#
# Run as root on the server:
#   bash deploy/hetzner-bootstrap.sh
#
# After this: configure Caddy (Caddyfile.example), .env, then albert-deploy.sh.
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root (e.g. ssh root@your-server)" >&2
  exit 1
fi

echo "→ apt update + base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg ufw

echo "→ Docker (official repo)"
install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

echo "→ Caddy (reverse proxy + HTTPS)"
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
if [[ ! -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]]; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
fi
apt-get install -y caddy

echo "→ firewall (SSH + HTTP/S)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "→ directories"
mkdir -p /opt/albert/backups
chmod 700 /opt/albert

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -d "$REPO_ROOT/backend" ]]; then
  echo "→ repo already at $REPO_ROOT"
else
  echo "⚠ clone the repo to /opt/albert/repo before deploying:"
  echo "    git clone https://github.com/Rae9711/alfred-ai-cos.git /opt/albert/repo"
fi

echo ""
echo "✓ bootstrap done"
echo ""
echo "Next steps:"
echo "  1. DNS A record → this server's public IP"
echo "  2. cp deploy/Caddyfile.example /etc/caddy/Caddyfile  (set your domain)"
echo "  3. systemctl reload caddy"
echo "  4. cp .env.production.example .env && fill secrets"
echo "  5. ./deploy/albert-deploy.sh"
