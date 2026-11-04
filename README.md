# Walkthrough Kit

**A human-led, AI-assisted habitability walkthrough for housing navigators.**

Walkthrough Kit is a mobile-first prototype for capturing a staged housing-unit walkthrough, organizing video evidence, and preparing a local inspection packet. It explores how an AI companion can help overextended case managers and navigators document a walkthrough while leaving every inspection decision with a human evaluator.

## The problem

People can wait a long time for housing assistance, then spend scarce time searching for a home that meets program requirements. A visit to an unsuitable unit can add avoidable work for both the household and the case manager. Staff may also be carrying heavy caseloads or have limited experience with habitability walkthroughs.

Walkthrough Kit focuses on the documentation and review step: guide the worker through the rooms, connect AI suggestions to source video, and make it clear what still needs human review. These are product motivations, not measured impact claims; the project has not established reduced visits, time savings, or improved housing outcomes.

## What the prototype does

- Guides capture for the kitchen, bathroom, bedroom/living area, and hallway. The front door and lock are covered in the hallway.
- Uses Meta SAM 3.1 to find candidate moments and Meta Muse Spark to draft evidence-linked observations from video stills.
- Keeps AI suggestions separate from evaluator decisions, required in-person checks, and sign-off.
- Creates local PDFs and JSON for manual handling, including a copy of the LAHSA FY 2022–23 Form 1083 and supporting evidence pages.

The modeled flow is a staged demonstration. Participant/HMIS identity and unit address are blank, and the exports are not case-ready. This app does not conduct an HQS inspection, submit to HMIS, deliver documents to landlords, or decide voucher eligibility. Pre-visit address screening and SAM.gov lookups are ideas for future exploration and are not implemented.

## Screens

These captures show the empty/staged interface; they do not show completed inspections or provider-generated results.

| Capture | Review | Sign-off |
|---|---|---|
| ![Mobile capture screen](artifacts/design-qa/capture-final-390.png) | ![Mobile review screen](artifacts/design-qa/review-final-390.png) | ![Mobile sign-off screen](artifacts/design-qa/signoff-final-390.png) |

## Run locally

**Requirements:** Node.js 22 and npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Use `APP_ANALYSIS_MODE=fixture` for local development. Fixture output is synthetic. Live analysis requires server-side provider credentials, can incur provider charges, and sends selected media to configured providers. Use only rights-cleared staged/mock-unit media. See [development setup](docs/DEVELOPMENT.md) and [privacy and safety](docs/PRIVACY_AND_SAFETY.md).

## Project status and limits

The repository includes the guided capture, review, sign-off, provider routes, and local export flow. Automated checks cover the code paths they execute; fixture and CI success do not establish live model quality, physical-device compatibility, recipient acceptance, or field effectiveness. No measured staff-time savings, avoided visits, or inspection accuracy are claimed.

Room capture limits are 30 seconds for the kitchen, bathroom, and bedroom/living area, and 15 seconds for the hallway. See [scope and limitations](docs/PROJECT_OVERVIEW.md) for the product boundaries and [evaluation protocol](docs/evaluation/protocol.md) for how future evidence should be reported.

## Documentation

- [Project overview](docs/PROJECT_OVERVIEW.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development setup](docs/DEVELOPMENT.md)
- [Privacy, safety, and limitations](docs/PRIVACY_AND_SAFETY.md)
- [Hackathon and portfolio narrative](docs/HACKATHON.md)
- [Evaluation protocol](docs/evaluation/protocol.md)
- [Form 1083 mapping contract](docs/integration/FORM_1083_MAPPING.md)
- [Analysis API contract](docs/integration/ANALYZE_CONTRACT.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Contributing](CONTRIBUTING.md)

## Project identity and license

The product is named **Walkthrough Kit**. The GitHub repository currently uses the `meta-inspector` URL slug. Project-authored code is licensed under MIT. Bundled forms, fonts, generated audio, and dependencies have separate terms; see [third-party notices](THIRD_PARTY_NOTICES.md).
