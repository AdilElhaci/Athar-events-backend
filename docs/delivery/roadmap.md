# Implementation roadmap

**Status: approved plan (2026-10-24).** Task-level status lives only in [progress.md](progress.md). Each phase below lists its objective, scope, reuse, deliverables, changes, dependencies, tasks, acceptance, tests, verification, definition of done and risks. Weeks are build weeks; the clock starts after the first payment and all client accounts (quotation section 4). External waiting (Meta verification, template approval, Moyasar activation) is not counted but is started as early as possible ([D-23](../product/decisions.md)).

## Overview

| Phase | Week | Outcome | Milestone |
| --- | --- | --- | --- |
| P0 | Before the clock | Rules answered, accounts and templates submitted, hosting chosen | Signing — 40% |
| P1 | W1 | Foundations, sign-in, landing, shells, **WhatsApp + QR tracer proven on a real phone** | — |
| P2 | W2 | Packages, events, payment, owner dashboard | Demo — 30% |
| P3 | W3 | Guests and import, approval, scheduling, sending engine, RSVP, QR issuance | — |
| P4 | W4 | Replacements, scanner, counts, admin exceptions, venue rehearsal | — |
| P5 | W5 | Hardening, accessibility, production, UAT, launch | Launch — 30% |

Internal order differs slightly from the quotation's week list (guest records before WhatsApp, a WhatsApp tracer in W1); the client-facing milestones are unchanged.

## Definition of Done (every task)

1. Code follows [conventions](../architecture/conventions.md); no Athar code copied without approval.
2. Lint, typecheck, unit tests and build pass in CI; integration tests pass where the task touches invariants.
3. Acceptance criteria referenced by the task pass and are linked as evidence in [progress.md](progress.md).
4. UI tasks: RTL, mobile width, empty/loading/error states and keyboard checked; matches [design system](../ux/design-system.md).
5. API changes reflected in Swagger and [API contracts](../architecture/api-contracts.md); schema changes in [data model](../architecture/data-model.md) with a migration.
6. No secrets, personal data or tokens in logs, code or docs.
7. Ledger updated (status, evidence) before handoff.

Phase DoD adds: phase acceptance passed on staging, verification log entry, `AGENTS.md`/`DESIGN.md` checked against the code, open questions affecting the next phase reviewed.

---

## P0 — Decisions and accounts

1. **Objective:** remove business ambiguity and external blockers before the clock starts.
2. **Scope:** OQ-01 to OQ-25; accounts in [operations](../architecture/operations.md#accounts-the-client-provides); ADR-0002 decision.
3. **Reuse:** —
4. **Frontend:** —
5. **Backend:** —
6. **UI/UX:** confirm branding inputs (OQ-13); collect landing copy and invitation wording.
7. **Database/API:** —
8. **Dependencies:** client availability.
9. **Tasks:** `T-P0-01` to `T-P0-05`.
10. **Acceptance:** answers recorded as decisions; accounts listed as received; templates submitted to Meta; hosting option chosen.
11. **Tests:** —
12. **Verification:** decisions.md and open-questions.md updated; STATUS blockers cleared or dated.
13. **DoD:** first payment received and every account in the list received, or each missing item has a date.
14. **Risks:** Meta verification delay (weeks) → start immediately, build against a test number; quotation expiry (OQ-12).

## P1 — Foundations, sign-in, landing, tracer (W1)

1. **Objective:** both repositories scaffolded to the agreed conventions, deployable to staging, with sign-in working and the riskiest integration (WhatsApp → reply → QR → scan) proven end to end.
2. **Scope:** FR-01, FR-02, FR-09 (staging, CI), tracer for FR-06/FR-07.
3. **Reuse (patterns):** Athar `src/shared` envelope/filter/pagination, typed config, auth module structure, Dockerfile, Compose, frontend route groups, `baseApi`, `DataTable`/form wrappers, `DESIGN.md` tokens.
4. **Frontend:** scaffold (Next 16, pnpm, IBM Plex Sans Arabic, tokens, shadcn RTL, wrappers, Redux/RTK Query with single-flight refresh, `proxy.ts`); SCR-01 to SCR-05, SCR-06/07; dashboard shell; minimal tracer scan page.
5. **Backend:** scaffold (`main.ts`, config validation, shared, i18n ar, throttler `60_000`, CORS allowlist, logging allowlist, health), `auth` and `users` modules, mail, admin seed, minimal `invitations` tracer (send template, webhook signature, reply correlation, QR image), minimal check-in endpoint.
6. **UI/UX:** tokens and base components (`StatusBadge`, `NextStepCard`, `CountTile`, `LastUpdated`, `OtpInput`, `PhoneText`); landing layout; scan result layout prototype.
7. **Database/API:** `users`, `otp_challenges`, `refresh_tokens`; `/auth/*`, `/users/me`, `/packages` (stub), `/whatsapp/webhook`.
8. **Dependencies:** P0 accounts (SMTP, domain or temporary staging host, Meta test number), OQ-13 for final colours (placeholder brand allowed).
9. **Tasks:** `T-P1-01` to `T-P1-11`.
10. **Acceptance:** AC-01-1 to AC-01-4 (with placeholder packages), AC-02-1 to AC-02-5; tracer steps 1–6 recorded.
11. **Tests:** TC-AUTH-01…09, TC-SEC-01…03, TC-UX-01…03, TC-WA-T1…T3.
12. **Verification:** staging URL works on iPhone and Android; verification log entry "P1 tracer".
13. **DoD:** CI green in both repos; staging deploy script works; tracer recorded; ledger updated.
14. **Risks:** Meta number not ready → use the Meta test number and repeat later; email deliverability → Mailpit locally, provider on staging.

## P2 — Packages, events, payment, owner dashboard (W2)

1. **Objective:** an owner can buy a package for an event and see a truthful event overview; admins manage packages and see events and payments.
2. **Scope:** FR-03 (AC-03-1…3, 7), FR-04 (AC-04-1, 2), FR-05, FR-08 (packages, payments, queue skeleton).
3. **Reuse:** Athar Moyasar invoice, webhook and callback patterns; payment attempts with unique provider ids; admin controllers.
4. **Frontend:** SCR-10, SCR-11, SCR-12, SCR-13 (states, next step; counts placeholder), SCR-20, SCR-20a, SCR-21, SCR-26, SCR-28.
5. **Backend:** `packages`, `events`, `payments` modules; reconciliation job; `admin-actions`.
6. **UI/UX:** stepper, event timeline, next-step logic, payment return states.
7. **Database/API:** `packages`, `events`, `payment_attempts`, `webhook_receipts`, `admin_actions`; endpoints per [API contracts](../architecture/api-contracts.md).
8. **Dependencies:** Moyasar test keys; P1 auth.
9. **Tasks:** `T-P2-01` to `T-P2-10`.
10. **Acceptance:** AC-03-1…3, AC-03-7, AC-04-1, AC-04-2, AC-05-1…5, AC-08-5 (packages, payments), AC-08-6.
11. **Tests:** TC-PKG-01…04, TC-EVT-01…07, TC-PAY-01…08, TC-ADM-01…02.
12. **Verification:** demo script run on staging with the client; verification log "Demo milestone".
13. **DoD:** demo accepted (sandbox payment if OQ-07 allows); ledger updated.
14. **Risks:** Moyasar payload differences → fixtures from sandbox; event editing rules (OQ-16) → keep editable only before checkout until answered.

## P3 — Guests, approval, scheduling, sending, RSVP (W3)

1. **Objective:** an admin can prepare a list, the owner approves, and a scheduled WhatsApp campaign sends reliably with RSVPs and QR delivery.
2. **Scope:** FR-03 (AC-03-4, 5), FR-06, FR-08 (AC-08-2, 3), QR issuance from FR-07.
3. **Reuse:** Athar Excel parsing technique, Saudi phone normalisation, email-engine invariants (`SKIP LOCKED`, `unknown`, stale recovery), Athar WhatsApp discovery facts (re-verified).
4. **Frontend:** SCR-14, SCR-15, SCR-22, SCR-22a, SCR-23.
5. **Backend:** `guests` (manual, import), `invitations` (content versions, approval, schedule, due sweeper, sender, webhook apply, RSVP, QR intents), BullMQ queues, scheduler role.
6. **UI/UX:** import preview, WhatsApp-style preview, precondition list, campaign progress.
7. **Database/API:** `guests`, `guest_imports`, `guest_import_rows`, `invitation_contents`, `whatsapp_messages`, `whatsapp_inbound`.
8. **Dependencies:** P1 tracer passed; approved templates (or test templates); OQ-01…05, OQ-18, OQ-22, OQ-24 answered or defaults confirmed.
9. **Tasks:** `T-P3-01` to `T-P3-09`.
10. **Acceptance:** AC-03-4, AC-03-5, AC-04-3, AC-06-1…6, AC-08-2, AC-08-3.
11. **Tests:** TC-IMP-01…08, TC-WA-01…10, TC-QR-01…02.
12. **Verification:** a 20-guest campaign to consenting test numbers on staging, with replies and QR receipt; verification log entry.
13. **DoD:** campaign survives a worker restart mid-send without duplicates (TC-WA-06); ledger updated.
14. **Risks:** template category/pricing surprises; messaging tier limits; dirty lists → template and preview.

## P4 — Replacements, scanner, counts, exceptions (W4)

1. **Objective:** complete the event lifecycle: replacements within the margin, owner-authenticated scanning at the door, live counts, admin exception handling.
2. **Scope:** FR-03 (AC-03-6), FR-04 (AC-04-4), FR-07, FR-08 (AC-08-4, 5).
3. **Reuse:** Athar `DataTable` list pattern for the message log and users; hydration-safe role hook.
4. **Frontend:** SCR-24, SCR-25, SCR-27, SCR-30, SCR-31, SCR-32, SCR-40; polling with `LastUpdated`.
5. **Backend:** `replacement.service`, `checkin` module (scan, public invitation), summary endpoint, message resolution, QR reissue, users admin.
6. **UI/UX:** scan mode (full screen, result states, permission flow), counts with definitions.
7. **Database/API:** `/scan/*`, `/public/invitations/:token`, `/admin/events/:id/replacements`, `/admin/messages/:id/resolve`, `/admin/guests/:id/qr/reissue`.
8. **Dependencies:** P3; OQ-01, OQ-15, OQ-23 answers or confirmed defaults.
9. **Tasks:** `T-P4-01` to `T-P4-08`.
10. **Acceptance:** AC-03-6, AC-04-4, AC-07-1…6, AC-08-4, AC-08-5.
11. **Tests:** TC-REP-01…06, TC-QR-03…09, TC-EVT-06, TC-ADM-03…06.
12. **Verification:** venue rehearsal on staging with two phones scanning the same guests; verification log entry.
13. **DoD:** rehearsal passes; ledger updated.
14. **Risks:** camera quirks on iOS Safari → test early in P1 tracer; owner session sharing at the door (accepted, ADR-0005).

## P5 — Hardening and launch (W5)

1. **Objective:** production-ready, accepted by the client, launched.
2. **Scope:** FR-09, all NFRs, revision rounds.
3. **Reuse:** Athar runbook structure (deploy, rollback, backup) with W8 corrections.
4. **Frontend:** fixes from UAT, accessibility fixes, PWA manifest polish.
5. **Backend:** retention job, alerts, production configuration, dependency audit.
6. **UI/UX:** device and accessibility matrix ([accessibility](../ux/accessibility-and-acceptance.md#verification-matrix)); copy review with the client.
7. **Database/API:** roles split, backups, restore drill.
8. **Dependencies:** production hosting, domain, live Moyasar, production WhatsApp number and approved templates.
9. **Tasks:** `T-P5-01` to `T-P5-08`.
10. **Acceptance:** all FR acceptance criteria on production; AC-09-1…5; UX-01…13.
11. **Tests:** full regression, TC-OPS-01…05, Lighthouse/axe, security checklist.
12. **Verification:** [release checklist](../qa/test-strategy.md#release-checklist) recorded in the verification log.
13. **DoD:** launch milestone accepted; support window start date recorded; handover (runbook, credentials list, admin guide) delivered.
14. **Risks:** late external approvals → launch date moves per quotation section 4; UAT scope creep → additions priced separately.
