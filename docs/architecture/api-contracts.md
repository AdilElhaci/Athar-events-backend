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
| GET | `/public/invitations/:token` | public (bearer token in path) | `{ guestName, eventName, startsAt, venueName, venueMapUrl, status: 'VALID' \| 'ADMITTED' \| 'REVOKED' \| 'CLOSED' }` | `Cache-Control: no-store`; never checks in; 404 for unknown tokens; rate-limited |

## Owner — events — [SP-02](../specs/SP-02-packages-events-payments.md)

| Method | Path | Auth | Request | Response `data` | Notes / codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/events` | any¹ | `{ packageId, name, startsAt, venueName, venueMapUrl?, requestedSendAt? }` | `IEvent` | ¹ creates as owner; 422 `events.package_inactive`, 422 `events.starts_in_past` |
| GET | `/events` | owner | `?page&limit&search&status` | `Paginated<IEventListItem>` | Own events only |
| GET | `/events/:id` | owner | — | `IEvent` (with state dimensions and next action) | 404 if not owned |
| PATCH | `/events/:id` | owner | editable fields | `IEvent` | 409 `events.locked` once approved/scheduled; package change only before checkout |
| POST | `/events/:id/checkout` | owner | — | `{ paymentUrl, paymentAttemptId }` | Reuses an open attempt; 409 `events.already_paid` |
| GET | `/events/:id/payment-status` | owner | `?paymentAttemptId` | `{ paymentStatus, attemptStatus }` | Triggers a server-side Moyasar fetch if `PENDING` (rate-limited); used by `/payment/return` |
| GET | `/events/:id/summary` | owner | — | `IEventSummary` | Polled every 10 s |
| GET | `/events/:id/guests` | owner | `?page&limit&search&rsvp&admitted` | `Paginated<IOwnerGuest>` | Phones masked `+9665•••••123` |
| GET | `/events/:id/invitation` | owner | — | `{ content: IInvitationContent, approvable: boolean }` | Latest version + rendered preview |
| POST | `/events/:id/invitation/approve` | owner | `{ contentId, contentHash }` | `IInvitationContent` | 409 `invitation.version_outdated` if hash differs |
| GET | `/events/guest-list-template` | any | — | `.xlsx` file | The fixed template ([SP-03](../specs/SP-03-guests-and-import.md#excel-template)) |

`IEventSummary = { invited, delivered, read, accepted, declined, noReply, extras: { cap, used, available }, admitted, updatedAt }` — definitions in [SP-04](../specs/SP-04-whatsapp-campaigns-rsvp-replacements.md#counts).

## Scanner — [SP-05](../specs/SP-05-qr-and-check-in.md)

| Method | Path | Auth | Request | Response `data` | Notes / codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/scan/events` | owner | — | `{ id, name, startsAt, admissionOpensAt, admissionClosesAt, isOpen }[]` | Owner's paid events whose window is open or opens within 24 h |
| POST | `/scan/events/:eventId/check-ins` | owner | `{ token }` (raw token or the full QR URL) | `{ result, guestName?, checkedInAt?, admittedCount }` | `result ∈ ADMITTED, ALREADY_ADMITTED, INVALID, NOT_ACCEPTED, WRONG_EVENT, WINDOW_CLOSED`; always 200 for scan outcomes; 403/404 for authorization; rate-limited per user |
| GET | `/scan/events/:eventId/stats` | owner | — | `{ admitted, accepted }` | |

## Admin — [SP-02](../specs/SP-02-packages-events-payments.md), [SP-03](../specs/SP-03-guests-and-import.md), [SP-04](../specs/SP-04-whatsapp-campaigns-rsvp-replacements.md)

| Method | Path | Request | Response `data` | Notes / codes |
| --- | --- | --- | --- | --- |
| GET | `/admin/dashboard` | — | queue counts per stage, alerts (unknown sends, payments to reconcile, overdue) | |
| GET | `/admin/events` | `?stage&page&limit&search` | `Paginated<IAdminEventListItem>` | `stage ∈ awaiting_payment, awaiting_list, awaiting_approval, scheduled, sending, needs_attention, done` |
| GET | `/admin/events/:id` | — | `IAdminEvent` | Includes owner contact |
| PATCH | `/admin/events/:id` | correction fields, `reason` | `IAdminEvent` | Audited; admission window editable |
| POST | `/admin/events/:id/list-status` | `{ status: 'IN_PROGRESS' \| 'READY' }` | `IAdminEvent` | `READY` requires ≥ 1 initial guest |
| POST | `/admin/events/:id/invitation` | `{ templateName, variables }` | `IInvitationContent` | New version; sets approval `AWAITING_OWNER` |
| POST | `/admin/events/:id/schedule` | `{ sendAt }` | `IAdminEvent` | 422 `campaign.not_paid`, `campaign.not_approved`, `campaign.list_not_ready`, `campaign.send_after_event` |
| POST | `/admin/events/:id/pause` / `/resume` / `/cancel-campaign` | `{ reason? }` | `IAdminEvent` | Each increments `schedule_version` |
| POST | `/admin/events/:id/mark-refunded` | `{ reason }` | `IAdminEvent` | Cancels event; revokes QR codes ([OQ-16](../product/open-questions.md)) |
| GET | `/admin/events/:id/guests` | `?page&limit&search&kind&rsvp&delivery` | `Paginated<IAdminGuest>` | Full phone visible to admins |
| POST | `/admin/events/:id/guests` | `{ name, phone, kind, note? }` | `IAdminGuest` | 409 `guests.phone_duplicate`, 422 `guests.allowance_exceeded` |
| PATCH / DELETE | `/admin/events/:id/guests/:guestId` | fields | `IAdminGuest` / `{}` | 409 `guests.locked_after_allocation` |
| POST | `/admin/events/:id/guest-imports` | multipart `file` (.xlsx ≤ 2 MB) | `IGuestImportPreview` | Parses in memory; 400 `imports.unreadable`, `imports.missing_columns`, `imports.too_many_rows` |
| GET | `/admin/events/:id/guest-imports/:importId/rows` | `?result&page&limit` | `Paginated<IImportRow>` | |
| POST | `/admin/events/:id/guest-imports/:importId/apply` | — | `{ created, skipped }` | Only `VALID` rows; 409 `imports.expired`; idempotent |
| POST | `/admin/events/:id/replacements` | `{ count }` or `{ guestIds: string[] }` | `{ allocated: IAdminGuest[], extras }` | 422 `replacements.no_declines_available`, `replacements.margin_exhausted`, `replacements.no_reserves` |
| POST | `/admin/guests/:guestId/qr/reissue` | `{ reason }` | `IAdminGuest` | Revokes the old QR, sends a new one by template |
| GET | `/admin/events/:id/messages` | `?state&delivery&kind&page&limit` | `Paginated<IMessage>` | Message log |
| POST | `/admin/messages/:messageId/resolve` | `{ resolution: 'MARK_SENT' \| 'MARK_FAILED' \| 'RESEND', reason }` | `IMessage` | Only for `UNKNOWN`/`FAILED` |
| GET / POST / PATCH | `/admin/packages`, `/admin/packages/:id` | package fields | `IPackage` | Deactivate instead of delete once used |
| GET | `/admin/users` | `?type&status&search&page&limit` | `Paginated<IAdminUser>` | |
| POST | `/admin/users` | `{ email, name }` | `IAdminUser` | Creates a `PLATFORM_ADMIN` |
| PATCH | `/admin/users/:id/status` | `{ status }` | `IAdminUser` | Cannot suspend yourself |
| GET | `/admin/payments` | `?status&page&limit&search` | `Paginated<IPayment>` | |
| POST | `/admin/payments/:id/reconcile` | — | `IPayment` | Forces a Moyasar fetch |
| GET | `/admin/actions` | `?eventId&actorId&action&page&limit` | `Paginated<IAdminAction>` | |

## Provider webhooks — [integrations](integrations.md)

| Method | Path | Verification | Behaviour |
| --- | --- | --- | --- |
| POST | `/payments/moyasar/webhook` | `secret_token` in body, timing-safe compare, 401 on failure | Dedupe by payment id + type; fetch the payment from Moyasar; apply idempotently; 200 quickly |
| POST | `/payments/moyasar/invoice-callback` | None from Moyasar → **re-fetch** the invoice by id before acting | Same apply path |
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
