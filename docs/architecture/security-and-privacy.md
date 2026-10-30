# Security and privacy

**Status: planned controls.** The quotation makes the client responsible for guests' consent and for WhatsApp and PDPL compliance (section 7). That contractual allocation does not replace engineering controls; the controls below are part of the build.

## Authorization matrix

| Capability | Visitor | Guest (token) | Owner | Platform admin |
| --- | --- | --- | --- | --- |
| View packages, landing | ✓ | ✓ | ✓ | ✓ |
| Register / sign in with password | ✓ | — | ✓ | ✓ (CLI-provisioned account; no public admin sign-up) |
| Create event, pay | — | — | Own | — |
| View event, summary, guest list | — | — | Own (phones masked) | All (full phones) |
| Approve invitation | — | — | Own | Override with reason (if [OQ-02](../product/open-questions.md) allows) |
| Enter/import guests, mark list ready | — | — | — | ✓ |
| Schedule / pause / cancel campaign | — | — | — | ✓ |
| Send replacements, reissue QR, resolve messages | — | — | — | ✓ |
| Scan and admit guests | — | — | Own event, inside the admission window ([D-08](../product/decisions.md)) | Only if [OQ-15](../product/open-questions.md) allows (default: no) |
| View own QR page | — | Own token | — | — |
| Manage packages, users, payments, action log | — | — | — | ✓ |

Enforcement is on the backend only: `JwtAuthGuard` → `UserTypeGuard` → ownership check in the service. The frontend hides what a role cannot do but is never the control. Non-owned resources return 404.

## Threats and controls

| Threat | Control | Test |
| --- | --- | --- |
| Password guessing, code guessing or email bombing | argon2id; generic 401; 10 failures per IP+email and 50 per email per 15 min (no hard lock); registration code: 5 attempts, 10 min, 15/hour per email; per-address email budget 1/60 s and 5/hour; Redis-backed, atomic counters ([ADR-0007](../adr/0007-password-authentication.md)) | e2e suite (2026-10-24) |
| Account enumeration | Identical responses on register/start, login and forgot-password; one argon2 verification always runs | e2e suite |
| Token theft by XSS | Access token in memory (15 min); refresh token HttpOnly + Secure + SameSite=Lax, path `/api/auth`; strict CSP on the frontend; no `dangerouslySetInnerHTML` with user content | TC-AUTH-06 |
| CSRF on cookie-authenticated endpoints | Only `/auth/refresh` and `/auth/logout` use the cookie; they require `Origin` in `CORS_ORIGINS` and a custom header (`X-Requested-With: athar-events`) | TC-AUTH-09 |
| Refresh-token replay / race | Atomic conditional rotation; reuse of a revoked token revokes the chain | TC-AUTH-07 |
| Privilege escalation | Admins only via seed or an existing admin; role read from DB on every request | TC-AUTH-05, TC-AUTH-08 |
| Cross-owner access (IDOR) | Ownership in every owner query (`WHERE owner_id = :userId`) | TC-EVT-05 |
| Payment spoofing | Activation only after fetching Moyasar and matching amount/currency/reference; browser return never activates | TC-PAY-01…04 |
| Webhook forgery / replay | Moyasar secret (timing-safe), Meta `X-Hub-Signature-256` over the raw body; `webhook_receipts` dedupe | TC-PAY-05, TC-WA-04 |
| QR guessing | 256-bit random tokens; only SHA-256 stored; rate limits on `/public/invitations` and scan endpoints | TC-QR-01, TC-QR-07 |
| QR forwarding | A QR is a bearer credential; the scan result shows the guest's name for the door to compare ([OQ-03](../product/open-questions.md)) | Accepted risk |
| Double admission | Conditional update `WHERE checked_in_at IS NULL` | TC-QR-03 |
| Over-sending / quota abuse | Event-row lock, unique replacement link, unique message logical key | TC-REP-02, TC-WA-02 |
| Spreadsheet formula injection | Neutralise `= + - @` on echo; parse in memory; size and row limits | TC-IMP-05 |
| Personal data in logs | Allowlisted log fields; no bodies, phones, names, codes, tokens or provider payloads | TC-SEC-03 |
| Open CORS, default secrets | Explicit `CORS_ORIGINS`; config validation refuses to boot without required secrets in production | TC-SEC-02 |
| Brute force on API | Global throttle 100 requests/min per user or IP (`ttl: 60_000`) | TC-SEC-01 |
| Door device left signed in | Scan mode is a separate full-screen route with a visible "sign out of this device" action; the owner can also "sign out of all devices" (`POST /auth/logout-all`), which revokes every refresh chain | TC-QR-08 |

## Personal data inventory

| Data | Where | Who sees it | Retention (default, [OQ-10](../product/open-questions.md)) |
| --- | --- | --- | --- |
| Owner email, name, phone | `users` | Owner, admins | While the account exists |
| Guest name, phone | `guests` | Admins (full), owner (masked phone), door (name only, after a valid scan) | Anonymised 90 days after the event |
| RSVP, admission time | `guests` | Owner, admins | Kept as aggregate after anonymisation |
| Message ids and statuses | `whatsapp_messages` | Admins | Errors cleared after 90 days |
| Inbound button replies | `whatsapp_inbound` | System only | Deleted after 90 days; free text never stored |
| Imported spreadsheets | Memory only; parsed rows in `guest_import_rows` | Admins | Rows deleted 7 days after apply |
| OTP challenges | `otp_challenges` | System only | Deleted after 30 days |
| Payment references, card brand/last4 | `payment_attempts` | Owner (own), admins | As required for accounting (client decision) |

## Processors

Data flows to: the hosting provider (all data), Meta (guest phone numbers, names in template variables, message content), Moyasar (owner payment), the email provider (owner and admin emails), and an error tracker if one is approved. The client approves this list and the hosting location before production data is loaded ([OQ-06](../product/open-questions.md)); transfers outside Saudi Arabia need the client's PDPL assessment.

## Secrets

| Secret | Purpose |
| --- | --- |
| `JWT_SECRET` (≥ 32 bytes) | Access tokens |
| `OTP_SECRET` (≥ 32 bytes, separate) | OTP code digests |
| `REFRESH_TOKEN_PEPPER` | Refresh token digests |
| `MOYASAR_SECRET_KEY`, `MOYASAR_WEBHOOK_SECRET` | Payments |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | WhatsApp |
| `MAIL_PASSWORD` | SMTP |
| Database runtime and migration passwords | Separate roles (W8) |

Rotation procedure and storage are in [operations](operations.md#secrets).
