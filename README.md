# Athar Events — backend

NestJS 11 API for Athar Events. Planning and decisions live in [`docs/`](docs/README.md); agent rules in [`AGENTS.md`](AGENTS.md).

## Requirements

Node 22 (`.nvmrc`), pnpm 12, Docker (for PostgreSQL, Redis and Mailpit).

## Local setup

```bash
cp .env.example .env            # then replace the three secrets: openssl rand -base64 48
docker compose up -d            # postgres :5433, redis :6380, mailpit SMTP :1025 / UI http://localhost:8025
pnpm install
pnpm migration:run
pnpm start:dev                  # http://localhost:4000/api, Swagger at /api/docs (non-production only)
```

All email (registration codes, reset and invite links) is captured by Mailpit at http://localhost:8025.

## Real SMTP

Set in `.env` (values provided by the owner; never committed):

```
SMTP_HOST=…   SMTP_PORT=587   SMTP_SECURE=false   SMTP_USER=…   SMTP_PASSWORD=…
MAIL_FROM=no-reply@<your-domain>   MAIL_FROM_NAME=أثر للمناسبات
```

Use port 465 with `SMTP_SECURE=true`, or 587 with `SMTP_SECURE=false` (STARTTLS). The sender domain needs SPF, DKIM and DMARC.

## Creating an administrator

There is no public admin registration. On the server:

```bash
pnpm admin:create --email admin@example.com --name "اسم المدير"              # development (ts-node)
node dist/cli/create-admin.js --email admin@example.com --name "اسم المدير"   # production build
```

The admin receives a 24-hour link to choose their password. To grant admin rights to an existing owner account, add `--promote` (this signs them out everywhere).

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm format:check
pnpm test          # unit
pnpm test:e2e      # needs the docker compose stack and the athar_events_test database:
                   # docker compose exec postgres psql -U athar_events -c "CREATE DATABASE athar_events_test;"
pnpm build
```
