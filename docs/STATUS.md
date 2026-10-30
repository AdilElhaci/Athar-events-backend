# Athar Events status

**Updated: 2026-10-30.** This page is the entry point and handoff note. Task-level status is in [delivery/progress.md](delivery/progress.md) and is not repeated here.

## What exists

- **Backend code (uncommitted):** NestJS 11 API with password authentication ([D-27](product/decisions.md), [ADR-0007](adr/0007-password-authentication.md)), CLI-only admin provisioning ([D-28](product/decisions.md)), admin users list; PostgreSQL migration; docker compose for PostgreSQL, Redis and Mailpit. 7 unit + 20 e2e tests pass.
- **Frontend code:** landing page committed on branch `feat/T-P1-08-landing-page` (pushed); uncommitted on top: register/login/forgot/reset/accept-invite pages, protected dashboard shell and admin users page (browser-verified 25/25). Next 16 scaffold (part of T-P1-02) and the public landing page, privacy and terms shells (T-P1-08, design per [D-26](product/decisions.md)), browser-verified on 2026-10-24 ([verification log](qa/verification-log.md#2026-10-24--landing-page-t-p1-08)). Packages show a prelaunch state until the API exists; contact and legal text are provisional; brand colours follow the client's brand kit ([D-29](product/decisions.md), 2026-10-27).
- **Documentation:** this planning set, approved by the owner on 2026-10-24, plus `AGENTS.md`, `CLAUDE.md` in both repositories and `DESIGN.md` in the frontend.
- **ADRs:** seven, all `Proposed` ([index](adr/README.md)).

## Current phase

**P0: decisions and accounts** ([roadmap](delivery/roadmap.md#p0--decisions-and-accounts)). P0 is not implementation: it collects the client's answers to the [open questions](product/open-questions.md) and the accounts listed in [operations](architecture/operations.md#accounts-the-client-provides). The 4–5 week build clock starts after the first payment and all required accounts are received (quotation, section 4).

## Blocking items

| Item | Blocks | Reference |
| --- | --- | --- |
| Client answers to the business questions (replacement rule, approval gate, guest identity, list channel, Excel template) | P3 rules freeze | [OQ-01 to OQ-05](product/open-questions.md) |
| Hosting budget and post-support operator (location approved: [D-31](product/decisions.md)) | Handover | [OQ-06](product/open-questions.md), [ADR-0002](adr/0002-hosting-and-data-location.md) |
| Meta Business verification, WhatsApp number, template submission | P1 tracer, P3 campaign | [OQ-14](product/open-questions.md), [integrations](architecture/integrations.md#whatsapp-cloud-api) |
| Moyasar merchant account | P2 payment | [integrations](architecture/integrations.md#moyasar) |
| Quotation validity (expires about 2026-11-01) | Commercial start | [OQ-12](product/open-questions.md) |

## Owner decisions on 2026-10-24

- **Password authentication** replaces email-OTP-only sign-in ([D-27](product/decisions.md)); the client must confirm ([OQ-26](product/open-questions.md)). Administrators are created only by the server CLI ([D-28](product/decisions.md)).


The owner approved the planning proposal in full, with one change: **scanning at the venue requires the authenticated event owner** (signed-in owner account) instead of the scanner-pass design recommended in review ([D-08](product/decisions.md)). Consequences are recorded in [SP-05](specs/SP-05-qr-and-check-in.md) and [OQ-15](product/open-questions.md).

## Next actions

1. Send the Arabic client questionnaire ([open-questions.md](product/open-questions.md#client-questionnaire-arabic)).
2. Start Meta Business verification and Moyasar onboarding with the client (external review time is not counted in the schedule).
3. On first payment and accounts: start P1 (task `T-P1-01`).

## Handoff notes

- The existing Athar project is a **reference**, not a dependency. Read [reference alignment](architecture/reference-alignment.md) before copying any idea from it; several of its patterns are deliberately not carried forward (W1–W11).
- Two Codex findings about Athar (refresh-token race, request-body logging) were verified by reading the code on 2026-10-24.
