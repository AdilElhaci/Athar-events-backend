#!/usr/bin/env bash

# One-time setup of a fresh Athar Events server (DEPLOYMENT.md, "First-time setup").
# Run as ubuntu after: packages installed, both repositories cloned, .env and .env.db
# written, and the TLS certificate issued. Starts PostgreSQL and Redis, installs the
# blue/green nginx site and records that no slot is live yet.

set -Eeuo pipefail

readonly DEPLOY_ROOT="/srv/athar-events"
readonly BACKEND_DIR="$DEPLOY_ROOT/backend"
readonly FRONTEND_DIR="$DEPLOY_ROOT/frontend"
readonly TEMPLATE="$BACKEND_DIR/deploy/nginx/athar-events.conf"
readonly NGINX_SITE="/etc/nginx/sites-available/athar-events"
readonly NGINX_ENABLED="/etc/nginx/sites-enabled/athar-events"
readonly UPSTREAM_DIR="/etc/nginx/athar-events-upstreams"
readonly CERT_DIR="/etc/letsencrypt/live/atharevents.sa"
readonly STATE_DIR="$DEPLOY_ROOT/.deployment"
readonly STATE_FILE="$STATE_DIR/active-slot"
readonly BACKUP_DIR="$DEPLOY_ROOT/backups"
# Blue ports; the site answers 502 until the first deployment starts a slot.
readonly BLUE_API_PORT="4001"
readonly BLUE_WEB_PORT="3001"

trap 'echo "Setup stopped at line $LINENO." >&2' ERR

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_private_file() {
  local file="$1"

  [[ -f "$file" ]] || { echo "Missing $file" >&2; exit 1; }
  [[ "$(stat -c '%a' "$file")" == "600" ]] || {
    echo "$file must be mode 600: chmod 600 $file" >&2
    exit 1
  }
}

main() {
  require_command docker
  require_command nginx
  require_command sudo
  require_command git

  sudo -n true || { echo "Passwordless sudo is required." >&2; exit 1; }
  [[ -d "$BACKEND_DIR/.git" ]] || { echo "Backend repository not found: $BACKEND_DIR" >&2; exit 1; }
  [[ -d "$FRONTEND_DIR/.git" ]] || { echo "Frontend repository not found: $FRONTEND_DIR" >&2; exit 1; }
  require_private_file "$BACKEND_DIR/.env"
  require_private_file "$BACKEND_DIR/.env.db"
  sudo test -f "$CERT_DIR/fullchain.pem" || {
    echo "TLS certificate missing in $CERT_DIR. Issue it first (DEPLOYMENT.md)." >&2
    exit 1
  }

  if [[ -f "$STATE_FILE" ]]; then
    echo "This server is already set up (state: $(cat "$STATE_FILE"))." >&2
    exit 1
  fi

  echo "==> Starting PostgreSQL and Redis"
  (
    cd "$BACKEND_DIR"
    docker compose --env-file .env --env-file .env.db \
      -f docker-compose.prod.yml up -d --wait --wait-timeout 120
  )

  echo "==> Installing the nginx site"
  sudo install -d -m 0755 "$UPSTREAM_DIR"
  printf 'server 127.0.0.1:%s;\n' "$BLUE_API_PORT" | sudo tee "$UPSTREAM_DIR/api.conf" >/dev/null
  printf 'server 127.0.0.1:%s;\n' "$BLUE_WEB_PORT" | sudo tee "$UPSTREAM_DIR/web.conf" >/dev/null
  sudo install -m 0644 "$TEMPLATE" "$NGINX_SITE"
  sudo ln -sfn "$NGINX_SITE" "$NGINX_ENABLED"
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t
  sudo systemctl reload nginx

  install -d -m 0755 "$STATE_DIR"
  install -d -m 0700 "$BACKUP_DIR"
  printf 'none\n' > "$STATE_FILE"

  echo "==> Setup complete. Run scripts/deploy-production.sh for the first release."
}

main "$@"
