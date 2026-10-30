# Reference alignment: the existing Athar project

**Status: assessment recorded 2026-10-24** from a read-only inspection of `/Users/adilelhaci/my personal project/athar/athar-backend` (HEAD `2d72518`) and `/Users/adilelhaci/my personal project/athar/athar-frontend` (HEAD `fdadcb4`), cross-checked independently by Codex (round 3). Statements describe the repository source and configuration, **not** a verified production deployment. Owner decision: adopt Athar's conventions unless there is a recorded reason not to ([D-05](../product/decisions.md)); never copy code without approval ([D-24](../product/decisions.md)).

## Athar backend (verified from source)

| Area | What the code shows | Where |
| --- | --- | --- |
| Runtime | NestJS 11, TypeScript 6 (`strict: false`, `strictNullChecks: true`), pnpm 11.6, Docker image `node:lts-alpine` (floating) | `package.json`, `tsconfig.json`, `Dockerfile` |
| Structure | `src/modules/<feature>/{controllers,dto,entities,enums,services,processors,guards,utils,types}`; `src/shared/{decorators,dto,exceptions,filters,helpers,interceptors,pagination,swagger}`; typed config per feature in `src/config` | `src/` |
| Data | TypeORM 1.0 + PostgreSQL 18; uuid PKs; `timestamptz`; 50 migrations; seeds `platform-owner`, `billing-plans`; `DATABASE_SYNCHRONIZE=false` | `src/database` |
| API | Global prefix `/api`, URI versioning enabled, global `ValidationPipe({whitelist, forbidNonWhitelisted, transform})`, Swagger at `/api/docs` | `src/main.ts` |
| Responses | `ResponseInterceptor` → `{success, message, data}`; `AllExceptionsFilter` → `{success:false, message, error, statusCode, code?}` with i18n keys via `I18nException`; `ResponseHelper` | `src/shared` |
| Pagination | `BasePaginationDto` (page, limit ≤ 100), `BaseSearchWithPaginateDto`, `paginateQuery` → `{items, meta}` | `src/shared/dto`, `src/shared/pagination` |
| Auth | Password (bcrypt) + email-verification OTP (6 digits, hashed with email, 10 min, superseded codes invalidated, pessimistic lock); JWT access 15 min via Bearer (`passport-jwt`); rotating hashed refresh tokens 7 days (`refresh_tokens`, `replacedByTokenId`, IP/UA) | `src/modules/auth` |
| Authorization | `UserType = PLATFORM_ADMIN \| CLIENT`, `@RequireUserType` + `UserTypeGuard`; workspace roles via `x-workspace-id`; admin endpoints in separate `admin*.controller.ts` under `/admin` | `src/modules/auth`, `src/modules/users` |
| Payments | Moyasar hosted invoices; webhook with `rawBody` and timing-safe `secret_token` compare; invoice callback that **re-fetches** the invoice from Moyasar; `billing_payment_attempts` with a partial unique index on `moyasarPaymentId`; scheduler service | `src/modules/billing` |
| Sending engine | Email campaigns: recipient rows are durable intents; chunk claim with `FOR UPDATE SKIP LOCKED`; outcomes `sent \| failed \| retry \| unknown` (ambiguous ⇒ `unknown`, never resent); `recoverStale` marks interrupted `sending` rows `unknown`; campaign-level CAS transitions; Bull v4 launch/chunk jobs as triggers | `src/modules/email-campaigns/services/email-campaign-sender.service.ts` |
| Excel | `exceljs` parser, first sheet, header detection, row limit, formula neutralisation (`neutralizeFormula`), per-row errors | `src/modules/email-campaigns/utils/excel-email-parser.ts` |
| Phone | `normalizeSaudiMobile` → `+9665XXXXXXXX`, Arabic-Indic and Persian digits; `@IsSaudiMobile()` | `src/shared/helpers/saudi-phone.helper.ts` |
| Jobs and infra | Redis (cache via keyv, Bull v4 via `@nestjs/bull`), `@nestjs/schedule`, socket.io gateways for AI job progress | `src/app.module.ts` |
| Throttling | `ThrottlerModule.forRoot({throttlers:[{ttl: 60, limit: 100}]})` globally; per-route `@Throttle({default:{limit:5, ttl:60_000}})` | `src/app.module.ts`, `auth.controller.ts` |
| Tests | 100 colocated `*.spec.ts` (Jest + ts-jest); e2e in `test/` | — |
| Deploy | Multi-stage Dockerfile (non-root, dumb-init, healthcheck); container start runs migrations + platform-owner seed; Compose with Postgres 18 + Redis 8; nginx blue/green on a VPS; `DEPLOYMENT.md` runbook (topology, routine deploy, rollback, backup, incident notes) | repo root, `deploy/nginx` |
| Docs | `docs/*-frontend.md` API handoff notes (Arabic), changelogs, `docs/features/<feature>/` bundles; `docs/features/whatsapp-campaigns/` is **planning only** (requirements, decisions WA-D1…45, discovery with Meta facts cited from official docs, P0 sandbox checklist not executed) | `docs/` |

## Athar frontend (verified from source)

| Area | What the code shows | Where |
| --- | --- | --- |
| Runtime | Next.js 16.2.9 App Router, React 19.2.4, TypeScript strict, npm | `package.json` |
| Routes | Route groups `(Landing Page)` (home, about, blog, contact, pricing, privacy, services, terms, unsubscribe), `(Auth)/auth/*` (plus a duplicate `(Auth)/reset-password`), `(BrandSetup)/setup`, `(Dashboard)/dashboard/*` — one shell for admins and clients | `app/` |
| Route gating | `proxy.ts` (Next 16 middleware) reads cookies to redirect between auth, setup and dashboard | `proxy.ts` |
| State and API | Redux Toolkit + RTK Query `baseApi` (Bearer header, workspace/brand headers, 401 → refresh → retry, global success/error toasts with sonner, `roleScoped` URL rewrite to `/admin/...`) | `redux/app/baseApi.ts` |
| Session storage | Access token, refresh token and user JSON in cookies via `cookies-next` (readable by JavaScript, 7 days) | `redux/features/auth/authSlice.ts` |
| Roles in UI | `useRole()` (hydration-safe), sidebar items filtered by `roles` | `hooks/useRole.ts`, `components/layout/Sidebar/useSidebarItems.ts` |
| Components | shadcn (`radix-nova`, `rtl: false` in `components.json`) under `components/ui`; project wrappers: `DataTable` (TanStack Table, `search`/`filters` props, skeleton), form elements (`TextFormEle`, `ComboboxFormEle`, …), `ReusableDialog`, `MainTitles`, `SummaryCard`, `StepProgress`, `WizardLayout`, `Money`, `CustomPagination` | `components/` |
| Forms and requests | react-hook-form + zod (`schemas/`), `handleReqWithToaster`, `Button isLoading` | `lib/`, `components/ui/button.tsx` |
| Hooks | `useUrlPagination`, `useUrlTab`, `useDebouncedSearchCommit`, `useMediaQuery` | `hooks/` |
| Design | `DESIGN.md` (foundations, layout, component rules, RTL rules, anti-patterns, new-page checklist); Tailwind 4 `@theme` semantic tokens in `globals.css`; IBM Plex Sans Arabic; type scale `text-10`…`text-32`; brand mint `#3eaf8e`, dark teal `#063334` | `DESIGN.md`, `app/globals.css` |
| Agent rules | `AGENTS.md` (component rules, canonical dashboard list page); its project-context section says the backend is Supabase, which is **stale** | `AGENTS.md` |
| Landing stack | three.js / react-three-fiber, shaders, lenis, framer-motion, swiper | `package.json` |

## Comparison and adoption register

`Adopt` = same pattern; `Improve` = same pattern with a recorded correction; `Reject` = not used in Athar Events.

| Pattern | Athar reference | Athar Events | Verdict | Reason |
| --- | --- | --- | --- | --- |
| Feature-module layout, `shared/`, typed config | `src/modules`, `src/shared`, `src/config` | Same | Adopt | Familiar, proven |
| Response envelope, `I18nException`, `code` | `shared/interceptors`, `shared/filters` | Same; Arabic resources only; `code` always present on handled errors | Improve | Clients branch on `code` |
| Validation | Global `ValidationPipe`, `class-validator` DTOs | Same | Adopt | — |
| Pagination | `BasePaginationDto`, `paginateQuery` | Same | Adopt | Matches frontend `DataTable` |
| TypeORM conventions | uuid, `timestamptz`, migrations, named enums | Same; `strict: true` | Improve | W9 |
| Seeds | Seed runs on every container start | Idempotent seed run as a release step; no invented prices | Improve | W8 |
| Auth tokens | JWT + rotating refresh, JS-readable cookies | JWT in memory + HttpOnly refresh cookie, atomic rotation | Improve | W2, W3 |
| Sign-in | Password + OTP | OTP only | Improve | Quotation 02 |
| OTP | Hashed, 10 min, no attempt limit | Hashed with a separate secret, 5 min, 5 attempts, cooldown, email/IP limits | Improve | W4 |
| Roles | `PLATFORM_ADMIN \| CLIENT` + workspaces | `PLATFORM_ADMIN \| OWNER`, no workspaces; role read from DB | Improve | W11, simpler tenancy |
| Admin controllers | `admin*.controller.ts` under `/admin` | Same | Adopt | — |
| Throttling | Global `ttl: 60` (ms) | `60_000`, Redis store, trusted proxy hops | Improve | W1 |
| CORS / secrets | `origin: true` with credentials; fallback JWT secret | Explicit allowlist; refuse to start without secrets | Improve | W5 |
| Logging | Body logging with a route deny-list; IP from `x-forwarded-for` | Allowlisted metadata only; IP from trusted proxy chain | Improve | W6 |
| Exception mapping | Every TypeORM error → 400; webhook bad secret → 500 | Unique violation → 409, others → 500; bad secret → 401 | Improve | W7 |
| Moyasar | Hosted invoice, timing-safe secret, callback re-fetch, unique payment id | Same, plus re-fetch on the webhook path and a reconciliation job | Improve | Payment integrity |
| Sending engine | Durable rows, `SKIP LOCKED`, `unknown`, `recoverStale`, Bull v4 triggers | Same invariants for WhatsApp; BullMQ; database sweeper; per-row CAS | Improve | D-09; Bull v4 maintenance-only |
| Excel parser | `exceljs`, formula neutralisation | Same technique for `name`/`phone`/`type` template | Adopt (re-implemented) | D-24 |
| Saudi phone helper | `normalizeSaudiMobile` | Same rule, also strips Unicode direction marks | Improve | Copy-paste from WhatsApp adds RLM/LRM |
| WhatsApp | Planning only (marketing) | Independent module; reuse verified facts after re-checking | Improve | D-11 |
| Real-time | socket.io gateways | Polling | Reject | D-14 |
| Frontend route groups | `(Landing Page)`, `(Auth)`, `(Dashboard)` | Same + `(Scanner)`, `(Guest)`; one reset route tree | Adopt | D-17 |
| Dashboard shell | One shell, role-filtered sidebar | Same; owner and admin pages composed separately | Adopt | D-17 |
| `roleScoped` URL rewrite | Rewrites object args to `/admin/...` | Explicit admin endpoints | Reject | W10 |
| RTK Query + toasts | `baseApi`, global toasts, `handleReqWithToaster` | Same; single-flight refresh; no error toast for background polls | Improve | Polling UX |
| UI wrappers | `DataTable`, form elements, `ReusableDialog`, `Button isLoading` | Same rules | Adopt | — |
| Design tokens | `DESIGN.md`, `@theme`, IBM Plex Sans Arabic, type scale | Same structure; brand layer per OQ-13; shadcn `rtl: true` | Improve | D-18 |
| Landing stack | three.js, shaders, lenis | Lightweight template | Reject | Quotation 01, mobile performance |
| Package manager | pnpm (backend), npm (frontend) | pnpm in both | Improve | W9 |
| Deploy | VPS, Compose, nginx blue/green, runbook; app runs as DB superuser; migrate on start | Dedicated VPS stack; app DB role; migrations as release step; pinned Node | Improve | W8, D-19 |
| Agent docs | `AGENTS.md` (stale context), `DESIGN.md` | `AGENTS.md` + `DESIGN.md` checked against the code at each phase end | Improve | W10, D-22 |

## Weaknesses not carried forward

| ID | Weakness in Athar (verified) | Correction in Athar Events | Test |
| --- | --- | --- | --- |
| W1 | Global throttler `ttl: 60` with `@nestjs/throttler` 6.x is 60 ms, so the global limit allows 100 requests per 60 ms | `ttl: 60_000` (or `seconds(60)`), Redis storage, trusted proxy configuration | TC-SEC-01 |
| W2 | Access and refresh tokens stored in JavaScript-readable cookies for 7 days | Access token in memory; refresh token HttpOnly, Secure, SameSite=Lax, path `/api/auth` | TC-AUTH-06 |
| W3 | `refresh()` reads and validates the token before the transaction, without a lock or conditional consume, so concurrent refreshes can both succeed | `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now() RETURNING …`; frontend single-flight refresh | TC-AUTH-07 |
| W4 | No per-code OTP attempt counter | `attempts` column incremented in its own committed statement; locked after 5 | TC-AUTH-03 |
| W5 | `enableCors({origin: true, credentials: true})`; JWT secret falls back to a default | `CORS_ORIGINS` allowlist; config validation fails startup on missing secrets in production | TC-SEC-02 |
| W6 | Logging interceptor logs request bodies except on a route deny-list, and takes the IP from `x-forwarded-for` | Log method, route template, status, duration, correlation id, user id only | TC-SEC-03 |
| W7 | Invalid Moyasar secret throws a plain `Error` (500 ⇒ provider retries); every `QueryFailedError` becomes 400 | 401 for failed webhook authentication; 409 for unique violations; 500 otherwise | TC-PAY-05 |
| W8 | Runtime uses the bootstrap Postgres user; migrations and seed run at every container start, including during blue/green overlap | Separate migration (owner) and runtime (DML) roles; migrations run once per release before switching | TC-OPS-02 |
| W9 | Backend `strict: false`; floating `node:lts-alpine`; mixed npm/pnpm | `strict: true`; pinned Node LTS image digest; pnpm in both | CI |
| W10 | Stale `AGENTS.md` (Supabase); duplicate reset-password route; `roleScoped` rewrite assumes object args and shares cache between roles; URI versioning enabled without versioned routes | Agent docs reviewed at each phase end; one route per page; explicit admin endpoints; no URI versions (D-25) | Phase DoD |
| W11 | `JwtStrategy` reloads the user but returns the role from the token payload | `req.user.type` taken from the database row loaded in `validate()` | TC-AUTH-08 |

## Not reused

Athar business domains (brands, workspaces, AI studios, marketing seasons, calendar, library, subscriptions, coupons, email campaigns) are unrelated to Athar Events and are not carried over, even structurally.
