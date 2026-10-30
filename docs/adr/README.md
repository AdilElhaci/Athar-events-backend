# Architecture decision records

An ADR records a consequential, hard-to-reverse decision: what was decided, why, and which alternatives were rejected. Ordinary implementation choices (a DTO shape, an index, a helper) stay in the pull request.

**Write an ADR when a decision** changes a repository or module boundary, adopts or removes a major dependency or infrastructure component, is expensive to reverse once data depends on it, or resolves a conflict between the quotation and the design.

## Process

1. Draft with status `Proposed`, linking the decisions (`D-xx`) and open questions (`OQ-xx`) it depends on.
2. The owner reviews; only the owner changes the status to `Accepted` ([D-21](../product/decisions.md)).
3. A reversal is a new ADR that supersedes the old one; an accepted ADR's decision is never edited in place.
4. Open items stay in [open-questions.md](../product/open-questions.md), not inside the ADR.

File name: `NNNN-short-slug.md`. Sections: Status, Date, Traceability, Context, Decision, Alternatives considered, Consequences, Open items.

## Index

| ADR | Decision | Traceability | Status |
| --- | --- | --- | --- |
| [0001](0001-stack-and-repository-boundaries.md) | Stack and repository boundaries: NestJS modular monolith + one Next.js app, following the Athar reference | All FRs; D-03, D-04, D-05 | Proposed (2026-10-24) |
| [0002](0002-hosting-and-data-location.md) | Dedicated VPS + Compose + nginx blue/green by default; managed PostgreSQL alternative; location chosen by the client | FR-09, NFR-04, NFR-09; D-19; OQ-06; D-30, D-31 | Accepted (2026-10-31) |
| [0003](0003-whatsapp-route-and-templates.md) | Meta Cloud API direct, client-owned WABA, durable send engine, two templates | FR-06, FR-07; D-09, D-11; OQ-14 | Proposed (2026-10-24) |
| [0004](0004-payment-gateway.md) | Moyasar hosted invoice with server-side verification and reconciliation | FR-05; D-10; OQ-07 | Proposed (2026-10-24) |
| [0005](0005-scanner-access-model.md) | Scanning requires the authenticated event owner | FR-07; D-08; OQ-15 | Proposed (2026-10-24) — records an owner decision |
| [0006](0006-auth-session-model.md) | Email OTP + JWT in memory + rotating HttpOnly refresh cookie | FR-02; D-06, D-07 | Proposed (2026-10-24); sign-in method superseded by ADR-0007, session model still applies |
| [0007](0007-password-authentication.md) | Password authentication: 3-step registration, argon2id, reset by fragment link, `sid`/`sv` session checks, CLI-only admins | FR-02, FR-08; D-27, D-28 | Proposed (2026-10-24) — records an owner decision |

`Proposed` means the recorded decision is the baseline for work, but nothing that would be expensive to reverse should be hardened before acceptance (for example, production data loaded into a hosting location before ADR-0002 is accepted).
