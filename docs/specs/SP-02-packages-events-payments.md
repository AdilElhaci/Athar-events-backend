# SP-02: Packages, events and payments

*Status: Approved outline; packages implemented 2026-11-01 (`T-P2-01`), event creation and editing 2026-11-02 (`T-P2-03`). Implementation: see [progress](../delivery/progress.md) (`T-P2-*`).*

## 1. Purpose and source

Primary owner of **FR-05** and of the package and event parts of **FR-03** and **FR-04** (quotation 03, 04, 05). Decisions [D-10](../product/decisions.md), [D-15](../product/decisions.md); [ADR-0004](../adr/0004-payment-gateway.md). Reference: Athar `src/modules/billing` (Moyasar invoice, webhook, callback re-fetch, payment attempts).

## 2. Actors and triggers

- Admin manages packages.
- Owner creates and edits an event, starts checkout, returns from Moyasar.
- Moyasar sends webhooks and the invoice callback; the scheduler reconciles pending attempts.

## 3. Inputs

Package fields; event fields (name, `startsAt` in Asia/Riyadh, venue name, map URL, requested send time, package id); Moyasar invoice and payment objects.

## 4. Behaviour

**Packages.** Admins add, edit, activate and deactivate; there is no delete. New packages start inactive and are not seeded. Public list returns active packages ordered by `sort_order`.

**Event creation.** Owner (any signed-in non-admin user) creates an event in `DRAFT`, `UNPAID`, `AWAITING_LIST`, `NOT_REQUESTED`, `NOT_SCHEDULED`, with a package snapshot and a reference code. `startsAt` must be in the future; `requestedSendAt` must be in the future and before `startsAt`. Admission window defaults are set from `startsAt`.

**Editing.** Owner may edit name, date, venue, map link and requested send time until the invitation is approved; changing the package is allowed only before a payment attempt exists. Editing a field used in the invitation creates no automatic approval; an admin regenerates the invitation content. After scheduling, only admins correct fields (audited) ([OQ-16](../product/open-questions.md)).

**Checkout.** `POST /events/:id/checkout`: if `PAID` → 409; if an open attempt with a live invoice exists → return it; else, holding the event row lock, create a Moyasar invoice (valid 2 hours) with `metadata.paymentAttemptId`, insert the attempt as `PENDING`, set the event `PENDING`, return `paymentUrl`. An open attempt is reused only while its invoice has more than 15 minutes left. Moyasar unreachable or no secret key → 503 `payments.unavailable` and nothing is stored. *Implemented 2026-11-02 (`T-P2-07`).*

**Apply payment (single path).** Triggered by webhook, invoice callback, reconciliation, or `GET /events/:id/payment-status`. In one transaction: lock the attempt and event; fetch the invoice/payment from Moyasar; verify `status = paid`, amount, currency, attempt id; set attempt `PAID` (unique-paid constraint), event `payment_status = PAID`, `status = ACTIVE`, `paid_at`; record a `webhook_receipts` row when triggered by a webhook. Failures set attempt `FAILED` without touching a paid event. Repeats are no-ops. A paid invoice for an event that is already paid, refunded, cancelled or closed is recorded on its attempt (`FAILED`, `duplicate_payment` or `event_not_payable`) for a manual refund and never applied. When the last pending attempt fails or expires, the event returns to `UNPAID`. Attempts still `PENDING` after 48 hours are expired without a fetch (`not_confirmed`).

**Return page.** `/dashboard/events/:id/payment?attemptId` (Moyasar's `success_url`; inside the dashboard so the session is already there) polls `payment-status` every 2 s for up to 30 s, then shows "we will confirm shortly" with a link to the event.

**Refund marking.** Admin `mark-refunded` (paid events only, reason 3–300 characters): event `REFUNDED` + `CANCELLED`, campaign `CANCELLED` unless already `SENT`, queued messages `CANCELLED` (`event_refunded`), every QR code revoked (`qr_token_hash` cleared), the paid attempt's `metadata.refundedAt` set; one transaction under the event lock; audited `event.refunded` with counts ([OQ-16](../product/open-questions.md) default). The money itself is returned by hand in the Moyasar dashboard first. *Implemented 2026-11-12 (`T-P2-09`).*

**Payments taken but not applied.** An attempt `FAILED` with `duplicate_payment`, `event_not_payable` or `mismatch` holds money at Moyasar: it is flagged `refundNeeded` on SCR-26 and counted in the admin dashboard alert `paymentsToRefund` until an admin records the manual refund (`refund-done`, sets `metadata.refundedAt`, audited `payment.refund_done`; the event is untouched). Admins can also force a Moyasar fetch of a `PENDING` attempt (`reconcile`, audited `payment.reconcile`; 503 `payments.provider_unavailable` on outage). *Implemented 2026-11-12 (`T-P2-09`).*

## 5. Acceptance criteria

AC-03-1, AC-03-2, AC-03-7, AC-04-1, AC-04-2, AC-05-1 to AC-05-5.

## 6. Technical design

- Modules `packages` (`packages.controller.ts`, `admin-packages.controller.ts`), `events` (`events.controller.ts`, `admin-events.controller.ts`, `events.service.ts`, `event-summary.service.ts`), `payments` (`moyasar.client.ts`, `payment-apply.service.ts`, `payments-webhook.controller.ts`, `admin-payments.controller.ts`, `payments-reconcile.job.ts`).
- Tables: `packages`, `events`, `payment_attempts`, `webhook_receipts`.
- Config `moyasar.config.ts` ([integrations](../architecture/integrations.md#moyasar)).
- Frontend: SCR-10 to SCR-14, SCR-21, SCR-26 ([information architecture](../ux/information-architecture.md#screen-inventory)).

## 7. Security, permissions, audit

Owner endpoints check `owner_id`; webhook secret timing-safe with 401 on failure; callback acts only on re-fetched data; package, refund and correction actions audited. Amounts never come from the client.

## 8. Scope and dependencies

In: one purchase per event. Out: upgrades between packages, coupons, invoices/ZATCA, automatic refunds, saved cards. Depends on Moyasar account ([OQ-07](../product/open-questions.md)), SP-01.

## 9. Open questions

[OQ-07](../product/open-questions.md), [OQ-08](../product/open-questions.md), [OQ-16](../product/open-questions.md), [OQ-17](../product/open-questions.md).
