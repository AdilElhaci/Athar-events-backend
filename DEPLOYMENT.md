# Athar Events production deployment runbook

Production runs on a dedicated OVH VPS at `149.56.209.111` and serves `https://atharevents.sa` (web app) and `https://api.atharevents.sa` (API). The approach follows the Athar runbook (Docker Compose, nginx blue/green, `git push` then `./scripts/deploy-production.sh` on the server), with the corrections from [operations.md](docs/architecture/operations.md): migrations run once per release as a separate role, the database is backed up before every release, and the API never holds the migration credentials.

> Never paste `.env` or `.env.db` into tickets, chat, git or shell history. Both are mode `0600` on the server. Do not run `docker compose config` in a shared terminal: it prints the expanded secrets.

## Topology

```text
https://api.atharevents.sa ─► nginx :443 ─── /api/* ─► 127.0.0.1:4001|4002 ─► athar-events-api-<slot>  (NestJS)
https://atharevents.sa ─────► nginx :443 ─┬─ /api/* ─► (same API upstream)
                                          └─ /*     ─► 127.0.0.1:3001|3002 ─► athar-events-web-<slot>  (Next.js)
                                                                              athar-events-db     (PostgreSQL 18)
                                                                              athar-events-redis  (Redis 8)
```

`api.atharevents.sa` is the public API address: provider webhooks (Moyasar, Meta), health checks and integrations use it. The web app's browser code keeps calling `https://atharevents.sa/api` (same origin), so the HttpOnly refresh cookie stays first-party and the auth model of [ADR-0006](docs/adr/0006-auth-session-model.md) is unchanged. Both paths reach the same API containers.

| Item | Value |
| --- | --- |
| Server | `ubuntu@149.56.209.111` (OVH, registered in Montreal, Canada) |
| Web | `https://atharevents.sa`; `www` and `http` redirect to it |
| API | `https://api.atharevents.sa/api` (health: `/api/health`) |
| Repositories | `/srv/athar-events/backend`, `/srv/athar-events/frontend` (branch `main`) |
| Secrets | `/srv/athar-events/backend/.env` (runtime) and `.env.db` (database administration), mode `0600` |
| Slots | `blue`: API `4001`, web `3001` · `green`: API `4002`, web `3002`; all bound to `127.0.0.1` |
| Data | `athar-events-db` and `athar-events-redis` on the `athar-events-network` Docker network; no host ports |
| State | `/srv/athar-events/.deployment/active-slot` (`none`, `blue` or `green`) |
| Backups | `/srv/athar-events/backups`, newest 14 kept; off-host copy not set up yet |
| Firewall | UFW: only 22, 80, 443 inbound |

Database roles (created on first start by `deploy/postgres/init-roles.sh`):

| Role | Can | Used by |
| --- | --- | --- |
| `athar_events_admin` | Superuser | Backups (`pg_dump`) and maintenance only |
| `athar_events_migrator` | Owns the `public` schema | `dist/database/run-migrations.js`, once per release |
| `athar_events_app` | Read and write rows; cannot change the schema | The API |

`.env` holds the application role; `.env.db` holds the superuser and migration role and is only given to the data stack and the migration step.

## Routine deployment

1. Merge to `main` in both repositories and push.
2. On the server:

```bash
ssh ubuntu@149.56.209.111
cd /srv/athar-events/backend
./scripts/deploy-production.sh
```

The script:

1. Checks the tools, nginx site, data network, database health, passwordless sudo and both repositories; stops if either repository has tracked local changes.
2. Pulls `main` in both repositories (fast-forward only).
3. Builds the API and web images for the idle slot. A failed build changes nothing.
4. Backs up the database (`pg_dump -Fc`).
5. Runs pending migrations once with the new image as `athar_events_migrator`. Migrations must work with the code still live (expand, migrate, contract across releases).
6. Starts the idle slot and waits for Docker health checks and loopback checks.
7. Switches the nginx upstream files, validates nginx and reloads gracefully; then checks `https://api.atharevents.sa/api/health`, `https://atharevents.sa/api/health` and `https://atharevents.sa/`.
8. Records the new slot, waits 30 s for in-flight requests, and stops the old slot.

Before the switch, a failed slot is removed and the old slot keeps serving. After the switch, a failed public check leaves the new slot live for investigation.

Longer drain: `DRAIN_SECONDS=120 STOP_TIMEOUT=120 ./scripts/deploy-production.sh`.

## Rollback

Deploy known-good commits through the same script:

```bash
cd /srv/athar-events/backend
BACKEND_DEPLOY_REF=<GOOD_BACKEND_SHA> FRONTEND_DEPLOY_REF=<GOOD_FRONTEND_SHA> ./scripts/deploy-production.sh
```

Then run the script without the variables to return to `main`. Rolling back code does not roll back the database: a migration that the old code cannot run with needs a forward fix, or a restore (below).

## First-time setup

Done once on the empty server, in this order.

### 1. DNS

At the domain's DNS provider (name servers `ns10/ns11.hawsabah.com.sa`):

| Type | Host | Value |
| --- | --- | --- |
| `A` | `@` | `149.56.209.111` |
| `A` | `www` | `149.56.209.111` |
| `A` | `api` | `149.56.209.111` |

Check: `dig +short atharevents.sa`, `dig +short www.atharevents.sa` and `dig +short api.atharevents.sa` all print `149.56.209.111`.

### 2. Packages, Docker and firewall

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git nginx certbot python3-certbot-nginx ufw fail2ban unattended-upgrades

# Docker Engine + Compose plugin (Docker's official apt repository)
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo systemctl enable --now docker nginx fail2ban
```

Log out and back in (docker group), then check `docker compose version` and `sudo ufw status verbose`.

Once your SSH key works, allow keys only. Keep the current session open while testing; recovery is the OVH KVM console (local password login), then remove the file and reload `ssh`:

```bash
printf '%s\n' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' 'PermitRootLogin no' \
  | sudo tee /etc/ssh/sshd_config.d/00-athar-events-hardening.conf >/dev/null
sudo sshd -t && sudo systemctl reload ssh
sudo sshd -T | grep -i '^passwordauthentication'   # expect: no
```

From another terminal, `ssh ubuntu@<server> true` must still work.

If the server has less than 4 GB of RAM, add swap before the first build (Next.js builds need memory):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 3. Repository access

The repositories are on GitHub. Create one read-only deploy key per repository on the server:

```bash
ssh-keygen -t ed25519 -N '' -C 'athar-events-backend deploy' -f ~/.ssh/athar_events_backend
ssh-keygen -t ed25519 -N '' -C 'athar-events-frontend deploy' -f ~/.ssh/athar_events_frontend
cat >> ~/.ssh/config <<'EOF'
Host github-athar-events-backend
  HostName github.com
  IdentityFile ~/.ssh/athar_events_backend
  IdentitiesOnly yes
Host github-athar-events-frontend
  HostName github.com
  IdentityFile ~/.ssh/athar_events_frontend
  IdentitiesOnly yes
EOF
cat ~/.ssh/athar_events_backend.pub ~/.ssh/athar_events_frontend.pub
```

Add each public key in GitHub → repository → Settings → Deploy keys (read access only). Then clone:

```bash
sudo install -d -o ubuntu -g ubuntu -m 0755 /srv/athar-events
git clone --branch main git@github-athar-events-backend:AdilElhaci/Athar-events-backend.git /srv/athar-events/backend
git clone --branch main git@github-athar-events-frontend:AdilElhaci/Athar-events-frontend.git /srv/athar-events/frontend
```

### 4. Secrets

```bash
cd /srv/athar-events/backend
cp .env.production.example .env
cp .env.db.example .env.db
chmod 600 .env .env.db
openssl rand -base64 48   # run once per secret
nano .env
nano .env.db
```

Fill every empty value. Rules: no quotes around values; `JWT_SECRET`, `TOKEN_PEPPER` and `OTP_SECRET` all different; `REDIS_URL` contains the same password as `REDIS_PASSWORD`; database and Redis passwords use only letters and digits (`openssl rand -hex 24`), because they also appear inside URLs. SMTP values come from the transactional email provider ([OQ-20](docs/product/open-questions.md)).

### 5. TLS certificate

With DNS pointing at the server and the default nginx site still enabled:

```bash
sudo certbot certonly --nginx -d atharevents.sa -d www.atharevents.sa -d api.atharevents.sa
sudo certbot renew --dry-run
```

### 6. Data stack and nginx

```bash
cd /srv/athar-events/backend
./scripts/setup-server.sh
```

It starts PostgreSQL and Redis (creating the three database roles), installs `deploy/nginx/athar-events.conf` as the only nginx site, and records `none` as the active slot. The site answers 502 until the first deployment.

### 7. First deployment and first admin

```bash
./scripts/deploy-production.sh
```

Administrators are created only by the CLI ([D-28](docs/product/decisions.md)); the invite link is emailed:

```bash
SLOT="$(cat /srv/athar-events/.deployment/active-slot)"
docker exec -it "athar-events-api-$SLOT" node dist/cli/create-admin.js --email <ADMIN_EMAIL> --name "<NAME>"
```

## Verification and logs

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl --fail -sS https://api.atharevents.sa/api/health
curl --fail -sS https://atharevents.sa/api/health
curl --fail -sS -o /dev/null -w '%{http_code}\n' https://atharevents.sa/
cat /srv/athar-events/.deployment/active-slot
sudo cat /etc/nginx/athar-events-upstreams/api.conf /etc/nginx/athar-events-upstreams/web.conf

SLOT="$(cat /srv/athar-events/.deployment/active-slot)"
docker logs --tail 200 -f "athar-events-api-$SLOT"
docker logs --tail 200 -f "athar-events-web-$SLOT"
docker logs --tail 100 athar-events-db
sudo tail -n 200 -f /var/log/nginx/error.log
```

## Backup and restore

The deploy script backs up before every release. Manual backup:

```bash
umask 077
docker exec athar-events-db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' \
  > "/srv/athar-events/backups/athar-events-$(date +%F-%H%M%S).dump"
```

A backup kept only on this server does not survive losing the server. A nightly off-host copy and a restore drill are required before launch (AC-09-3, [operations.md](docs/architecture/operations.md#database)).

Restore (stops the API first so nothing writes during the restore):

```bash
SLOT="$(cat /srv/athar-events/.deployment/active-slot)"
docker stop "athar-events-api-$SLOT"
docker exec -i athar-events-db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  < /srv/athar-events/backups/<FILE>.dump
docker start "athar-events-api-$SLOT"
```

## Not covered yet

- **Worker and scheduler.** When WhatsApp sending and scheduled jobs arrive (P3), they run as one container outside blue/green: stopped before migrations and restarted after the switch, so two schedulers never run at once ([operations.md](docs/architecture/operations.md#deployment)).
- **Off-host backups, monitoring and alerts** (P5).
- **Data location.** The server is in Canada. Guest data may only be loaded after the client approves the location ([ADR-0002](docs/adr/0002-hosting-and-data-location.md), [OQ-06](docs/product/open-questions.md)).
