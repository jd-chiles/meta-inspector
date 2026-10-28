# Evaluation results (REQ-011)

Status: no measured runs. Date: 2026-10-27. Source snapshot for this record:
`0318bbea7a44c20df4fda285897eef71cafb2b45c0558c350a94d5ec10d18f34`
(SDD revision 67, stage `implementing`).

This file records only observed state. It claims no measured times, coverage,
retakes, edits, rejections, or practitioner validation. Every unobserved cell
stays `unmeasured` per `docs/evaluation/protocol.md`.

## 1. Runs recorded

None. No development-set or evaluation-set measured run has been filed under
`fixtures/evaluation/`. The reserved directories remain empty of binary media:

- `fixtures/media/` — reserved, currently empty; no media committed yet.
- `fixtures/evaluation/` — reserved, currently empty; no evaluation run recorded.
- `fixtures/responses/fixture-draft.json` — hand-written mock-unit draft,
  `mode: "fixture"`, with `fixtureNotice`; deterministic test input only,
  never live inference.
- `fixtures/README.md` — provenance/license contract only; manifest rows for
  media slots remain `unmeasured`.

## 2. Blank sheet (still unmeasured)

| Field | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Date | unmeasured | unmeasured | unmeasured |
| Scenario (A / B / C) | unmeasured | unmeasured | unmeasured |
| Mode (`fixture` or `live`) | unmeasured | unmeasured | unmeasured |
| Catalog version | unmeasured | unmeasured | unmeasured |
| Model | unmeasured | unmeasured | unmeasured |
| Current-workflow minutes | unmeasured | unmeasured | unmeasured |
| Assisted-workflow minutes | unmeasured | unmeasured | unmeasured |
| Items with usable linked evidence | unmeasured | unmeasured | unmeasured |
| Missing-evidence items | unmeasured | unmeasured | unmeasured |
| Retakes | unmeasured | unmeasured | unmeasured |
| Worker edits / rejections | unmeasured | unmeasured | unmeasured |
| Manual checks flagged / performed / not-performed | unmeasured | unmeasured | unmeasured |
| Unresolved checks at export | unmeasured | unmeasured | unmeasured |
| Sample size | unmeasured | unmeasured | unmeasured |
| Errors and recovery observed | unmeasured | unmeasured | unmeasured |
| Notes | unmeasured | unmeasured | unmeasured |

Sample size is zero sessions, zero items, zero workers. No rate or average
exists to report.

## 3. What the existing test files are (and are not)

TASK-009 added fixture-only behavioral inputs, not measured runs:

- `tests/unit/integration/flow.test.ts` — deterministic synthetic-byte checks
  for stale-response races, storage tombstones, media boundaries, provider
  errors, review honesty, export escaping, and catalog labeling. All bytes,
  hashes, and drafts are synthetic; no credentials, no network, no live call.
- `tests/e2e/walkthrough.spec.ts` — Playwright 360px fixture-mode flow
  (capture/upload, review/edit/rejection, manual checks, export banner).

Per the TASK-009 worker report, browser acceptance currently fails against the
scaffold page because no capture/review/export testids are wired; the worker
describes this as the correct fail-for-absent-feature signal. No
coordinator-executed `npm run test:unit` or `npm run test:e2e` evidence exists
in `.sdd/evidence/habitability-walkthrough-mvp.jsonl` as of this record, and
no `package.json` manifest was observed in the checkout root, so no
unit/browser pass is claimed here. Fixture tests never prove live inference.

## 4. Live-inference limitation (REQ-003, REQ-011)

- No Meta API key is provisioned in this checkout (env names only in
  `.env.example`). No `npm run test:live` executed evidence exists.
- Live smoke must fail clearly without credentials and must never pass via
  fixtures. When credentials exist, record model, mode, request ID, and
  latency separately without media, secrets, or provider bodies.
- Green unit/browser/build checks, when they exist, prove only fixture
  behavior. They prove neither live inference nor provider form confirmation.

## 5. Form status (REQ-001)

Real vs illustrative: illustrative demo only. The bundled catalog
(`src/data/catalog.demo.json`, `0.1.0-demo.1`, `mode: "demo"`) carries
`Demo checklist — not a verified Form 1083 mapping.` No provider has confirmed
the operative Form 1083 copy, wording, numbering, or physical-test
requirements (see `docs/integration/FORM_1083_MAPPING.md` §1). Missing
confirmation never promotes a demo item; fake confirmation in tests must not
promote it either.

## 6. New vs reused work (submission record)

- New event-built work in this checkout: `src/` domain/server/storage/export/
  capture/review/summary code, `src/data/catalog.demo.json`,
  `fixtures/README.md` + `fixtures/responses/fixture-draft.json`,
  `docs/integration/FORM_1083_MAPPING.md`,
  `docs/evaluation/protocol.md`, this results file, and the SDD feature
  artifacts under `docs/sdd/features/habitability-walkthrough-mvp/`.
- Pre-existing / reused project notes (not event-built behavior):
  `docs/PRODUCT_BRIEF.md`, `docs/RESEARCH.md`, `docs/DECISIONS.md`,
  `docs/BUILD_PLAN.md`, `IDEA.md`, and linked Drive/LAHSA references.
- No third-party media, tenant data, or provider-confirmed mapping has been
  added. Coding-agent assistance alone is not runtime Meta model integration.

## 8. 2026-10-28 GTM pass — still zero measured runs

- Runs recorded: none. Scenarios A/B/C remain `unmeasured`; sample size is
  still zero sessions, zero items, zero workers. No measured times,
  coverage, retakes, edits, rejections, manual-check counts, practitioner
  validation, or live result is claimed.
- Empty-set state is now filed at `fixtures/evaluation/README.md` (date +
  catalog `0.1.0-demo.1`): no evaluation-set inputs exist, the dev-set
  ceiling-detector photo cannot be reused for evaluation, and the exact
  media needed for A/B/C is listed there. No fixture-mode evaluation run
  was possible, so none was invented.
- Coordinator-run CI evidence reported by the frontend lane (task
  `t_bf5d0dcb`, 2026-10-28; not re-run in this GTM pass): `npm run lint`
  exit 0, `npm run typecheck` exit 0, `npm run test:unit` 130/130,
  `npm run build` exit 0, `npm run test:e2e` 15/15 pass on the production
  build in fixture mode (`APP_ANALYSIS_MODE=fixture`, no Meta key). This
  supersedes the §3 note that no coordinator-executed unit/e2e evidence
  existed. Per protocol §5 it proves fixture behavior only — it is not a
  measured evaluation run and proves neither live inference nor provider
  form confirmation.
- Live status in this lane: unchanged, `unmeasured`. No Meta key is
  available to this lane and no live call was observed here, so no live
  result is claimed here. Note: `docs/sdd/features/
  habitability-walkthrough-mvp/06-release.md` records a coordinator-side
  live-smoke success (model `muse-spark-1.3`, mode `live`, requestId
  `5b303073-787c-481d-8725-8c2b9a865666`, latencyMs `6108`, one call, no
  retries); that record was not independently observed in this GTM pass
  and is cited here as a pointer only, not as GTM evidence.

- Fix evaluation inputs with manifest rows, then file completed sheets under
  `fixtures/evaluation/` with date and catalog version before any claim.
- Keep development and evaluation sets separate; never tune prompts on
  evaluation media.
- Record owner-reported case-manager conversations as qualitative input only
  (no sample size, dates, quotations, or measured times on record).
- Housing placement timelines remain outside the evaluation.
- Re-verified 2026-10-28 (this GTM pass): `fixtures/evaluation/` still holds
  only its state-record README (no run sheets, no media) and
  `fixtures/media/` still holds only the dev-set image, so the zero-run
  record above is current. Frozen demo route for the fixture take is
  recorded in `docs/DEMO.md` (http://127.0.0.1:3100/, fixture,
  catalog `0.1.0-demo.1`); no behavior beyond that cited evidence is
  claimed here.
