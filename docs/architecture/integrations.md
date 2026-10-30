# Integrations

**Status: planned; no provider account is connected.** Provider behaviour below is marked **Verified** only where it was checked in official documentation (with date) and **To verify** where it must be confirmed in the provider sandbox or the client's account during P1. Credentials are always the client's own accounts ([quotation section 7](../product/scope-and-acceptance.md#1-product-summary)); secrets live only in server environment variables, never in the frontend, logs or API responses.

## Moyasar

| Item | Plan | Status |
| --- | --- | --- |
| Product | Hosted invoice (`POST /v1/invoices`) with `amount` (halalas), `currency=SAR`, `description`, `callback_url` (server), `success_url`/`back_url` (browser), `metadata.paymentAttemptId`, `metadata.eventId` | Pattern verified in the Athar code (`moyasar.service.ts`); invoice fields **to verify** against current Moyasar docs in P2 |
| Webhook | `POST /api/payments/moyasar/webhook`; body carries `secret_token`; compare with `MOYASAR_WEBHOOK_SECRET` using `timingSafeEqual`; event types `payment_paid`, `payment_failed`, … | Secret-token model as in Athar; payload **to verify** in sandbox |
| Invoice callback | `POST /api/payments/moyasar/invoice-callback`; unauthenticated by Moyasar, so the handler fetches `GET /v1/invoices/:id` before acting | Athar pattern |
| Verification rule | Activate only when the fetched invoice/payment is `paid`, `amount` and `currency` equal the attempt, and `metadata.paymentAttemptId` matches | [D-10](../product/decisions.md) |
| Reconciliation | Every 5 minutes: attempts `PENDING` older than 2 minutes and younger than 48 hours are fetched from Moyasar; also on `GET /events/:id/payment-status` | AC-05-4 |
| Refunds | Manual in the Moyasar dashboard; admin marks the event refunded | Out of scope (quotation) |
| Environment | `MOYASAR_SECRET_KEY`, `MOYASAR_PUBLISHABLE_KEY` (unused unless the embedded form is chosen), `MOYASAR_WEBHOOK_SECRET`, `MOYASAR_API_BASE_URL`, `MOYASAR_SUCCESS_URL`, `MOYASAR_BACK_URL` | Test and live keys are separate per environment |
| Client provides | Moyasar merchant account in the client's name, activated for live payments (external review, not counted in the schedule) | [OQ-07](../product/open-questions.md) |

Fallback: Tap Payments only if Moyasar onboarding fails; Tap uses `hashstring` validation and would need its own ADR amendment.

## WhatsApp Cloud API

Reference: the Athar WhatsApp discovery (`athar-backend/docs/features/whatsapp-campaigns/discovery.md`, facts read 2026-10-22). Those facts are re-read against Meta's documentation before use; Athar's plan targets marketing broadcasts, Athar Events targets invitations with replies.

| Item | Plan | Status |
| --- | --- | --- |
| Account | Client's Meta Business (verified), WhatsApp Business Account (WABA), one dedicated number not registered on the consumer app; a system-user permanent token | Client obligation; **to verify** in P0/P1 |
| Send | `POST /{version}/{phone-number-id}/messages`, `type: template` for invitations; `type: image` (QR) inside the 24-hour customer-service window opened by the guest's reply; approved `QR_TEMPLATE` (image header) outside it | Window rule per Meta pricing page (checked by Codex 2026-10-24); payload **to verify** |
| Invitation template | Arabic (`ar`), body variables: guest name, event name, date/time text, venue; two **quick-reply** buttons with payloads `RSVP_ACCEPT` and `RSVP_DECLINE`; optional header image of the client's brand | Category is assigned by Meta and may be changed by Meta; budget as **marketing** until Meta assigns it ([OQ-14](../product/open-questions.md)) |
| QR template | Utility-style message with image header (the QR) and the recovery link, used when the 24-hour window has closed (late acceptance after an outage, reissue) | Submitted with the invitation template in P0/P1 |
| Reply correlation | Inbound `button` message carries the `context.id` of the invitation `wamid`; match `context.id` → `whatsapp_messages.provider_message_id` → guest, and require `from` (normalised) = guest phone | **To verify** in the P1 tracer |
| Webhook security | `GET` verify-token handshake; `POST` signed with `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret) | Verified (Meta docs via Codex, 2026-10-24) |
| Status webhooks | `sent`, `delivered`, `read`, `failed` per message; may arrive out of order and in batches; dedupe per status id + status | Ordering handled by monotonic `delivery_status` |
| Errors | Treat provider rejections (`4xx` with an error code) as `FAILED`; timeouts and connection resets after the request was sent as `UNKNOWN`; rate limit errors as retry-later before send | Athar engine pattern |
| Throughput | Send in chunks of 50 with a pause; respect the account's messaging tier (number of unique users per 24 h) | Tier **to verify** in the client's account ([OQ-21](../product/open-questions.md)) |
| Template status | Subscribe to `message_template_status_update` and `template_category_update`; show the template state in the admin event page; block scheduling if the template is not `APPROVED` | Athar discovery M16 (**to re-verify**) |
| Pricing | Meta charges per delivered template message by category and recipient market; replies inside the customer-service window are treated differently | Verified at a summary level (Meta pricing page, 2026-10-24); the Saudi rate card is **to verify** in the client's account |
| Environment | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_INVITATION_TEMPLATE`, `WHATSAPP_QR_TEMPLATE` | |

### P1 tracer (must pass before P3 starts)

1. Send the real Arabic invitation template to one consenting test number.
2. Persist the intent and the returned `wamid`.
3. Receive the button reply, verify the signature, correlate by `context.id` and sender.
4. On Accept, issue a QR credential and send the QR image in the window.
5. Receive `delivered` and `read` statuses; replay the same webhook and observe no change.
6. Scan the QR with the owner-authenticated scan page on a real phone.

Results go to the [verification log](../qa/verification-log.md). A sandbox/test number proves the mechanics; the run is repeated with the client's production number and approved templates before P5.

## Email (OTP)

| Item | Plan | Status |
| --- | --- | --- |
| Transport | SMTP via nodemailer, as in Athar (`MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`) through a transactional provider chosen by the client | [OQ-20](../product/open-questions.md) |
| Domain | `no-reply@<client-domain>` with SPF, DKIM and DMARC (`p=quarantine` after monitoring) | AC-09-2 |
| Template | Arabic, plain and HTML, code shown large and as text, 5-minute validity, no links | [SP-01](../specs/SP-01-auth-and-roles.md) |
| Local development | Mailpit container in Compose | |

## Other services

| Service | Use | Notes |
| --- | --- | --- |
| QR rendering | `qrcode` npm package, server-side PNG (error correction M, 512 px, quiet zone 4) | Image uploaded to Meta media endpoint per message; not stored on disk |
| Excel | `exceljs` | As Athar |
| Error tracking | Optional (e.g. Sentry) only with PII scrubbing and client approval of the processor | [Security and privacy](security-and-privacy.md#processors) |
