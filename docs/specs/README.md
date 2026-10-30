# Feature specifications

**Status: Approved outline (2026-10-24); nothing implemented.** Each spec is the single primary owner of its requirements and uses SHARAKAT's nine sections as a checklist, kept short:

1. Purpose and source. 2. Actors and triggers. 3. Inputs. 4. Behaviour. 5. Acceptance criteria. 6. Technical design (data, API, jobs, config). 7. Security, permissions, audit. 8. Scope boundaries and dependencies. 9. Open questions.

Acceptance criteria IDs (`AC-xx-n`) are defined in [scope and acceptance](../product/scope-and-acceptance.md) and referenced here, not copied. Endpoints are in [API contracts](../architecture/api-contracts.md); tables in the [data model](../architecture/data-model.md).

| Spec | Owns | Phase |
| --- | --- | --- |
| [SP-01 Auth and roles](SP-01-auth-and-roles.md) | FR-02 | P1 |
| [SP-02 Packages, events and payments](SP-02-packages-events-payments.md) | FR-03 (event and payment parts), FR-04 (packages), FR-05 | P2 |
| [SP-03 Guests and import](SP-03-guests-and-import.md) | FR-08 (guest list parts) | P3 |
| [SP-04 WhatsApp campaigns, RSVP and replacements](SP-04-whatsapp-campaigns-rsvp-replacements.md) | FR-06, FR-04 (replacements), FR-03 (counts, approval), FR-08 (campaign parts) | P1 tracer, P3, P4 |
| [SP-05 QR and check-in](SP-05-qr-and-check-in.md) | FR-07 | P1 tracer, P4 |
| [SP-06 Landing page](SP-06-landing.md) | FR-01 | P1 |
