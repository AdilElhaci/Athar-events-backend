# SP-01: Authentication and roles

*Status: Implemented (2026-10-24, uncommitted) — password authentication per [D-27](../product/decisions.md) / [ADR-0007](../adr/0007-password-authentication.md), superseding the email-OTP-only outline. Progress: [ledger](../delivery/progress.md) `T-P1-04` to `T-P1-07`.*

## 1. Purpose and source

Primary owner of **FR-02**. The quotation (section 02) specified email-code sign-in without passwords; the owner decided on passwords with email verification, forgot/reset password and CLI-provisioned administrators (D-27, D-28). Client confirmation: [OQ-26](../product/open-questions.md). Reference: Athar `src/modules/auth` (structure only; corrections W2–W5, W11).

## 2. Actors and triggers

- A visitor registers (name + email → code → password) and lands on the dashboard.
- An owner or admin signs in with email + password; reloads restore the session from the HttpOnly cookie.
- Anyone requests a password reset; the link arrives by email.
- The server operator runs `admin:create`; the new admin accepts the invite and sets a password.
- An admin lists users; an owner cannot.

## 3. Inputs

Email (trimmed, lower-cased, ≤ 254), name (2–120), 6-digit code (Arabic-Indic digits accepted), password (never trimmed; 12–128 code points after NFKC), registration/reset/invite tokens (43-char base64url), refresh cookie, client IP from the trusted proxy chain.

## 4. Behaviour

| Flow | Endpoint(s) | Key rules |
| --- | --- | --- |
| Register | `POST /auth/register/start` → `/register/verify` → `/register/complete` | Generic start response; existing accounts get a notice email instead of a code; code 10 min / 5 attempts (committed before comparison) / 15 per email per hour; registration token 15 min, single use; account created only at completion; always `OWNER` |
| Login | `POST /auth/login` | Generic 401; dummy-hash verification for unknown emails; per-IP+email and per-email limits; re-hash when parameters change; session issued in a transaction that re-checks status and session version |
| Session | `POST /auth/refresh`, `/logout`, `/logout-all`, `GET /auth/me` | Rotating refresh token under row locks; replay after 15 s revokes the session; JWT `sid`/`sv` checked on every request |
| Recovery | `POST /auth/forgot-password`, `/reset-password` | Generic response; 30-min single-use link with the token in the fragment; one live token per email; reset revokes every session and emails a confirmation |
| Admin invite | CLI `admin:create`, `POST /auth/accept-invite` | 24-h purpose-bound token; only for `INVITED` admins; `--promote` for existing owners revokes their sessions |
| Users list | `GET /admin/users?page&limit&search&type&status` | `PLATFORM_ADMIN` only (403 otherwise); limit ≤ 100; search on name/email with LIKE wildcards escaped; never returns hashes |

## 5. Acceptance criteria

AC-02-1 to AC-02-5 as amended by D-27 (password instead of code at sign-in; AC-02-1/3 now apply to the registration code). Evidence: [verification log](../qa/verification-log.md#2026-10-24--authentication-and-admin-users-t-p1-01-t-p1-04-to-t-p1-07).

## 6. Technical design

- Backend modules: `auth` (`auth.controller.ts`; services `auth`, `session`, `password`, `rate-limit`, `admin-provisioning`; `jwt.strategy.ts`; guards `jwt-auth`, `user-type`, `csrf`; `session-cookie.ts`; utils `crypto`, `password-policy`), `users` (`admin-users.controller.ts`), `mail` (nodemailer SMTP, Arabic templates), `redis`. CLI `src/cli/create-admin.ts`.
- Tables: `users`, `email_challenges`, `auth_tokens` (purpose-bound, partial unique live index), `sessions`, `refresh_tokens`, `admin_actions` ([data model](../architecture/data-model.md#identity)).
- Frontend: `(Auth)/auth/{login,register,forgot-password,reset-password,accept-invite}`, `(Dashboard)/dashboard` (role-filtered shell), `(Dashboard)/dashboard/users`; Redux `authSlice` (memory token), RTK Query `baseApi` (single-flight refresh, CSRF header), `proxy.ts` (marker-cookie routing only), Next rewrite `/api` → `BACKEND_URL` (build time).
- Config: see `.env.example` in each repository.

## 7. Security, permissions, audit

Controls in [security and privacy](../architecture/security-and-privacy.md#threats-and-controls) and ADR-0007. Admin provisioning is written to `admin_actions`. Codes, tokens, passwords and request bodies are never logged.

## 8. Scope and dependencies

In: register, verify, login, logout, logout everywhere, refresh, forgot/reset, admin invite and promotion, admin users list. Out (for now): admin MFA ([OQ-27](../product/open-questions.md)), suspending users from the UI, social login, phone login, account deletion, profile editing. Depends on PostgreSQL, Redis, SMTP.

## 9. Open questions

[OQ-26](../product/open-questions.md) client acceptance of passwords; [OQ-27](../product/open-questions.md) admin MFA; [OQ-28](../product/open-questions.md) minimum length.
