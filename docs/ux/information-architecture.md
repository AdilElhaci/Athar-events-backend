# Information architecture

**Status: approved baseline (2026-10-24).** Route structure follows the Athar frontend's route groups with one role-filtered dashboard shell ([D-17](../product/decisions.md)).

## Sitemap

```text
(Landing Page)   /                      SCR-01 landing (hero, how it works, packages, FAQ, contact)
                 /privacy  /terms       SCR-06, SCR-07 static pages
(Auth)           /auth/login            SCR-02 email step
                 /auth/verify           SCR-03 code step
                 /auth/profile          SCR-04 first-time name (only when requiresProfile)
(Dashboard)      /dashboard             SCR-10 owner: my events | SCR-20 admin: action queue
  owner          /dashboard/events/new  SCR-11 create event (package → details → review & pay)
                 /dashboard/events/[id] SCR-13 overview · tabs: guests SCR-14 · invitation SCR-15
  admin          /dashboard/events                   SCR-20a all events (filters by stage)
                 /dashboard/events/[id]              SCR-22 workspace · tabs: guests SCR-22 (+ import SCR-22a) ·
                                                     invitation & campaign SCR-23 · replacements SCR-24 ·
                                                     messages SCR-25 · details & admission window
                 /dashboard/packages                 SCR-21
                 /dashboard/payments                 SCR-26
                 /dashboard/users                    SCR-27
                 /dashboard/activity                 SCR-28 admin action log
  both           /dashboard/profile                  SCR-05 name, email, sign out of all devices
payment          /payment/return                     SCR-12 payment confirmation
(Scanner)        /scan                               SCR-30 choose event (owner)
                 /scan/[eventId]                     SCR-31 scanner · SCR-32 result states
(Guest)          /i/[token]                          SCR-40 QR recovery page
```

`/dashboard/events/[id]` renders the owner composition for owners and the admin composition for admins, each backed by its own endpoints (`/events/:id` vs `/admin/events/:id`). Direct navigation to an admin-only route as an owner shows a 404 page.

## Navigation

| Role | Sidebar (desktop) / bottom sheet menu (mobile) |
| --- | --- |
| Owner | مناسباتي (My events) · مناسبة جديدة (New event) · الملف الشخصي (Profile) · مساعدة (WhatsApp support link) |
| Admin | لوحة المهام (Queue) · المناسبات (Events) · الباقات (Packages) · المدفوعات (Payments) · المستخدمون (Users) · سجل النشاط (Activity) · الملف الشخصي |

The header shows the breadcrumb, the user menu (profile, sign out) and, for owners with an event today, a "وضع المسح" (scan mode) button. Scan and guest surfaces have no sidebar.

## Screen inventory

| ID | Screen | Role | Primary content | Primary action | States |
| --- | --- | --- | --- | --- | --- |
| SCR-01 | Landing | Public | Hero, steps, packages (API), FAQ, contact | Start an event | Packages loading/error fallback (hide section, keep CTA) |
| SCR-02 | Sign in — email | Public | Email field | Send code | Sending, throttled (countdown) |
| SCR-03 | Sign in — code | Public | 6-digit input, resend countdown, change email | Verify | Invalid, expired, locked, resend available |
| SCR-04 | Complete profile | Any | Name | Save | — |
| SCR-05 | Profile | Any | Name, email, phone; sign out of all devices | Save | — |
| SCR-10 | My events | Owner | Event cards: name, date, next-step badge | New event | Empty (first event CTA), loading skeleton, error |
| SCR-11 | Create event | Owner | Stepper: package → details → review | Pay | Validation, package inactive, redirecting to payment |
| SCR-12 | Payment return | Owner | Verifying → paid / still pending / failed | Go to event / retry payment | Pending > 30 s explains delayed confirmation |
| SCR-13 | Event overview | Owner | Status timeline, next-step card, counts with tooltips, last updated, scan-mode entry on event day | Contextual (pay, send list, approve, open scan mode) | Unpaid, awaiting list, list in progress, awaiting approval, scheduled (send time), sending, sent, closed, cancelled; stale data |
| SCR-14 | Guest list | Owner | Table: name, masked phone, kind, RSVP, admitted; search, filters | — | Empty (list not received yet + instructions), loading, error |
| SCR-15 | Invitation preview & approval | Owner | Rendered WhatsApp-style preview with sample name, event details | Approve | Not ready, awaiting approval, approved (time), outdated version |
| SCR-20 | Admin queue | Admin | Stage counters; alerts (unknown sends, payments to reconcile, overdue); events needing action | Open event | Empty (nothing to do), loading |
| SCR-20a | All events | Admin | `DataTable`: reference, owner, date, stage, package | Open | Filters by stage, search |
| SCR-21 | Packages | Admin | `DataTable` + dialog form | Add / edit / deactivate | Validation |
| SCR-22 | Event workspace — guests | Admin | Allowance meter (initial x/N, reserve y/E); `DataTable` with full phone, kind, RSVP, delivery, admitted; add guest | Import / add / mark list ready | Locked rows after allocation |
| SCR-22a | Import dialog | Admin | Upload → preview counts → rows by result → apply | Apply | Unreadable file, missing columns, too many rows, expired preview |
| SCR-23 | Invitation & campaign | Admin | Content versions, approval state, template status, preconditions checklist, schedule picker (Riyadh time), progress | Schedule / pause / resume / cancel | Preconditions missing, scheduled, sending (progress), paused, sent |
| SCR-24 | Replacements | Admin | Extras cap/used/available, eligible declines, reserve list | Send N replacements / choose guests | No declines, margin exhausted, no reserves |
| SCR-25 | Message log | Admin | `DataTable`: guest, kind, state, delivery, time, error code; filter `UNKNOWN`/`FAILED` | Resolve | — |
| SCR-26 | Payments | Admin | `DataTable`: event, owner, amount, status, Moyasar ids | Reconcile / mark refunded | — |
| SCR-27 | Users | Admin | `DataTable`: name, email, type, status | Create admin / suspend / reactivate | — |
| SCR-28 | Activity log | Admin | `DataTable`: time, actor, action, target | — | — |
| SCR-30 | Scan — choose event | Owner | Today's / upcoming events with window times | Start scanning | No event with an open window; not signed in → sign in |
| SCR-31 | Scanner | Owner | Full-screen camera, admitted/accepted counter, manual entry, torch, sign out of device | Scan | Camera permission prompt / denied, no connection, window closed |
| SCR-32 | Scan result | Owner | Large result card: icon + title + guest name/time + reason | Continue | ADMITTED, ALREADY_ADMITTED, NOT_ACCEPTED, INVALID, WRONG_EVENT, WINDOW_CLOSED |
| SCR-40 | Guest QR page | Guest | QR, guest name, event, date, venue + map link | Open map | Valid, admitted, revoked, closed, unknown token |

## Feature-to-screen map

| FR | Screens |
| --- | --- |
| FR-01 Landing | SCR-01, SCR-06, SCR-07 |
| FR-02 Accounts | SCR-02, SCR-03, SCR-04, SCR-05 |
| FR-03 Owner dashboard | SCR-10, SCR-11, SCR-13, SCR-14, SCR-15 |
| FR-04 Packages & extras | SCR-21, SCR-24, SCR-13 (extras counts) |
| FR-05 Payment | SCR-11, SCR-12, SCR-26 |
| FR-06 WhatsApp | SCR-23, SCR-25, SCR-40 (QR recovery) |
| FR-07 QR & check-in | SCR-30, SCR-31, SCR-32, SCR-40 |
| FR-08 Admin dashboard | SCR-20 to SCR-28 |

## Next-step logic (SCR-13 and SCR-20)

| Condition (first match) | Owner sees | Admin queue stage |
| --- | --- | --- |
| `status = CANCELLED` | Cancelled (reason) | done |
| `payment_status ≠ PAID` | "أكمل الدفع" (Complete payment) | awaiting_payment |
| `list_status = AWAITING_LIST` | "أرسل قائمة ضيوفك" + reference + template | awaiting_list |
| `list_status = IN_PROGRESS` | "نجهّز قائمتك" (We are preparing your list), last update | awaiting_list |
| `approval_status = AWAITING_OWNER` | "راجع الدعوة واعتمدها" (Review and approve) | awaiting_approval |
| `campaign_status = NOT_SCHEDULED` | "سيتم جدولة الإرسال قريباً" | awaiting_approval (ready to schedule) |
| `campaign_status = SCHEDULED` | "موعد الإرسال: <date time>" | scheduled |
| `campaign_status = SENDING / PAUSED` | Progress / paused notice | sending / needs_attention |
| unknown or failed messages, unpaid-but-paid-at-Moyasar | — | needs_attention |
| `campaign_status = SENT`, before event | Results; scan-mode entry on event day | done (monitoring) |
| `status = CLOSED` | Final results | done |
