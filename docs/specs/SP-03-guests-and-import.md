# SP-03: Guests and import

*Status: Approved outline. Implementation: see [progress](../delivery/progress.md) (`T-P3-01` to `T-P3-03`).*

## 1. Purpose and source

Primary owner of the guest-list parts of **FR-08** (quotation 08: receive guest lists from users and enter/arrange them per event, from Excel or manually, reflected immediately in the user's dashboard) and the read-only guest list in **FR-03** (quotation 03: the owner does not upload data). Reference: Athar `excel-email-parser.ts` and `saudi-phone.helper.ts` (technique only, [D-24](../product/decisions.md)).

## 2. Actors and triggers

- Owner sends the list outside the app ([OQ-04](../product/open-questions.md)) and downloads the template from the dashboard.
- Admin imports the file or adds guests manually, then marks the list ready.
- Owner views the list read-only.

## 3. Inputs

### Excel template

One `.xlsx` file, first sheet, header row in Arabic or English (both accepted):

| Column | Header (ar / en) | Rule |
| --- | --- | --- |
| A | الاسم / name | Required, 2–120 characters after trimming |
| B | الجوال / phone | Required, Saudi mobile in any common format (05…, 5…, 9665…, +9665…, Arabic-Indic digits, spaces, dashes, direction marks) |
| C | النوع / type | Optional: `أساسي`/`initial` (default) or `احتياطي`/`reserve` |
| D | ملاحظة / note | Optional, ≤ 200 characters |

Limits: ≤ 2 MB, ≤ 2,000 data rows ([OQ-05](../product/open-questions.md), [OQ-18](../product/open-questions.md)).

## 4. Behaviour

1. **Preview** (`POST /admin/events/:id/guest-imports`): parse in memory; normalise phones; classify each row `VALID`, `INVALID` (reason key), `DUPLICATE_IN_FILE`, `DUPLICATE_EXISTING` (phone already on the event), `OVER_LIMIT` (would exceed allowance or reserve cap, counted in row order); store the import and rows; nothing is added to `guests`.
2. **Review**: the admin sees counts and filters rows by result; invalid rows show the neutralised raw value and the reason.
3. **Apply**: within 30 minutes, in one transaction holding the event row lock, insert `VALID` rows that still fit the limits; mark the import `APPLIED`; repeat calls return the same result. Audited (`guests.import_apply`).
4. **Manual entry**: add/edit/delete one guest with the same validation; deletion and phone edits are blocked after allocation.
5. **List readiness**: admin sets `list_status = IN_PROGRESS` on first change and `READY` explicitly; `READY` requires at least one initial guest and moves approval to `AWAITING_OWNER` if an invitation content exists.
6. **Owner view**: the owner sees name, masked phone (`+9665•••••123`), kind, RSVP, admitted, with search by name and filters; updated on the next poll after admin changes.

## 5. Acceptance criteria

AC-03-4, AC-04-3, AC-08-2, plus: an import with 300 valid, 5 invalid, 3 duplicate rows previews exactly those counts and applies 300 (TC-IMP-01); a formula cell `=HYPERLINK(...)` is neutralised in the preview (TC-IMP-05); applying twice adds nothing the second time (TC-IMP-04); two admins applying imports concurrently never exceed the allowance (TC-IMP-07).

## 6. Technical design

- Module `guests`: `admin-guests.controller.ts`, `owner-guests.controller.ts` (`/events/:id/guests`), `guest-import.service.ts`, `guests.service.ts`, `utils/guest-sheet.parser.ts`, `utils/phone.ts`.
- Tables: `guests`, `guest_imports`, `guest_import_rows`.
- Template download: generated with `exceljs` at request time (`GET /events/guest-list-template`), Arabic headers, an example row, data validation on column C.
- Frontend: SCR-14 (owner guest list), SCR-22 (admin guests tab), SCR-22a (import dialog with preview table).

## 7. Security, permissions, audit

Admin only for writes; owner read filtered by ownership with masked phones; file never stored on disk or served; import and edits audited without names/phones in the summary.

## 8. Scope and dependencies

In: one fixed template, manual entry, reserve flag. Out: column mapping, owner upload, contact book across events, companions, international numbers (unless [OQ-18](../product/open-questions.md) changes). Depends on SP-02 (paid event).

## 9. Open questions

[OQ-03](../product/open-questions.md), [OQ-04](../product/open-questions.md), [OQ-05](../product/open-questions.md), [OQ-18](../product/open-questions.md), [OQ-21](../product/open-questions.md).
