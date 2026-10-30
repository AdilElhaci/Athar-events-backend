# ADR-0001: Stack and repository boundaries

Status: Proposed
Date: 2026-10-24
Traceability: all FRs; [D-03](../product/decisions.md), [D-04](../product/decisions.md), [D-05](../product/decisions.md), [D-17](../product/decisions.md), [D-24](../product/decisions.md)

## Context

Both Athar Events repositories are empty. The quotation fixes a 4–5 week, fixed-price, solo build. The owner already runs a production NestJS + Next.js project (Athar) whose conventions should be reused ([reference alignment](../architecture/reference-alignment.md)). Two repositories already exist and the owner keeps them.

## Decision

- **Backend** (`Athar-events-backend`): one NestJS 11 modular monolith with TypeORM + PostgreSQL, Redis, BullMQ, `@nestjs/schedule`, `nestjs-i18n` (Arabic), Swagger. One image, three process roles (`api`, `worker`, `scheduler`). Modules per [overview](../architecture/overview.md#backend-modules).
- **Frontend** (`Athar-events-frontend`): one Next.js 16 App Router app with route groups `(Landing Page)`, `(Auth)`, `(Dashboard)`, `(Scanner)`, `(Guest)`; Redux Toolkit + RTK Query; react-hook-form + zod; shadcn/ui on Tailwind 4.
- Node pinned to the current LTS; pnpm in both repositories; TypeScript strict in both.
- Conventions from the Athar project, with corrections W1–W11 ([conventions](../architecture/conventions.md)). No code copied and no dependency on Athar without approval.
- Planning documentation lives in the backend repository `docs/`.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Full-stack Next.js only (route handlers + server actions) | Splits business rules across UI code; durable jobs and webhook handling still need a worker; diverges from the owner's Athar conventions |
| Separate admin application (Refine, react-admin, AdminJS) | Bulk import, campaign readiness, replacements and approvals are custom workflows anyway; a second UI stack breaks consistency |
| Prisma or Drizzle | The owner's projects use TypeORM; no gain worth the switch |
| pg-boss / Graphile Worker (no Redis) | Considered in review round 2; superseded once the Athar reference showed Redis already in the owner's stack and a proven database-first sending engine |
| Bull v4 (exact Athar parity) | Nest documents Bull as maintenance-only; BullMQ is the active successor and only carries ids here |
| Microservices | No scale or team reason |

## Consequences

- Patterns, guards, envelope and UI wrappers feel identical to Athar for the developer.
- Redis becomes a required service (queues, throttler store).
- Deviations from Athar (BullMQ, pnpm in the frontend, strict TS, HttpOnly refresh cookie) must stay documented so future agents do not "fix" them back.

## Open items

None beyond those listed in ADR-0002 to ADR-0006.
