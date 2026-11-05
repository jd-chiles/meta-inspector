# Walkthrough Kit — portfolio case study

> A human-led, AI-assisted walkthrough prototype for documenting unit conditions with evidence that a person can inspect.

## At a glance

| | |
|---|---|
| **Product** | Mobile-first walkthrough and local inspection-packet prototype |
| **Primary user** | Housing navigator or case manager conducting a staged unit walkthrough |
| **Workflow** | Capture → evidence-linked draft → evaluator review → sign-off → local export |
| **Stack** | Next.js 15, React 19, TypeScript, IndexedDB, PDF generation, Playwright, Vitest |
| **AI services** | Meta SAM 3.1 for candidate moments; Meta Muse Spark for draft observations |
| **Status** | Hackathon/portfolio prototype; not a production inspection or case-management system |

## The problem I chose

Housing placement involves more than finding a unit. A walkthrough can require a worker to cover multiple rooms, record observations, complete checks that require physical inspection, and prepare paperwork. The prototype explores one narrow question: can software make evidence capture and review easier to follow without taking the decision away from the evaluator?

This is a product motivation, not a validated estimate of the problem's prevalence or cost. The repository does not claim measured time savings, avoided visits, improved inspection accuracy, or housing outcomes.

## Product decisions

### 1. Keep the human decision explicit

The model produces draft observations tied to evidence. It cannot pass or fail a unit, complete a manual check, or create an approved deficiency. The evaluator reviews, edits or rejects suggestions, records required checks, and signs.

### 2. Preserve evidence identity

Asynchronous work can return after a clip, checklist item, or session has changed. The workflow binds results to session, item, source media, frame, analysis attempt, and revision. Stale or mismatched results must not silently attach to new evidence or retain prior approval.

### 3. Treat physical checks as physical checks

A frame can support a visible observation, but it cannot prove operation, temperature, airflow, or other conditions requiring an in-person check. The UI and export flow keep those responsibilities separate.

### 4. Make the demo safe and honest

The staged flow uses mock-unit media and leaves participant/HMIS identity and unit address blank. Fixture output is visibly synthetic. Local PDF/JSON export is for manual handling; it is not represented as an HMIS submission, an accepted inspection, or a landlord delivery.

## How the system works

1. A worker records or imports short clips for the kitchen, bathroom, bedroom/living area, and hallway.
2. The app stores the session and evidence locally in the browser.
3. On an explicit live-analysis request, the browser uploads selected media bytes to a same-origin server route. It does not submit a URL for the server to retrieve.
4. The server validates the media, sends the video through the SAM segmentation path, derives bounded still frames, and uses a short-lived identity-bound lease for mapping.
5. Muse Spark drafts observations from server-derived evidence. The client checks provenance before displaying a draft.
6. The worker reviews each item, completes required checks, records decisions and corrections, and signs.
7. Client-side export code prepares local PDF and JSON files from the evaluator's record.

See [architecture](ARCHITECTURE.md), [Form 1083 workflow](integration/FORM_1083_MAPPING.md), and [privacy and safety](PRIVACY_AND_SAFETY.md) for implementation boundaries.

## What I built

- Room-guided, mobile-first capture and review flow.
- Local session and media persistence.
- Server-side video analysis routes with bounded input validation and explicit fixture/live modes.
- Evidence-linked AI draft review and evaluator-controlled decisions.
- Local PDF and JSON export flow, including the bundled FY 2022–23 Form 1083 base and supporting pages.
- Unit/API-boundary tests, browser acceptance tests, lint/type checks, build, and documentation-link validation in CI.

## Verification and evidence

The repository contains automated checks for defined software behavior. Those checks do not establish live model quality, physical-device compatibility, external recipient acceptance, or field effectiveness. A provider connectivity check is not an evaluation.

For any future evaluation, use the [evaluation protocol](evaluation/protocol.md): label fixture, live-provider, device, and practitioner evidence separately; document method and sample size; record failures and unmeasured outcomes.

## Limitations and next work

- The prototype models a specific LAHSA Form 1083 version; it does not establish that this is the current form or that another organization accepts the output.
- No HMIS integration, voucher eligibility logic, landlord delivery, or case tracking is implemented.
- Live processing sends selected media to configured providers and can incur cost. Only rights-cleared staged/mock-unit media should be used.
- Device/browser behavior and provider output need separate evaluation.
- Future address screening or SAM.gov lookup ideas remain out of scope until sources, matching rules, human review, privacy, and error handling are defined.

## How to explore the repo

Start with [the demo walkthrough](DEMO.md), then read [development setup](DEVELOPMENT.md) to run fixture mode. The [documentation index](README.md) maps the remaining product, architecture, API, privacy, and evaluation guides.
