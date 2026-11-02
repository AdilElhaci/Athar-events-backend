# Progress ledger

**The only authoritative task status** ([D-20](../product/decisions.md)). Updated: 2026-11-02.

Status values: `planned` · `in-progress` · `blocked` (with the dependency and next action) · `done` (only with evidence) · `dropped` (with the decision that dropped it).

Rules: one row per task; `done` requires evidence (commit hash, test run, verification-log entry); each session updates this file before handing off and fills in the footer.

## Documentation

| ID | Phase | Deliverable | Status | Deps | Acceptance | Evidence / blocker |
| --- | --- | --- | --- | --- | --- | --- |
| T-DOC-01 | — | Planning documentation set, `AGENTS.md`/`CLAUDE.md` in both repos, frontend `DESIGN.md` | done | Owner approval 2026-10-24 | README rules | Files created 2026-10-24 (uncommitted) |
| T-DOC-02 | — | Documentation verification pass (coverage, consistency, no unsupported claims) | done | T-DOC-01 | [Verification log](../qa/verification-log.md#2026-10-24--documentation-verification) | Verification log entry 2026-10-24 |

## P0 — Decisions and accounts

| ID | Phase | Deliverable | Status | Deps | Acceptance | Evidence / blocker |
| --- | --- | --- | --- | --- | --- | --- |
| T-P0-01 | P0 | Send the Arabic questionnaire; record answers as decisions; move resolved OQs | planned | — | OQ-01…OQ-25 | |
| T-P0-02 | P0 | Collect client accounts: CR, verified Meta Business, WhatsApp number, Moyasar, domain/hosting access, brand assets and copy | in-progress | — | operations.md list | 2026-10-24: owner sent the Meta Business account requirements to the client; awaiting the rest |
| T-P0-03 | P0 | Hosting option, location and operator chosen; ADR-0002 presented for acceptance | in-progress | T-P0-01 (OQ-06) | ADR-0002 | 2026-10-31: server D-30, location approved D-31, ADR-0002 accepted. **Open:** budget and post-support operator (OQ-06) |
| T-P0-04 | P0 | Submit invitation and QR templates to Meta (Arabic) | planned | T-P0-02 (WABA) | OQ-14 | |
| T-P0-05 | P0 | Quotation signed or re-issued (validity, VAT) | planned | — | OQ-08, OQ-12 | |

## P1 — Foundations, sign-in, landing, tracer (W1)

| ID | Phase | Deliverable | Status | Deps | Acceptance | Evidence / blocker |
| --- | --- | --- | --- | --- | --- | --- |
| T-P1-01 | P1 | Backend scaffold: Nest 11, pnpm, strict TS, config validation, shared envelope/filter/i18n(ar)/pagination/logging allowlist, throttler `60_000`, CORS allowlist, health; Dockerfile; Compose (Postgres, Redis, Mailpit); CI (lint check, typecheck, test, build) | done | P0 | conventions.md | 2026-10-24, uncommitted; see [verification log](../qa/verification-log.md#2026-10-24--authentication-and-admin-users-t-p1-01-t-p1-04-to-t-p1-07): NestJS 11 scaffold, strict TS, env validation, envelope/filter, Redis throttler (60 000 ms), CORS allowlist, helmet, docker-compose (Postgres 5433, Redis 6380, Mailpit), migration up/down/up. CI pipeline not yet created |
| T-P1-02 | P1 | Frontend scaffold: Next 16, pnpm, IBM Plex Sans Arabic, tokens, shadcn RTL, wrappers (`Button`, form elements, `DataTable`, `ReusableDialog`, `MainTitles`), Redux + `baseApi` (memory token, single-flight refresh), route groups, `proxy.ts`; CI | in-progress | P0 | design-system.md | 2026-10-24: Next 16.2.9 + React 19.2 + Tailwind 4, strict TS, pnpm, Node 22 pin, security headers, standalone output, fonts, tokens, `cn` (tailwind-merge extended), `Button`/`ButtonLink`, `(Landing Page)` group, scripts `lint`/`typecheck`/`format:check`/`build` all pass (uncommitted). Remaining: shadcn init (RTL), form elements, `DataTable`, `ReusableDialog`, Redux/`baseApi`, `(Auth)`/`(Dashboard)` groups, `proxy.ts`, CI |
| T-P1-03 | P1 | Production environment (host, TLS, deploy script, secrets); staging deferred | in-progress | T-P0-03, T-P1-01, T-P1-02 | AC-09-1 | 2026-10-31: per D-30. Live on OVH `149.56.209.111` (Ubuntu 26.04): Docker, nginx, UFW (22/80/443), fail2ban, 2 GB swap; read-only deploy keys; SSH keys only (password and root login disabled, 2026-10-31); Let's Encrypt cert for apex, `www`, `api` (renewal dry-run passed); secrets generated on the server; `setup-server.sh` ran; first deploy (blue) applied `InitialAuth` and passed public checks; second deploy switched blue→green with no downtime. SMTP via Google Workspace (`info@atharevents.sa`, login verified). First admin invited by CLI. **Open:** off-host backups and monitoring (P5) |
| T-P1-04 | P1 | Auth backend: `users`, `otp_challenges`, `refresh_tokens`, OTP request/verify, refresh rotation, logout(-all), JWT strategy (DB role), guards, mail template, `PLATFORM_ADMIN_EMAILS` seed | done | T-P1-01 | AC-02-1…5 | 2026-10-24, uncommitted; see [verification log](../qa/verification-log.md#2026-10-24--authentication-and-admin-users-t-p1-01-t-p1-04-to-t-p1-07): password model per D-27 (supersedes OTP-only): 3-step registration, login, refresh rotation with reuse detection, logout(-all), forgot/reset, admin invite, CLI provisioning (D-28) |
| T-P1-05 | P1 | Auth frontend: SCR-02, SCR-03 (`OtpInput`), SCR-04, SCR-05; session bootstrap; marker cookie routing | done | T-P1-02, T-P1-04 | AC-02-1…4 | 2026-10-24, uncommitted; see [verification log](../qa/verification-log.md#2026-10-24--authentication-and-admin-users-t-p1-01-t-p1-04-to-t-p1-07): register (3 steps), login, forgot, reset, accept-invite pages; memory-only access token; single-flight refresh with race retry; proxy.ts marker routing 2026-10-31: restyled to the Figma page "02 Auth" (branch `feat/figma-public-pages`, uncommitted): login with locked state, 3-step register with OTP states (sending, wrong, too many attempts, resend), forgot/sent, reset and invite with expired link, profile (read-only: no update endpoint or phone yet). States verified in Chrome via Playwright with mocked API codes at 1280/360/320. Design differs from the API on the password rule (8 + letter/digit vs 12 chars, D-27): the API rule is shown. 2026-10-31 (D-32): password rule 8 characters with no other rules (API + UI); profile edits name and Saudi mobile (`PATCH /auth/me`, migration `AddUserPhone`); change password with the current one (`POST /auth/change-password`, ends every session); lockout copy matches the API's 15-minute window; "sign out of all devices" removed from the profile. Verified: backend unit 13/13 and e2e 22/22 (2 new); real browser flow against the local API (register with 8 characters, edit profile, change password, old password rejected, lockout at the 11th attempt). 2026-11-01: added the missing entry points: "تسجيل الدخول" in the homepage navbar ("دخول" below 768 px, an addition to Figma, not behind `NEXT_PUBLIC_SIGN_IN_ENABLED`) and "الملف الشخصي" in the dashboard account block. Verified in Chromium at 320/360/768/1024/1440 (no horizontal overflow, 44 px target) and the dashboard link at 1280/360 with a mocked session; typecheck, lint, Prettier pass. Uncommitted, not deployed. |
| T-P1-06 | P1 | Auth and baseline security tests | done | T-P1-04 | TC-AUTH-01…09, TC-SEC-01…03 | 2026-10-24, uncommitted; see [verification log](../qa/verification-log.md#2026-10-24--authentication-and-admin-users-t-p1-01-t-p1-04-to-t-p1-07): 20 e2e (real Postgres/Redis) + 7 unit; Codex security review (2 rounds), 5 findings fixed with regression tests |
| T-P1-07 | P1 | Dashboard shell: role-filtered sidebar, header, breadcrumb, 404 for admin routes as owner | done | T-P1-05 | D-17 | 2026-10-24, uncommitted; see [verification log](../qa/verification-log.md#2026-10-24--authentication-and-admin-users-t-p1-01-t-p1-04-to-t-p1-07): role-filtered dashboard shell, admin users list with search/filters/URL pagination, owner gate (API 403) |
| T-P1-08 | P1 | Landing SCR-01, privacy SCR-06, terms SCR-07 | in-progress | T-P1-02, D-29 | AC-01-1…5 | 2026-10-24: built per D-26 and browser-verified ([verification log](../qa/verification-log.md#2026-10-24--landing-page-t-p1-08)): AC-01-1, AC-01-4, AC-01-5 pass on a local production build. **Open:** AC-01-2 needs `GET /api/packages` (T-P2-01; page shows the prelaunch state meanwhile); AC-01-3 needs sign-in (T-P1-05; set `NEXT_PUBLIC_SIGN_IN_ENABLED`); SVG logo (brand colours applied 2026-10-27 per D-29), contact channels, FAQ wording and privacy/terms text from the client 2026-10-31: rebuilt from the Figma visual direction (file mwjLSQO13GqzARYEHwI47s, page 01 Public) on branch `feat/figma-public-pages`, uncommitted: homepage complete-v2 (13 sections, interactive WhatsApp demo, accordion, contact dialog), five articles, privacy/terms/refund drafts, 404/500. Verified in Chrome via Playwright at 1440/768/360 (no horizontal overflow, section heights within a few px of Figma); lint, typecheck, format, build pass. **Open:** client contact/CR/payment data, approved legal text, approved FAQ answers, real package data before go-live. 2026-10-31 (design update): contact section with form (`POST /api/contact` e-mails the team inbox `CONTACT_INBOX`, no storage; CSRF, throttle, 5 per IP per hour, honeypot), contact icons (phone, mail, map pin), approved SVG logo (red and white), footer without contact details. Verified: e2e 25/25 (3 new), real submission delivered to Mailpit, browser at 1440/360 (section 936 px vs 935 in Figma). 2026-10-31 (footer social row, Figma 190:1293/190:1306): Instagram, X, Snapchat, TikTok icons, always shown as in the design and linked only when `NEXT_PUBLIC_SOCIAL_*` is set. Verified in Chrome at 1440/360 (icon positions equal Figma, linked and unlinked states, no horizontal overflow); lint, typecheck, format pass; e2e not rerun. **Open:** client social URLs. 2026-10-31 (homepage compared section by section with Figma 16:35 and 16:146): fixed footer link spacing, verification block width, mobile payment badges (76 px), accordion height (92 px), textarea resize handle, owner-section mobile gaps, featured-article mobile padding; added `NEXT_PUBLIC_BUSINESS_DEMO` and a git-ignored `.env.local` with the Figma sample data for local review. Verified in Chrome at 1440/360 (no horizontal overflow); lint, typecheck, format and production build pass; a build without the sample values renders none of them. Remaining height differences are font wrapping (Noto in Figma, IBM Plex in code). Only the homepage was compared. |
| T-P1-09 | P1 | Base UX components: `StatusBadge`, `NextStepCard`, `CountTile`, `LastUpdated`, `PhoneText` | planned | T-P1-02 | design-system.md | |
| T-P1-10 | P1 | WhatsApp + QR tracer (integrations.md steps 1–6) on a real phone, incl. minimal webhook signature check and minimal owner scan | planned | T-P0-02 (Meta test number), T-P1-04 | Tracer steps | |
| T-P1-11 | P1 | Phase review: agent docs vs code, verification log entry | planned | T-P1-01…10 | Phase DoD | |

## P2 — Packages, events, payment, owner dashboard (W2)

| ID | Phase | Deliverable | Status | Deps | Acceptance | Evidence / blocker |
| --- | --- | --- | --- | --- | --- | --- |
| T-P2-01 | P2 | Packages: entity, public list, admin CRUD, SCR-21; landing reads real packages | done | T-P1-04 | AC-04-1, AC-01-2 | 2026-11-01, on `main`, not deployed; see [verification log](../qa/verification-log.md#2026-11-01--packages-t-p2-01): migration `AddPackages`, `GET /packages`, `GET/POST/PATCH /admin/packages` (audited in `admin_actions`; deactivate, never delete), SCR-21 at `/dashboard/packages`. **To go live:** deploy, set `WEB_API_URL=http://api:4000/api` on the server, then the admin enters the real packages (none are seeded: no approved prices exist). 2026-11-02: a package chosen on the landing page now carries through sign-in or registration into SCR-11 (AC-01-3). |
| T-P2-02 | P2 | Moyasar client, config, fakes and sandbox fixtures | planned | T-P0-02 | integrations.md | |
| T-P2-03 | P2 | Events backend: create/edit, package snapshot, reference code, state fields, ownership, admission window defaults | done | T-P2-01 | AC-03-1, AC-03-7, AC-04-2 | 2026-11-02, on `main`, not deployed; see [verification log](../qa/verification-log.md#2026-11-02--owner-events-t-p2-03-to-t-p2-05): migration `AddEvents`, `GET/POST /events`, `GET/PATCH /events/:id`. `approved_content_id` waits for `invitation_contents` (T-P3-04). |
| T-P2-04 | P2 | Owner SCR-10 my events, SCR-11 create wizard | done | T-P2-03 | AC-03-1 | 2026-11-02, on `main`, not deployed; same log entry. The review step ends with "أنشئ المناسبة"; "ادفع الآن" replaces it with checkout (T-P2-07). |
| T-P2-05 | P2 | Owner SCR-13 overview: timeline, next-step card, state handling (counts placeholder) | in-progress | T-P2-03, T-P1-09 | AC-03-2, AC-03-3 | 2026-11-02, on `main`, not deployed: overview, timeline, next step for every state, capacity tiles, edit dialog. **Open:** pay button (T-P2-07); guest-list template download (T-P3-02, OQ-04, OQ-05). Only the unpaid state was reached in the browser: later states need payment and admin tasks. |
| T-P2-06 | P2 | Admin queue SCR-20, all events SCR-20a, event workspace details tab | done | T-P2-03 | AC-08-1 | 2026-11-02, on `main`, not deployed; see [verification log](../qa/verification-log.md#2026-11-02--admin-queue-and-events-t-p2-06): `GET /admin/dashboard`, `GET /admin/events`, `GET`/`PATCH /admin/events/:id` (audited correction with reason, admission window), SCR-20, SCR-20a, details tab. **Follow-ups belong to their tasks:** alerts for unknown sends and payments to reconcile (T-P3-07, T-P2-08); `sending` stays empty until sending exists; the assignee column in Figma has no data model and was left out. |
| T-P2-07 | P2 | Checkout, payment attempts, single apply-payment path | planned | T-P2-02, T-P2-03 | AC-05-1, AC-05-2 | |
| T-P2-08 | P2 | Webhook, invoice callback, reconciliation job, payment-status endpoint, SCR-12 | planned | T-P2-07 | AC-05-3, AC-05-4 | |
| T-P2-09 | P2 | Admin payments SCR-26, mark refunded, `admin_actions` + SCR-28 | planned | T-P2-07 | AC-05-5, AC-08-5, AC-08-6 | |
| T-P2-10 | P2 | Demo milestone on staging; verification log entry | planned | T-P2-01…09 | Demo milestone | |
| T-P2-11 | P2 | Admin contact requests SCR-29: stored messages, list, search, status, delete, sidebar count | done | T-P1-08, D-34 | D-34 | 2026-11-02, on `main`, not deployed; [verification log](../qa/verification-log.md#2026-11-02--contact-requests-t-p2-11). Retention D-35; privacy draft updated. **Open:** client approval of the privacy wording. |
| T-P2-12 | P2 | Admin articles SCR-29a, SCR-29b: CRUD, cover upload, public pages from the API, five launch guides seeded | done | T-P1-08, D-36 | D-36 | 2026-11-02, on `main`, not deployed; [verification log](../qa/verification-log.md#2026-11-02--admin-articles-t-p2-12). Also fixed a pre-existing type error in `packages.service.ts`. **Open:** no public page lists every article, so anything older than the newest five needs a direct link. |

## P3 — Guests, approval, scheduling, sending, RSVP (W3)

| ID | Phase | Deliverable | Status | Deps | Acceptance | Evidence / blocker |
| --- | --- | --- | --- | --- | --- | --- |
| T-P3-01 | P3 | Guests: entity, admin manual entry, quota locks, SCR-22 | planned | T-P2-03 | AC-04-3 | |
| T-P3-02 | P3 | Excel template download, import preview/apply, SCR-22a | planned | T-P3-01, OQ-05 | AC-08-2 | |
| T-P3-03 | P3 | Owner guest list SCR-14 (masked phones); list readiness transitions | planned | T-P3-01 | AC-03-4 | |
| T-P3-04 | P3 | Invitation content versions, owner approval SCR-15, admin content panel | planned | T-P3-03, OQ-02 | AC-03-5 | |
| T-P3-05 | P3 | BullMQ queues, scheduler role, sweepers, stale recovery, heartbeat | planned | T-P1-01 | D-09 | |
| T-P3-06 | P3 | Schedule/pause/resume/cancel endpoints, preconditions, SCR-23 | planned | T-P3-04, T-P3-05 | AC-08-3 | |
| T-P3-07 | P3 | Sending engine: intents, claim, outcomes, chunking, event-start cutoff, `UNKNOWN` handling | planned | T-P3-05, T-P1-10 | AC-06-1, AC-06-4, AC-06-5 | Must recheck `approval_status = APPROVED` at send time: an admin correction (T-P2-06) can reset approval on a `SCHEDULED` campaign without unscheduling it. |
| T-P3-08 | P3 | Webhook apply: monotonic statuses, button replies, RSVP, inbound records | planned | T-P3-07 | AC-06-2, AC-06-6 | |
| T-P3-09 | P3 | QR issuance on Accept; QR and QR-template intents | planned | T-P3-08 | AC-06-3, AC-07-1 | |

## P4 — Replacements, scanner, counts, exceptions (W4)

| ID | Phase | Deliverable | Status | Deps | Acceptance | Evidence / blocker |
| --- | --- | --- | --- | --- | --- | --- |
| T-P4-01 | P4 | Replacement service with concurrency tests | planned | T-P3-08, OQ-01 | AC-04-4 | |
| T-P4-02 | P4 | Replacements UI SCR-24 | planned | T-P4-01 | AC-08-4 | |
| T-P4-03 | P4 | Scan endpoints (owner-only, window, conditional update), public invitation endpoint | planned | T-P3-09, OQ-15 | AC-07-2…4 | |
| T-P4-04 | P4 | Scanner PWA SCR-30/31/32, guest page SCR-40, real-device tests | planned | T-P4-03 | AC-07-5, AC-07-6 | |
| T-P4-05 | P4 | Summary endpoint, owner counts with polling and `LastUpdated` | planned | T-P3-08 | AC-03-6 | |
| T-P4-06 | P4 | Message log SCR-25, resolve `UNKNOWN`/`FAILED`, QR reissue | planned | T-P3-07 | AC-06-4, AC-08-5 | |
| T-P4-07 | P4 | Users admin SCR-27 (suspend, reactivate) | planned | T-P1-04 | AC-08-5 | 2026-11-02: "create admin" removed by D-33; administrators are created only by the server CLI (D-28) |
| T-P4-08 | P4 | Venue rehearsal on staging (two phones, full journey); verification log entry | planned | T-P4-01…07 | Phase DoD | |

## P5 — Hardening and launch (W5)

| ID | Phase | Deliverable | Status | Deps | Acceptance | Evidence / blocker |
| --- | --- | --- | --- | --- | --- | --- |
| T-P5-01 | P5 | Security and concurrency review; dependency audit | planned | P4 | security-and-privacy.md | |
| T-P5-02 | P5 | Accessibility and device matrix; UX acceptance checks | planned | P4 | UX-01…13, A-01…14 | |
| T-P5-03 | P5 | Production environment: host, DNS, TLS, SPF/DKIM/DMARC, DB roles | planned | T-P0-03 | AC-09-1, AC-09-2 | |
| T-P5-04 | P5 | Off-host backups and restore drill | planned | T-P5-03 | AC-09-3 | |
| T-P5-05 | P5 | Production tracer re-run with approved templates and client number; live payment smoke | planned | T-P5-03, T-P0-04 | AC-05-*, AC-06-* | |
| T-P5-06 | P5 | UAT and revision rounds | planned | T-P5-05 | Client sign-off | |
| T-P5-07 | P5 | Retention job, alerts, runbook and admin guide handover | planned | T-P5-03 | NFR-04, NFR-08 | |
| T-P5-08 | P5 | Launch; release checklist; support window start recorded | planned | T-P5-01…07 | AC-09-4, AC-09-5 | |

---

**Session footer** (overwrite each session)

- Last session: 2026-11-02 — events backend (T-P2-03), owner SCR-10, SCR-11, SCR-13 (T-P2-04, T-P2-05), chosen package carried through sign-in; "sign out of all devices" button removed from the dashboard shell for owners and admins at the owner's request (`POST /auth/logout-all` kept, API-only; changing the password still ends every session). Everything since 2026-11-01 is on `main` and not deployed. Plan change D-33: no admin creation in the dashboard (AC-08-5, SCR-27, T-P4-07, TC-ADM-04, API contract updated). T-P2-06 done (admin queue, all events, details tab).
- Next action: commit and deploy; then T-P2-02/07/08 (Moyasar checkout and activation), which needs the client's Moyasar test keys (T-P0-02) for a real sandbox run.
- 2026-11-02, T-P2-11: admin contact requests SCR-29 built and verified (D-34), on `main`, not deployed. Run `AddContactMessages` with the release. Retention decided (D-35), privacy draft updated.
- 2026-11-02, T-P2-12: admin articles built and verified (D-36), on `main`, not deployed. Run `AddArticles` with the release; it must run before `AddContactMessages`, which the timestamps already ensure. The local dev database already has both migrations.
- Working-state concerns: hosting budget and post-support operator still open (OQ-06). Off-host backups and monitoring not set up (P5). Local stack: `docker compose up -d` in the backend; API on :4000, web on :3000.
