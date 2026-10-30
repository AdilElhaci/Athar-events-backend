# Architecture overview

**Status: target architecture, nothing built.** Decisions: [D-03](../product/decisions.md), [D-04](../product/decisions.md), [D-09](../product/decisions.md); ADRs [0001](../adr/0001-stack-and-repository-boundaries.md)–[0006](../adr/0006-auth-session-model.md) (`Proposed`).

## System context

```text
                         ┌──────────────────────────── Athar-events-frontend (Next.js 16) ─────────────────────────┐
 Visitor / Owner ──────▶ │ (Landing Page)/   (Auth)/auth/*   (Dashboard)/dashboard/*   (Scanner)/scan/*   (Guest)/i/[token] │
 Admin ────────────────▶ │                        RTK Query ── Bearer access token (memory) + refresh cookie          │
 Owner at the door ────▶ └──────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                                    │ HTTPS  /api/*   (nginx, same site)
 Guest (WhatsApp) ◀───── Meta Cloud API ◀───┐                       ▼
        │ taps button ─────▶ Meta ──webhook──┼──▶ ┌──────────── Athar-events-backend (NestJS 11) ────────────┐
                                              │    │ API process: controllers, guards, services                  │
 Moyasar hosted invoice ──webhook/callback────┘    │ Worker process: BullMQ processors (send, webhook-apply)     │
        ▲                                          │ Scheduler: @nestjs/schedule sweepers (due campaigns,         │
        └──── owner pays in browser                │            stale claims, payment reconciliation)             │
                                                   └───────────┬──────────────────────┬──────────────────────────┘
 SMTP provider ◀── OTP emails ─────────────────────────────────┤                      │
                                                        PostgreSQL (truth)       Redis (BullMQ triggers,
                                                                                  throttler store, cache)
```

One backend codebase runs as three process roles from the same image: `api`, `worker`, `scheduler` (selected by `APP_ROLE`). In the MVP the worker and scheduler may run in one container; the split keeps blue/green API switches from running two schedulers (see [operations](operations.md#deployment)).

## Backend modules

Layout follows the Athar reference ([conventions](conventions.md#backend-layout)).

| Module | Owns | Key collaborators |
| --- | --- | --- |
| `auth` | OTP challenges, refresh tokens, JWT strategy, `@RequireUserType`, `UserTypeGuard`, `EventOwnerGuard` | `users`, mail |
| `users` | User profile, admin user management (`admin-users.controller.ts`) | `admin-actions` |
| `packages` | Package catalogue (public list, admin CRUD) | — |
| `events` | Event lifecycle, package snapshot, invitation content versions, owner approval, owner summary counts | `packages`, `payments`, `guests` |
| `payments` | Payment attempts, Moyasar client, webhook and callback, reconciliation | `events` |
| `guests` | Guests, Excel import (preview/apply), phone normalisation, replacements | `events`, `invitations` |
| `invitations` | WhatsApp client, message intents, campaign scheduling, sending engine, inbound webhook, RSVP, QR issuance | `guests`, `events` |
| `checkin` | Scan endpoint, admission window, scan stats; public invitation page data | `guests`, `events` |
| `admin-actions` | Append-only admin action log and its admin list | all admin controllers |
| `dashboard` | Admin queue and counters | read models over the above |
| `shared/` | Response envelope, exceptions, filters, interceptors, pagination, helpers (Saudi phone, encryption, logging) | — |

## Key flows

### Purchase

1. Owner creates an event (`DRAFT`) with a package → the event stores a **snapshot** of the package terms.
2. `POST /events/:id/checkout` creates a payment attempt and a Moyasar invoice; the browser goes to Moyasar.
3. Moyasar calls the webhook and/or the invoice callback; the backend **fetches** the invoice/payment from Moyasar, verifies it and applies it once ([SP-02](../specs/SP-02-packages-events-payments.md)).
4. Event payment state becomes `PAID`, event status `ACTIVE`, preparation state `AWAITING_LIST`.

### Preparation and approval

5. Owner sends the list outside the app ([OQ-04](../product/open-questions.md)). Admin imports or enters it; owner sees it read-only.
6. Owner approves the rendered invitation version ([D-15](../product/decisions.md)).
7. Admin schedules: the event's campaign state becomes `SCHEDULED` with `send_at` and an incremented `schedule_version`.

### Sending (D-09)

8. The scheduler sweeper finds due campaigns, re-checks eligibility and creates one `whatsapp_messages` intent row per guest (unique logical key) in one transaction, then enqueues a chunk job.
9. A worker claims `QUEUED` rows with `FOR UPDATE SKIP LOCKED`, marks them `SENDING`, calls Meta, and records `SENT` with the provider message id, `FAILED` (definite) or `UNKNOWN` (ambiguous, never resent).
10. Meta status webhooks update delivery state (monotonic). Button replies update RSVP; an `ACCEPT` issues the QR credential and creates a QR message intent.

### Admission

11. The owner signs in on the door device and opens scan mode for the event ([D-08](../product/decisions.md)).
12. Each scan posts the token; one conditional update admits or reports a duplicate ([SP-05](../specs/SP-05-qr-and-check-in.md)).

## State dimensions of an event

An event is described by independent fields, never one overloaded status ([data model](data-model.md#events)):

| Field | Values |
| --- | --- |
| `status` | `DRAFT`, `ACTIVE`, `CLOSED`, `CANCELLED` |
| `payment_status` | `UNPAID`, `PENDING`, `PAID`, `REFUNDED` |
| `list_status` | `AWAITING_LIST`, `IN_PROGRESS`, `READY` |
| `approval_status` | `NOT_REQUESTED`, `AWAITING_OWNER`, `APPROVED` |
| `campaign_status` | `NOT_SCHEDULED`, `SCHEDULED`, `SENDING`, `PAUSED`, `SENT`, `CANCELLED` |

Guest dimensions: `rsvp` (`PENDING`, `ACCEPTED`, `DECLINED`), delivery (from the latest invitation message), admission (`checked_in_at`).

## Cross-cutting choices

| Concern | Choice | Reference |
| --- | --- | --- |
| API style | REST under `/api`, Athar envelope, Swagger at `/api/docs` (disabled or protected in production) | [conventions](conventions.md#api-conventions), [D-25](../product/decisions.md) |
| Auth | Email OTP, JWT access in memory, rotating HttpOnly refresh cookie | [ADR-0006](../adr/0006-auth-session-model.md) |
| Authorization | `UserTypeGuard` + ownership checks in services; role read from the database row | [SP-01](../specs/SP-01-auth-and-roles.md) |
| Jobs | PostgreSQL intents + BullMQ triggers + sweepers | [D-09](../product/decisions.md) |
| Time | Stored UTC (`timestamptz`); event timezone `Asia/Riyadh`; display in Arabic Gregorian | [OQ-17](../product/open-questions.md) |
| Money | Integer halalas; SAR | Athar `payment_attempts.amount` convention |
| i18n | `nestjs-i18n` with Arabic resources only; machine-readable `code` on errors | [conventions](conventions.md#errors-and-i18n) |
| Live data | Polling | [D-14](../product/decisions.md) |
