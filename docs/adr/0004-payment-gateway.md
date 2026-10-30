# ADR-0004: Payment gateway

Status: Proposed
Date: 2026-10-24
Traceability: FR-05; [D-10](../product/decisions.md); [OQ-07](../product/open-questions.md), [OQ-08](../product/open-questions.md), [OQ-16](../product/open-questions.md)

## Context

The quotation names Moyasar or Tap through the gateway's ready-made payment page and requires that an event is activated only after a successful payment. The owner's Athar project already integrates Moyasar hosted invoices with a webhook, a server callback that re-fetches the invoice, timing-safe secret checks and payment attempts with a unique provider id.

## Decision

- Moyasar hosted invoice per checkout; amount from the event's package snapshot (halalas, SAR).
- Three inputs — webhook (secret token), invoice callback (no provider auth, so re-fetch), reconciliation job — converge on one idempotent `applySuccessfulPayment(attemptId, providerIds)` that fetches the invoice/payment from Moyasar and verifies status, amount, currency and `metadata.paymentAttemptId`.
- The browser return page only asks the backend for status; it never activates.
- One paid attempt per event (partial unique index); a second success raises a reconciliation alert for a manual refund.
- Refunds are manual in the Moyasar dashboard; an admin marks the event refunded.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Tap Payments | No existing pattern in the owner's code; fallback only if Moyasar onboarding fails |
| Embedded card form (Moyasar.js) | More PCI surface and UI work; the quotation specifies the ready-made page |
| Trusting webhook payloads without re-fetch | A leaked secret or replay could activate events |

## Consequences

- Payment logic mirrors Athar's, easing maintenance.
- The demo milestone may use Moyasar test mode if the client agrees ([OQ-07](../product/open-questions.md)).

## Open items

[OQ-07](../product/open-questions.md), [OQ-08](../product/open-questions.md), [OQ-16](../product/open-questions.md).
