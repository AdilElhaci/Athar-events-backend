# SP-06: Landing page

*Status: Approved outline. Implementation: see [progress](../delivery/progress.md) (`T-P1-08`).*

## 1. Purpose and source

Primary owner of **FR-01** (quotation 01: an introductory page built on a ready-made template with the client's identity; service, how it works, prices, contact; mobile-friendly; Arabic). Decision [D-18](../product/decisions.md).

## 2. Actors and triggers

Visitors from search, social links or the client's WhatsApp; returning owners going to sign-in.

## 3. Inputs

Client copy, logo and colours ([OQ-13](../product/open-questions.md)); active packages from `GET /packages`; contact details (WhatsApp number, email, social links).

## 4. Behaviour

Sections in order: header (logo, "كيف تعمل", "الباقات", "تواصل معنا", sign-in button) → hero (value statement, primary CTA "ابدأ مناسبتك", secondary "شاهد الباقات") → how it works (4 steps: choose a package and pay → send your guest list → we send WhatsApp invitations → guests scan their QR at the door) → packages (cards from the API; featured package highlighted; CTA to sign-in with `?package=<id>`) → FAQ (accordion, 6–8 questions supplied by the client) → contact (WhatsApp button, email, hours) → footer (privacy, terms, copyright). Privacy and terms pages render client-supplied text.

The template is a lightweight, Arabic-capable marketing layout implemented with the project's tokens and shadcn components (no three.js, shaders, lenis or scroll-jacking). Images optimised with `next/image`; fonts via `next/font`.

## 5. Acceptance criteria

AC-01-1 to AC-01-5.

## 6. Technical design

`app/(Landing Page)/page.tsx`, `privacy/page.tsx`, `terms/page.tsx`, `contact/page.tsx` (optional if the contact section suffices); components under `components/pages/landing-page/<section>/`; packages fetched server-side with revalidation (60 s) and rendered statically; metadata (Arabic title/description, Open Graph image).

## 7. Security, permissions, audit

Public; no forms that collect personal data (contact via WhatsApp/email links) unless the client asks for a contact form (extra scope).

## 8. Scope and dependencies

In: one landing page, privacy, terms. Out: blog, multiple languages, CMS, custom illustration work. Depends on branding and copy from the client.

## 9. Open questions

[OQ-13](../product/open-questions.md) branding.
