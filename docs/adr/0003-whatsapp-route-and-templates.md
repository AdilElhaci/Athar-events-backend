# ADR-0003: WhatsApp route, templates and sending engine

Status: Proposed
Date: 2026-10-24
Traceability: FR-06, FR-07; [D-09](../product/decisions.md), [D-11](../product/decisions.md), [D-12](../product/decisions.md); [OQ-14](../product/open-questions.md), [OQ-19](../product/open-questions.md), [OQ-21](../product/open-questions.md)

## Context

The quotation requires the WhatsApp Business API, a two-button invitation template, scheduled sending, automatic status updates and QR delivery to guests who accept. WhatsApp is the highest schedule risk: business verification, number registration, template approval and category assignment are external. The Athar project has a planning-only WhatsApp feature with facts cited from Meta's documentation and a proven database-first email sending engine.

## Decision

- **Route:** Meta WhatsApp Cloud API directly, using the client's verified Meta Business account, WABA and one dedicated number. No Business Solution Provider unless the client needs onboarding help.
- **Templates:** (1) Arabic invitation template with two quick-reply buttons (`RSVP_ACCEPT`, `RSVP_DECLINE`); (2) a QR template with an image header for delivery outside the 24-hour customer-service window. Both are submitted in P0/P1. The category is whatever Meta assigns; costs are budgeted as marketing until confirmed.
- **QR delivery:** after Accept, send the QR as an image message inside the window opened by the guest's reply, with the recovery link; fall back to the QR template when the window is closed.
- **Engine ([D-09](../product/decisions.md)):** `whatsapp_messages` rows are durable intents with a unique logical key; workers claim with `SKIP LOCKED`; outcomes `SENT`/`FAILED`/`UNKNOWN` (never auto-resent); stale-claim recovery; scheduler sweepers; BullMQ jobs carry ids only; every send re-checks `schedule_version`, payment, approval and `starts_at`.
- **Inbound:** signed webhook (`X-Hub-Signature-256`), receipts deduped per message/status, RSVP correlation by `context.id` + sender phone, monotonic delivery status.
- **Module:** independent `invitations` module; no shared package with Athar.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| A BSP (e.g. a Saudi WhatsApp reseller) | Extra contract and per-message markup; does not remove Meta approval risk |
| Interactive button message (non-template) for invitations | Allowed only inside an open customer-service window; invitations are business-initiated |
| Link-only RSVP (web page) | Quotation requires WhatsApp buttons |
| Self-contained signed QR (JWT) | Online check-in already needs the database; signed tokens add key management without benefit |
| Shared WhatsApp client with Athar | Different accounts and purposes; premature extraction; needs approval (D-24) |

## Consequences

- A P1 tracer on a real phone is mandatory before P3 ([integrations](../architecture/integrations.md#p1-tracer-must-pass-before-p3-starts)).
- `UNKNOWN` sends require an admin resolution screen.
- Template changes need Meta re-approval; the invitation wording is fixed per template, with variables only.

## Open items

[OQ-14](../product/open-questions.md) (verification, category, cost), [OQ-19](../product/open-questions.md) (one sender), [OQ-21](../product/open-questions.md) (volume vs. messaging tier), [OQ-22](../product/open-questions.md) (RSVP changes).
