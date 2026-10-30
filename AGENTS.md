# Athar Events — backend agent guide

Athar Events is an Arabic (RTL) platform for wedding and event invitations: owners buy a package and pay (Moyasar), admins prepare guest lists and send WhatsApp invitations (Meta Cloud API), guests reply Accept/Decline, accepted guests get a QR code, and the **event owner** scans it at the venue.

**Current state (2026-10-24): no application code yet.** This repository holds the planning documentation in `docs/`. Do not describe the stack as built until it is; check `docs/STATUS.md` and `docs/delivery/progress.md` first.

## Read before working

1. `docs/README.md` — sources, authority order, documentation rules.
2. `docs/STATUS.md` — what exists and what is next.
3. `docs/delivery/progress.md` — the only task ledger; pick tasks by ID.
4. `docs/architecture/conventions.md` — how code is written here.
5. The spec for your task in `docs/specs/` and the decisions it cites in `docs/product/decisions.md`.

## Stack (target, per ADR-0001)

NestJS 11 modular monolith · TypeORM + PostgreSQL · Redis + BullMQ · `@nestjs/schedule` · `nestjs-i18n` (Arabic) · Swagger · Node LTS (pinned) · pnpm · TypeScript strict. Process roles `api`, `worker`, `scheduler` from one image.

## Guardrails

- **Reference project:** `/Users/adilelhaci/my personal project/athar` is the conventions reference. Read it only; never modify it; never copy its code or add a dependency on it without the owner's approval (D-24). Do not reintroduce its known weaknesses W1–W11 (`docs/architecture/reference-alignment.md`).
- **Decisions:** do not change a recorded decision (D-xx) or an ADR's decision; propose a new one. Do not choose a business rule that is an open question (OQ-xx); use the recorded default and keep it easy to change.
- **Approval required before:** adding a major dependency or infrastructure component, changing auth/session behaviour, changing the scanner access model (owner-only, D-08), changing payment activation rules, changing the WhatsApp sending invariants, destructive migrations, anything touching production or provider accounts.
- **Invariants** live in the database (unique/partial indexes, conditional updates, row locks). Never "read, check, write" for quotas, check-in, refresh rotation or job claims.
- **Never log** OTP codes, tokens, QR tokens, guest names/phones, request bodies or provider payloads.
- **Webhooks:** raw body, verify (Moyasar secret timing-safe; Meta `X-Hub-Signature-256`), 401 on failure, dedupe, idempotent apply.
- **Sending:** ambiguous sends become `UNKNOWN` and are never resent automatically; nothing is sent after the event starts.
- **Git:** do not commit or push unless the owner asks.

## Verification commands (once scaffolded)

`pnpm lint:check` · `pnpm typecheck` · `pnpm test` · `pnpm test:integration` · `pnpm test:e2e` · `pnpm build`. Do not use auto-fixing lint as a check.

## Before handing off

Update `docs/delivery/progress.md` (status, evidence, session footer). Record verified milestones in `docs/qa/verification-log.md`. If code and docs disagree, fix the docs in the same change or record the discrepancy in `STATUS.md`.
