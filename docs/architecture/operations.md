# Operations

**Status: planned. Primary owner of FR-09** (launch: hosting, domain, SPF/DKIM/DMARC, testing, 14-day support; acceptance AC-09-1 to AC-09-5). Default topology per [D-19](../product/decisions.md) and [ADR-0002](../adr/0002-hosting-and-data-location.md) (`Proposed`): a **dedicated** VPS running Docker Compose with nginx blue/green, structured after the Athar `DEPLOYMENT.md` runbook, with the corrections W8–W9. The hosting provider, region and operator are the client's decision ([OQ-06](../product/open-questions.md)). Athar Events never shares Athar's server, database, Redis, volumes or credentials.

## Accounts the client provides

From the quotation, section 7 (before the build clock starts):

1. Valid commercial registration.
2. Meta Business account in the client's name, with business verification completed.
3. A dedicated mobile number for WhatsApp Business, not registered on the WhatsApp consumer app.
4. A payment-gateway (Moyasar) account in the client's name.
5. Domain and hosting, with developer access.
6. Logo, colours, landing page copy and invitation wording.

## Environments

| Environment | Purpose | Data | Providers |
| --- | --- | --- | --- |
| Local | Development | Seeded fakes | Docker Compose: Postgres, Redis, Mailpit; Moyasar test keys; Meta test number |
| Staging | Demo milestone, UAT, tracer | Test data only | Moyasar test mode; Meta test number or the production number with test recipients |
| Production | Live | Real | Moyasar live; client's WhatsApp number |

Each environment has its own secrets; nothing is shared between environments.

## Topology (default)

```text
Internet ─▶ nginx (TLS, Let's Encrypt) ─┬─▶ frontend  (blue | green)   Next.js standalone, port 3000
                                        └─▶ api       (blue | green)   APP_ROLE=api, /api/*
                                            worker    (single)        APP_ROLE=worker,scheduler
                                            postgres  (volume, not exposed)
                                            redis     (volume, not exposed, password)
```

- Frontend and API on the same site: `https://<domain>` and `https://<domain>/api` (or `api.<domain>`; then the refresh cookie uses `Domain=<domain>` and SameSite=Lax still applies because both are same-site).
- The worker/scheduler container is **not** blue/green: it is stopped, migrated and restarted once per release so two schedulers never run at the same time.
- **Client IP and `/api` routing (verified 2026-10-24):** Next's rewrite proxy forwards headers but does not add `X-Forwarded-For`, and `BACKEND_URL` is fixed at build time. In production nginx sets `X-Forwarded-For` (`$proxy_add_x_forwarded_for`) in front of Next — or routes `/api` straight to the API — and the API runs with `TRUST_PROXY_HOPS=1`. The API (4000) and Next (3000) ports are bound to localhost only; otherwise a client could spoof its IP and rate limits would be shared by everyone.
- Images: pinned Node LTS by digest; non-root; `dumb-init`; health checks `/api/health` and `/`.

## Deployment

Routine release (a script modelled on Athar's `deploy-production.sh`):

1. Build and tag images for the commit.
2. Back up the database (`pg_dump`, see below).
3. Stop the worker container.
4. Run migrations once with the **migration role** (`node dist/database/run-migrations.js`); migrations must be backward-compatible with the running API (expand → migrate → contract across releases).
5. Start the idle colour of API and frontend; wait for health checks.
6. Switch nginx upstreams; keep the old colour for 10 minutes; stop it.
7. Start the worker with the new image.
8. Record the release in the [verification log](../qa/verification-log.md) for milestone releases.

Rollback: switch nginx back to the previous colour. Blue/green does **not** roll back the database; a migration that cannot run with the previous code requires a forward fix.

Seeds (`platform-admins`: creates admins from `PLATFORM_ADMIN_EMAILS` if missing) run as a release step, are idempotent and never modify existing rows.

## Database

- Roles: `athar_events_migrator` (owns schema) and `athar_events_app` (SELECT/INSERT/UPDATE/DELETE on tables, USAGE on sequences). The application never connects as the superuser (W8).
- Backups: nightly `pg_dump -Fc` encrypted, copied **off the host** (object storage or a second server chosen by the client), 14 daily + 8 weekly kept.
- Restore drill: before launch and after any schema-heavy release, restore into a scratch database and run `SELECT count(*)` checks per table; record it (AC-09-3).
- Restore during operations: **pause outbound processing first** (stop the worker), restore, then review campaigns and check-ins recorded after the backup time before resuming. A restored database can forget admissions, revocations and sends made after the backup.

## Scheduled jobs (`APP_ROLE=scheduler`)

| Job | Every | Purpose |
| --- | --- | --- |
| `campaigns.due-sweeper` | 1 min | Create intents for due campaigns (version-checked), enqueue chunks; skip events whose `starts_at` has passed |
| `messages.stale-recovery` | 1 min | `SENDING` rows claimed > 2 min ago → `UNKNOWN` |
| `messages.queued-sweeper` | 1 min | `QUEUED` rows with no active job → enqueue chunk |
| `payments.reconcile` | 5 min | Fetch pending Moyasar attempts |
| `events.close` | 1 h | Close events 24 h after `admission_closes_at` |
| `retention.anonymise` | daily | [Data retention](data-model.md#retention) |
| `otp.cleanup` | daily | Delete challenges older than 30 days |

## Monitoring and alerts

Logs are structured JSON with correlation ids (`requestId`, `eventId`, `guestId`, `messageId`, `paymentAttemptId`) and no personal data.

| Alert | Condition | Action |
| --- | --- | --- |
| Overdue campaign | `campaign_status = SCHEDULED` and `send_at < now() − 5 min` | Check worker and Redis |
| Unknown sends | Any `UNKNOWN` message | Admin resolves from the message log |
| Paid but not applied | Moyasar-paid attempt not `PAID` locally after 15 min | Run reconcile |
| Second payment | Unique-paid constraint hit | Manual refund |
| Worker down | No scheduler heartbeat for 3 min | Restart worker |
| Elevated send failures | > 10% `FAILED` in a campaign | Pause campaign, check template/number quality |
| Template not approved | Scheduled event's template not `APPROVED` | Block and notify admin |
| Disk / backup | Backup missing or disk > 80% | Ops |

Alert delivery (email to the operations contact) is set up in P5; the channel is part of [OQ-11](../product/open-questions.md).

## Secrets

Stored in server-only `.env` files (mode 600, outside the repository) as in the Athar runbook, or in the hosting provider's secret store if available. Rotation: `JWT_SECRET` rotation signs everyone out (acceptable, 15-minute tokens); `OTP_SECRET` rotation invalidates open codes only; provider secrets rotated in the provider console first, then the environment, then a restart.

## Event-day readiness (per event)

- Owner has signed in on each door device the day before and opened scan mode once (camera permission granted).
- Venue connectivity checked (scanning needs internet; offline scanning is out of scope).
- Admin knows how to reissue a QR and how to look up a guest by name or phone.
- Manual fallback agreed with the owner (printed accepted-guest list exported from the owner's guest list screen, if the client wants it — out of scope unless agreed).
