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

## 2026-11-05 — Invitation calculator (T-P1-08)

Landing packages section replaced by the calculator (Figma 255:5090; landing 255:7187 desktop, 255:7246 mobile, 255:10952 at 320 px). Frontend only; no API or schema change.

- Rules (`lib/invitation-calculator.ts`): only the base allowance counts (the reserve is separate); smallest fitting package, cheaper on a tie; a chosen package is kept while it fits and dropped once it does not; above the largest allowance the summary offers contact and no price. Prices are integer halalas from the API and are never computed, only displayed; the event snapshots the package price on the server, and existing e2e tests reject a client `priceHalalas`.
- No VAT, discount or surcharge rule exists in the code, the API or the decisions; the page states the price per event as charged at payment. Owner later confirmed prices include VAT ([D-38](../product/decisions.md#d-38)); calculator, wizard review and event overview now say «شامل الضريبة». The Figma note «تفاصيل الضريبة تُؤكَّد قبل الدفع» was not used because nothing confirms tax before payment.
- Unit (Node test runner, 7 tests): boundaries 1, 99, 100, 101, 249, 250, 251, 499, 500, 501; reserve not counted; choice fallback; Arabic-Indic, Persian, Western digits and grouping; empty, zero, negative, fractions, text, too long.
- Chromium via Playwright against a local API with three temporary packages (100+10 / 490, 250+25 / 990, 500+50 / 1,790 SAR), 44 checks pass: the same boundaries in the UI, disabled packages with «لا تستوعب العدد», larger choice kept then dropped, digits, invalid states with `aria-invalid`, presets and «أكثر من 500 دعوة», keyboard focus, one polite announcement after typing settles, CTA link `next=/dashboard/events/new?package=…&invitations=180`, the register link keeping it, sign-in landing on the wizard with the package preselected, «لَمّة» disabled for 180, and a too-small package in an edited link replaced by the smallest fit with a notice.
- Server-rendered HTML contains the title, package names, prices and the CTA link before hydration.
- Widths 1440, 1024, 768, 390, 360, 320: no horizontal scroll; the WhatsApp button does not cover the CTA. Typecheck, lint, Prettier and production build pass. Test packages and the test owner were deleted afterwards.

Not verified: a full new registration (OTP) through to the wizard (only the preserved `next` on the register link); screen reader output itself (the live region text was checked, not spoken).

## 2026-11-07 — Figma refresh (T-P1-08)

Frontend only; no API, schema or auth change. Figma read through MCP: homepage 16:35 / 16:146, 293:1802, 262:988, 255:5090, gallery concepts 263:825/837/848, EditorialGuide 262:1029…1123, contact feedback 269:1794/1804, auth 28:2, owner 29:51 / 29:364 / 29:2305, privacy 36:546, 404 36:650.

- Hero title: sampled `clip-path` in Chromium: line 1 uncovers first, line 2 from ~0.8 s, both complete by ~1.5 s; hero height and CTA position identical before and after; with `prefers-reduced-motion: reduce` the animation is `none` and the text is fully visible at once. The text stays one DOM string per line (no letter splitting).
- Tabs: arrow keys and Home/End move selection and focus; panel changes only on the owner's action (250 ms fade).
- Gallery: 6 cards; dialog opens with focus inside, closes on Escape and on «أغلق المعاينة», and focus returns to the card; phone «التالي» scrolls the row (RTL).
- Calculator: 50 browser checks pass (boundaries 1…501, larger choice then count change, Arabic and Persian digits, invalid input, meter 100/250 → «150 دعوة إضافية…», 248 → «دعوتان إضافيتان…», full at 250, larger package 100/500 with price 1,790, input/price/meter in sync). Unit tests 7/7.
- Full registration through Mailpit OTP from the calculator CTA (count typed as «٣٢٠») lands on the wizard with the package and 320 preserved; smaller packages disabled; the details preview mirrors the typed name.
- Contact: server error shows «تعذّر إرسال الرسالة» and keeps the inputs; the pending state shows on the button; success appears only after the local API answered and moves focus to the confirmation. Messages went to Mailpit only.
- Widths 1440, 1280, 1024, 768, 390, 360, 320: no horizontal page scroll.
- Typecheck, lint, Prettier and production build pass. Test users, events and the contact message were deleted afterwards.

Not verified: admin list empty states were not opened in the browser (the shared component was checked on the owner list); scanner (05) and guest (06) pages do not exist yet; Figma typing settings were not used as evidence (the animation was measured in the browser).
- Follow-up (owner request): the impact figures count up once (about 1.4 s, ease-out) when the band scrolls into view. Measured in Chromium: 0 before scrolling, intermediate values at 150/500/900 ms, exactly 12 / 25,000 / 24,000 at the end; band height unchanged (an invisible copy of the final value reserves the width); the server HTML and the screen-reader text hold the final values; with reduced motion the final values show at once.

## 2026-11-07 — Landing motion phase 1 (T-P1-08)

Foundation only (tokens, `lib/motion.ts`, `Reveal` on `data-reveal` with stagger). Uncommitted.

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`: pass.
- Playwright (Chromium 1194, WebKit 26.0) at 1440/768/360/320, 80 checks, 80 pass on a production server (`next start`): steps armed only below the fold and revealed with 0/80/160/240 ms delays (opacity sampled mid-transition in both engines); nothing left `data-reveal="armed"` after a full scroll; count-up ends at 12 / 25,000 / 24,000; hero `type-reveal` unchanged (0.7 s, second line +0.8 s); no horizontal overflow; no console errors; measured CLS over load plus a full scroll 0.0000 at every width; reduced motion: nothing armed, final values, static hero; JavaScript off: steps visible; print media: armed steps print visible.
- On the dev server Chromium at 320 px measured CLS 0.0154 from the hero paragraph re-wrapping while the web font loads (dev only; 0 on the production server). Not caused by the motion work.


## 2026-11-07 — Guests, import and list readiness (T-P3-01 to T-P3-03)

Backend `guests` module, migration `AddGuests`, admin SCR-22 guests tab and SCR-22a import dialog, owner guest list on SCR-13. Uncommitted, not deployed.

- `test/guests.e2e-spec.ts`, 12/12: role separation; manual entry with Arabic digits and spaces normalised to `+9665…`, duplicate phone 409, allowance and reserve limits 422, non-Saudi number 422, audit rows without phones; unpaid 422 and scheduled 409; edit, soft delete and re-adding a deleted number; 300 valid / 5 invalid / 3 duplicate rows preview exactly those counts and apply 300, a second apply adds nothing, the template example row is skipped (TC-IMP-01, TC-IMP-04); existing numbers, over-limit, reserve and a bad type classified; a `=HYPERLINK(…)` cell neutralised and rejected, a non-xlsx file and missing headers refused (TC-IMP-05); expired preview 409; two concurrent applies on a 3-guest allowance add exactly 3 (TC-IMP-07); `READY` refused with no initial guest, accepted with one (stage `awaiting_approval`), reverted to `IN_PROGRESS` when the last initial guest is deleted; owner list masked (`+9665•••••567`), name search only, 404 for another owner's event; template served to owners and admins with the four Arabic headers.
- Full backend suite: unit 39/39, e2e 94/94; typecheck, lint (0 errors), Prettier and `nest build` pass. Frontend typecheck, lint, Prettier and production build pass.
- Browser (Chromium, local API and dev web server, temporary QA admin, owner and paid events created in the dev database and deleted afterwards): admin guests tab empty state; template downloaded as `قائمة-الضيوف-أثر.xlsx`; a 12-row owner sheet previewed as 10 valid, 1 invalid, 1 duplicate and applied (10 added); manual add refused for an existing number and accepted for a new one; meters 9/10 and 2/2; «القائمة جاهزة» moved the event to «الاعتماد والجدولة» (task «جدولة الإرسال»); owner saw the 11 guests with masked phones at 1440 and 390; the SEND_LIST card shows the template, the WhatsApp link prefilled with the event number and the copy button. No horizontal page scroll at 1440 or 390 after a fix: the hidden actions header (`sr-only`, absolutely positioned) escaped `DataTable`'s scroll box, so the box is now `relative`.

Not verified: real WhatsApp delivery of the owner's message (link only); an import of the full 2,000 rows in the browser (the 308-row case is covered by e2e); WebKit.

## 2026-11-07 — Invitation approval and scheduling (T-P3-04, T-P3-06)

Uncommitted, not deployed. Migration `AddInvitationContents`; module `invitations`; SCR-23 admin tab «الدعوة والجدولة»; SCR-15 owner card.

- `test/invitations.e2e-spec.ts`, 6/6: suggested variables and template state; versions (unchanged text adds none, a new line refused with `invitation.variable_invalid`), stage `awaiting_approval` / `APPROVE_INVITATION`; owner approval refused with a wrong hash, accepted with the right one, idempotent; a new version resets approval and the old one is `version_outdated`; unpaid refused; another owner's invitation 404; admin override with a reason (audited); scheduling refused in order: list not ready, not approved, template not approved, past, after the event; then scheduled (stage `scheduled`, version 1), guests and invitation frozen, reschedule (version 2), unschedule back to `AWAITING_SCHEDULE` and guests editable again; a material admin correction clears the approved version.
- Full backend: e2e 100/100, unit 39/39, lint, Prettier, build pass. Frontend typecheck, lint, Prettier and production build pass.
- Browser (Chromium, local API, temporary QA accounts and event deleted afterwards): admin tab prefilled from the event; live preview follows the typed date; saving moved the task to «متابعة اعتماد الدعوة»; the owner at 390 px saw the WhatsApp-style preview, approved, and the next step became «سيتم جدولة الإرسال قريباً»; the admin then saw «اعتمدها صاحب المناسبة», three of four conditions met and «جدولة الإرسال» disabled because the template is `PENDING`; no horizontal scroll at 1440 and 390; no page errors.

Not verified in the browser: the scheduled state (needs `WHATSAPP_INVITATION_TEMPLATE_STATUS=APPROVED`; covered by e2e) and the override dialog (covered by e2e).

## 2026-11-10 — WhatsApp tracer on production and campaign sender (T-P1-10, T-P3-07)

Tracer: deployed (`f69609d`, `b696aea`). Campaign sender: uncommitted, not deployed.

- Production, real phones, client number on WABA «أثر ايفنتس - Messaging campaigns»: a manual template send was accepted but not delivered until Meta's billing block was fixed (statuses `FAILED` in `webhook_receipts`), then delivered. Event AE-000002: the CLI sent the approved invitation to two guests (`SENT`); the owner tapped «سأحضر» → dashboard `ACCEPTED` and the QR image with its link arrived; a second guest tapped «أعتذر» → dashboard `DECLINED`, no QR.
- `test/whatsapp.e2e-spec.ts`, 22/22, 8 new: failure code kept on the receipt for platform and manual messages; a due campaign sends once to each live initial guest (not the reserve or a removed guest), allocates them and ends `SENT`, a second sweep sends nothing; a guest already invited by the tracer is not invited again; not started before `send_at`, after an approval reset, or while the template is not approved (stays `SCHEDULED`); an overdue campaign whose event started is `CANCELLED` with nothing sent (AC-06-5); intents still queued when the event starts are `CANCELLED` `event_started` and the campaign closes; a queued QR image goes out before queued invitations.
- Full backend: e2e 122/122, unit 47/47, typecheck, lint, Prettier and `nest build` pass.

Not verified: a real scheduled campaign on production; Meta's tier limits at volume.

## 2026-11-12 — Campaign pause/resume and daily limit (T-P3-07)

- **Scope:** `POST /admin/events/:id/pause` and `/resume`, paused campaigns skipped by the sender, `WHATSAPP_DAILY_INVITATION_LIMIT`, SCR-23 buttons.
- **Backend:** typecheck, `pnpm test` 58/58, `pnpm test:e2e` 144/144, `pnpm build` pass. New e2e: pause/resume transitions, 409 codes, 403 for an owner, audit rows, version unchanged (`invitations`); paused invitations stay queued while a QR image still goes out, resume sends the rest then `SENT`; a pause after the claim returns the intent to `QUEUED` with no attempt used; the daily limit sends exactly the remaining room and leaves the rest queued (`whatsapp`). ESLint: no new findings (2 pre-existing errors in `articles.e2e-spec.ts`).
- **Frontend:** typecheck, lint, format pass. Not checked in the browser (no sending campaign in the local database).
- **Not verified:** against the real Meta number; the right limit value for the client's tier.

## 2026-11-12 — QR check-in and guest page (T-P4-03, T-P4-04)

- **Backend:** typecheck, build, `pnpm test:e2e` 153/153 (new `test/checkin.e2e-spec.ts`, 9 tests): token from URL or bare; SCR-30 list (open, within 24 h; excludes far, unpaid, cancelled, other owner); admit once then `ALREADY_ADMITTED` with the original time and `checked_in_by_user_id`; 20 concurrent scans → 1 `ADMITTED` + 19 `ALREADY_ADMITTED` (TC-QR-03); `INVALID` for garbage, unknown and revoked (TC-QR-04), `NOT_ACCEPTED`, `WRONG_EVENT` without details; `WINDOW_CLOSED` before the window and for a cancelled event, nothing admitted; admin 403, other owner 404, no session 401 (TC-QR-05); guest page `no-store`, SVG QR, never checks in, admitted after scan; 404 for unknown/declined, `CLOSED` hides the QR. ESLint: no new findings.
- **Frontend:** typecheck, lint, format, production build. Browser: Playwright Chromium, iPhone 13 profile, local API and dev server, fake camera fed a Y4M video of a real guest QR: 17/17 checks (sign-in redirect to `/scan`, event list, camera admission, DB actor, already admitted with time, counter «دخل 1 من 2», declined/URL/garbage by manual entry, guest page valid/admitted/unknown, `no-referrer` + `noindex`, no horizontal overflow at 390 px, sign-out of the device, no page errors). Two fixes found this way: the video must never be hidden (the library resets the style and Safari stops hidden video), and the scanner bar uses a short «خروج» label so it fits on one line.
- **Not verified:** real iPhone Safari and Android Chrome cameras (need HTTPS; after deploy); torch (no flash on the fake camera); vibration.

## 2026-11-12 — Message log and resolution (T-P4-06)

- **Backend:** typecheck, build, `pnpm test:e2e` 161/161 (new `test/messages.e2e-spec.ts`, 8 tests): list with guest details and filters, 404 for an unknown event; `MARK_SENT` on `UNKNOWN` with audit, second resolution 409; `MARK_FAILED` only for `UNKNOWN`, reason required (400); invitation `RESEND` → key `:r1`, sent once by the sweeper, original kept; a failed resend resent as `:r2`; refused after a reply (`guest_replied`), after the event started, and when a sent invitation exists (`already_sent`); QR `RESEND` → version 2, image sent, guest `qr_version` 2; 422 `window_closed` after 30 h; 401 without a session. ESLint: no new findings.
- **Frontend:** typecheck, lint, format. Browser (Chromium, local API, seeded admin and event, deleted afterwards): needs-action view lists `UNKNOWN` and `FAILED`; `UNKNOWN` offers three actions, `FAILED` only resend; resend with a reason leaves the view and writes `RESEND` + a `:r1` intent; all-messages view shows 4 rows and «أُعيد إرسالها»; no horizontal overflow at 1440 and 390 px; no page errors. 11/11.
- **Not verified:** against Meta (local `.env` has no WhatsApp credentials, so nothing is sent locally).

## 2026-11-12 — Replacements (T-P4-01, T-P4-02)

- **Backend:** typecheck, build, `pnpm test:e2e` 169/169 (new `test/replacements.e2e-spec.ts`, 8 tests): view (extras, oldest decline first, reserves in order); count send pairs the oldest decline with the first reserve, locks the decline, queues and sends the invitation, audits the pairs; a replacement's own decline unlocks another but never beyond the margin; chosen reserves, refusal of a non-reserve or an already sent one; no declines / no reserves / bad body; refused before the campaign started and after the event started; 3 concurrent sends with margin 1 → exactly one replacement (200, 422, 422); 401 without a session. Migration `AddGuestReplacements` run, reverted and run again on the dev database. ESLint: no new findings.
- **Frontend:** typecheck, lint, format, production build. Browser (Chromium, local API, seeded admin and event, deleted afterwards): count send and hand-picked send write the right pairs, lock the decline and create the intent; notices and disabled buttons once no declines remain; no horizontal overflow at 1440 and 390 px (found and fixed: the five-tab workspace bar overflowed on phones); no page errors. 11/11.

## 2026-11-12 — Admin payments, refunds and activity log (T-P2-09)

- **Backend:** typecheck, build, unit 58/58, `pnpm test:e2e` 174/174 (new `test/admin-payments.e2e-spec.ts`, 5 tests): list with event and owner (no password hash), status filter and search, 403 for owners; reconcile a pending attempt (503 on Moyasar outage with nothing changed, then PAID and the event activated, 409 once final, audited); a duplicate payment is flagged `refundNeeded`, counted in the dashboard alert, cleared by `refund-done` (400 on a short reason, 409 twice), the paid event untouched; `mark-refunded` cancels the event and campaign, cancels only queued messages, revokes every QR code, marks the paid attempt refunded, audits the counts, 409 on a second call and on an unpaid event; action log newest first with the actor, by event (including payment actions), by action, names list, 400 on a malformed action, 403 for owners. ESLint: no new findings.
- **Frontend:** typecheck, lint, format, production build. Browser (Chromium, local API with no WhatsApp token and no Moyasar call, seeded admin, event and attempts, deleted afterwards): dashboard alert links to the filtered payments; refund-done needs a reason and clears the row; «تسجيل استرجاع» on the event cancels it, revokes the QR code and cancels the queued message, then shows the refunded notice; the event's activity log lists both actions; no horizontal overflow at 390 px on payments, activity and the event page; no page errors. 15/15.

