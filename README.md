# Habitability Walkthrough Companion

Meta Global AI Developer Hackathon · Indie Developer · Build for Your World

GitHub repository: [jd-chiles/meta-inspector](https://github.com/jd-chiles/meta-inspector).

> An image-first companion helps housing navigators capture evidence for selected habitability walkthrough items, prepare a reviewable draft, and flag what still needs a manual check.

This is a focused prototype for reducing friction in one administrative step. It does not assess housing eligibility, certify habitability, or claim to shorten the time to permanent housing.

## Project workspace

- [OpenCode SDD handoff](docs/OPENCODE_HANDOFF.md) — eight specifications, task inputs, check configuration and build prompts.
- [Codex review and CI](docs/REVIEW_AND_CI.md) — prepared workflow, review rules and GitHub activation steps.
- [Current product brief](docs/PRODUCT_BRIEF.md) — user, problem, workflow, scope, and success measures.
- [Build plan](docs/BUILD_PLAN.md) — implementation sequence, gates, and backlog.
- [Research and validation](docs/RESEARCH.md) — evidence, source links, unresolved claims, and field validation.
- [Demo and submission plan](docs/DEMO.md) — three-minute story and hackathon requirements.
- [Decisions and changes](docs/DECISIONS.md) — current decisions and superseded directions.
- [Original working idea](IDEA.md) — retained as the initial sketch, with its unverified assumptions marked.

## Current state

Epoch-3 rescope (November 4 target): 11-item demo checklist
(`demo-habitability-walkthrough` version `0.2.0-demo.1` — 4 carried
illustrative items + 7 reserved placeholders with official
wording/tests/sign-offs TBD), installable PWA shell with offline pending
queue, and review-only printable/PDF export. Every checklist surface keeps
`Demo checklist — not a verified Form 1083 mapping.` The 11-item scope is
user-attested (owner statement, October 28, 2026); all confirmation details
remain OPEN — no operative Form 1083 mapping, provider confirmation, or
pilot claim exists.

Source of truth: SDD run `habitability-walkthrough-mvp` (revision 483 at
time of writing, recorded plan approval `8d202606485e`), requirements
REQ-001–REQ-013 in
`docs/sdd/features/habitability-walkthrough-mvp/01-requirements.md`, plan
tasks TASK-069–TASK-073 in `03-plan.md`/`tasks.json`. Epoch-3 builders
TASK-069–TASK-072 are recorded passed; executable-check re-runs on the
epoch-3 fingerprint are pending coordinator execution — fixture success
never counts as live, and local deletion never claims provider deletion.
Use only self-shot mock-unit images and fictional data in the hackathon demo.

## Reference material

- [Feasibility report](https://docs.google.com/document/d/1iXxZM6GmQnw12c8KlKIcbQveHC_i2uvZeu43BsD3Ru0/edit)
- [Concept brief](https://docs.google.com/document/d/1ba1iApZ3nwIWDqAA7vmkIucfCSS2wBU46_SqWc3ZzDA/edit)
- [Official hackathon event](https://dev.meta.ai/events/global-hackathon)
- [Meta Model API model catalog](https://dev.meta.ai/docs/models)
- [LAHSA Form 1083 listing](https://www.lahsa.org/documents?id=6886--tls-and-hn-fy-2022-2023-form-1083-habitability-standards-form.pdf)
- [LAHSA HMIS forms](https://www.lahsa.org/hmis/forms)
