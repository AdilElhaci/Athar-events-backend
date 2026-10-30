# ADR-0007: Password authentication

Status: Proposed (records the owner's decision [D-27](../product/decisions.md) of 2026-10-24)
Date: 2026-10-24
Supersedes: the sign-in method of [ADR-0006](0006-auth-session-model.md) (email OTP). ADR-0006's session model (memory access token, rotating HttpOnly refresh cookie, CSRF rule) still applies and is extended below.
Traceability: FR-02, FR-08; [D-27](../product/decisions.md), [D-28](../product/decisions.md); [OQ-26](../product/open-questions.md), [OQ-27](../product/open-questions.md), [OQ-28](../product/open-questions.md)

## Context

The owner asked for login, registration, forgot/reset password and an admin dashboard listing users. The quotation (section 02) specified email-code sign-in without passwords; the owner chose passwords. The design was debated with Codex (one security round) before implementation and reviewed again after it.

## Decision

**Registration (three steps, inbox first).** `POST /auth/register/start {name,email}` always answers the same; a new email gets a 6-digit code (HMAC with `OTP_SECRET`, 10 minutes, 5 attempts counted in a committed statement, plus 15 attempts per email per hour across replacement codes); an existing account gets an "you already have an account" email instead. `POST /auth/register/verify {email,code}` returns a 15-minute purpose-bound `registrationToken`. `POST /auth/register/complete {registrationToken,password}` creates an `OWNER` (public registration can never create an admin) and signs in. No account or password exists before inbox control is proven, which defeats pre-registration hijacking.

**Passwords.** argon2id (19 MiB, t=2, p=1), re-hashed on login when parameters change; at most 4 concurrent hash operations and 64 queued. Policy: 12–128 code points after NFKC, never trimmed, common/repeated passwords blocked, must not contain the email local part or the name; no composition rules.

**Login.** Generic `401 auth.invalid_credentials` for unknown email, wrong password or a non-active account; one argon2 verification always runs (dummy hash for unknown emails). Limits: 10 failed attempts per IP+email and 50 per email per 15 minutes, 30 requests per IP per 15 minutes. No hard account lock.

**Sessions** (extends ADR-0006). A `sessions` row per device; the refresh token (32 random bytes, HMAC with `TOKEN_PEPPER`) rotates atomically under row locks; replay of a rotated token more than 15 s later revokes the session. The access JWT (HS256, 15 min, `iss`/`aud` checked, algorithm pinned) carries `sid` and `sv`; the strategy reloads the user and session on every request, so logout, password reset, promotion and "sign out everywhere" (`sv` bump) take effect immediately.

**Recovery.** `POST /auth/forgot-password` always answers the same; active accounts receive a 30-minute single-use link `…/auth/reset-password#token=…` (fragment: never sent to servers, proxies or logs; the page removes it from history). Issuing a new link revokes the previous one (one live token per email and purpose, enforced by a partial unique index). `POST /auth/reset-password` sets the password, marks the email verified and revokes every session; a "password changed" email follows.

**Administrators** ([D-28](../product/decisions.md)). Created only by the server CLI; invite tokens are purpose-bound (`ADMIN_INVITE`, 24 h) and accepted only for `INVITED` admins.

**Email abuse.** Every email to an address (code, notice, reset, invite) shares one budget: one per 60 s and five per hour, in Redis.

**Transport.** The browser calls same-origin `/api`; Next rewrites to the API (destination fixed at build time via `BACKEND_URL`). In production nginx terminates TLS in front, sets `X-Forwarded-For`, and `TRUST_PROXY_HOPS=1`; the API and Next ports are not publicly reachable.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Email OTP only (ADR-0006) | Overridden by the owner |
| Password chosen at step 1, verified afterwards | Lets an attacker pre-register a victim's email with a known password (Codex HIGH finding) |
| bcrypt (Athar parity) | argon2id is the current OWASP recommendation; 72-byte bcrypt limit |
| Hard lockout after N failures | Lets anyone lock a known email out |
| Reset token in the query string | Leaks through proxy logs, analytics and referrers |

## Consequences

- Two more flows to support (reset, invite) and a password policy to explain in the UI.
- Admin accounts depend on a password alone until MFA is added ([OQ-27](../product/open-questions.md)).
- Emails are sent in-process after the response (`setImmediate`); a durable outbox arrives with BullMQ (P3).

## Open items

[OQ-26](../product/open-questions.md), [OQ-27](../product/open-questions.md), [OQ-28](../product/open-questions.md).
