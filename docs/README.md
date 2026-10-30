# Athar Events documentation

**Status: planning baseline approved by the owner on 2026-10-24. No application code exists yet.** These documents specify the Athar Events MVP: an Arabic, right-to-left web platform for organizing wedding and event invitations over WhatsApp, with paid packages, an admin-run guest list workflow, QR admission and venue check-in. [STATUS.md](STATUS.md) is the entry point for what exists today; [delivery/progress.md](delivery/progress.md) is the only task ledger.

## Sources and authority

Read the sources in this order. A lower source never overrides a higher one; a conflict is recorded in [open questions](product/open-questions.md), not resolved silently.

1. **The quotation** `عرض-سعر-منصة-الدعوات.pdf` (dated 18 October 2026, fixed price 12,000 SAR, 4–5 weeks). It defines **what** the MVP delivers: scope items 01–09, the out-of-scope list, the timeline, the payment milestones and the client's obligations. It is a commercial scope summary, not a detailed requirements document. Its requirements are numbered FR-01 to FR-09 in [scope and acceptance](product/scope-and-acceptance.md).
2. **The owner's decisions**, recorded in [decisions.md](product/decisions.md) (D-xx). They settle how the scope is built and interpreted.
3. **The existing Athar project** (`/Users/adilelhaci/my personal project/athar`), the reference for **how** the code is organized and written. Its patterns are adopted, improved or rejected in [reference alignment](architecture/reference-alignment.md) and codified in [conventions](architecture/conventions.md). Athar is a reference only: it is not a source of Athar Events business rules, it is not a dependency, and its code is not copied without approval ([D-24](product/decisions.md)).
4. **The SHARAKAT documentation set**, the reference for how planning is **documented and tracked** (source → decision → implementation → evidence, registers, ADR gating). Its technologies are not adopted.
5. **The Claude–Codex review** (three rounds, Codex session `01a16a97-baa2-7b63-86a6-9c3243f90c9f`, 2026-10-24). It produced recommendations; only the owner's approval turns a recommendation into a decision.

Where the quotation is silent, the docs record a question with a recommended default. A recommended default is **not** a decision until the owner or the client confirms it.

## Read order

1. [STATUS.md](STATUS.md): what exists, what is next, handoff notes.
2. [Scope and acceptance](product/scope-and-acceptance.md): FR-01–FR-09, non-functional requirements, exclusions, traceability.
3. [Decisions](product/decisions.md) and [open questions](product/open-questions.md).
4. Architecture: [overview](architecture/overview.md) → [reference alignment](architecture/reference-alignment.md) → [conventions](architecture/conventions.md) → [data model](architecture/data-model.md) → [API contracts](architecture/api-contracts.md) → [integrations](architecture/integrations.md) → [security and privacy](architecture/security-and-privacy.md) → [operations](architecture/operations.md).
5. [Architecture decision records](adr/README.md).
6. [Feature specs](specs/README.md) SP-01 to SP-06.
7. UX: [strategy and personas](ux/strategy-and-personas.md) → [information architecture](ux/information-architecture.md) → [design system](ux/design-system.md) → [accessibility and UX acceptance](ux/accessibility-and-acceptance.md).
8. Delivery: [roadmap](delivery/roadmap.md) and [progress ledger](delivery/progress.md).
9. QA: [test strategy](qa/test-strategy.md) and [verification log](qa/verification-log.md).

## Documentation rules

- **One owner per fact.** Each requirement has one primary spec. Status lives in [progress.md](delivery/progress.md) only; other files link to it rather than repeating a status.
- **Stable IDs.** Requirements `FR-xx`/`NFR-xx`, acceptance criteria `AC-xx-n`, decisions `D-xx`, open questions `OQ-xx`, screens `SCR-xx`, tests `TC-xx`, tasks `T-Px-nn`. Link by ID instead of copying text.
- **Planned ≠ implemented ≠ verified.** A task is `done` only with evidence (commit, test run or recorded check) in the ledger and, for milestones, in the [verification log](qa/verification-log.md).
- **ADR gating.** An ADR starts `Proposed`; only the owner marks it `Accepted`. Work that depends on a `Proposed` ADR follows the recorded decision but must not harden it into something expensive to reverse.
- **Facts vs. assumptions.** External provider behaviour (Meta, Moyasar, email) is written as verified only when checked in official documentation or in the provider sandbox, with the date.
- **Every session updates the ledger** before handing off (see [AGENTS.md](../AGENTS.md)).
