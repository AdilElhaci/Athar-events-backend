# UX strategy and personas

**Status: approved baseline (2026-10-24).** There is no Athar Events UI yet. The visual and interaction vocabulary follows the existing Athar frontend ([D-18](../product/decisions.md), [reference alignment](../architecture/reference-alignment.md#athar-frontend-verified-from-source)), adapted to four very different surfaces.

## Design principles

1. **Always show the next step.** Every event screen answers "what happens next, and who does it?" (owner, admin, or the guests).
2. **Separate states, never one vague status.** Payment, list, approval, campaign, RSVP and admission are shown as distinct facts ([overview](../architecture/overview.md#state-dimensions-of-an-event)).
3. **Honest numbers.** Every count has a definition; data shows "last updated"; a failed refresh never shows zeros.
4. **Mobile first for owners, guests and the door; desktop first for admin bulk work.**
5. **Arabic first.** Right-to-left layout, Arabic copy written natively (not translated), Gregorian dates in Arabic, Western digits for phone numbers and codes (isolated left-to-right).
6. **Calm, not decorative.** No heavy animation; motion only for feedback and respects reduced motion.
7. **Consistency with Athar.** Same component wrappers, list-page anatomy, toasts and form behaviour, so the ecosystem feels like one product family.
8. **Accessible by default.** WCAG 2.2 AA as the target ([accessibility](accessibility-and-acceptance.md)).

## Personas

### P-1 Event owner — "Sara", organising her sister's wedding

- Context: phone, evenings, limited patience; first-time user; pays a significant amount; anxious about guests and the door.
- Goals: pay safely, be sure the invitation is correct, see who is coming, have a smooth entrance on the day.
- Frustrations: unclear status after paying, not knowing what to do with the guest list, numbers that do not add up, technology failing at the venue.
- Implications: guided event creation; a clear "send your list" instruction with the event reference; explicit approval of the exact invitation; counts with definitions; a simple scan mode she or a trusted relative can use on the day (signed in beforehand, [D-08](../product/decisions.md)).

### P-2 Platform admin — "Khalid", operations at the client

- Context: desktop, handles several events a day, receives lists in messy spreadsheets over WhatsApp.
- Goals: see which events need action, import lists quickly with clear errors, schedule safely, react to declines and failures.
- Frustrations: re-typing lists, silent failures, sending to the wrong event, owners asking "did it go out?".
- Implications: an action queue grouped by stage; an import preview with row-level reasons; guarded scheduling (all preconditions visible); a message log with uncertain sends highlighted; replacement allowance shown as used / available / cap.

### P-3 Door scanner — the owner or someone using the owner's signed-in phone at the entrance

- Context: noisy, dim hall; queue of guests; one hand; possibly weak mobile data.
- Goals: scan fast, get an unmistakable answer, handle problems without leaving the screen.
- Implications: full-screen camera, large result with icon + text + colour + vibration, guest name for comparison, manual code entry, admitted counter, connection status, nothing else on screen. Because scanning uses the owner's session, scan mode hides the dashboard navigation and offers "sign out of this device".

### P-4 Guest — any age, WhatsApp only

- Context: receives a WhatsApp message from an unknown business number.
- Goals: understand who invites them and when/where, answer in one tap, find the QR on the day.
- Implications: trustworthy template wording (host name, event, date, venue), two clear buttons, immediate acknowledgement, QR image plus a link that always reopens the QR; no account, no app.

## Core journeys

### J-1 Owner purchase (SCR-01 → SCR-02/03 → SCR-11 → Moyasar → SCR-12 → SCR-13)

Landing → choose package → sign in with email code → event details (name, date/time, venue, map link, preferred send time) → review → pay on Moyasar → return page confirms payment → event overview shows "send your guest list" with the event reference and the template download.

Friction removed: package preselected from the landing; profile name asked once; payment confirmation does not depend on the browser returning.

### J-2 List preparation and approval (admin SCR-22 → owner SCR-15)

Admin imports the file → fixes or skips invalid rows → marks list ready → creates the invitation content → owner gets the approval card on their overview → owner previews the rendered message (with a sample guest name) → approves.

### J-3 Campaign (admin SCR-23, owner SCR-13)

Admin schedules (preconditions checklist visible) → sending progress → owner sees invited/delivered/accepted/declined rising → declines unlock replacements → admin sends replacements → uncertain or failed messages appear in the message log for resolution.

### J-4 Guest RSVP (WhatsApp, SCR-40)

Invitation → tap "سأحضر" or "أعتذر" → acknowledgement message → if accepted, QR image + link → on the day opens the image or link.

### J-5 Door admission (SCR-30 → SCR-31/32)

Owner signs in on the door device the day before → on the day opens `/scan` → selects the event → grants camera → scans → result → next guest. Problems: already admitted (shows the original time), not accepted, invalid, wrong event, outside the window, no connection.

## UX risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Owner unsure how to send the list | Persistent instruction card with reference code, template download and the client's contact ([OQ-04](../product/open-questions.md)) |
| Invitation wording disputes | Explicit approval of the exact rendered version ([D-15](../product/decisions.md)) |
| Shared owner session at the door | Dedicated scan mode, no navigation, sign-out of this device; changing the password ends every session |
| Email code not received at the venue | Sign in on door devices the day before (event-day checklist) |
| Admin overload from messy lists | Template, preview and row reasons; skip invalid rows rather than blocking |
| Count confusion | Tooltips with definitions; "extras used / available / cap" instead of "remaining" |
