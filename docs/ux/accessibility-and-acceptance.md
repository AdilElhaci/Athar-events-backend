# Accessibility and UX acceptance

**Status: approved baseline (2026-10-24).** Target: **WCAG 2.2 AA**. A target is not a conformance claim; only the checks recorded in the [verification log](../qa/verification-log.md) are evidence.

## Accessibility requirements

| ID | Requirement | Applies to |
| --- | --- | --- |
| A-01 | Every interactive element is reachable and operable by keyboard; visible focus ring (`--ring`, ≥ 2 px, ≥ 3:1) | All |
| A-02 | Form fields have visible labels, linked errors (`aria-describedby`), and errors announced on submit | Forms |
| A-03 | Text contrast ≥ 4.5:1 (body) / 3:1 (large, UI boundaries), re-checked after branding | All |
| A-04 | Status is never conveyed by colour alone (icon + text) | Badges, scan results |
| A-05 | Touch targets ≥ 44×44 px on mobile surfaces (WCAG 2.5.8 minimum is 24 px; we use 44) | Owner, scanner, guest, landing |
| A-06 | Scan results and async outcomes announced with `aria-live` | Scanner, toasts |
| A-07 | OTP input supports paste, `autocomplete="one-time-code"`, screen-reader labels per digit group | SCR-03 |
| A-08 | Dialogs trap focus and restore it on close; `Esc` closes | Dialogs |
| A-09 | Tables have header cells and accessible sort/pagination controls | Admin |
| A-10 | Page `lang="ar"`, `dir="rtl"`; LTR values isolated | All |
| A-11 | Respects `prefers-reduced-motion` | All |
| A-12 | Zoom to 200% without loss of content; no horizontal page scroll at 320 px for mobile surfaces | Mobile surfaces |
| A-13 | Camera permission flow explains why before the browser prompt, and offers manual entry when denied | SCR-31 |
| A-14 | Time-limited UI (OTP countdown) shows remaining time as text | SCR-03 |

## UX acceptance criteria

| ID | Criterion | Screen |
| --- | --- | --- |
| UX-01 | A first-time owner completes package → sign-in → details → payment without help in under 5 minutes (moderated test with 2 people) | SCR-01 → SCR-12 |
| UX-02 | After payment, the owner can state what to do next from the overview alone | SCR-13 |
| UX-03 | Every count shows its definition on hover/tap and a "last updated" time | SCR-13 |
| UX-04 | A failed poll keeps the last numbers and shows a stale notice, without toasts | SCR-13 |
| UX-05 | The invitation preview matches the WhatsApp message received on a real phone (text, variables, buttons) | SCR-15 |
| UX-06 | An admin imports a 300-row file with 5 errors, understands each error, and applies in under 3 minutes | SCR-22a |
| UX-07 | Scheduling is impossible while any precondition fails, and the failing precondition is named | SCR-23 |
| UX-08 | A scan result is readable at arm's length (title ≥ 32 px) and appears within 2 s on 4G | SCR-32 |
| UX-09 | "Already admitted" shows the original admission time | SCR-32 |
| UX-10 | Scan mode has no dashboard navigation and a visible "sign out of this device" | SCR-31 |
| UX-11 | Every list has distinct empty, loading and error states | All lists |
| UX-12 | No screen shows a raw error code, English system text or an untranslated string | All |
| UX-13 | The guest page works without sign-in, shows the QR full width, and never changes admission | SCR-40 |

## Verification matrix

| Surface | iPhone Safari (iOS current − 1) | Android Chrome (current) | Desktop Chrome | Desktop Safari | Desktop Edge | Keyboard only | VoiceOver / TalkBack |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Landing | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (smoke) |
| Auth | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Owner dashboard | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ (smoke) |
| Admin dashboard | — | — | ✓ | ✓ | ✓ | ✓ | — |
| Scanner | ✓ (real device, camera) | ✓ (real device, camera) | — | — | — | — | ✓ (result announcement) |
| Guest page | ✓ | ✓ | ✓ | — | — | — | ✓ (smoke) |

Automated: axe checks in Playwright on each page state (no serious/critical violations), Lighthouse on landing and owner overview. Manual: the matrix above at P4 end and P5, recorded in the [verification log](../qa/verification-log.md).
