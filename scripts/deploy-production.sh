#!/usr/bin/env bash

# Deploy the API and the web app with blue/green containers and a graceful nginx reload.
# Modelled on the Athar deploy script, with the release steps from docs/architecture/operations.md:
# build first, back up the database, run migrations once as the migration role, then switch.
# Run as ubuntu on the server after scripts/setup-server.sh.

set -Eeuo pipefail

readonly DEPLOY_ROOT="/srv/athar-events"
readonly BACKEND_DIR="$DEPLOY_ROOT/backend"
readonly FRONTEND_DIR="$DEPLOY_ROOT/frontend"
readonly COMPOSE_FILE="docker-compose.bluegreen.yml"
readonly STATE_DIR="$DEPLOY_ROOT/.deployment"
readonly STATE_FILE="$STATE_DIR/active-slot"
readonly BACKUP_DIR="$DEPLOY_ROOT/backups"
readonly BACKUPS_KEPT=14
readonly NGINX_SITE="/etc/nginx/sites-available/athar-events"
readonly API_UPSTREAM="/etc/nginx/athar-events-upstreams/api.conf"
readonly WEB_UPSTREAM="/etc/nginx/athar-events-upstreams/web.conf"
readonly PUBLIC_URL="https://atharevents.sa"
readonly API_PUBLIC_URL="https://api.atharevents.sa/api"
readonly DATA_NETWORK="athar-events-network"
readonly DB_CONTAINER="athar-events-db"
readonly BLUE_API_PORT="4001"
readonly BLUE_WEB_PORT="3001"
readonly GREEN_API_PORT="4002"
readonly GREEN_WEB_PORT="3002"
readonly HEALTH_RETRIES=30
readonly HEALTH_RETRY_DELAY=2
readonly STARTUP_TIMEOUT=180
readonly DRAIN_SECONDS="$(printenv DRAIN_SECONDS 2>/dev/null || printf '30')"
readonly STOP_TIMEOUT="$(printenv STOP_TIMEOUT 2>/dev/null || printf '60')"
readonly BACKEND_DEPLOY_REF="$(printenv BACKEND_DEPLOY_REF 2>/dev/null || printf 'main')"
readonly FRONTEND_DEPLOY_REF="$(printenv FRONTEND_DEPLOY_REF 2>/dev/null || printf 'main')"

TARGET_SLOT=""
TARGET_STARTED=false
PROXY_SWITCHED=false

on_error() {
  local line="$1"

  if [[ "$TARGET_STARTED" == "true" && "$PROXY_SWITCHED" != "true" ]]; then
    echo "Deployment failed before traffic switched; removing $TARGET_SLOT containers." >&2
    remove_slot "$TARGET_SLOT" || true
  fi

  echo "Deployment stopped at line $line. Live traffic was not switched unless the slot was healthy." >&2
}
trap 'on_error "$LINENO"' ERR

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

validate_positive_integer() {
  local value="$1"
  local name="$2"

  [[ "$value" =~ ^[0-9]+$ ]] && (( value > 0 )) || {
    echo "$name must be a positive integer; received: $value" >&2
    exit 1
  }
}

ensure_clean_tracked_tree() {
  local service_dir="$1"
  local service_name="$2"

  if [[ -n "$(git -C "$service_dir" status --porcelain --untracked-files=no)" ]]; then
    echo "$service_name has tracked local changes. Resolve them before deploying:" >&2
    git -C "$service_dir" status --short >&2
    exit 1
  fi
}

update_repository() {
  local service_dir="$1"
  local service_name="$2"
  local deploy_ref="$3"

  echo "==> Updating $service_name to $deploy_ref"
  ensure_clean_tracked_tree "$service_dir" "$service_name"

  git -C "$service_dir" fetch --prune origin
  if [[ "$deploy_ref" == "main" ]]; then
    git -C "$service_dir" switch main
    git -C "$service_dir" pull --ff-only origin main
  else
    git -C "$service_dir" checkout --detach "$deploy_ref"
  fi

  git -C "$service_dir" log -1 --format="$service_name commit: %h %s"
}

container_exists() {
  docker container inspect "$1" >/dev/null 2>&1
}

wait_for_container_health() {
  local container_name="$1"
  local attempt
  local status

  for ((attempt = 1; attempt <= HEALTH_RETRIES; attempt += 1)); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_name" 2>/dev/null || true)"

    if [[ "$status" == "healthy" ]]; then
      return 0
    fi

    if [[ "$status" == "unhealthy" || "$status" == "missing" ]]; then
      break
    fi

    sleep "$HEALTH_RETRY_DELAY"
  done

  echo "$container_name did not become healthy; final status: $status" >&2
  return 1
}

wait_for_url() {
  local url="$1"
  local description="$2"
  local attempt

  echo "==> Checking $description"
  for ((attempt = 1; attempt <= HEALTH_RETRIES; attempt += 1)); do
    if curl --fail --silent --show-error --output /dev/null "$url"; then
      return 0
    fi

    sleep "$HEALTH_RETRY_DELAY"
  done

  echo "$description did not return a successful response: $url" >&2
  return 1
}

active_slot() {
  local slot

  [[ -f "$STATE_FILE" ]] || {
    echo "Deployment state is missing. Run scripts/setup-server.sh once first." >&2
    return 1
  }

  slot="$(tr -d '[:space:]' < "$STATE_FILE")"
  case "$slot" in
    none|blue|green)
      printf '%s' "$slot"
      ;;
    *)
      echo "Invalid active slot in $STATE_FILE: $slot" >&2
      return 1
      ;;
  esac
}

next_slot() {
  case "$1" in
    none|green) printf 'blue' ;;
    blue) printf 'green' ;;
  esac
}

api_port_for_slot() {
  case "$1" in
    blue) printf '%s' "$BLUE_API_PORT" ;;
    green) printf '%s' "$GREEN_API_PORT" ;;
  esac
}

web_port_for_slot() {
  case "$1" in
    blue) printf '%s' "$BLUE_WEB_PORT" ;;
    green) printf '%s' "$GREEN_WEB_PORT" ;;
  esac
}

stop_and_remove_container() {
  local container_name="$1"

  if ! container_exists "$container_name"; then
    return 0
  fi

  echo "==> Gracefully stopping $container_name"
  docker stop --time "$STOP_TIMEOUT" "$container_name"
  docker rm "$container_name" >/dev/null
}

remove_slot() {
  local slot="$1"

  [[ "$slot" == "none" ]] && return 0
  stop_and_remove_container "athar-events-web-$slot"
  stop_and_remove_container "athar-events-api-$slot"
  docker network rm "athar-events-${slot}_default" >/dev/null 2>&1 || true
}

slot_compose() {
  local slot="$1"
  shift

  (
    cd "$BACKEND_DIR"
    DEPLOY_SLOT="$slot" \
      API_BIND_PORT="$(api_port_for_slot "$slot")" \
      WEB_BIND_PORT="$(web_port_for_slot "$slot")" \
      docker compose --env-file .env \
        --project-name "athar-events-$slot" \
        -f "$COMPOSE_FILE" "$@"
  )
}

assert_prerequisites() {
  [[ -d "$BACKEND_DIR/.git" ]] || { echo "Backend repository not found: $BACKEND_DIR" >&2; exit 1; }
  [[ -d "$FRONTEND_DIR/.git" ]] || { echo "Frontend repository not found: $FRONTEND_DIR" >&2; exit 1; }
  [[ -f "$BACKEND_DIR/.env" ]] || { echo "Missing $BACKEND_DIR/.env" >&2; exit 1; }
  [[ -f "$BACKEND_DIR/.env.db" ]] || { echo "Missing $BACKEND_DIR/.env.db" >&2; exit 1; }
  [[ -f "$API_UPSTREAM" && -f "$WEB_UPSTREAM" ]] || {
    echo "nginx upstream files are missing. Run scripts/setup-server.sh once first." >&2
    exit 1
  }
  grep -Fq "Managed by Athar Events blue/green deployment." "$NGINX_SITE" || {
    echo "nginx is not using the Athar Events site. Run scripts/setup-server.sh once first." >&2
    exit 1
  }
  docker network inspect "$DATA_NETWORK" >/dev/null
  [[ "$(docker inspect -f '{{.State.Health.Status}}' "$DB_CONTAINER" 2>/dev/null)" == "healthy" ]] || {
    echo "$DB_CONTAINER is not healthy." >&2
    exit 1
  }
  sudo -n true || { echo "Passwordless sudo is required for the nginx switch." >&2; exit 1; }
  sudo nginx -t
}

backup_database() {
  local file

  file="$BACKUP_DIR/athar-events-$(date +%F-%H%M%S).dump"
  echo "==> Backing up the database to $file"
  install -d -m 0700 "$BACKUP_DIR"
  (
    umask 077
    docker exec "$DB_CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$file"
  )
  [[ -s "$file" ]] || { echo "Backup is empty: $file" >&2; return 1; }

  # Keep the newest BACKUPS_KEPT dumps on this host; off-host copies are a separate job.
  ls -1t "$BACKUP_DIR"/athar-events-*.dump | tail -n +"$((BACKUPS_KEPT + 1))" | xargs -r rm -f
}

run_migrations() {
  local slot="$1"

  echo "==> Running migrations with the $slot image"
  (
    cd "$BACKEND_DIR"
    docker run --rm --network "$DATA_NETWORK" \
      --env-file .env --env-file .env.db \
      "athar-events-api:$slot" node dist/database/run-migrations.js
  )
}

start_target_slot() {
  local slot="$1"

  echo "==> Starting $slot containers"
  TARGET_STARTED=true
  slot_compose "$slot" up -d --no-build --wait --wait-timeout "$STARTUP_TIMEOUT"

  wait_for_container_health "athar-events-api-$slot"
  wait_for_container_health "athar-events-web-$slot"
  wait_for_url "http://127.0.0.1:$(api_port_for_slot "$slot")/api/health" "$slot API health"
  wait_for_url "http://127.0.0.1:$(web_port_for_slot "$slot")/" "$slot web app"
}

restore_proxy_files() {
  local backup_dir="$1"

  sudo install -m 0644 "$backup_dir/api.conf" "$API_UPSTREAM"
  sudo install -m 0644 "$backup_dir/web.conf" "$WEB_UPSTREAM"
  sudo nginx -t
  sudo systemctl reload nginx
}

switch_proxy() {
  local slot="$1"
  local backup_dir
  local candidate_dir

  backup_dir="$(mktemp -d)"
  candidate_dir="$(mktemp -d)"
  sudo install -m 0644 "$API_UPSTREAM" "$backup_dir/api.conf"
  sudo install -m 0644 "$WEB_UPSTREAM" "$backup_dir/web.conf"
  printf 'server 127.0.0.1:%s;\n' "$(api_port_for_slot "$slot")" > "$candidate_dir/api.conf"
  printf 'server 127.0.0.1:%s;\n' "$(web_port_for_slot "$slot")" > "$candidate_dir/web.conf"

  sudo install -m 0644 "$candidate_dir/api.conf" "$API_UPSTREAM"
  sudo install -m 0644 "$candidate_dir/web.conf" "$WEB_UPSTREAM"

  if ! sudo nginx -t; then
    echo "Candidate nginx configuration is invalid; restoring previous upstreams." >&2
    restore_proxy_files "$backup_dir"
    return 1
  fi

  if ! sudo systemctl reload nginx; then
    echo "nginx reload failed; restoring previous upstreams." >&2
    restore_proxy_files "$backup_dir"
    return 1
  fi

  rm -rf "$backup_dir" "$candidate_dir"
  PROXY_SWITCHED=true
}

main() {
  local current_slot
  local target_slot

  require_command git
  require_command docker
  require_command curl
  require_command nginx
  require_command sudo

  validate_positive_integer "$DRAIN_SECONDS" DRAIN_SECONDS
  validate_positive_integer "$STOP_TIMEOUT" STOP_TIMEOUT
  assert_prerequisites

  current_slot="$(active_slot)"
  target_slot="$(next_slot "$current_slot")"
  TARGET_SLOT="$target_slot"

  update_repository "$BACKEND_DIR" backend "$BACKEND_DEPLOY_REF"
  update_repository "$FRONTEND_DIR" frontend "$FRONTEND_DEPLOY_REF"

  # Build before touching anything: a failed build leaves the live slot and database as they are.
  echo "==> Building $target_slot images"
  remove_slot "$target_slot"
  slot_compose "$target_slot" build

  backup_database
  # Migrations must stay compatible with the live slot (expand -> migrate -> contract).
  run_migrations "$target_slot"

  start_target_slot "$target_slot"

  echo "==> Switching nginx to $target_slot"
  switch_proxy "$target_slot"
  wait_for_url "$API_PUBLIC_URL/health" "public API health"
  wait_for_url "$PUBLIC_URL/api/health" "same-origin API path"
  wait_for_url "$PUBLIC_URL/" "public web app"

  install -d -m 0755 "$STATE_DIR"
  printf '%s\n' "$target_slot" > "$STATE_FILE"

  if [[ "$current_slot" != "none" ]]; then
    echo "==> Draining $current_slot for $DRAIN_SECONDS seconds"
    sleep "$DRAIN_SECONDS"
    remove_slot "$current_slot"
  fi

  echo "==> Deployment completed: $target_slot is live"
  docker ps --filter name=athar-events --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
}

main "$@"
