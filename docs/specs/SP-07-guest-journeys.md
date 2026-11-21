# SP-07: Guest journeys

*Status: Approved by the owner on 2026-11-21 (D-50 to D-55). Implementation: see [progress](../delivery/progress.md) (`T-P6-*`).*

## 1. Purpose and source

The messages a guest gets after the invitation: follow-ups, reminders, the apology, the thank-you, and the RSVP close. Source: the client brief «الملخص التشغيلي لرحلة الضيف» v1.1 (Nov 2026) and the owner's answers on 2026-11-21: [D-50](../product/decisions.md#d-50) (journeys are part of every package), [D-51](../product/decisions.md#d-51) (timing), [D-52](../product/decisions.md#d-52) (one QR = one person, no seats), [D-53](../product/decisions.md#d-53) (decline then accept), [D-54](../product/decisions.md#d-54) (contact permission), [D-55](../product/decisions.md#d-55) (derived QR token). Builds on [SP-04](SP-04-whatsapp-campaigns-rsvp-replacements.md) (engine, intents, webhook) and [SP-05](SP-05-qr-and-check-in.md) (QR, check-in).

## 2. Actors and triggers

- Admin chooses the journey and the RSVP close when scheduling, and decides late replies.
- Owner ticks the contact-permission declaration when approving the invitation.
- The WhatsApp sweeper creates each journey message when it falls due; the sender re-checks it before sending.
- Guest replies (accept/decline buttons on the invitation or a follow-up); the venue scan records attendance.

## 3. Inputs

Event `starts_at`, `timezone`, `venue_map_url`; the journey (7, 21 or 40); `send_at`; `rsvp_closes_at`; guest RSVP, `rsvp_at`, QR state, `checked_in_at`; Meta template status.

## 4. Behaviour

### Journeys and timing (D-51)

All dates are in the event's time zone. *Event date* = the local date of `starts_at`. *Evening event* = local start time 16:00 or later; otherwise *morning*.

| Message | Kind | To | 7 days | 21 days | 40 days |
| --- | --- | --- | --- | --- | --- |
| M01 invitation | `INVITATION` | every allocated guest | event date − 7 | − 21 | − 40 |
| M04 follow-up 1 | `FOLLOW_UP_1` | no reply yet | `send_at` + 2 days | + 3 days | + 5 days |
| M05 follow-up 2 (last) | `FOLLOW_UP_2` | no reply yet | `send_at` + 4 days | + 7 days | + 12 days |
| M06 reminder 1 | `REMINDER_1` | accepted | event date − 2 | − 3 | − 3 |
| M07 final reminder | `REMINDER_FINAL` | accepted | evening: `starts_at` − 5 h; morning: 19:00 the day before | same | same |
| M08 thank-you | `THANK_YOU` | admitted (`checked_in_at` set) | 12:00 the day after the event date | same | same |
| M02 confirmation + QR | `QR` (`QR_TEMPLATE` outside the window) | on accept | immediately | same | same |
| M03 apology | `APOLOGY` | on decline, once ever | immediately | same | same |

- The invitation day comes from the journey; its time of day is the admin's choice. Scheduling proposes `send_at` = event date − N days at 10:00 and accepts any `send_at` later than now and before the RSVP close. Follow-ups count from `send_at`; reminder 1 uses the time of day of `send_at`.
- `rsvp_closes_at` defaults to 18:00 two days before the event date; the admin may change it (after `send_at`, before `starts_at`).
- An event without a journey (scheduled before this feature) sends the invitation only, as before.

### Rules (brief §03, §04, §08)

1. **Due, not retroactive.** The sweeper creates a step's intents when its due time has passed and is less than 2 hours old (`JOURNEY_MISSED_GRACE`). A step found later (an outage, a late guest) is never created.
2. **Eligibility at creation and again after the claim.** Follow-ups: guest `PENDING`, invitation `SENT` and not `FAILED` at least 24 h before the due time, due time before `rsvp_closes_at`. Reminders: guest `ACCEPTED` with a live QR, and `rsvp_at` at least 24 h before the due time (a late accept already got M02). Thank-you: `checked_in_at` set. Anything no longer due when claimed is `CANCELLED` with a reason code (`not_pending`, `not_accepted`, `too_soon`, `rsvp_closed`, `not_admitted`, `template_not_approved`).
3. **Once per guest and step.** Logical key `<kind>:<guestId>:<scheduleVersion>`; `apology:<guestId>` (once ever). Retries, duplicate jobs and duplicate webhooks cannot send a step twice.
4. **After the last follow-up** nothing more goes to a guest who has not replied; their `PENDING` state stays visible.
5. **Event start.** Queued journey intents are cancelled at `starts_at` (as SP-04), except `THANK_YOU`, which is only created after it.
6. **Pause** holds follow-ups and reminders as it holds invitations; cancelling a campaign stops the journey.
7. **Daily limit.** Follow-ups, reminders, the thank-you and `QR_TEMPLATE` are business-initiated templates and count towards `WHATSAPP_DAILY_INVITATION_LIMIT` with invitations; M02 and M03 inside the window do not.
8. **Templates.** A step whose template is not `APPROVED` at Meta is not created; the operations alert reports it once per event.

### RSVP (D-53)

| Reply | Before `rsvp_closes_at` | After |
| --- | --- | --- |
| Accept, guest `PENDING` or `DECLINED` and not replaced | Applied: M02 with the QR | Recorded `REVIEW`, waits for an admin |
| Accept, guest replaced (`rsvp_locked`) | Applied if `extra_margin − used > 0`, using one (counted like a replacement); else `REVIEW` | `REVIEW` |
| Decline | Applied: QR revoked, journey reminders cancelled, M03 once | Same |

The admin decides a `REVIEW` from the event's campaign tab: **accept** (applies the accept; QR by M02 in the window or `QR_TEMPLATE` after it; uses a vacant invitation when the guest was replaced) or **dismiss** (nothing changes). Both are audited.

### QR in reminders (D-55)

Reminders and `QR_TEMPLATE` carry the QR card as the template's image header. The token is re-derived from `QR_TOKEN_SECRET`, the guest id and the current `qr_version`; it must hash to the stored `qr_token_hash`. If it does not (a token issued before D-55), the reminder issues a new QR version first.

### Contact permission (D-54)

Approving the invitation requires the owner to tick the declaration; `events.contact_consent_at` and `contact_consent_by_user_id` are set. An admin override approval (D-40) sets them with the override reason. Scheduling refuses `contact_consent_missing`.

## 5. Acceptance criteria (brief §09)

| ID | Test | Expected |
| --- | --- | --- |
| AC-J-1 | Guest accepts | M02 at once with venue link and QR; no follow-up afterwards |
| AC-J-2 | Decline, then accept before the close | Status updated; new QR version issued; M02 sent |
| AC-J-3 | No reply after both follow-ups | No further message; no reminder created |
| AC-J-4 | Accept a few hours before reminder 1 or the final reminder | That reminder is not sent |
| AC-J-5 | Same QR scanned twice | Second scan admits no one (SP-05) |
| AC-J-6 | Admitted / absent guest | Thank-you the day after to the admitted guest only |
| AC-J-7 | Decline | M03 once, even after several declines; QR revoked; queued reminders cancelled |
| AC-J-8 | Accept after the RSVP close, or replaced guest with no vacant invitation | `REVIEW`; nothing sent until an admin accepts |
| AC-J-9 | Sweeper down past a step's grace | That step is never sent |
| AC-J-10 | Guest added late (replacement) | Only steps still in the future and ≥ 24 h after their invitation |

## 6. Technical design

- **Migration (expand-only):** `events.journey` (smallint, null, check 7/21/40), `events.rsvp_closes_at`, `events.contact_consent_at`, `events.contact_consent_by_user_id`; `whatsapp_messages.scheduled_for`; new values of `whatsapp_message_kind` (`FOLLOW_UP_1`, `FOLLOW_UP_2`, `REMINDER_1`, `REMINDER_FINAL`, `THANK_YOU`, `APOLOGY`); new `whatsapp_inbound_outcome` `REVIEW` and `whatsapp_inbound.review_decided_at`, `review_decided_by_user_id`, `review_decision`; `guests.reinstated_at` (an accept that used a vacant invitation, counted by `usedCount`).
- **Code:** `journey-schedule.ts` (pure: due times from event + journey, unit-tested across time zones and the 16:00 boundary); `JourneyService.createDue()` called by the sweeper pass after `startDue()`; `WhatsappSenderService` new `deliver*` branches with the eligibility re-check; webhook: match replies to `INVITATION`, `FOLLOW_UP_1`, `FOLLOW_UP_2`, apply the close and D-53, queue M03; `qr-token.ts` derived token.
- **Templates (Arabic, category UTILITY, to submit from the dashboard, D-41):** `athar_followup` (M04, 2 quick replies), `athar_followup_final` (M05, 2 quick replies), `athar_reminder` (M06, image header), `athar_reminder_final` (M07, image header), `athar_thanks` (M08), `athar_confirmation` (M02 outside the window, image header). Names in env (`WHATSAPP_TEMPLATE_*`) with these defaults. Meta may reclassify the thank-you as MARKETING.
- **Env:** `QR_TOKEN_SECRET` (D-55), `JOURNEY_MISSED_GRACE_MINUTES` (120).
- **API:** `POST /admin/events/:id/schedule` takes `journey` and optional `rsvpClosesAt`, refuses `campaign.contact_consent_missing` and `campaign.rsvp_close_invalid`; `GET /admin/events/:id/invitation` carries `journey` (proposals per journey, steps with counts by state, pending reviews) and `contactConsent`; `GET /admin/events/:id/rsvp-reviews`, `POST /admin/events/:id/rsvp-reviews/:inboundId` (`ACCEPT` | `DISMISS`); owner approval body adds `contactConsent: true`.
- **Frontend:** schedule dialog (journey, send time, RSVP close, timeline preview); campaign tab timeline and «ردود تنتظر القرار»; approval page checkbox; message log labels for the new kinds.

## 7. Security, permissions, audit

Admin-only schedule and review actions, audited (`campaign.schedule` summary gains the journey; `rsvp.review`). The QR still holds only an opaque token; the secret lives in the server env only. Message bodies are not stored; skip reasons are codes.

## 8. Scope and dependencies

**Phase 1:** everything above. **Phase 2:** change of date or venue (hold the affected messages, then reschedule or send a change notice after the client approves, new template `athar_event_change`); a settings page for the journey defaults (offsets, hours, grace) instead of code constants. **Dropped:** seats per guest (D-52). Depends on the six templates being approved at Meta.

## 9. Open questions

- The exact wording of the contact-permission declaration (D-54) with the client.
- The final template texts follow the brief §05–06; Meta may ask for changes.
