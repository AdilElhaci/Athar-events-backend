# ADR-0006: Authentication and session model

Status: Proposed
Date: 2026-10-24
Traceability: FR-02, FR-07; [D-06](../product/decisions.md), [D-07](../product/decisions.md); weaknesses W2–W5, W11 in [reference alignment](../architecture/reference-alignment.md#weaknesses-not-carried-forward)

## Context

The quotation requires sign-up and sign-in with an email one-time code and no passwords. The Athar reference uses a JWT access token plus rotating hashed refresh tokens, both stored in JavaScript-readable cookies, with a refresh race and no OTP attempt limit.

## Decision

- **OTP:** 6 digits from a CSPRNG; HMAC-SHA256 digest with `OTP_SECRET`; 5-minute expiry; at most 5 verification attempts per code (counter persisted even on failure); a new request supersedes open codes; 60-second resend cooldown; 5 requests/hour per email and 20/hour per IP (Redis-backed throttler, trusted proxy hops). Responses never reveal whether an email has an account. First successful verification of an unknown email creates an `OWNER`.
- **Access token:** JWT HS256, 15 minutes, `sub`, `type`, `iat`, `exp`, `aud=athar-events`; sent as `Authorization: Bearer`; held only in Redux memory. `JwtStrategy.validate` loads the user and returns the **database** role and status.
- **Refresh token:** 32-byte opaque random, stored as a peppered SHA-256; 30-day lifetime; cookie `athar_events_rt` HttpOnly, Secure, SameSite=Lax, Path `/api/auth`; rotation by one conditional `UPDATE … RETURNING`; reuse of a revoked token revokes that chain.
- **Marker cookie:** `athar_events_session=1` (not HttpOnly, no secrets) so `proxy.ts` can route; never used for authorization.
- **CSRF:** cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`) require an allowlisted `Origin` and the header `X-Requested-With: athar-events`.
- **Frontend:** on load, one single-flight refresh before protected queries; 401 on a protected call triggers one refresh then a retry; RTK Query state reset on sign-out.
- **Admins:** `PLATFORM_ADMIN` only via the `PLATFORM_ADMIN_EMAILS` seed or an existing admin.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Exact Athar parity (tokens in JS-readable cookies) | Keeps a known XSS exposure of a 7-day credential |
| Server-side sessions only (opaque session cookie on every request) | Diverges further from the Athar guard/strategy model the developer knows |
| Magic links instead of codes | Quotation specifies a verification code; links break across devices at the venue |

## Consequences

- Small changes to the Athar `baseApi` pattern (no token cookies, single-flight refresh, credentials on refresh requests).
- Cookie scope needs frontend and API on the same site ([operations](../architecture/operations.md#topology-default)).

## Open items

[OQ-20](../product/open-questions.md) (email provider), [OQ-25](../product/open-questions.md) (admin bootstrap list).
