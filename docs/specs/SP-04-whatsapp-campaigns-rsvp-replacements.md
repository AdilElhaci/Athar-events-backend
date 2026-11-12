# SP-04: WhatsApp campaigns, RSVP and replacements

*Status: Approved outline. Implementation: see [progress](../delivery/progress.md) (`T-P1-10`, `T-P3-04` to `T-P3-09`, `T-P4-01`, `T-P4-02`, `T-P4-06`).*

## 1. Purpose and source

Primary owner of **FR-06**, the replacement part of **FR-04**, the approval and counts parts of **FR-03**, and the campaign parts of **FR-08**. Decisions [D-09](../product/decisions.md), [D-11](../product/decisions.md), [D-14](../product/decisions.md), [D-15](../product/decisions.md), [D-16](../product/decisions.md); [ADR-0003](../adr/0003-whatsapp-route-and-templates.md). Reference: Athar `email-campaign-sender.service.ts` (engine invariants) and Athar WhatsApp discovery (facts to re-verify).

## 2. Actors and triggers

- Admin creates the invitation content, schedules/pauses/resumes/cancels, sends replacements, resolves uncertain sends.
- Owner approves the invitation and watches counts.
- Scheduler sweepers and workers send; Meta webhooks deliver statuses and replies.

## 3. Inputs

Approved template name and variables; event `send_at`; allocated guests; Meta webhook payloads (statuses, button replies).

## 4. Behaviour

### Invitation content and approval

Admin creates a content version (template + variables); the backend renders an Arabic preview with a sample guest name. The owner approves the exact version (`contentId` + `contentHash`). Any new version resets approval to `AWAITING_OWNER` ([D-15](../product/decisions.md)).

### Scheduling

`POST /admin/events/:id/schedule` requires: `payment_status = PAID`, `list_status = READY`, `approval_status = APPROVED`, template `APPROVED` at Meta, `send_at > now()` and `send_at < starts_at`. Sets `campaign_status = SCHEDULED`, increments `schedule_version`. Cancel also increments it. Pause (`SENDING` → `PAUSED`) and resume (`PAUSED` → `SENDING`, refused once the event has started) do not: the version cancels intents, and a pause must keep them. Invitations of a paused campaign stay `QUEUED` and are not claimed; one claimed just before the pause returns to `QUEUED` without counting as an attempt. QR messages are not paused.

### Sending

1. `campaigns.due-sweeper` (every minute) selects events `SCHEDULED` with `send_at ≤ now()` and `starts_at > now()`, re-checks eligibility, and in one transaction: allocates all initial guests (`allocation_status = ALLOCATED`), creates `INVITATION` intents with logical key `invitation:<guestId>:<contentVersion>` (`ON CONFLICT DO NOTHING`), sets `SENDING`; then enqueues `send-chunk(eventId, scheduleVersion)`.
2. Worker: claim up to 50 `QUEUED` intents for the event with `FOR UPDATE SKIP LOCKED`, set `SENDING` + `claimed_at`; for each, re-check the event version and `starts_at`; call Meta; record `SENT` (+ `wamid`), `FAILED` (definite rejection, with code) or `UNKNOWN` (ambiguous). Re-enqueue itself while `QUEUED` rows remain; when none remain set `campaign_status = SENT`.
3. Stale recovery: `SENDING` older than 2 minutes → `UNKNOWN`. `UNKNOWN` is never resent automatically; admin resolution: `MARK_SENT`, `MARK_FAILED` (both only for `UNKNOWN`), `RESEND` (also for `FAILED`; creates a new intent with a new logical key suffix `:r<n>`, refused after the guest replied or while another invitation is sent or queued; a QR resend is a new QR version inside the 23 h reply window).
4. Pacing (OQ-21): invitations claimed in any rolling 24 h, across all events, stay at or below `WHATSAPP_DAILY_INVITATION_LIMIT` (the number's Meta messaging limit); the rest wait in the queue. QR messages answer a guest's reply and do not count.
5. A campaign whose `starts_at` passes while intents are still `QUEUED` cancels them (AC-06-5).

### Status and RSVP webhooks

- Statuses update `delivery_status` monotonically (`NONE < SENT < DELIVERED < READ`; `FAILED` only from `NONE`/`SENT`).
- A button reply is matched by `context.id` → invitation intent → guest, and the sender phone must equal the guest phone. Outcomes recorded in `whatsapp_inbound`.
- `RSVP_ACCEPT`: set `ACCEPTED` (unless `rsvp_locked`), issue QR credential ([SP-05](SP-05-qr-and-check-in.md)), create a `QR` intent (in-window image) or `QR_TEMPLATE` intent if the window is closed.
- `RSVP_DECLINE`: set `DECLINED`; an accepted guest who declines has the QR revoked.
- Replies after `starts_at` are recorded `AFTER_EVENT` and change nothing ([OQ-22](../product/open-questions.md)).

### Replacement rule

Default per [D-16](../product/decisions.md), pending [OQ-01](../product/open-questions.md):

- Eligible declines = allocated guests of the event with `rsvp = DECLINED` and no replacement linked to them yet.
- `POST /admin/events/:id/replacements` (`count` or explicit reserve `guestIds`): in one transaction holding the event row lock, for each requested replacement take one eligible decline and one unallocated reserve guest; require `replacements_used < extra_margin`; set the reserve guest `ALLOCATED` with `replacement_for_guest_id = <decline>`, set the decline's `rsvp_locked = true`, create an `INVITATION` intent; enqueue sending immediately (replacements are not scheduled).
- A replacement guest's own decline is also an eligible decline.
- *Implementation (2026-11-12):* `replacements.service.ts`. Requests are refused until the campaign has started (`SENDING`, `PAUSED` or `SENT`) and once the event has started. `count` pairs the oldest declines (by `rsvp_at`) with reserves in list order; `guestIds` picks the reserves. `GET /admin/events/:id/replacements` feeds SCR-24.

### Counts

Shown in `IEventSummary` and on the owner dashboard; each with a tooltip:

| Count | Definition |
| --- | --- |
| invited | Allocated guests whose invitation intent is `SENT` (accepted by WhatsApp), or who replied (an `UNKNOWN` send the guest answered was received) |
| delivered | Invitation `delivery_status ≥ DELIVERED` |
| read | Invitation `delivery_status = READ` |
| accepted / declined | Invited guests by RSVP |
| noReply | invited guests still `PENDING` (= invited − accepted − declined) |
| extras cap / used / available | `extra_margin` / replacements allocated / min(eligible declines, cap − used, unallocated reserves) |
| admitted | Guests with `checked_in_at` |

## 5. Acceptance criteria

AC-03-5, AC-03-6, AC-04-4, AC-06-1 to AC-06-6, AC-08-3, AC-08-4.

## 6. Technical design

- Module `invitations`: `whatsapp.client.ts` (Graph API, media upload), `invitation-content.service.ts`, `campaign.service.ts`, `campaign-sender.service.ts`, `whatsapp-webhook.controller.ts`, `whatsapp-webhook.service.ts`, `rsvp.service.ts`, `replacement.service.ts`, `processors/whatsapp.processor.ts` (jobs `send-chunk`, `apply-webhook`), scheduler jobs per [operations](../architecture/operations.md#scheduled-jobs-app_rolescheduler).
- Queue `whatsapp` (BullMQ, T-P3-05): jobs carry no data and run one sending pass under the Redis lock. Job ids: `sweep` (triggers coalesce while one waits) and `due:<eventId>:<scheduleVersion>` (delayed to `send_at`). Queued after commit by schedule, resume, replacement send and resend; the 30 s sweeper is the backstop. Queued invitations are sent at once; QR images keep a 10 s settle window for the webhook's inline send.
- Tables: `invitation_contents`, `whatsapp_messages`, `whatsapp_inbound`, `webhook_receipts`, `guests`.
- Frontend: SCR-13 (owner overview and counts), SCR-15 (approval), SCR-23 (admin campaign tab), SCR-24 (replacements), SCR-25 (message log).

## 7. Security, permissions, audit

Admin-only campaign actions, all audited; signed webhook; no free-text storage; message errors stored as codes. Owner sees aggregate counts and RSVP per guest, not message payloads.

## 8. Scope and dependencies

In: one campaign per event (with pause/resume and replacements), one sender number, two templates. Out: reminders, SMS, email invitations, multiple invitation variants, a chat inbox, owner-triggered sending. Depends on the P1 tracer, SP-02, SP-03, Meta account and template approval.

## 9. Open questions

[OQ-01](../product/open-questions.md), [OQ-02](../product/open-questions.md), [OQ-09](../product/open-questions.md), [OQ-14](../product/open-questions.md), [OQ-19](../product/open-questions.md), [OQ-21](../product/open-questions.md), [OQ-22](../product/open-questions.md), [OQ-24](../product/open-questions.md).
