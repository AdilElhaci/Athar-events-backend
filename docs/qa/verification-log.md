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
