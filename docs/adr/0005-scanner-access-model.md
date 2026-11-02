# ADR-0005: Scanner access model

Status: Proposed (records the owner's decision [D-08](../product/decisions.md) of 2026-10-24)
Date: 2026-10-24
Traceability: FR-07; [D-08](../product/decisions.md), [D-13](../product/decisions.md); [OQ-15](../product/open-questions.md)

## Context

The quotation requires a mobile-browser scanning page that prevents duplicate scans, but does not say who scans or how they authenticate. The review recommended event-scoped scanner passes (a revocable link plus PIN, no account) because door staff are often hired the same day. The owner decided instead that **the scanner must be the authenticated event owner**.

## Decision

- The scan page (`/scan`, `/scan/[eventId]`) requires a signed-in `OWNER` session (email OTP, same session model as [ADR-0006](0006-auth-session-model.md)).
- `POST /api/scan/events/:eventId/check-ins` is allowed only for the owner of that event, only for a paid, active event, and only inside the admission window (`admission_opens_at`–`admission_closes_at`).
- The owner may sign in on several door devices; each device has its own refresh chain and can be signed out individually or all at once.
- Each admission records `checked_in_by_user_id`.
- Platform admins do not scan by default ([OQ-15](../product/open-questions.md)).

## Alternatives considered

| Alternative | Why not chosen |
| --- | --- |
| Scanner passes (link + PIN, per event, revocable) | Recommended by the review; rejected by the owner — the owner wants every scan tied to an authenticated account |
| Named staff accounts with event grants | Requires staff management (invite, grant, expire); out of the fixed scope; can be priced later |
| Shared admin login at the door | Exposes every event and guest list; rejected |

## Consequences

- No scanner-pass entity, strategy or management UI — less to build.
- Door staff who scan must use the owner's signed-in session on that device, which exposes the owner's dashboard on the device. Mitigations: a dedicated full-screen scan mode, a prominent "sign out of this device", changing the password to end every session, and short-lived access tokens. This is accepted by the owner.
- Signing in at the venue depends on email delivery; the [event-day readiness checklist](../architecture/operations.md#event-day-readiness-per-event) asks the owner to sign in on door devices the day before.
- Attribution is per owner account, not per staff member.

## Open items

[OQ-15](../product/open-questions.md): admin scanning, admission window defaults, owner acceptance of shared-device use.
