# Scope and acceptance

**Source:** quotation `عرض-سعر-منصة-الدعوات.pdf`, dated 2026-10-18, sections 1–7. English wording below is a translation; where the Arabic and this page differ, the quotation wins and the difference is an [open question](open-questions.md).

## 1. Product summary

An event owner chooses a package, pays, and sends their guest list to the platform's administrators. An administrator enters or imports the list, the owner approves the invitation, and the administrator schedules a WhatsApp campaign. Each guest answers **Accept** or **Decline** with a WhatsApp button. Guests who accept receive a unique QR code that is scanned at the venue entrance. The owner follows results in their dashboard.

Commercial frame: fixed price **12,000 SAR** (15% VAT added if applicable), **4–5 working weeks** from first payment and receipt of all client accounts, **14 days** of post-launch bug-fix support, **two revision rounds per phase**, payments **40% / 30% / 30%** (signing / working demo of the user dashboard and payment / launch). Source-code ownership transfers after full payment. Additions are priced separately.

## 2. Actors

| Actor | Description | Authenticated as |
| --- | --- | --- |
| Event owner | Buys a package for one event, approves the invitation, follows results, **scans guests at the venue** ([D-08](decisions.md)) | `OWNER` (email OTP) |
| Platform admin | Client's operations staff: arranges guest lists, runs campaigns, manages packages, users, payments | `PLATFORM_ADMIN` (email OTP, allowlisted) |
| Guest | Receives the invitation on WhatsApp, replies, presents the QR code | Not authenticated; holds a bearer QR credential |
| Payment provider (Moyasar), Meta WhatsApp Cloud API | External systems calling webhooks | Provider-specific verification |

## 3. Functional requirements

Each FR maps to one primary spec. Acceptance criteria are observable and testable; criteria that depend on an unanswered question say so.

### FR-01 Landing page — [SP-06](../specs/SP-06-landing.md)

Quotation 01: an introductory page built on a ready-made template with the client's identity; service introduction, how it works, prices, contact; mobile-friendly; Arabic.

- AC-01-1 The page renders in Arabic, right-to-left, with sections: hero, how it works (4 steps), packages, FAQ, contact, footer with privacy and terms links.
- AC-01-2 Package cards show the **active packages from the API** (name, invitation count, extra margin, price in SAR), not hard-coded values.
- AC-01-3 The primary call to action leads to sign-in and, after sign-in, to event creation with the chosen package preselected.
- AC-01-4 At 360 px width there is no horizontal scroll and every interactive target is at least 44×44 px.
- AC-01-5 Lighthouse mobile performance ≥ 85 and accessibility ≥ 95 on the staging build (target, verified in P5).

### FR-02 Accounts and sign-in — [SP-01](../specs/SP-01-auth-and-roles.md)

Quotation 02: sign-up and sign-in with an email one-time code; no password, so no "forgot password" page.

- AC-02-1 Entering an email sends a 6-digit code; the response is identical whether or not the email has an account.
- AC-02-2 A correct code within 5 minutes signs the user in; a new email becomes an `OWNER` account and is asked for a display name once.
- AC-02-3 After 5 wrong attempts the code is unusable; a new code can be requested after a 60-second cooldown; per-email and per-IP limits apply.
- AC-02-4 Sessions survive a page reload (refresh cookie) and end on sign-out on that device.
- AC-02-5 `PLATFORM_ADMIN` cannot be obtained by sign-up; admins are created by an existing admin or the bootstrap seed.

### FR-03 Owner dashboard — [SP-02](../specs/SP-02-packages-events-payments.md), [SP-04](../specs/SP-04-whatsapp-campaigns-rsvp-replacements.md)

Quotation 03: choose a package and create the event (name, date and time, location, send time); the owner does not upload data — they send their guest list to the administration, and it appears in their dashboard after an admin arranges it; preview the invitation text before sending; follow results: invited, accepted, declined, no reply, remaining extra invitations, actual attendance.

- AC-03-1 The owner creates an event with name, date and time (Asia/Riyadh), venue name, map link and requested send time, choosing an active package.
- AC-03-2 An unpaid event shows a payment action and cannot be scheduled.
- AC-03-3 A paid event awaiting its list shows exactly how to send the list ([OQ-04](open-questions.md)) and the event reference number.
- AC-03-4 Once an admin has entered the list, the owner sees it read-only (name, masked phone, RSVP, admission) with search and filters.
- AC-03-5 The owner previews the rendered invitation (with a sample guest name) and approves it ([D-15](decisions.md), pending [OQ-02](open-questions.md)).
- AC-03-6 Counts shown: invited (messages accepted by WhatsApp), delivered, accepted, declined, no reply, extras used / available / cap, admitted. Each count has a definition tooltip; a "last updated" time is visible; data refreshes at least every 10 seconds while the page is open ([NFR-05](#non-functional-requirements)).
- AC-03-7 An owner can never read another owner's events, guests or counts (403/404).

### FR-04 Packages and extra invitations — [SP-02](../specs/SP-02-packages-events-payments.md), [SP-04](../specs/SP-04-whatsapp-campaigns-rsvp-replacements.md)

Quotation 04: packages defined by the admin — invitation count, price, extra-invitation margin (e.g. 300 + 30); extra invitations are sent in place of guests who decline, within the package margin.

- AC-04-1 An admin creates, edits, activates and deactivates packages (name, invitation allowance, extra margin, price in halalas, sort order, featured flag).
- AC-04-2 A package edit never changes an event that has already started checkout: the event holds a snapshot of the package terms.
- AC-04-3 The initial list cannot exceed the allowance; reserve guests can be added up to the margin.
- AC-04-4 Each decline unlocks at most one replacement; replacements never exceed the margin; two simultaneous replacement requests cannot exceed either limit (concurrency test) — rule per [D-16](decisions.md), pending [OQ-01](open-questions.md).

### FR-05 Online payment — [SP-02](../specs/SP-02-packages-events-payments.md)

Quotation 05: integration with a Saudi payment gateway (e.g. Moyasar or Tap) through its ready-made payment page; pay the package price; the event is activated only after successful payment.

- AC-05-1 Checkout opens the Moyasar hosted invoice for the snapshot price in SAR.
- AC-05-2 The event becomes paid **only** after the backend retrieves the payment/invoice from Moyasar and the amount, currency and reference match; the browser return URL alone never activates it.
- AC-05-3 A webhook or callback replayed twice changes nothing the second time.
- AC-05-4 A payment that succeeds while the browser is closed still activates the event (webhook, callback or reconciliation job within 15 minutes).
- AC-05-5 Refunds are manual in the Moyasar dashboard (out of scope); an admin can mark an event refunded, which cancels it.

### FR-06 WhatsApp invitations — [SP-04](../specs/SP-04-whatsapp-campaigns-rsvp-replacements.md)

Quotation 06: WhatsApp Business API; invitation template with two buttons, Accept and Decline; scheduled sending; guest status updated automatically; QR sent to guests who accept.

- AC-06-1 An approved template with two quick-reply buttons is sent to every initial guest at the scheduled time, in batches, from the client's WhatsApp number.
- AC-06-2 A button reply updates that guest's RSVP within 10 seconds of the webhook; a reply that cannot be matched to an invitation changes nothing and is logged.
- AC-06-3 An accepted guest receives the QR image (and recovery link) on WhatsApp; outside the 24-hour window a pre-approved template is used ([OQ-14](open-questions.md)).
- AC-06-4 A send whose outcome is uncertain is marked `unknown` and **never** resent automatically; an admin resolves it.
- AC-06-5 An overdue campaign is not sent after the event's start time, even after an outage.
- AC-06-6 Delivery status (sent, delivered, read, failed) is recorded per message without an older status overwriting a newer one.

### FR-07 QR code and check-in — [SP-05](../specs/SP-05-qr-and-check-in.md)

Quotation 07: unique, unguessable code per guest; scanning page in the mobile browser (PWA), requires internet; prevent duplicate scans; attendance updated immediately.

- AC-07-1 Each accepted guest has one active QR credential (256-bit random, stored only as a hash); reissuing revokes the previous one.
- AC-07-2 The scanning page requires the **authenticated owner of that event** ([D-08](decisions.md)); any other account, or no session, gets no check-in capability.
- AC-07-3 A valid first scan admits the guest and shows the guest's name; a second scan of the same code on any device shows "already admitted" with the original time; two devices scanning simultaneously produce exactly one admission (concurrency test).
- AC-07-4 Scanning is accepted only inside the event's admission window ([OQ-15](open-questions.md)).
- AC-07-5 Results are shown with icon, text and colour (not colour alone) and are announced to screen readers.
- AC-07-6 The admitted count in the owner dashboard reflects a scan within 10 seconds.

### FR-08 Admin dashboard — [SP-03](../specs/SP-03-guests-and-import.md), [SP-04](../specs/SP-04-whatsapp-campaigns-rsvp-replacements.md), [SP-02](../specs/SP-02-packages-events-payments.md)

Quotation 08: built on a ready-made admin panel; receive guest lists from users and enter/arrange them per event (from Excel or manually), reflected immediately in the user's dashboard; launch the WhatsApp campaign and send extra invitations based on declines within the margin; manage packages, prices and margin dynamically; manage users and events; view payments and the message log.

- AC-08-1 An events queue groups events by next action: awaiting payment, awaiting list, awaiting approval, scheduled, sending, needs attention, done.
- AC-08-2 An admin adds guests manually or imports the [fixed `.xlsx` template](../specs/SP-03-guests-and-import.md#excel-template); the preview shows valid rows, invalid rows with reasons and duplicates before anything is saved.
- AC-08-3 An admin schedules, pauses and resumes a campaign; scheduling requires payment, an approved invitation and a ready list.
- AC-08-4 An admin sends replacements; the screen shows extras used, available and cap.
- AC-08-5 An admin manages packages (AC-04-1), users (list, suspend, reactivate, create admin) and views payments and the per-message log with filters.
- AC-08-6 Every admin write action is recorded in the admin action log with actor, time, target and summary.

### FR-09 Launch — [operations](../architecture/operations.md)

Quotation 09: deploy to hosting and connect the domain; configure email settings for verification codes (SPF / DKIM / DMARC); full testing; 14 days of bug-fix support after launch.

- AC-09-1 Production runs on the hosting the client approved ([OQ-06](open-questions.md)) at the client's domain over HTTPS.
- AC-09-2 SPF, DKIM and DMARC pass for the OTP sender domain (mail-tester or provider report recorded).
- AC-09-3 A backup is restored to a scratch database and the restore is recorded before launch.
- AC-09-4 The [P5 verification checklist](../qa/test-strategy.md#release-checklist) passes and is recorded in the [verification log](../qa/verification-log.md).
- AC-09-5 The 14-day support window, its contact channel and response expectations are written down ([OQ-11](open-questions.md)).

## Non-functional requirements

| ID | Requirement | Measure | Source |
| --- | --- | --- | --- |
| NFR-01 | Arabic only, right-to-left | `lang="ar" dir="rtl"`; logical CSS; mixed-direction values isolated | Quotation 01; multi-language excluded |
| NFR-02 | Mobile-friendly | Owner, landing, scanner and guest surfaces usable at 360 px; admin optimised for ≥ 1280 px and usable on tablet | Quotation 01, 07 |
| NFR-03 | Security | [Security and privacy](../architecture/security-and-privacy.md) controls; no authorization in the frontend only | Engineering baseline |
| NFR-04 | Privacy (PDPL) | Guest data minimised, masked, access-logged, retention defined ([OQ-10](open-questions.md)) | Quotation 7 (client responsibility) + engineering controls |
| NFR-05 | "Live" results | Owner counts refresh ≤ 10 s; scan result ≤ 2 s on 4G | Proposed target, [OQ-09](open-questions.md) |
| NFR-06 | Reliability of sending | No duplicate invitation from a retry; no send after event start; uncertain sends surfaced | Engineering baseline |
| NFR-07 | Accessibility | WCAG 2.2 AA as target; verified checks listed in [UX acceptance](../ux/accessibility-and-acceptance.md) | Engineering baseline |
| NFR-08 | Observability | Correlated logs (request, event, guest, provider ids) without personal data; alerts listed in [operations](../architecture/operations.md) | Engineering baseline |
| NFR-09 | Recoverability | Daily off-host backup; restore tested before launch | Quotation 09 |
| NFR-10 | Capacity envelope | One event up to its package size (e.g. 300 + 30); several events in parallel; tested at 1,000 guests in one event | Proposed, [OQ-21](open-questions.md) |

## Out of scope

From the quotation, section 3 (each can be priced later): offline QR scanning; automatic refunds (manual from the gateway dashboard); automatic ZATCA (Fatoora) integration; email invitations; reminder messages and SMS; multiple languages; advanced reports; fully custom design or an invitation-card designer; native Android/iOS apps.

Also not built in the MVP (planning decisions, see [decisions](decisions.md)): owner upload of guest lists (quotation 03; channel in [OQ-04](open-questions.md)); companions / plus-ones ([OQ-03](open-questions.md)); delegated door-staff accounts ([D-08](decisions.md)); multiple campaigns or invitation variants per event; real-time sockets.

## Delivery milestones

| Milestone | Payment | Acceptance |
| --- | --- | --- |
| Signing | 40% — 4,800 SAR | Quotation signed; P0 answers and accounts in progress |
| Demo | 30% — 3,600 SAR | FR-02, FR-03 (AC-03-1…3), FR-04 (AC-04-1, 2), FR-05 pass on staging; sandbox payment acceptable only if the client agrees ([OQ-07](open-questions.md)) |
| Launch | 30% — 3,600 SAR | All FR acceptance criteria pass on production; [release checklist](../qa/test-strategy.md#release-checklist) recorded |

## Traceability

The chain is **requirement → decision → spec → screens → API → implementation → evidence**. "Implementation" is `Missing` for every FR at this date; live status is in [progress.md](../delivery/progress.md).

| FR | Decisions | Open questions | Spec | Screens | Main API | Tasks | Tests | Implementation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FR-01 | D-17, D-18 | OQ-13 | SP-06 | SCR-01 | `GET /packages` | T-P1-08 | TC-UX-01…03 | Missing |
| FR-02 | D-06, D-07 | OQ-20 | SP-01 | SCR-02, SCR-03 | `/auth/*` | T-P1-04…06 | TC-AUTH-01…09 | Missing |
| FR-03 | D-14, D-15 | OQ-02, OQ-04, OQ-09 | SP-02, SP-04 | SCR-10…15 | `/events/*` | T-P2-03…05, T-P3-03, T-P3-04, T-P4-05 | TC-EVT-01…07 | Missing |
| FR-04 | D-16 | OQ-01 | SP-02, SP-04 | SCR-21, SCR-24 | `/admin/packages`, `/admin/events/:id/replacements` | T-P2-01, T-P4-01…02 | TC-PKG-01…04, TC-REP-01…06 | Missing |
| FR-05 | D-10 | OQ-07, OQ-08 | SP-02 | SCR-11, SCR-12 | `/events/:id/checkout`, `/payments/moyasar/*` | T-P2-02, T-P2-07…09 | TC-PAY-01…08 | Missing |
| FR-06 | D-09, D-11 | OQ-14, OQ-19, OQ-22, OQ-24 | SP-04 | SCR-23, SCR-25 | `/admin/events/:id/schedule`, `/whatsapp/webhook` | T-P1-10, T-P3-04…09 | TC-WA-01…10 | Missing |
| FR-07 | D-08, D-12, D-13 | OQ-15, OQ-23 | SP-05 | SCR-30…32, SCR-40 | `/scan/*`, `/public/invitations/:token` | T-P1-10, T-P3-09, T-P4-03…04 | TC-QR-01…09 | Missing |
| FR-08 | D-07, D-17 | OQ-05 | SP-03 (+SP-02, SP-04) | SCR-20…27 | `/admin/*` | T-P2-01, T-P2-06, T-P2-09, T-P3-01…03, T-P3-06, T-P4-02, T-P4-06…07 | TC-ADM-01…06, TC-IMP-01…08 | Missing |
| FR-09 | D-19 | OQ-06, OQ-10, OQ-11 | operations.md | — | — | T-P1-01…03, T-P5-* | TC-OPS-01…05 | Missing |
