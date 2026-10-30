# Test strategy

**Status: approved baseline (2026-10-24).** Effort goes to the failure boundaries that would hurt the client on event day: payment integrity, quota and replacement races, duplicate or missed sends, duplicate admission, authorization, and Arabic/mobile usability. Commands are in [conventions](../architecture/conventions.md#testing-conventions).

## Levels

| Level | Tooling | Scope | Runs |
| --- | --- | --- | --- |
| Unit | Jest + ts-jest (backend), Vitest + Testing Library (frontend) | Services, parsers, phone normalisation, state transitions, next-step logic, reducers | Every commit (CI) |
| Integration (DB) | Jest against a disposable PostgreSQL + Redis (Compose) | Constraints, transactions, `SKIP LOCKED`, conditional updates, concurrency | Every commit touching modules with invariants; nightly |
| API / e2e | supertest (`test/*.e2e-spec.ts`) | Endpoint contracts, envelope, guards, ownership, webhooks with fixtures | CI |
| UI end-to-end | Playwright (Chromium, WebKit, mobile viewports) with axe | Main journeys per role, RTL rendering, a11y scans | Pre-merge on `main`, phase ends |
| Provider contract | Recorded sandbox fixtures (Moyasar, Meta) replayed in tests; live sandbox runs | Payload shapes, signatures | Phase ends; after provider changes |
| Manual device | Real iPhone and Android | Scanner camera, WhatsApp messages, OTP email | P1 tracer, P4 rehearsal, P5 |
| Load (light) | k6 or autocannon | 1,000-guest campaign intent creation, 20 concurrent scans/s, summary polling from 50 clients | P4/P5 |

Coverage is not a target number; every test case below must exist before its task is `done`.

## Test catalogue

### Authentication and security

| ID | Case |
| --- | --- |
| TC-AUTH-01 | OTP request returns the same response for known, unknown and suspended emails |
| TC-AUTH-02 | Correct code within 5 min signs in; new email creates `OWNER` with `requiresProfile` |
| TC-AUTH-03 | 5 wrong attempts lock the code, counter persists across failures, 6th attempt with the right code fails |
| TC-AUTH-04 | Resend cooldown 60 s; per-email and per-IP hourly limits return 429 |
| TC-AUTH-05 | Suspended user: refresh fails immediately; access token rejected on next request |
| TC-AUTH-06 | Refresh cookie is HttpOnly, Secure, SameSite=Lax, Path `/api/auth`; no token readable by `document.cookie` |
| TC-AUTH-07 | Two concurrent refreshes with the same cookie produce exactly one success; reuse of the revoked token revokes the chain |
| TC-AUTH-08 | Changing a user's type in the DB changes authorization on the next request (role read from DB) |
| TC-AUTH-09 | `/auth/refresh` without allowlisted `Origin` or `X-Requested-With` header is rejected |
| TC-SEC-01 | Global throttle: 101st request within 60 s returns 429 (proves `ttl` in ms is set correctly) |
| TC-SEC-02 | CORS rejects an unlisted origin; app refuses to start in production without required secrets |
| TC-SEC-03 | Logs for OTP verify, guest import and webhook requests contain no code, token, phone, name or body |

### Packages, events, payments

| ID | Case |
| --- | --- |
| TC-PKG-01 | Admin CRUD; owner gets 403 on admin package endpoints |
| TC-PKG-02 | Inactive package hidden from `/packages` and rejected on event creation |
| TC-PKG-03 | Editing a package after checkout does not change the event snapshot |
| TC-PKG-04 | Validation: allowance > 0, margin ≥ 0, price > 0 |
| TC-EVT-01 | Create event with valid fields; past start date rejected; send time after start rejected |
| TC-EVT-02 | Edit allowed before approval; 409 `events.locked` after scheduling |
| TC-EVT-03 | Package change blocked once a payment attempt exists |
| TC-EVT-04 | Next-step logic returns the right step for every state combination (table-driven) |
| TC-EVT-05 | Owner A cannot read/update owner B's event, guests, summary, invitation, scan endpoints (404) |
| TC-EVT-06 | Summary counts match the definitions in SP-04 on a seeded event |
| TC-EVT-07 | Times stored UTC and displayed in Asia/Riyadh across a DST-free zone boundary (midnight) |
| TC-PAY-01 | Checkout creates one attempt and returns the existing open attempt on repeat |
| TC-PAY-02 | Browser return without webhook does not activate; `payment-status` fetch activates when Moyasar says paid |
| TC-PAY-03 | Amount or currency mismatch in the fetched invoice does not activate and raises an alert |
| TC-PAY-04 | Webhook delivered twice → second is a no-op |
| TC-PAY-05 | Wrong webhook secret → 401; nothing changes |
| TC-PAY-06 | Invoice callback with a forged body → re-fetch decides; forged "paid" is ignored |
| TC-PAY-07 | Reconciliation activates a paid attempt whose webhook was lost |
| TC-PAY-08 | Second successful payment for the same event is not applied and is flagged |

### Guests and import

| ID | Case |
| --- | --- |
| TC-IMP-01 | 300 valid + 5 invalid + 3 duplicate rows → exact preview counts; apply adds 300 |
| TC-IMP-02 | Phone formats (05…, 5…, 9665…, +9665…, Arabic-Indic digits, spaces, RLM/LRM marks) normalise; non-Saudi rejected |
| TC-IMP-03 | Arabic and English headers both recognised; missing name/phone column rejected |
| TC-IMP-04 | Apply twice → no duplicates |
| TC-IMP-05 | Formula cells neutralised in preview output |
| TC-IMP-06 | Over-allowance rows marked `OVER_LIMIT` in file order |
| TC-IMP-07 | Two concurrent applies cannot exceed the allowance |
| TC-IMP-08 | File > 2 MB or > 2,000 rows rejected; non-xlsx rejected |

### WhatsApp, RSVP, replacements

| ID | Case |
| --- | --- |
| TC-WA-T1 | Tracer: template sent to a real phone, `wamid` stored |
| TC-WA-T2 | Tracer: button reply received, signature verified, correlated by context id and sender |
| TC-WA-T3 | Tracer: QR image received and scanned successfully |
| TC-WA-01 | Scheduling blocked unless paid, list ready, approved, template approved, send before start |
| TC-WA-02 | Due sweeper run twice concurrently creates each intent once (logical key) |
| TC-WA-03 | Reschedule/pause increments version; old jobs no-op |
| TC-WA-04 | Meta webhook with a bad signature → 401; duplicate receipt ignored |
| TC-WA-05 | Status ordering: `read` then late `delivered` keeps `READ` |
| TC-WA-06 | Worker killed mid-chunk → rows become `UNKNOWN` after 2 min and are not resent; no duplicates sent |
| TC-WA-07 | Timeout after request → `UNKNOWN`; definite 4xx → `FAILED`; rate-limit before send → retried |
| TC-WA-08 | Event start passes with queued intents → cancelled, nothing sent |
| TC-WA-09 | Reply from a different phone than the guest's, or unmatched context → no RSVP change, recorded `UNMATCHED` |
| TC-WA-10 | Accept inside the window sends `QR`; accept with window closed sends `QR_TEMPLATE` |
| TC-REP-01 | One decline → one replacement; reserve guest linked to the decline |
| TC-REP-02 | Concurrent replacement requests never exceed margin or reuse a decline |
| TC-REP-03 | Replacement guest's decline unlocks another (D-16) |
| TC-REP-04 | Funded decline is locked: a later Accept from that guest does not change RSVP |
| TC-REP-05 | Margin exhausted / no reserves / no declines return specific 422 codes |
| TC-REP-06 | Extras used/available/cap match the definitions |

### QR and check-in

| ID | Case |
| --- | --- |
| TC-QR-01 | Token is 256-bit, only its hash stored; token never appears in logs |
| TC-QR-02 | Reissue revokes the previous token |
| TC-QR-03 | 20 concurrent scans of one token → exactly one `ADMITTED`, others `ALREADY_ADMITTED` with the original time |
| TC-QR-04 | Revoked, unknown, declined-guest tokens return `INVALID`/`NOT_ACCEPTED` |
| TC-QR-05 | Admin, another owner, or no session cannot use the scan endpoint ([D-08](../product/decisions.md)) |
| TC-QR-06 | Outside the admission window → `WINDOW_CLOSED` |
| TC-QR-07 | Public invitation endpoint is rate-limited, `no-store`, and never changes admission |
| TC-QR-08 | "Sign out of this device" ends the scan session; "sign out of all devices" ends all |
| TC-QR-09 | Scanner works on iPhone Safari and Android Chrome (camera permission, rear camera, low light) |

### Admin

| ID | Case |
| --- | --- |
| TC-ADM-01 | Queue stages match the next-step logic |
| TC-ADM-02 | Every admin write creates an `admin_actions` row without personal data in `summary` |
| TC-ADM-03 | Resolve `UNKNOWN` message: mark sent / mark failed / resend creates a new intent |
| TC-ADM-04 | Create admin; owner cannot reach admin pages (404) or endpoints (403) |
| TC-ADM-05 | Suspend/reactivate user; cannot suspend self |
| TC-ADM-06 | Mark refunded cancels the event, campaign and QR codes |

### UX and operations

| ID | Case |
| --- | --- |
| TC-UX-01 | Landing at 360 px: no horizontal scroll; targets ≥ 44 px; RTL |
| TC-UX-02 | axe: no serious/critical violations on every page state in the Playwright suite |
| TC-UX-03 | Lighthouse mobile: performance ≥ 85, accessibility ≥ 95 on landing |
| TC-OPS-01 | Deploy script: blue/green switch with zero failed requests during a 1 rps probe |
| TC-OPS-02 | Runtime DB role cannot `CREATE`/`DROP`; migrations run once per release |
| TC-OPS-03 | Backup restored into a scratch database; row counts match |
| TC-OPS-04 | Alerts fire for overdue campaign, unknown sends, worker down (simulated) |
| TC-OPS-05 | SPF, DKIM, DMARC pass for the OTP sender |

## Release checklist

Recorded in the [verification log](verification-log.md) before launch:

1. All FR acceptance criteria pass on production (or on staging with production configuration where a production run would affect real guests).
2. Full automated suite green on the release commit.
3. Production tracer (TC-WA-T1…T3) with the client's number and approved templates.
4. Live payment smoke test with the client (small amount, refunded manually).
5. Device and accessibility matrix completed.
6. Backup restore drill (TC-OPS-03) and alert simulation (TC-OPS-04).
7. Secrets present, CORS and cookies correct, Swagger disabled or protected.
8. Runbook, admin guide and credentials list handed over; support window dates recorded.
