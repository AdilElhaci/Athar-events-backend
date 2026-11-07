# SP-05: QR and check-in

*Status: Approved outline. Implementation: see [progress](../delivery/progress.md) (`T-P1-10`, `T-P4-03`, `T-P4-04`).*

## 1. Purpose and source

Primary owner of **FR-07** (quotation 07: unique unguessable code per guest; scanning page in the mobile browser (PWA), requires internet; prevent duplicate scans; attendance updated immediately). Decisions [D-08](../product/decisions.md) (**scanning requires the authenticated event owner**), [D-12](../product/decisions.md), [D-13](../product/decisions.md); [ADR-0005](../adr/0005-scanner-access-model.md).

## 2. Actors and triggers

- Guest accepts → QR issued and sent ([SP-04](SP-04-whatsapp-campaigns-rsvp-replacements.md)).
- Guest opens the recovery link `/i/<token>`.
- **Event owner**, signed in on a door device, scans guests.
- Admin reissues a QR.

## 3. Inputs

Raw QR token (from the camera: either the full URL `https://<domain>/i/<token>` or the bare token), event id, owner session.

## 4. Behaviour

### Issue

On acceptance: generate 32 random bytes → base64url token (43 chars); store `qr_token_hash = sha256(token)`, increment `qr_version`, set `qr_issued_at`; render a PNG of `https://<domain>/i/<token>` and send it ([SP-04](SP-04-whatsapp-campaigns-rsvp-replacements.md)). The token itself is never stored. Reissue (admin) and a later decline replace or clear the hash, which invalidates the old code. *Implementation (2026-11-08):* acceptance creates a `QR` intent for version `n`; the sender generates the token, writes its hash and sends the image in one step, so the token only exists in memory. A retry before delivery issues a fresh token for the same version; a decline or a newer version cancels it.

### Guest page

`/i/[token]` calls `GET /public/invitations/:token`; shows the QR (rendered client-side from the URL token), guest name, event name, date, venue and map link; status banner for admitted/revoked/closed. `no-store`, `noindex`, `Referrer-Policy: no-referrer`, no analytics. Opening the page never checks in.

### Scan mode (owner)

1. `/scan` lists the owner's events with open or upcoming admission windows (`GET /scan/events`); if not signed in, redirect to sign-in with return to `/scan`.
2. `/scan/[eventId]` is a full-screen PWA view: camera permission prompt with explanation, rear camera by default, torch toggle if supported, manual code entry fallback, counter "admitted / accepted", "sign out of this device".
3. Each detection posts `POST /scan/events/:eventId/check-ins`; the camera pauses until the result is shown (1.5 s for success, tap to continue for errors); the same token detected again within 3 s is ignored client-side.
4. Server: verify owner of event, event `ACTIVE` and paid, window open; hash the token; one statement:
   `UPDATE guests SET checked_in_at = now(), checked_in_by_user_id = $user WHERE event_id = $event AND qr_token_hash = $hash AND rsvp = 'ACCEPTED' AND checked_in_at IS NULL RETURNING name, checked_in_at`.
   If no row: look up by hash to return `ALREADY_ADMITTED` (with original time and name), `NOT_ACCEPTED`, `WRONG_EVENT` (hash belongs to another event of any owner → reported without details), or `INVALID`.
5. Results: `ADMITTED` (green, check icon, guest name, "دخول مسموح"), `ALREADY_ADMITTED` (amber, warning icon, original time), `INVALID`/`NOT_ACCEPTED`/`WRONG_EVENT`/`WINDOW_CLOSED` (red, cross icon, reason). Vibration pattern per result where supported; `aria-live="assertive"`.

### PWA

Web app manifest scoped to `/scan`, standalone display, Arabic name, icons; no offline support (out of scope) — the page shows a clear "no connection" state and does not queue scans.

## 5. Acceptance criteria

AC-07-1 to AC-07-6, plus: an admin or another owner calling the scan endpoint gets 403/404 (TC-QR-05); a revoked token returns `INVALID` (TC-QR-04); 20 concurrent scans of one token produce one `ADMITTED` (TC-QR-03).

## 6. Technical design

- Module `checkin`: `scan.controller.ts` (`/scan/*`, `@RequireUserType(OWNER)` + ownership), `public-invitations.controller.ts`, `checkin.service.ts`, `qr.service.ts` (issue, hash, render).
- Library: `qrcode` (server PNG); frontend scanning with a maintained browser QR decoder (e.g. `@zxing/browser` or `qr-scanner`), chosen in P1 after a real-device test on iPhone Safari and Android Chrome.
- Frontend: `(Scanner)/scan/page.tsx` (SCR-30), `(Scanner)/scan/[eventId]/page.tsx` (SCR-31, SCR-32), `(Guest)/i/[token]/page.tsx` (SCR-40).

## 7. Security, permissions, audit

Owner-only scanning ([D-08](../product/decisions.md)); rate limit 120 scans/min per user; tokens never logged; `checked_in_by_user_id` recorded; QR reissue audited. Accepted risks: a forwarded QR admits whoever presents it first (door compares the displayed name); door staff using the owner's session can see the owner's dashboard on that device ([ADR-0005](../adr/0005-scanner-access-model.md#consequences)).

## 8. Scope and dependencies

In: online scanning by the owner, duplicate prevention, manual code entry, QR recovery page. Out: offline scanning, staff accounts, re-entry/exit tracking, printed badges, export. Depends on SP-01, SP-04.

## 9. Open questions

[OQ-03](../product/open-questions.md) (one admission per invitation), [OQ-15](../product/open-questions.md) (admin scanning, window, shared device), [OQ-23](../product/open-questions.md) (reissue).
