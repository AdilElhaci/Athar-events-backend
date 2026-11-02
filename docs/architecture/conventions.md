# Coding standards and project conventions

**Status: approved baseline (2026-10-24).** These conventions follow the existing Athar project ([reference alignment](reference-alignment.md)) with the corrections W1–W11. When this page and Athar differ, this page wins for Athar Events. Frontend UI rules are expanded in the frontend `DESIGN.md` and `AGENTS.md`.

## Shared

- **Languages:** TypeScript everywhere, `strict: true` in both repositories.
- **Package manager:** pnpm (versions pinned via `packageManager` in `package.json`); Node pinned in `.nvmrc`, `engines` and the Docker image.
- **Formatting:** Prettier (`singleQuote: true`, `trailingComma: "all"`) in the backend as in Athar; the frontend uses Prettier defaults with the Tailwind plugin. ESLint with type-checked rules in the backend; `next lint`/ESLint flat config in the frontend.
- **Commits:** small, imperative subject (`add guest import preview endpoint`), one concern per commit, referencing the task ID in the body (`T-P3-02`). No commits that mix refactoring with behaviour changes.
- **Branches:** `main` is deployable; work on `feat/<task-id>-<slug>` or `fix/<slug>`.
- **No secrets in code or docs.** `.env.example` lists every variable with a safe placeholder.
- **IDs and time:** uuid v4 primary keys; all timestamps `timestamptz` in UTC; event-local display uses `Asia/Riyadh`.
- **Money:** integer halalas (`amount: 30000` = 300.00 SAR); currency field alongside.
- **Phones:** stored as `+9665XXXXXXXX` (normalised on input, Arabic-Indic digits and direction marks stripped).

## Backend layout

```text
src/
├── main.ts                       bootstrap (prefix /api, ValidationPipe, interceptors, CORS allowlist, Swagger)
├── app.module.ts
├── config/                       <feature>.config.ts + <feature>-config.type.ts, validated at startup
├── database/                     data-source.ts, migrations/, seeds/
├── i18n/ar/                      common.json, errors.json, <domain>.json
├── shared/
│   ├── decorators/  dto/  enums/  exceptions/  filters/  helpers/  interceptors/  pagination/  swagger/
└── modules/<feature>/
    ├── <feature>.module.ts
    ├── controllers/              <feature>.controller.ts, admin-<feature>.controller.ts
    ├── dto/                      create-<thing>.dto.ts, <thing>-query.dto.ts, <thing>-response.dto.ts
    ├── entities/                 <thing>.entity.ts
    ├── enums/
    ├── services/                 <feature>.service.ts (+ focused services: <thing>-<role>.service.ts)
    ├── processors/               <queue>.processor.ts (BullMQ)
    ├── guards/  utils/  types/
    └── *.spec.ts beside the file under test
```

Naming:

| Item | Convention | Example |
| --- | --- | --- |
| Files | kebab-case with a type suffix | `guest-import.service.ts`, `create-event.dto.ts` |
| Classes | PascalCase with suffix | `GuestImportService`, `CreateEventDto`, `AdminEventsController` |
| Entities | Singular class, plural snake_case table | `Guest` → `guests` |
| Columns | camelCase properties mapped to snake_case columns via the naming strategy | `checkedInAt` → `checked_in_at` |
| Enums | PascalCase type, UPPER_SNAKE values, named Postgres enum | `CampaignStatus.SCHEDULED`, `events_campaign_status_enum` |
| Indexes | `IDX_<table>_<cols>`, unique `UQ_<table>_<cols>` | `UQ_guests_event_id_phone` |
| i18n keys | `domain.snake_case` | `events.not_found`, `auth.otp_invalid` |
| Queues and jobs | kebab-case constants in `constants/` | `WHATSAPP_QUEUE = 'whatsapp'`, job `send-chunk` |

## API conventions

- Base path `/api`, no URI version ([D-25](../product/decisions.md)). Admin endpoints under `/api/admin/*` in `admin-*.controller.ts`; scan endpoints under `/api/scan/*`; unauthenticated guest data under `/api/public/*`; provider webhooks under `/api/payments/moyasar/*` and `/api/whatsapp/webhook`.
- Success: `{ "success": true, "message": "<translated>", "data": <payload> }`. Lists: `data = { items: T[], meta: { total, page, limit, totalPages, hasNext, hasPrev } }`.
- Error: `{ "success": false, "message": "<translated>", "error": "<translated or list>", "statusCode": 409, "code": "guests.phone_duplicate" }`. `code` is always present for handled errors; clients branch on `code`, never on text.
- Status codes: 400 validation, 401 unauthenticated or failed webhook authentication, 403 wrong role, 404 not found **or not owned** (owners never learn that another owner's resource exists), 409 conflict/state violation, 422 business rule violation with a specific `code`, 429 rate limit, 500 unexpected.
- DTOs validate everything (`whitelist`, `forbidNonWhitelisted`, `transform`); query DTOs extend `BasePaginationDto` / `BaseSearchWithPaginateDto` (limit ≤ 100).
- Every controller method has Swagger decorators (`@ApiOperation`, `@ApiSuccessResponse`, error responses).
- State transitions are explicit endpoints (`POST /admin/events/:id/schedule`), not generic `PATCH status`.
- Idempotency: webhook handlers are idempotent by provider id; `POST` actions that can be double-clicked (checkout, schedule, replacements, check-in) are safe to repeat.

## Errors and i18n

- Throw `I18nBadRequestException('domain.key', args)` style exceptions from services; never return raw English strings.
- `AllExceptionsFilter`: `QueryFailedError` with Postgres `23505` → 409 with a mapped `code`; other database errors → 500 and logged; never echo SQL or driver text.
- Arabic is the only resource locale; keys stay language-independent.

## Data access and invariants

- Repositories via `@InjectRepository`; multi-row invariants in `dataSource.transaction`.
- Invariants are enforced **in the database** where possible: unique indexes, check constraints, partial unique indexes, conditional `UPDATE … WHERE <expected state> RETURNING`. Never "read, check, then write" for quotas, check-in, refresh rotation or claims.
- Workers claim with `FOR UPDATE SKIP LOCKED` and record an owner/claim time; recovery uses a bounded stale threshold.
- Migrations: generated or hand-written in `src/database/migrations`, reviewed, reversible where possible, run once per release ([operations](operations.md#deployment)). `synchronize` is always false.
- Seeds are idempotent and never overwrite business data on restart.

## Background work

- PostgreSQL holds intent and outcome; BullMQ jobs carry ids only; a duplicate job is harmless.
- A scheduler sweeper (`@nestjs/schedule`) re-discovers due work every minute, so a lost Redis job only delays work.
- External send outcomes: `SENT` (provider id received), `FAILED` (provider said no, definite), `UNKNOWN` (timeout/connection reset after the request may have reached the provider) — `UNKNOWN` is never retried automatically.
- Each processor logs start/end with correlation ids, never message bodies or phone numbers.

## Security conventions

- Guards: `JwtAuthGuard` → `UserTypeGuard` (`@RequireUserType(UserType.PLATFORM_ADMIN)`) → ownership check in the service (`event.ownerId === user.id`), returning 404 when not owned.
- `req.user` comes from the database row (W11).
- Raw-body webhooks; signature/secret verification with `timingSafeEqual`; 401 on failure.
- Logs: allowlisted metadata only (W6). Never log OTP codes, tokens, QR tokens, guest names or phones, or provider payloads.
- Uploads (Excel) are parsed in memory and never written to a publicly served folder.

## Testing conventions

- Unit specs beside the code (`*.spec.ts`), Jest + ts-jest, as in Athar.
- Integration tests that need PostgreSQL (concurrency, constraints, transactions) run against a disposable database in `test/integration/` (Docker Compose service), not mocks.
- e2e API tests in `test/*.e2e-spec.ts` with supertest.
- Provider clients (Moyasar, Meta, SMTP) are behind interfaces with fakes for tests; contract fixtures stored under `test/fixtures/<provider>/`.
- Verification commands (no auto-fix): `pnpm lint:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`.

## Frontend layout

```text
app/
├── layout.tsx                    <html lang="ar" dir="rtl">, IBM Plex Sans Arabic, ReduxProvider, Toaster
├── (Landing Page)/               page.tsx, contact/, privacy/, terms/
├── (Auth)/auth/                  login/, verify/
├── (Dashboard)/dashboard/        layout.tsx (Sidebar + DashboardHeader), page.tsx, events/ ([id]/payment = SCR-12, verifies status from the API), packages/, users/, payments/, messages/
├── (Scanner)/scan/               page.tsx (event picker), [eventId]/page.tsx (full-screen scanner)
└── (Guest)/i/[token]/            page.tsx (QR recovery)
components/
├── ui/                           shadcn primitives + project form elements (components/ui/form/*)
├── shared/                       DataTable, MainTitles, ReusableDialog, SummaryCard, StatusBadge, LastUpdated, …
├── layout/                       Sidebar, DashboardHeader, Navbar
└── pages/<area>/<feature>/       page-specific components (PascalCase folder + index.tsx)
constants/  hooks/  lib/  providers/  redux/{app,features/<resource>/<resource>Api.ts}  schemas/<domain>/  types/<resource>.ts
proxy.ts                          navigation hints only (marker cookie); never authorization
```

Frontend rules (detailed in the frontend `AGENTS.md` and `DESIGN.md`):

- Dashboard list pages follow Athar's canonical pattern: `page.tsx` + `columns.tsx` (`useColumns()`), `types/<resource>.ts`, `redux/features/<resource>/<resource>Api.ts` via `baseApi.injectEndpoints`, domain cells under `components/pages/dashboard/<resource>/`.
- Use the project wrappers: `DataTable` (with `search`/`filters` props), form elements with `react-hook-form` + `zod`, `ReusableDialog`, `Button isLoading`, `handleReqWithToaster`.
- Owner and admin data use **separate RTK Query endpoints** (`/events/...` vs `/admin/events/...`); no URL rewriting by role; RTK Query state is reset on sign-out.
- Polling queries pass `skipErrorToast` and show a persistent stale-data state instead.
- The access token lives only in Redux memory; on load, the app calls `/auth/refresh` once (single-flight) before firing protected queries.
- Components: PascalCase folder with `index.tsx`; hooks `useX.ts`; zod schemas in `schemas/<domain>/<thing>-schema.ts`; types prefixed `I` for entities (`IEvent`) as in Athar.
- Styling: Tailwind tokens and the type scale only; logical properties (`ps-*`, `pe-*`, `ms-*`, `start-*`); no arbitrary colours.
