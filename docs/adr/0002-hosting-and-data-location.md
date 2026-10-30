# ADR-0002: Hosting and data location

Status: Accepted — server per [D-30](../product/decisions.md), location (Canada) approved by the client per [D-31](../product/decisions.md)
Date: 2026-10-24
Traceability: FR-09, NFR-04, NFR-09; [D-19](../product/decisions.md); [OQ-06](../product/open-questions.md), [OQ-10](../product/open-questions.md)

## Context

The client pays hosting directly and must approve where guest data lives (PDPL). The owner already operates a VPS + Docker Compose + nginx blue/green deployment with a written runbook for Athar. A solo developer must keep operations small; after the 14-day support window, someone on the client side or a separate maintenance agreement operates the system.

## Decision

- **Default:** a dedicated VPS (sized for Postgres, Redis, API, worker, frontend) with Docker Compose and nginx blue/green, following the structure of the Athar runbook, with these corrections: separate database roles, migrations as a single release step, worker/scheduler outside blue/green, pinned images, off-host encrypted backups and a recorded restore drill ([operations](../architecture/operations.md)).
- **Costed alternative:** the same containers with managed PostgreSQL (and optionally managed Redis) from a provider in the client-approved region — preferable if the client cannot assign VPS operations after support.
- **Location:** the client decides between Saudi Arabia and elsewhere after reviewing the processor list ([security and privacy](../architecture/security-and-privacy.md#processors)). No production data is loaded before that decision.
- Athar Events never shares Athar's server, database, Redis, volumes or credentials.

## Alternatives considered

| Alternative | Why not the default |
| --- | --- |
| Managed PaaS outside KSA (Render, Railway, Fly) | Fast to start but unfamiliar runbook; data location not in KSA; recommended in review round 1 and withdrawn in round 3 |
| Co-hosting on the Athar server | Couples two clients' data, credentials and availability; rejected |
| Kubernetes | Operational weight unjustified |

## Consequences

- The developer reuses known deployment steps; the client gets a written runbook at handover.
- The client owns patching, backups and monitoring after support unless a maintenance agreement exists ([OQ-11](../product/open-questions.md)).
- Containers make a later move possible, but database migration, DNS, secrets and backups still need a planned cut-over.

## Open items

[OQ-06](../product/open-questions.md) (location, budget, operator), [OQ-10](../product/open-questions.md) (retention).
