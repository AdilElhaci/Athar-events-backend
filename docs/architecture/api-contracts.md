# API contracts

**Status: proposed contract, provisional until each endpoint is implemented and its tests pass.** Envelope, errors and pagination follow [conventions](conventions.md#api-conventions). All paths are under `/api`. Swagger at `/api/docs` is the generated source of truth once code exists; this page is the planning contract and the frontend handoff.

Legend — **Auth**: `public`, `owner` (`OWNER` and owns the event), `admin` (`PLATFORM_ADMIN`), `any` (any signed-in user), `provider` (webhook verification).

## Authentication — [SP-01](../specs/SP-01-auth-and-roles.md)

| Method | Path | Auth | Request | Response `data` | Notes / codes |
| --- | --- | --- | --- | --- | --- |
**Implemented 2026-10-24** (password model, [D-27](../product/decisions.md) / [ADR-0007](../adr/0007-password-authentication.md)); supersedes the earlier `/auth/otp/*` outline. Every `POST /auth/*` endpoint requires an allowlisted `Origin` and `X-Requested-With: athar-events` (403 `auth.csrf` otherwise).

| Method | Path | Auth | Request | Response `data` | Notes / codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/auth/register/start` | public | `{ name, email }` | `null` | Always the same response (`auth.registration_started`); new email → 6-digit code; existing account → notice email |
| POST | `/auth/register/verify` | public | `{ email, code }` | `{ registrationToken }` | 400 `auth.code_invalid` (wrong, expired or 5 attempts used); 429 `auth.code_locked` (15/hour per email) |
| POST | `/auth/register/complete` | public | `{ registrationToken, password }` | `{ accessToken, expiresIn }` | Creates an `OWNER`, sets cookies; 400 `auth.registration_token_invalid`, `password.*`; 409 `auth.account_exists` |
| POST | `/auth/login` | public | `{ email, password }` | `{ accessToken, expiresIn }` | Sets `athar_events_rt` (HttpOnly, Secure in production, SameSite=Lax, Path=`/api/auth`, host-only) and `athar_events_session=1`; 401 `auth.invalid_credentials` (generic); 429 |
| POST | `/auth/refresh` | cookie | — | `{ accessToken, expiresIn, user }` | Rotates the cookie; 401 `auth.session_expired` clears cookies; 409 `auth.refresh_race` keeps cookies (retry once) |
| POST | `/auth/logout` | cookie | — | `null` | Revokes this device's session, clears cookies |
| POST | `/auth/logout-all` | bearer | — | `null` | Revokes every session and access token of the user |
| GET | `/auth/me` | bearer | — | `IUser` | |
| POST | `/auth/forgot-password` | public | `{ email }` | `null` | Always the same response; link `…/auth/reset-password#token=…` valid 30 min |
| POST | `/auth/reset-password` | public | `{ token, password }` | `null` | Single use; revokes all sessions; 400 `auth.reset_token_invalid`, `password.*` |
| POST | `/auth/accept-invite` | public | `{ token, password }` | `null` | Admin invite (24 h); 400 `auth.invite_invalid`, `password.*` |
| GET | `/admin/users` | admin | `?page&limit(≤100)&search&type&status` | `Paginated<IUser>` | 401 without token, 403 for owners; search matches name or email literally |

`IUser = { id, type: 'OWNER' | 'PLATFORM_ADMIN', status: 'ACTIVE' | 'INVITED' | 'SUSPENDED', name, email, emailVerifiedAt, lastLoginAt, createdAt }`. The access token (JWT HS256, 15 min, carries `sid` and `sv`) is sent as `Authorization: Bearer`. Administrators are created only by the server CLI (`admin:create`), never over HTTP.

## Public

| Method | Path | Auth | Response `data` | Notes |
| --- | --- | --- | --- | --- |
| GET | `/packages` | public | `IPackage[]` (active, sorted) | Landing and event creation |
| GET | `/articles` | public | `Paginated<IArticleCard>` | Published only, newest first ([D-36](../product/decisions.md)) |
| GET | `/articles/:slug` | public | `IArticle` | 404 for drafts and unknown slugs |
| GET | `/articles/images/:id` | public | Image bytes | No JSON envelope; `Cache-Control: immutable` |
| POST | `/contact` | public (CSRF header) | `null` | `{ name, phone, subject, website? }`; honeypot, 5 per IP per hour; stored and e-mailed ([D-34](../product/decisions.md)) |
| GET | `/public/invitations/:token` | public (bearer token in path) | `{ guestName, eventName, startsAt, venueName, venueMapUrl, status: 'VALID' \| 'ADMITTED' \| 'CLOSED', checkedInAt, qrSvg }` | **Implemented.** `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`; never checks in; 404 for unknown, revoked or declined codes (a revoked hash is gone, so there is no `REVOKED`); `qrSvg` is null once closed; 30/min per IP |

## Owner — events — [SP-02](../specs/SP-02-packages-events-payments.md)

| Method | Path | Auth | Request | Response `data` | Notes / codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/events` | owner | `{ packageId, name, startsAt, venueName, venueMapUrl?, requestedSendAt? }` | `IEvent` | Implemented 2026-11-02. 403 for admins; 422 `events.package_inactive`, `events.starts_in_past`, `events.send_after_start`, `events.send_in_past` |
| GET | `/events` | owner | `?page&limit&search&status` | `Paginated<IEventListItem>` | Own events only |
| GET | `/events/:id` | owner | — | `IEvent` (with state dimensions, `nextAction`, `editable`, `packageEditable`) | 404 if not owned |
| PATCH | `/events/:id` | owner | editable fields | `IEvent` | 409 `events.locked` once approved/scheduled; 409 `events.package_locked` once checkout started; changing `startsAt` resets the admission window |
| POST | `/events/:id/checkout` | owner | — | `{ paymentUrl, paymentAttemptId }` | **Implemented** (T-P2-07). 200; CSRF; 10/min. Reuses an open attempt with more than 15 minutes left; 409 `events.already_paid`, 409 `events.closed`, 422 `events.starts_in_past`, 503 `payments.unavailable` |
| GET | `/events/:id/payment-status` | owner | `?paymentAttemptId` | `{ paymentStatus, attemptStatus }` | **Implemented** (T-P2-08). Fetches from Moyasar at most every 5 s per pending attempt; 60/min; a Moyasar outage returns the stored state. `attemptStatus` is null before any checkout. Used by `/dashboard/events/:id/payment` |
| GET | `/events/:id/summary` | owner | — | `IEventSummary` | **Implemented** (T-P4-05). Polled every 10 s; 404 unless owned |
| GET | `/events/:id/guests` | owner | `?page&limit&search&kind&rsvp&admitted` | `Paginated<IOwnerGuest> & { counts }` | **Implemented.** Phones masked `+9665•••••123`; search by name only; 404 unless owned |
| GET | `/events/:id/invitation` | owner | — | `{ content: IInvitationContent \| null, approvable: boolean }` | **Implemented.** Latest version + rendered preview; 404 unless owned |
| POST | `/events/:id/invitation/approve` | owner | `{ contentId, contentHash }` | `{ content, approvable }` | **Implemented.** 409 `invitation.version_outdated` if the id or hash is not the latest; idempotent |
| GET | `/events/guest-list-template` | owner, admin | — | `.xlsx` file | **Implemented.** The fixed template ([SP-03](../specs/SP-03-guests-and-import.md#excel-template)); `Cache-Control: no-store` |

`IEventSummary = { invited, delivered, read, accepted, declined, noReply, extras: { cap, used, available }, admitted, updatedAt }` — definitions in [SP-04](../specs/SP-04-whatsapp-campaigns-rsvp-replacements.md#counts).

## Scanner — [SP-05](../specs/SP-05-qr-and-check-in.md)

| Method | Path | Auth | Request | Response `data` | Notes / codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/scan/events` | owner | — | `{ id, name, startsAt, admissionOpensAt, admissionClosesAt, isOpen }[]` | **Implemented.** Owner's paid, live events whose window is open or opens within 24 h |
| POST | `/scan/events/:eventId/check-ins` | owner | `{ token }` (raw token or the full QR URL) | `{ result, guestName?, checkedInAt?, admittedCount }` | `result ∈ ADMITTED, ALREADY_ADMITTED, INVALID, NOT_ACCEPTED, WRONG_EVENT, WINDOW_CLOSED`; **Implemented.** Always 200 for scan outcomes; 403 for admins, 404 for another owner's event; 120/min per user (429) |
| GET | `/scan/events/:eventId/stats` | owner | — | `{ admitted, accepted }` | |

## Admin — [SP-02](../specs/SP-02-packages-events-payments.md), [SP-03](../specs/SP-03-guests-and-import.md), [SP-04](../specs/SP-04-whatsapp-campaigns-rsvp-replacements.md)

| Method | Path | Request | Response `data` | Notes / codes |
| --- | --- | --- | --- | --- |
| GET | `/admin/dashboard` | — | `{ stages: Record<stage, number>, alerts: { overdueCampaigns, paymentsToRefund } }` | **Implemented** (T-P2-06). `overdueCampaigns` follows the [operations alert](operations.md); `paymentsToRefund` counts payments taken but not applied and not yet refunded (T-P2-09). An unknown-sends alert is still to come |
| GET | `/admin/events` | `?stage&needsAction&page&limit&search` | `Paginated<IAdminEventListItem>` | **Implemented.** `stage ∈ awaiting_payment, awaiting_list, awaiting_approval, scheduled, sending, needs_attention, done`. `needsAction=true` keeps `awaiting_list`, `awaiting_approval`, `needs_attention`, soonest first (SCR-20); otherwise newest date first. Search matches event name, reference or owner name. `IAdminEventListItem = { id, referenceCode, name, startsAt, ownerName, packageName, stage, nextAction }` |
| GET | `/admin/events/:id` | — | `IAdminEvent` | **Implemented.** `IEvent` plus `stage` and `owner { id, name, email, phone }` |
| PATCH | `/admin/events/:id` | changed fields of `name, startsAt, venueName, venueMapUrl, requestedSendAt, admissionOpensAt, admissionClosesAt`, plus `reason` (3–300) | `IAdminEvent` | **Implemented.** Audited as `event.corrected`; a corrected date moves the window with it; changing name, date or venue moves an approved invitation back to `AWAITING_OWNER` until sending starts ([D-15](../product/decisions.md)). 409 `events.closed`; 422 `events.send_after_start`, `events.send_in_past`, `events.starts_in_past`, `events.admission_window_invalid` |
| POST | `/admin/events/:id/list-status` | `{ status: 'IN_PROGRESS' \| 'READY' }` | `IAdminEvent` | **Implemented.** `READY` requires ≥ 1 initial guest (422 `guests.ready_requires_guest`); back to `IN_PROGRESS` refused after approval (409 `guests.list_locked`); audited `event.list_status` |
| GET | `/admin/events/:id/invitation` | — | `{ template: { name, status, body, buttons }, content, versions, suggested, preconditions }` | **Implemented.** |
| POST | `/admin/events/:id/invitation` | `{ eventName, dateText, venue }` (template from `WHATSAPP_INVITATION_TEMPLATE`) | same as GET | **Implemented.** New version unless unchanged; sets approval `AWAITING_OWNER`; 422 `invitation.variable_invalid`, `campaign.not_paid`; 409 `invitation.locked` while scheduled |
| POST | `/admin/events/:id/invitation/override` | `{ contentId, reason }` | same as GET | **Implemented.** Admin approval with a reason (D-40); audited `invitation.override` |
| POST | `/admin/events/:id/schedule` | `{ sendAt }` | `IAdminEvent` | **Implemented.** 422 `campaign.not_paid`, `campaign.list_not_ready`, `campaign.not_approved`, `campaign.template_not_approved`, `events.send_in_past`, `campaign.send_after_event`; 409 `campaign.already_started`; reschedule allowed; audited `campaign.schedule` |
| POST | `/admin/events/:id/pause` / `/resume` / `/cancel-campaign` | `{ reason? }` (resume: none) | `IAdminEvent` | **Implemented.** `cancel-campaign` for a scheduled event (back to `NOT_SCHEDULED`, `send_at` cleared, increments `schedule_version`). `pause`: `SENDING` → `PAUSED`, 409 `campaign.not_sending`. `resume`: `PAUSED` → `SENDING`, 409 `campaign.not_paused`, `events.closed`, `campaign.event_started`. Pause/resume keep `schedule_version`; all audited |
| POST | `/admin/events/:id/mark-refunded` | `{ reason }` (3–300) | `IAdminEvent` | Paid events only (409 `events.not_paid`); cancels the event, its campaign (unless `SENT`) and queued messages; revokes QR codes ([OQ-16](../product/open-questions.md)); audited `event.refunded` |
| GET | `/admin/events/:id/guests` | `?page&limit&search&kind&rsvp` | `Paginated<IAdminGuest> & { counts: { initial, reserve, allowance, extraMargin } }` | **Implemented.** Full phone; search by name or phone digits. `delivery` filter arrives with sending (P3/P4) |
| POST | `/admin/events/:id/guests` | `{ name, phone, kind, note? }` | `IAdminGuest` | **Implemented.** 409 `guests.phone_duplicate`, 422 `guests.allowance_exceeded` / `guests.reserve_exceeded` / `guests.event_unpaid` / `imports.row.*`; 409 `guests.list_locked` once sending is scheduled |
| PATCH / DELETE | `/admin/events/:id/guests/:guestId` | fields | `IAdminGuest` / `null` | **Implemented.** 409 `guests.locked_after_allocation`; delete is soft and frees the number |
| POST | `/admin/events/:id/guest-imports` | multipart `file` (.xlsx ≤ 2 MB) | `IGuestImport` (`counts`, `previewExpiresAt`) | **Implemented.** Parses in memory; 400 `imports.unreadable`, `imports.missing_columns`, `imports.too_many_rows`; 413 above 2 MB |
| GET | `/admin/events/:id/guest-imports/:importId/rows` | `?result&page&limit` | `Paginated<IImportRow>` | **Implemented.** |
| POST | `/admin/events/:id/guest-imports/:importId/apply` | — | `IGuestImport` with `counts.created`, `counts.skipped` | **Implemented.** Only `VALID` rows that still fit (re-checked under the event lock); 409 `imports.expired`; idempotent; audited `guests.import_apply` |
| GET | `/admin/events/:id/replacements` | — | `{ extras, eligibleDeclines, reserves, sent, blockedReason }` | **Implemented.** SCR-24 |
| POST | `/admin/events/:id/replacements` | `{ count }` or `{ guestIds: string[] }` | `{ allocated: IAdminGuest[], extras }` | **Implemented.** 422 `replacements.count_or_guests`, `replacements.guest_invalid`, `replacements.no_declines_available`, `replacements.margin_exhausted`, `replacements.no_reserves`; 409 `replacements.campaign_not_started`, `replacements.event_started`, `events.closed`; audited |
| POST | `/admin/guests/:guestId/qr/reissue` | `{ reason }` | `IAdminGuest` | Revokes the old QR, sends a new one by template. Not built: needs the QR template (T-P3-09) |
| GET | `/admin/events/:id/messages` | `?state&delivery&kind&page&limit` | `Paginated<IMessage>` | **Implemented** (also `needsAction=true`: `UNKNOWN`/`FAILED`, not resolved). Newest first; rows carry guest name and phone |
| POST | `/admin/messages/:messageId/resolve` | `{ resolution: 'MARK_SENT' \| 'MARK_FAILED' \| 'RESEND', reason }` | `{ message: IMessage, resendId }` | **Implemented.** `MARK_SENT`/`MARK_FAILED` for `UNKNOWN` only, `RESEND` for `UNKNOWN`/`FAILED`; 409 `messages.not_resolvable`, `messages.resolution_invalid`, `messages.guest_replied`, `messages.already_sent`, `messages.event_started`, `messages.guest_gone`, `messages.guest_not_accepted`; 422 `messages.window_closed` (QR after 23 h), `messages.kind_unsupported`; audited |
| GET / POST / PATCH | `/admin/packages`, `/admin/packages/:id` | package fields | `IPackage` | `GET` is paginated and includes inactive packages. No delete: deactivate |
| GET | `/admin/users` | `?type&status&search&page&limit` | `Paginated<IAdminUser>` | |
| PATCH | `/admin/users/:id/status` | `{ status }` | `IAdminUser` | Cannot suspend yourself |
| GET | `/admin/contact-messages` | `?status&search&page&limit` | `Paginated<IContactMessage>` | Newest first; search matches name, subject and phone (05… or +966…) literally |
| GET | `/admin/contact-messages/new-count` | — | `{ count }` | Sidebar indicator, polled every 60 s |
| GET | `/admin/contact-messages/:id` | — | `IContactMessage` | No side effect |
| POST | `/admin/contact-messages/:id/read` | — | `IContactMessage` | `NEW` → `READ` only; any other status is returned unchanged |
| POST | `/admin/contact-messages/:id/status` | `{ status: 'NEW' \| 'READ' \| 'REPLIED' \| 'CLOSED' }` | `IContactMessage` | Audited |
| DELETE | `/admin/contact-messages/:id` | — | `null` | Permanent; audited |
| GET | `/admin/articles` | `?status&search&page&limit` | `Paginated<IAdminArticleListItem>` | Latest edit first; search matches the title literally |
| GET | `/admin/articles/:id` | — | `IAdminArticle` | |
| POST | `/admin/articles` | article fields | `IAdminArticle` | Audited; 409 `article.slug_taken`; 422 `article.incomplete` when published without excerpt, reading time, cover, cover alt or a section (category and takeaway are optional) |
| PATCH | `/admin/articles/:id` | article fields | `IAdminArticle` | Audited; same errors; `published_at` is set by the server on first publish |
| DELETE | `/admin/articles/:id` | — | `null` | Permanent; removes the uploaded cover; audited |
| POST | `/admin/articles/images` | multipart `file` | `{ url }` | JPEG, PNG or WebP by content, 2 MB at most (413 above it); not audited |
| GET | `/admin/payments` | `?status&needsAction&page&limit&search` | `Paginated<IAdminPayment>` | Newest first; with event and owner; `needsAction` = taken but not applied and not yet refunded (`refundNeeded`); search matches event name, reference, owner name or e-mail, Moyasar ids |
| POST | `/admin/payments/:id/reconcile` | — | `IAdminPayment` | `PENDING` only (409 `payments.not_pending`); fetches from Moyasar now (503 `payments.provider_unavailable`); audited |
| POST | `/admin/payments/:id/refund-done` | `{ reason }` (3–300) | `IAdminPayment` | Records the manual refund of a payment taken but not applied (409 `payments.no_refund_needed`); the event is untouched; audited |
| GET | `/admin/actions` | `?eventId&actorId&action&page&limit` | `Paginated<IAdminAction>` | Newest first, with the actor (null for the server CLI); `eventId` also matches actions whose summary names the event (messages, payments) |
| GET | `/admin/actions/names` | — | `string[]` | Action names present in the log (filter) |

## Provider webhooks — [integrations](integrations.md)

| Method | Path | Verification | Behaviour |
| --- | --- | --- | --- |
| POST | `/payments/moyasar/webhook` | `secret_token` in body, timing-safe compare, 401 on failure **Implemented** (T-P2-08). Dedupe by payment id + type in `webhook_receipts`; fetch the attempt's **invoice** by `data.invoice_id` from Moyasar; apply idempotently; 200 `{ outcome }`; 500 while Moyasar is unreachable so Moyasar retries; no throttle |
| POST | `/payments/moyasar/invoice-callback` | None from Moyasar → **re-fetch** the invoice by id before acting | **Implemented.** Only the body's `id` is read, and only an id that belongs to one of our attempts is fetched; same apply path |
| GET | `/whatsapp/webhook` | `hub.verify_token` | Returns `hub.challenge` |
| POST | `/whatsapp/webhook` | `X-Hub-Signature-256` HMAC of the raw body with the app secret, 401 on failure | Persist receipts per message/status, enqueue apply job, return 200 |

## Arabic summary for frontend work (ملخص للفرونت اند)

- كل الطلبات على `/api`، والرد الناجح شكله `{ success, message, data }`، والخطأ `{ success:false, message, error, statusCode, code }`. اعتمدوا على `code` وليس نص الرسالة.
- تسجيل الدخول برمز تحقق فقط: `POST /auth/otp/request` ثم `POST /auth/otp/verify`. التوكن (access) يُحفظ في الذاكرة فقط (Redux)، والـ refresh في كوكي HttpOnly لا يقرأه الجافاسكربت. عند فتح التطبيق نستدعي `POST /auth/refresh` مرة واحدة قبل أي طلب محمي، ونمنع التوازي في التجديد (طلب تجديد واحد في نفس الوقت).
- `proxy.ts` يقرأ كوكي `athar_events_session` فقط للتوجيه، وليس للصلاحيات.
- طلبات صاحب المناسبة على `/events/...`، وطلبات الأدمن على `/admin/...` — نقاط نهاية منفصلة، بدون إعادة كتابة الرابط حسب الدور.
- ملخص المناسبة `GET /events/:id/summary` يُستدعى كل 10 ثوانٍ مع `skipErrorToast`، ونعرض «آخر تحديث» بدلاً من رسائل خطأ متكررة.
- المسح: `POST /scan/events/:eventId/check-ins` يرجع دائماً 200 مع `result`؛ نعرض النتيجة بأيقونة ونص ولون معاً.
- صفحة الضيف `/i/[token]` تستدعي `GET /public/invitations/:token` ولا تسجّل الدخول أبداً.
