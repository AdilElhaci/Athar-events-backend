# Data model

**Status: proposed schema; identity, `packages`, `events`, `articles` and `article_images` are migrated.** PostgreSQL, TypeORM entities, conventions in [conventions.md](conventions.md#data-access-and-invariants). Every table has `id uuid PK`, `created_at timestamptz`, and `updated_at timestamptz` where rows change; these are omitted below. Columns are written in snake_case as stored.

## Entity map

```text
users ─1:N─ events ─1:N─ guests ─1:N─ whatsapp_messages
  │           │  │          │  └─ replacement_for_guest_id ─▶ guests (decline that funded it)
  │           │  │          └─ guest_import_rows ◀─ guest_imports
  │           │  ├─1:N─ invitation_contents (versioned, one approved)
  │           │  └─1:N─ payment_attempts
  ├─1:N─ refresh_tokens
otp_challenges (by email)   packages (catalogue; snapshotted into events)
whatsapp_inbound   webhook_receipts   admin_actions
contact_messages (public form; no link to users)
```

## Identity

**Implemented 2026-10-24** (migration `1792795910832-InitialAuth`, password model per [D-27](../product/decisions.md)). Full column definitions are in the entities under `src/modules/{users,auth,admin-actions}`.

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `users` | `type` (`OWNER`, `PLATFORM_ADMIN`), `status` (`ACTIVE`, `INVITED`, `SUSPENDED`), `name`, `email` (lower-cased), `password_hash` (argon2id, nullable for invited admins, never selected by default), `email_verified_at`, `session_version`, `password_changed_at`, `last_login_at` | `UNIQUE(email)` |
| `email_challenges` | Registration codes before an account exists: `email`, `name`, `code_hash` (HMAC with `OTP_SECRET`), `attempts`, `expires_at`, `consumed_at`, `superseded_at` | Index `(email, purpose, created_at)`; attempts counted by conditional `UPDATE … WHERE attempts < 5` |
| `auth_tokens` | Purpose-bound single-use tokens: `REGISTER` (15 min), `PASSWORD_RESET` (30 min), `ADMIN_INVITE` (24 h); `token_hash` (SHA-256), `email`, `user_id`, `used_at`, `revoked_at` | `UNIQUE(token_hash)`; partial `UNIQUE(email, purpose) WHERE used_at IS NULL AND revoked_at IS NULL`; FK → users |
| `sessions` | One per signed-in device; `id` = JWT `sid`; `expires_at`, `revoked_at`, `revoked_reason`, `ip`, `user_agent` | FK → users (cascade) |
| `refresh_tokens` | Rotating tokens of a session: `token_hash` (HMAC with `TOKEN_PEPPER`), `expires_at`, `rotated_at` | `UNIQUE(token_hash)`; FK → sessions (cascade) |
| `admin_actions` | Append-only admin log (`admin.invited`, `admin.promoted`, …) | Index on `created_at` |

Lock order in every session operation: user → session → refresh token.

## Catalogue

### packages

| Column | Type | Notes |
| --- | --- | --- |
| name | varchar(80) | Arabic display name |
| description | text null | |
| invitation_allowance | int | `CHECK (> 0)` |
| extra_margin | int | `CHECK (>= 0)` |
| price_halalas | int | `CHECK (> 0)` |
| currency | varchar(3) default `SAR` | |
| is_active, is_featured | boolean default `false` | Only active packages are listed publicly |
| sort_order | int default 0 | |

## Events

### events

| Column | Type | Notes |
| --- | --- | --- |
| owner_id | uuid → users | Index |
| reference_code | varchar(16) | Human reference shown to owner and admin (`AE-000123`), `UQ`; from a sequence |
| name | varchar(120) | |
| starts_at | timestamptz | Venue time entered in `Asia/Riyadh` |
| timezone | varchar(40) default `Asia/Riyadh` | |
| venue_name | varchar(160) | |
| venue_map_url | varchar(500) null | `https://` only |
| requested_send_at | timestamptz null | Owner's wish; admin confirms `send_at` |
| package_id | uuid → packages null | Reference only |
| package_name, invitation_allowance, extra_margin, price_halalas, currency | snapshot | Copied at creation; frozen once a payment attempt exists (AC-04-2) |
| status | enum (`DRAFT`, `ACTIVE`, `CLOSED`, `CANCELLED`) | |
| payment_status | enum (`UNPAID`, `PENDING`, `PAID`, `REFUNDED`) | |
| list_status | enum (`AWAITING_LIST`, `IN_PROGRESS`, `READY`) | |
| approval_status | enum (`NOT_REQUESTED`, `AWAITING_OWNER`, `APPROVED`) | |
| campaign_status | enum (`NOT_SCHEDULED`, `SCHEDULED`, `SENDING`, `PAUSED`, `SENT`, `CANCELLED`) | |
| approved_content_id | uuid → invitation_contents null | |
| send_at | timestamptz null | Set when scheduled |
| schedule_version | int default 0 | Incremented on every schedule/reschedule/pause; jobs carry it and no-op on mismatch |
| admission_opens_at, admission_closes_at | timestamptz | Defaults `starts_at − 3h` / `starts_at + 12h` ([OQ-15](../product/open-questions.md)) |
| paid_at, cancelled_at, closed_at | timestamptz null | |

Checks: `send_at < starts_at` and `requested_send_at < starts_at` when set; `admission_opens_at < admission_closes_at`. Migrated 2026-11-02 (`AddEvents`), except `approved_content_id`, which arrives with `invitation_contents`.

### invitation_contents

One row per content version of the invitation for an event.

| Column | Type | Notes |
| --- | --- | --- |
| event_id | uuid → events | |
| version | int | `UQ (event_id, version)` |
| template_name, template_language | varchar | Approved Meta template (`ar`) |
| variables | jsonb | Non-guest variables (event name, date text, venue, map link) |
| rendered_preview | text | Full Arabic text with a sample guest name, exactly as shown to the owner |
| content_hash | varchar(64) | SHA-256 of template + variables |
| approved_at, approved_by_user_id | null | Approval record ([D-15](../product/decisions.md)) |
| override_reason, overridden_by_user_id | null | Admin override if the client allows it ([OQ-02](../product/open-questions.md)) |

## Payments

### payment_attempts

Follows Athar's `billing_payment_attempts`.

| Column | Type | Notes |
| --- | --- | --- |
| event_id, owner_id | uuid | |
| amount | int | Halalas, from the event snapshot |
| currency | varchar(3) | |
| id | uuid | Generated by the API before the invoice is created, so `metadata.paymentAttemptId` can carry it |
| status | enum (`PENDING`, `PAID`, `FAILED`, `EXPIRED`) | Only `PENDING` changes; created `PENDING` together with the invoice (no `INITIATED` state) |
| expires_at | timestamptz null | When the hosted invoice stops accepting payment |
| moyasar_invoice_id | varchar(120) null | Partial `UQ` where not null |
| moyasar_payment_id | varchar(120) null | Partial `UQ` where not null |
| payment_url | varchar(500) null | Hosted invoice URL |
| failure_code, failure_message | null | |
| paid_at, last_reconciled_at | timestamptz null | |
| metadata | jsonb | No card data beyond brand/last4 |

Migrated 2026-11-02 (`AddPayments`). Indexes on `event_id` and `(status, created_at)` for reconciliation.

Constraint: `UQ_payment_attempts_event_paid` — partial unique `(event_id) WHERE status = 'PAID'`. A second successful payment for the same event cannot be applied and is raised as a reconciliation alert (manual refund).

## Guests

### guests

| Column | Type | Notes |
| --- | --- | --- |
| event_id | uuid → events | |
| name | varchar(120) | |
| phone | varchar(16) null | `+9665XXXXXXXX`; required by the DTOs, null only after retention anonymisation; `UQ (event_id, phone)` ([OQ-03](../product/open-questions.md)) |
| kind | enum (`INITIAL`, `RESERVE`) | |
| source | enum (`MANUAL`, `IMPORT`) | `import_id` when imported |
| allocation_status | enum (`NOT_ALLOCATED`, `ALLOCATED`) | `ALLOCATED` = counted against allowance or margin and eligible to receive the invitation |
| allocated_at | timestamptz null | |
| replacement_for_guest_id | uuid → guests null | Partial `UQ`; `CHECK (kind = 'RESERVE' OR replacement_for_guest_id IS NULL)` |
| rsvp | enum (`PENDING`, `ACCEPTED`, `DECLINED`) | |
| rsvp_at | timestamptz null | |
| rsvp_locked | boolean default false | True once this decline funded a replacement ([D-16](../product/decisions.md)) |
| qr_token_hash | varchar(64) null | SHA-256 of the current token; partial `UQ` |
| qr_version | int default 0 | Incremented on each issue; previous tokens are invalid because the hash changed |
| qr_issued_at | timestamptz null | |
| checked_in_at | timestamptz null | Set once |
| checked_in_by_user_id | uuid → users null | The owner session that scanned ([D-08](../product/decisions.md)) |
| note | varchar(200) null | Admin-only |
| deleted_at | timestamptz null | Only while `allocation_status = NOT_ALLOCATED` |

Quota invariants (enforced in one transaction holding `SELECT … FOR UPDATE` on the event row):

- `count(kind = INITIAL, not deleted) ≤ invitation_allowance`
- `count(kind = RESERVE, not deleted) ≤ extra_margin` (AC-04-3)
- `count(replacement_for_guest_id IS NOT NULL) ≤ extra_margin`
- each `replacement_for_guest_id` points to a guest of the same event with `rsvp = DECLINED`, and is unique

### guest_imports and guest_import_rows

`guest_imports`: `event_id`, `file_name` (sanitised), `file_sha256`, `status` (`PREVIEWED`, `APPLIED`, `EXPIRED`, `FAILED`), `counts` jsonb, `created_by_user_id`, `applied_by_user_id`, `applied_at`, `preview_expires_at` (30 min). The uploaded file is parsed in memory and never stored.

`guest_import_rows`: `import_id`, `row_number`, `raw_name`, `raw_phone` (formula-neutralised, ≤ 40 chars), `name`, `phone`, `kind`, `result` (`VALID`, `INVALID`, `DUPLICATE_IN_FILE`, `DUPLICATE_EXISTING`, `OVER_LIMIT`), `reason` (i18n key). Rows are deleted with the import 7 days after apply.

## Messaging

### whatsapp_messages (outbound intents)

| Column | Type | Notes |
| --- | --- | --- |
| event_id, guest_id | uuid | |
| kind | enum (`INVITATION`, `QR`, `QR_TEMPLATE`) | `QR` = in-window image; `QR_TEMPLATE` = approved template outside the window |
| logical_key | varchar(120) | `UQ`; e.g. `invitation:<guestId>:<contentVersion>`, `qr:<guestId>:<qrVersion>` — a retry or duplicate job can never create a second intent |
| schedule_version | int | Copied from the event; a mismatch at claim time cancels the intent |
| qr_version | int null | QR intents: the guest `qr_version` this message issues (`CHECK`: required unless `INVITATION`) |
| state | enum (`QUEUED`, `SENDING`, `SENT`, `FAILED`, `UNKNOWN`, `CANCELLED`) | Send attempt outcome |
| delivery_status | enum (`NONE`, `SENT`, `DELIVERED`, `READ`, `FAILED`) | From Meta status webhooks; monotonic (`READ` never goes back to `DELIVERED`) |
| provider_message_id | varchar(128) null | Partial `UQ` (`wamid…`) |
| claimed_at, claimed_by | null | Worker claim; stale after 2 minutes |
| attempt_count | smallint | Only definite pre-send failures are retried (max 3) |
| last_error_code, last_error | null | Provider code only, no payload |
| sent_at, delivered_at, read_at, failed_at | timestamptz null | |
| resolved_by_user_id, resolved_at, resolution | null | Admin resolution of `UNKNOWN` (`MARK_SENT`, `MARK_FAILED`, `RESEND`) |

### whatsapp_inbound

Minimal record of inbound button replies; free text is never stored.

| Column | Type | Notes |
| --- | --- | --- |
| provider_message_id | varchar(128) | `UQ` (dedupe) |
| context_message_id | varchar(128) null | The invitation `wamid` the guest replied to |
| from_phone | varchar(16) | Normalised sender; compared with the guest's phone |
| type | enum (`BUTTON`, `TEXT`, `OTHER`) | |
| button_payload | varchar(64) null | `RSVP_ACCEPT` / `RSVP_DECLINE` |
| guest_id | uuid null | When matched |
| outcome | enum (`APPLIED`, `UNMATCHED`, `LOCKED`, `DUPLICATE`, `AFTER_EVENT`, `IGNORED`) | `IGNORED`: not an RSVP button (free text, media, unknown payload); a redelivered message is skipped by the unique id, so `DUPLICATE` is not written |
| received_at | timestamptz | Deleted with guest data per retention ([OQ-10](../product/open-questions.md)) |

### webhook_receipts

`provider` (`MOYASAR`, `META`), `dedupe_key` (Moyasar `<payment id>:<event type>`; Meta status id + status), `UQ (provider, dedupe_key)`, `received_at`, `processed_at`, `outcome`, `error_code`. Raw payloads are not stored. A delivery whose `processed_at` is still null (the Moyasar fetch failed) is handled again on the provider's retry. Migrated 2026-11-02 (`AddPayments`).

## Contact

### contact_messages

Messages from the public contact form ([D-34](../product/decisions.md)).

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| name | varchar(120) | |
| phone | varchar(20) | `9665XXXXXXXX` |
| subject | text | Up to 2000 characters by the DTO; never edited |
| status | enum `contact_message_status` | `NEW`, `READ`, `REPLIED`, `CLOSED`; default `NEW`; `IDX_contact_messages_status` |
| created_at, updated_at | timestamptz | `IDX_contact_messages_created_at` |

Rows are deleted permanently. The client IP is not stored.

## Content

### articles

«دفتر أثر» guides managed by admins ([D-36](../product/decisions.md)). Plain text only; stored HTML is never rendered.

| Column | Type | Notes |
| --- | --- | --- |
| slug | varchar(120) | `UQ_articles_slug`; lowercase latin words and digits |
| title | varchar(160) | |
| excerpt | varchar(600) null | Summary: homepage card and article lead |
| category | varchar(60) null | Free label, not a taxonomy; optional, not shown since 2026-11-03 |
| reading_minutes | int null | Entered by the admin, 1 to 120 |
| cover_url | varchar(200) null | `/api/articles/images/:id`, or `/articles/*` in the web app's `public` folder; never another origin |
| cover_alt | varchar(200) null | |
| sections | jsonb default `[]` | `[{ heading, body }]`, 20 at most |
| takeaway | varchar(400) null | «خذها معك»; optional, the box is hidden when null |
| status | enum `articles_status_enum` | `DRAFT`, `PUBLISHED`; default `DRAFT`; `IDX_articles_status_published_at` |
| published_at | timestamptz null | Set by the server on first publish; kept when unpublished |

`CHK_articles_published_complete`: a `PUBLISHED` row has `published_at`, `excerpt`, `reading_minutes`, `cover_url`, `cover_alt` and at least one section (`category` and `takeaway` stay optional, migration `RelaxArticlePublishCheck`). Rows are deleted permanently.

### article_images

Uploaded covers: `data` bytea, `content_type` varchar(20). Stored here so they follow blue/green deploys and database backups. A cover is removed when replaced or when its article is deleted; an upload never saved to an article stays as an unreferenced row.

## Audit

### admin_actions

Append-only (no update/delete path in code).

| Column | Type | Notes |
| --- | --- | --- |
| actor_user_id | uuid → users | |
| action | varchar(60) | e.g. `package.update`, `guests.import_apply`, `campaign.schedule`, `replacement.send`, `qr.reissue`, `message.resolve`, `user.suspend`, `event.refund_mark` |
| target_type, target_id | varchar, uuid | |
| event_id | uuid null | For per-event filtering |
| summary | jsonb | Counts, changed field names and the admin's reason (free text, the form asks not to include guest names or numbers); no names or phones written by code |
| ip_address | inet null | |

Check-ins are attributed through `guests.checked_in_by_user_id`; failed scans are not stored in the MVP.

## Retention

Default, pending [OQ-10](../product/open-questions.md). A scheduled job, 90 days after `starts_at`: guest names → `'—'`, phones → null, QR hashes → null, `whatsapp_inbound` rows deleted, `whatsapp_messages` errors cleared. Aggregate counts on the event are kept.
