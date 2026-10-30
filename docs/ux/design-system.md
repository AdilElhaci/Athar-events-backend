# Design system foundations

**Status: approved baseline (2026-10-24).** This page owns the design foundations and their rationale. The frontend `DESIGN.md` describes how they are implemented (classes, components, examples) and links here; if the two disagree, this page wins and `DESIGN.md` is corrected. Structure, token architecture, font, type scale and component wrappers follow the Athar frontend ([D-18](../product/decisions.md)). The brand colour layer is the client's brand kit ([D-29](../product/decisions.md), 2026-10-27).

## Scale

A lightweight system, not a component library programme: Tailwind 4 `@theme` tokens, shadcn/ui primitives, and a small set of project wrappers reused from the Athar vocabulary.

## Tokens

### Brand layer (D-29)

The client's brand kit (`athar-events/Athar_Events_Brand_Kit/Color_Specifications.csv`) is approved as-is ([D-29](../product/decisions.md)); it replaces the Athar defaults and the provisional D-26 palette. Kit values are not altered. Components use semantic tokens, never brand tokens directly. Contrast ratios computed for opaque sRGB (≥ 4.5:1 body text, ≥ 3:1 large text and UI boundaries).

| Token | Value | Source | Use | Contrast |
| --- | --- | --- | --- | --- |
| `--brand-burgundy` | `#4A1F30` | Kit: Royal Burgundy | Primary actions, links, headers (`--primary`, `--ring`) | 12.32:1 on ivory; ivory text on it 12.32:1 |
| `--brand-ivory` | `#F7F2EA` | Kit: Warm Ivory | Page background (`--background`), text on primary | — |
| `--brand-rose` | `#A87C75` | Kit: Dusty Rose | Decorative hairlines and motifs only (`rose` utility) | 3.25:1 — never informative text |
| `--brand-warm-gray` | `#8C7B7B` | Kit: Warm Gray | Dividers (`--divider`), large secondary text | 3.6:1 — large text only |
| `--brand-charcoal` | `#2A2A2F` | Kit: Charcoal | Main text (`--foreground`) | 12.81:1 on ivory |
| `--brand-surface` | `#FFFDF9` | Derived | Cards, hero band | — |
| `--brand-burgundy-hover` | `#3A1826` | Derived | Primary hover | ivory text 14.08:1 |
| `--brand-ink-muted` | `#6F5F5F` | Derived (darker Warm Gray) | Small supporting text (`--muted-foreground`) | 5.42:1 on ivory |

The kit lists Warm Gray for secondary text, but at 3.6:1 it fails small text, so small supporting text uses the darker derived tone of the same hue. Logo: the kit holds raster previews only (AI-generated, not a vector master); the Arabic wordmark needs a human redraw and spelling check before print production. Until an SVG logo exists the UI keeps the text wordmark in `components/shared/Brand`.

### Landing variant (D-26)

Layout, motifs, display type and motion from review round 4 ([D-26](../product/decisions.md)) stay; its provisional colours are replaced by the brand layer above.

- **Display:** Reem Kufi 500 via `next/font` (`--font-reem-kufi`), only through the `text-display` utility (`clamp(2.25rem, 1.6rem + 3vw, 4rem)`, line-height 1.4) on the hero and closing headline, and in the provisional wordmark.
- **Fonts loading:** IBM Plex Sans Arabic preloads only the Arabic subset; Latin glyphs load on demand.
- **Motifs:** `ShurafatEdge` (stepped Najdi parapet, hero bottom edge) and `SaduBand` (closing section only). Inline SVG patterns, `aria-hidden`, never behind text or controls.
- **Motion:** buttons 150 ms colour only; guest-demo state change 180 ms opacity + 6 px; `Reveal` once-only 200 ms opacity + 8 px, armed only after hydration and only below the fold; reduced motion disables all of it while keeping the demo usable.
- **tailwind-merge:** the custom type scale is registered as font sizes in `lib/utils.ts` so `text-18` never removes a text colour.

### Semantic layer (from Athar's `globals.css` structure)

`--background`, `--foreground` (= ink), `--card`, `--popover`, `--primary` (= brand primary), `--primary-foreground`, `--secondary`, `--muted`, `--muted-foreground`, `--accent`, `--destructive`, `--border`, `--input`, `--ring` (= primary), plus status tokens:

| Token | Use | Pairing |
| --- | --- | --- |
| `--success` | Paid, accepted, admitted | Icon + text, never colour alone |
| `--warning` | Pending, paused, already admitted | Icon + text |
| `--error` | Failed, declined, invalid | Icon + text |
| `--info` | Scheduled, sending | Icon + text |

Dark mode: not in scope (Athar has none); tokens are structured so it can be added.

### Typography

- Family: **IBM Plex Sans Arabic** (`next/font/google`, weights 400/500/600/700), as in Athar; Latin fallback in the same family.
- Scale (Athar classes): `text-12` (captions, table headers only), `text-14` (body, table cells), `text-16`, `text-18`, `text-20`, `text-24` (page titles), `text-32` (landing hero). `text-10` is not used for content in Athar Events.
- Line height ≥ 1.6 for Arabic body text; no letter-spacing on Arabic.
- Numerals: Western digits for phone numbers, codes, amounts and counts (as in Athar); dates formatted with `Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh' })`.

### Spacing, radius, elevation

- Spacing on the 4 px Tailwind scale; page padding `p-4` mobile, `p-6` desktop; section gaps `space-y-6`.
- Radius from Athar's `--radius` scale; cards `rounded-xl`, inputs and buttons `rounded-lg`.
- Elevation: borders first; one shadow level for popovers/dialogs.

### Breakpoints

Tailwind defaults: `sm 640`, `md 768`, `lg 1024`, `xl 1280`. Owner, scanner, guest and landing are designed at 360 px first; admin at 1280 px first and usable from 768 px (tables scroll horizontally inside their container, never the page).

### Motion

Durations 150–250 ms, ease-out; used for feedback (button loading, dialog, toast, scan result). All motion disabled under `prefers-reduced-motion`. No smooth-scroll libraries, parallax or 3D.

### Icons

Lucide (and Iconify Solar set for the sidebar, as in Athar). Directional icons (arrows, chevrons) mirror in RTL; non-directional icons (check, QR, camera, phone) do not.

## Components

### Reused from the Athar vocabulary (re-implemented, [D-24](../product/decisions.md))

`Button` (with `isLoading`), form elements (`TextFormEle`, `ComboboxFormEle`, `RadioGroupFormEle`, `SwitchFormEle`) with react-hook-form + zod, `DataTable` (TanStack, `search`/`filters` props, URL pagination, skeleton), `ReusableDialog`, `MainTitles`, `SummaryCard`, `StepProgress`/`WizardLayout`, `Breadcrumb`, `Money`, `CustomPagination`, `Tabs`, toasts (sonner).

### New for Athar Events

| Component | Purpose |
| --- | --- |
| `StatusBadge` | One badge per state dimension (payment, list, approval, campaign, RSVP, delivery, admission); icon + label + tone from a single map |
| `EventTimeline` | Owner overview: steps paid → list → approval → scheduled → sent → event day, current step highlighted |
| `NextStepCard` | The single next action with explanation (from the next-step logic) |
| `CountTile` | `SummaryCard` variant with a definition tooltip |
| `LastUpdated` | "آخر تحديث قبل ٥ ثوانٍ" with stale warning after 30 s |
| `AllowanceMeter` | initial x / N, reserve y / E, extras used / available / cap |
| `PreconditionList` | Schedule preconditions with pass/fail icons |
| `WhatsAppPreview` | Chat-bubble rendering of the invitation with the two buttons |
| `OtpInput` | 6 boxes, paste, Arabic-Indic normalisation, LTR, `autocomplete="one-time-code"` |
| `PhoneText` | LTR-isolated phone display with masking option |
| `ScanResult` | Full-screen result card (icon, title, detail), `aria-live` |
| `ImportPreview` | Counts + `DataTable` of rows by result |

## RTL rules

- `<html lang="ar" dir="rtl">`; shadcn initialised with RTL support (`components.json` `rtl: true`, unlike Athar).
- Logical utilities only (`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`, `text-start`).
- Mixed-direction values wrapped in `<bdi>` or `dir="ltr"` spans: emails, phones, codes, URLs, amounts with currency, reference codes.
- Inputs for email, phone, code and URL use `dir="ltr"` with right-aligned placeholder text in Arabic.
- Verify portals (dialogs, popovers, toasts), calendars and table sorting icons in RTL during each phase review.

## Content style

- Arabic Modern Standard, warm and short; second person; no slang.
- Buttons are verbs: "ادفع الآن", "اعتمد الدعوة", "جدولة الإرسال".
- Errors say what happened and what to do; never raw codes.
- Numbers with units: "٣٠ دعوة إضافية" is avoided in favour of "30 دعوة إضافية" (Western digits, consistent with Athar).
