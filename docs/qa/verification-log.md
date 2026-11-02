# Verification log

Append-only record of what was actually verified, with date, environment, method and result. A planned test is not evidence; only entries here (and linked CI runs) are. Newest entries at the bottom.

Entry format:

```text
## YYYY-MM-DD — <title>
- Scope: <task IDs / acceptance IDs>
- Environment: <local | staging | production>, commit <hash>
- Method: <automated suite / manual steps / device>
- Result: pass | fail | partial — details
- Follow-ups: <task IDs>
```

## 2026-10-24 — Documentation verification

- Scope: T-DOC-02; all files under `docs/`, `AGENTS.md`/`CLAUDE.md` in both repositories, frontend `DESIGN.md`.
- Environment: documentation only; no application code exists.
- Method: manual review against the quotation, the owner's decisions, the Athar reference source (read-only) and the Claude–Codex review record; link and ID cross-check with `grep`.
- Result: pass, with the observations below.
  - Coverage: FR-01 to FR-09 each have a primary spec, acceptance criteria, screens, endpoints, tasks and test cases (traceability table in `product/scope-and-acceptance.md`).
  - Consistency: the owner's scanner decision (D-08) is reflected in the scope, specs, ADR-0005, API contracts, security matrix, UX docs, roadmap and tests; no remaining references to scanner passes except as the rejected alternative.
  - Athar facts: the two Codex-only claims (refresh-token race W3, request-body logging W6) were verified by reading `auth.service.ts` and `logging.interceptor.ts` on 2026-10-24.
  - Unsupported claims: provider behaviour not yet confirmed in a sandbox is marked "to verify" in `architecture/integrations.md`.
  - Automated cross-check (script over 40 Markdown files): all relative links and anchors resolve; every referenced D (25), OQ (25), AC (49), TC (81), task (53) and SCR (28) ID is defined.
  - Fixed during the pass: screen IDs in the traceability table and SP-04, task IDs in the traceability table, a broken retention anchor, an incorrect D-01 consequence, and a missing FR-09 ownership line in `operations.md`.
  - The existing Athar repositories show only their pre-existing local changes (`openrouter.provider.ts` edited 2026-10-21, untracked `docs/features/whatsapp-campaigns/` dated 2026-10-22, `.claude/`); nothing was written there.
- Follow-ups: T-P0-01 (client answers), T-P1-10 (tracer verifies the WhatsApp assumptions).

## 2026-10-24 — Landing page (T-P1-08)

- Scope: T-P1-08; AC-01-1, AC-01-4, AC-01-5; UX-10/11/12 where applicable; A-01, A-04, A-05, A-06, A-10, A-11.
- Environment: local production build (`next build` + `next start`), uncommitted working tree; system Chrome via Playwright 1.56.1 and @axe-core/playwright 4.10.2; Lighthouse 12.8.2. Package fixtures (`PACKAGES_FIXTURES=true`) and `example.com` contact values were used for the visual run only.
- Method: scripted checks at 1440×900, 820×1180 and 360×780 (RTL/lang, horizontal overflow, single H1, display font applied, reveals never leave content hidden, touch targets ≥ 44 px on mobile, axe WCAG 2.0–2.2 A/AA, console errors); keyboard-driven guest demo (accept → QR → door scan → reset → decline) with live-region check; mobile menu open/Escape; native FAQ; reduced motion; JavaScript disabled; Lighthouse mobile ×2 and desktop; default build (no fixtures, no contact) inspected for prelaunch states.
- Result: **pass** — 31/31 scripted checks; axe: no violations at any width; Lighthouse mobile performance 89, accessibility 100, best practices 100, SEO 100 (LCP 3.7 s simulated slow 4G, CLS 0, TBT 30–50 ms); desktop performance 100, accessibility 100. Default build shows "الباقات قيد الإعداد" and "نُعلن قنوات التواصل قريباً", no fixture text or sample contact.
- Defects found and fixed during the run: the door panel overlapped the phone and blocked the "أعتذر" button on desktop (moved beside the phone); tailwind-merge treated `text-18` as a colour and removed `text-primary-foreground` from the hero button (type scale registered as font sizes); brand link and demo buttons were under 44 px on mobile; preloading both IBM Plex subsets delayed LCP (Arabic-only preload).
- Not verified: real devices (iPhone Safari, Android Chrome), VoiceOver/TalkBack, 200% zoom, live `GET /api/packages` (backend not built), final brand. AC-01-2 and AC-01-3 remain open (see ledger).
- Follow-ups: T-P1-02 (port these checks into a Playwright suite in CI), T-P2-01 (packages API), T-P1-05 (sign-in CTA), OQ-13.

## 2026-10-24 — Authentication and admin users (T-P1-01, T-P1-04 to T-P1-07)

- Scope: D-27, D-28, ADR-0007; FR-02 (as amended), FR-08 users list; register, verify, login, refresh, logout, logout-all, forgot/reset, admin invite/promotion, admin users list.
- Environment: local; PostgreSQL 18, Redis 8, Mailpit (docker compose); API built with `nest build` and run with `node dist/main.js`; web built with `next build` and run with `next start`; uncommitted working trees.
- Method and result:
  - Backend: `pnpm lint` 0 findings, `pnpm typecheck` 0, `pnpm format:check` clean, `pnpm build` OK; unit 7/7 (password policy, LIKE escaping); e2e **20/20** against real PostgreSQL and Redis with captured email: three-step registration and cookie flags; identical responses for new/existing emails; no admin via public DTO; code lock after 5 attempts; Arabic-Indic digits; registration token single use; generic login errors; CSRF (missing header, foreign Origin); refresh rotation and replay → session revoked; logout kills the access token at once; failed-login limit 429; reset ends sessions, single use, newest link only; admin invite purpose binding; users list 401/403, pagination, literal search, type filter; promotion requires `--promote` and revokes sessions; review fixes (refresh race 409 keeps cookies, TTL repair, malformed JSON 400 without echo, hash upgrade).
  - Migration `InitialAuth` up → down → up on the development database.
  - Frontend: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm build` OK.
  - Browser (Chrome via Playwright, Mailpit for codes and links): **25/25** — registration through the UI with Arabic-Indic code entry, weak password rejected, landing on the dashboard; refresh cookie HttpOnly / Path `/api/auth` / Lax and not readable by JavaScript, nothing in web storage; session restored on reload; owner blocked from the users page (UI) and API (401/403); logout and redirect; generic wrong-password error; forgot → reset via the emailed link with the token removed from the address bar, single use, login with the new password; CLI invite → accept → admin login → users table, search, type filter, empty state; mobile layout without page overflow; axe: no serious or critical violations on register, login and admin users; no uncaught page errors.
- Codex: design debate (17.7K input / 1.3K output tokens) and focused code review (231.9K input, 183.3K cached / 2.3K output). Review findings fixed: HIGH re-hash could restore a reset password (conditional update); MEDIUM lost revocation between login and sign-out-everywhere (user-first lock order); MEDIUM multi-tab refresh race cleared the winner's cookie (409 `auth.refresh_race` + client retry); MEDIUM rate-limit counter without TTL (atomic Lua script); MEDIUM parser errors could log body fragments (fixed message, no message logging).
- Defects found by our own testing and fixed: post-login race redirected to the login page; unhandled promise rejection on failed login; ESM-only 12.x Nest companions broke Jest (pinned Nest-11 majors); `express` missing as a direct dependency; scaffold `tsconfig` not actually strict.
- **Not verified (owner to do):** delivery through the real SMTP provider (all email here went to Mailpit), SPF/DKIM/DMARC, inbox placement (spam folder), real phones, screen readers, production proxy/IP forwarding.
- Follow-ups: OQ-26, OQ-27, OQ-28; CI pipelines; Playwright suite in the frontend repository.

## 2026-11-01 — Packages (T-P2-01)

- Backend: e2e 28/28 (3 new: admin-only access and CSRF, public list of active packages in order, audit rows, field validation), unit 13/13, typecheck, ESLint, Prettier and build pass.
- Migration `AddPackages` ran up, down and up on a scratch database. `migration:generate --check` reports nothing for `packages`; it does report pre-existing enum differences on the auth tables, which are not caused by this change.
- Browser (Chromium, production build, real API and PostgreSQL): admin signs in, empty state, field errors, adds packages with Arabic-Indic digits and decimals, edits, activates and deactivates, reload. axe (WCAG 2 A/AA): 0 violations on the list and the dialog. Dialog closes on Escape and restores focus; no overflow at 360 px.
- Landing: `API_URL` set only at runtime, as in Docker. Without a rebuild the page moved from its built state to the live packages through the 60 s revalidation, showed active packages only and no sample notice; a card links to `/auth/login?package=<id>`.
- Not verified: the Docker image and the production server (not deployed).

## 2026-11-02 — Owner events (T-P2-03 to T-P2-05)

Uncommitted, not deployed. Ran on local Postgres, Redis and Mailpit with a production frontend build; scratch database dropped afterwards.

- Backend: typecheck, lint, build pass; unit 25/25 (12 new, next-action logic); e2e 35/35 (7 new: snapshot and defaults, unique references, owner isolation 401/403/404, CSRF, inactive package and impossible times, snapshot unchanged by a catalogue edit, package lock after checkout starts, full lock after approval). Migration `AddEvents` up, down, up: table and sequence removed and restored.
- Frontend: typecheck, lint, Prettier pass.
- Real Chromium flow: landing package card → sign-in → register with the emailed code → SCR-11 with the package preselected → validation (empty, past date, http link, send after start) → review → create → SCR-13 (`AE-000001`, unpaid) → reload → edit → SCR-10. Also: default selection, deactivated package notice, signed-in `/auth/login?next=` honoured, external `next` ignored, unknown event.
- axe (WCAG A/AA): 0 violations on details, review, overview and edit dialog. On SCR-10 and the package step the only finding is the green success toast's contrast (sonner `richColors`, global, not fixed).
- No horizontal overflow at 320, 360, 768, 1024 on SCR-10, SCR-11, SCR-13.

Not verified: states after payment (no path reaches them yet, covered by unit tests only), Docker image, production server. Not compared pixel by pixel with Figma; the wizard's selected package uses a ring where Figma has no selected state.

## 2026-11-02 — Contact requests (T-P2-11)

Uncommitted, not deployed. Ran on local Postgres and Redis with a scratch database, Redis index and ports (dropped afterwards), SMTP disabled.

- Backend: typecheck, lint, format, build pass; unit 30/30; e2e 57/57 across all suites (7 new in `test/contact-messages.e2e-spec.ts`: storage and e-mail, honeypot and invalid input store nothing, 401/403 on every admin route, CSRF, validation, literal search and filters, read without undoing later statuses, audit without personal data, permanent delete).
- Frontend: typecheck, lint, format, production build pass.
- Real Chrome flow on a dev server: public form with a markup payload → sign-in → table, sidebar count → open message (marked read, count drops, payload shown as text and not run) → status change reaches the table → delete with confirmation, no refetch of the deleted row → search by 05… → status filter and empty state → emptying the last page returns to a page with rows. No console errors. No horizontal page overflow at 360.

Not verified: the migration on the production server, the 60 s polling interval over real time, the load error states in the browser, real SMTP delivery of the unchanged e-mail. No axe run. The dev database is behind on migrations (`AddPackages` onward), so `pnpm migration:run` is needed before local use.

## 2026-11-02 — Admin queue and events (T-P2-06)

- Scope: AC-08-1, TC-ADM-01; `GET /admin/dashboard`, `GET /admin/events`, `GET`/`PATCH /admin/events/:id`; SCR-20, SCR-20a, event workspace details tab.
- Backend: 11 new e2e tests in `test/admin-events.e2e-spec.ts` against real PostgreSQL and Redis, including every combination of the five state fields against the next-step logic (TC-ADM-01), access (401/403), correction audit, date moving the window, inverted window, no-op, approval reset, send times, closed events, CSRF.
- Browser: Chromium against the local API with temporary seeded data, removed afterwards. Queue counters, overdue alert, task list, stage filter from a counter, search, correction with validation, owner overview, owner blocked from all events. No horizontal overflow at 1280, 768, 360 and 320 on the three screens; correction dialog measured at 320.
- Defect found and fixed in the browser: the form sent every field, so rounding to the minute logged an untouched `startsAt`; it now sends changed fields only.
- Not tested: the stale notice and the error states of SCR-20 in the browser; the production build was not run against a deployed server.

## 2026-11-02 — Admin articles (T-P2-12)

Uncommitted, not deployed. Ran on local Postgres and Redis with a scratch database (dropped afterwards), against the standalone production server, because `next start` never refreshes the homepage with `output: standalone`.

- Backend: typecheck, lint, format, build pass; unit 30/30; e2e 68/68 across all suites. `test/articles.e2e-spec.ts` covers seeded content, 401/403 on every admin route, CSRF, the draft-to-delete journey, publish completeness including the database check, long bodies past the 16 KB limit, slug uniqueness and format, literal search, status filter, and cover type, size, origin and cleanup.
- `migration:generate --check` reports nothing for `articles` or `article_images`.
- Frontend: typecheck, lint, Prettier and production build pass.
- Real Chrome flow (30 checks, then a separate mobile pass): seeded articles on the homepage and article page, owner gate, admin list, draft, field errors, refused quick publish, 2 MB limit, cover upload, publish, markup shown as text, search and filter, homepage update, unpublish, republish, delete with confirmation. No overflow at 320 and 375, no console errors.
- Found and fixed in this flow: `fetch`'s data cache keeps only 200 responses, so a deleted or unpublished article stayed public indefinitely. `lib/articles.ts` now caches the result, including "not found", through `unstable_cache`; the flow confirms 404 after unpublish and delete.

Not verified: the migration on the production server, the Docker image, real-device mobile, an axe run. `AddArticles` `down` was not run. A public change takes up to about a minute, and the first homepage request after a deploy can still show the build-time page, as with packages.

## 2026-11-02 — Moyasar checkout and activation (T-P2-02, T-P2-07, T-P2-08)

Uncommitted, not deployed. No real Moyasar key was used: the backend ran against `FakeMoyasarClient` (e2e) and against a local Moyasar stand-in over HTTP (browser), so the real `HttpMoyasarClient` request path was exercised but not Moyasar itself.

- Backend: typecheck, format, build pass; lint 0 errors (11 `no-unsafe-argument` warnings on `res.body` in e2e files, as in the other suites); unit 39/39 (new `payment-outcome.spec.ts`: amount, currency, invoice id, attempt id and payment amount mismatches, state mapping, card summary); e2e 81/81 across all suites. `test/payments.e2e-spec.ts` (13): invoice for the snapshot price with return/back URLs and attempt metadata, reuse, package frozen after checkout, two simultaneous clicks open one invoice, other owner 404, cancelled 409, started 422, 503 without a key or when Moyasar is down (nothing stored), webhook activation, replay is a no-op without a second fetch, 401 without or with a wrong secret, retry after a failed fetch, forged callback body ignored, unknown invoice ids not fetched, return-page status check, mismatch never activates, declined card keeps the attempt open, expiry frees the event, second paid invoice recorded as `duplicate_payment`, reconciliation after 2 minutes and expiry after 48 hours.
- `AddPayments` up, down, up on the local database; `migration:generate` shows no difference for `payment_attempts` or `webhook_receipts` (it does report older, unrelated enum drift in the auth tables, left untouched).
- Frontend: typecheck, lint, Prettier and production build pass.
- Real Chromium flow (Playwright, local API + Moyasar stand-in, 9 checks): wizard "ادفع الآن" opens the hosted page for 500.00 SAR; paying returns to SCR-12, which shows "تم الدفع بنجاح" and the overview moves to "أرسل قائمة ضيوفك"; leaving the hosted page unpaid shows the pending notice and the pay button reopens the same invoice; an expired invoice shows "لم يكتمل الدفع" and a new invoice; a payment never confirmed shows "سنؤكد الدفع قريباً" after 30 s. No horizontal overflow at 360.

Not verified: the Moyasar sandbox itself (invoice fields, `expired_at` format, real webhook and callback deliveries, invoice status names other than `initiated`/`paid`/`expired`), the callback URL (sent only for an `https` origin), the 5-minute cron in a running container, the Docker image.

## 2026-11-03 — Simpler article form (T-P2-12)

Owner asked for five admin fields: title, cover, summary, sections, published.

- Backend: `category` and `takeaway` removed from `REQUIRED_TO_PUBLISH` and from `CHK_articles_published_complete` (migration `RelaxArticlePublishCheck`, up/down/up on the local database). Articles e2e 16/16, including a new test that publishes without both fields. Typecheck and lint pass.
- Frontend: typecheck, lint, Prettier pass.
- Chromium via Playwright (local API and web): the new-article form shows only العنوان, صورة الغلاف, الملخص, عنوان القسم / نص القسم, منشور; publishing empty shows the field errors; a published article got slug `article-20261102-596d`, reading time 1, cover alt equal to the title, category null; the public page shows «دفتر أثر» without a category and no «خذها معك» box; editing kept the slug. Test article, its image and the temporary admin were deleted afterwards.

Not verified: the five seeded guides after the change (their category and takeaway stay stored; the takeaway still shows, the category no longer does).
