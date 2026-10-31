# Evaluation results (REQ-011)

## Current execution snapshot — 2026-10-31

There are still zero completed measured workflow evaluations and no
practitioner validation. The owner supplied staged/mock kitchen and bathroom
clips and authorized provider processing. These were live processing attempts,
not scored evaluation runs: the kitchen segment request returned HTTP 504 after
about 210.9 seconds; the bathroom segment endpoint returned HTTP 200 after
about 92.6 seconds, but the browser request was canceled before saving the
result. Muse mapping did not run, and tracking, mapping, timestamp/still
coverage, and indoor-light misses remain unmeasured. See
`video-clip-gate.md` for the sanitized attempt record and open scorecard.

The clips were separate room videos of about 23.1 seconds and 9.7 seconds,
respectively, totaling about 32.8 seconds. The current gate asks for one clip
of 30 seconds or less with visible faucet, fan, lock, and detector evidence;
the delivered footage and attempts do not establish that coverage. No raw
video or credentials are stored in the repository.

The check results in `docs/REVIEW_AND_CI.md` are from an earlier source
snapshot and have not been rerun on the current dirty tree.

## Historical execution snapshot — 2026-10-29

No measured workflow runs or practitioner validation are recorded; the
evaluation sample remains zero sessions, zero items, and zero workers. One
synthetic live video connectivity smoke was run separately: SAM 3.1 handled one
segment request in 12,155 ms and returned no candidates. Muse mapping was not
called, the lease was released, and inspection quality was not assessed. This
does not satisfy the staged-video quality gate in `video-clip-gate.md`.

The current development inputs include a self-shot detector photo at
`fixtures/media/dev-ceiling-detector-01.jpg` and the 1.77-second synthetic
test-pattern video at `tests/fixtures/synthetic-h264-test-pattern.mp4`. Neither
is staged property footage or an evaluation-set input. No rights-cleared
30-second kitchen/bathroom clip or scored video evaluation is recorded.
The synthetic MOV and JPEG derived from that clip under `tests/fixtures/` are
browser-test inputs only; they are not evaluation media.

Current local verification results are recorded in `docs/REVIEW_AND_CI.md`;
those fixture checks are not evaluation runs and do not prove provider quality.

Sections below preserve dated 2026-10-27 and 2026-10-28 snapshots. They are
historical unless explicitly restated in the current execution snapshot above;
in particular, the old photo-first scaffold/browser failure and old no-call
observations do not describe the current video app or current live-call status.

> Current form status (2026-10-29): the project owner confirmed that LAHSA
> Form 1083 is the form used and submitted in this workflow. Earlier lines in
> this dated evidence record that describe the form identity as unconfirmed
> predate that confirmation. No practitioner evaluation or measured run is
> thereby implied; app-output acceptance and HMIS submission remain separate
> and unclaimed.

Historical status: no measured runs. Date: 2026-10-27. Source snapshot for this record:
`0318bbea7a44c20df4fda285897eef71cafb2b45c0558c350a94d5ec10d18f34`
(SDD revision 67, stage `implementing`).

This file records only observed state. It claims no measured times, coverage,
retakes, edits, rejections, or practitioner validation. Every unobserved cell
stays `unmeasured` per `docs/evaluation/protocol.md`.

## 1. Current evaluation inputs and runs

No development-set or evaluation-set measured run has been filed under
`fixtures/evaluation/`. Current relevant inputs are:

- `fixtures/media/dev-ceiling-detector-01.jpg` — self-shot development image;
  not evaluation footage and not a substitute for a room video.
- `tests/fixtures/synthetic-h264-test-pattern.mp4` — 1.77-second synthetic
  connectivity/test input; it contains no staged-unit footage and cannot pass
  the video quality gate.
- `fixtures/responses/fixture-draft.json` — hand-written mock-unit draft,
  `mode: "fixture"`, with `fixtureNotice`; deterministic test input only,
  never live inference.
- `fixtures/README.md` — provenance/license contract only; manifest rows for
  additional media slots remain `unmeasured`. No rights-cleared staged
  kitchen/bathroom video or evaluation run sheet is recorded.

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

## 3. Historical TASK-009 scaffold and browser snapshot — 2026-10-27

TASK-009 added fixture-only behavioral inputs, not measured runs, for the
earlier photo-first scaffold:

- `tests/unit/integration/flow.test.ts` — deterministic synthetic-byte checks
  for stale-response races, storage tombstones, media boundaries, provider
  errors, review honesty, export escaping, and catalog labeling. All bytes,
  hashes, and drafts are synthetic; no credentials, no network, no live call.
- `tests/e2e/walkthrough.spec.ts` — Playwright 360px fixture-mode flow
  (capture/upload, review/edit/rejection, manual checks, export banner).

The TASK-009 worker reported that browser acceptance failed against the
scaffold page because capture/review/export test IDs were not wired. The same
snapshot had no root `package.json`, so it could not run the app checks. Those
statements describe that old scaffold only; they are not current browser
results or current repository contents. The photo-first test files cited above
have since been replaced. Current local lint, typecheck, unit, browser, and
build results are summarized in `docs/REVIEW_AND_CI.md`. They are not measured
evaluation runs and do not validate provider output.

## 4. Live-inference limitation (REQ-003, REQ-011)

The key-presence and no-call statements below describe only the 2026-10-27
snapshot. They are superseded as to current call status by the 2026-10-29
synthetic live video connectivity smoke recorded at the top of this file. The
later smoke returned no candidates, made no Muse request, and did not establish
staged-video quality.

- At the time of the 2026-10-27 snapshot, the owner reported that the Meta API
  key was in server-side `.env`; key presence was checked without reading or
  displaying its value. No `npm run test:live` request had been made in that
  snapshot. The later synthetic video smoke is the only video live result
  claimed here; it is connectivity evidence only, not an evaluation run.
- Live smoke must fail clearly without credentials and must never pass via
  fixtures. When credentials exist, record model, mode, request ID, and
  latency separately without media, secrets, or provider bodies.
- Green unit/browser/build checks, when they exist, prove only fixture
  behavior. They prove neither live inference nor provider form confirmation.

## 5. Form status (REQ-001)

Form identity is project-owner-confirmed. The current catalog carries all
eleven area labels from the owner's supplied Form 1083 model. It keeps demo
mode for sample analysis output, not because the owner has not identified the
form. This app does not submit the form or claim provider acceptance of its
export. See `docs/integration/FORM_1083_MAPPING.md` §1.

## 6. Historical new-vs-reused inventory — 2026-10-27

This inventory describes the older photo-first source snapshot and is not a
complete list of the current video implementation.

- New event-built work in this checkout: `src/` domain/server/storage/export/
  capture/review/summary code, `src/data/catalog.demo.json`,
  `fixtures/README.md` + `fixtures/responses/fixture-draft.json`,
  `docs/integration/FORM_1083_MAPPING.md`,
  `docs/evaluation/protocol.md`, this results file, and the SDD feature
  artifacts under `docs/sdd/features/habitability-walkthrough-mvp/`.
- Pre-existing / reused project notes (not event-built behavior):
  `docs/PRODUCT_BRIEF.md`, `docs/RESEARCH.md`, `docs/DECISIONS.md`,
  `docs/BUILD_PLAN.md`, `IDEA.md`, and linked Drive/LAHSA references.
- In that snapshot, no third-party media, tenant data, or provider-confirmed
  mapping had been added. This historical observation is not a statement that
  the current server-side Meta route is absent; its video quality remains
  unvalidated by the synthetic connectivity smoke.

## 8. 2026-10-28 GTM pass — still zero measured runs

This is a dated lane report, not the current execution snapshot. Its statements
about what that lane observed remain historical; the 2026-10-29 synthetic video
smoke is recorded at the top of this file.

- Evaluation runs recorded by that 2026-10-28 lane: none. Scenarios A/B/C
  remained `unmeasured`; sample size was zero sessions, zero items, zero
  workers. That lane recorded no measured times, coverage, retakes, edits,
  rejections, manual-check counts, practitioner validation, or live call. The
  separate 2026-10-29 synthetic video smoke is described above and is not an
  evaluation run.
- That lane reported an empty-set state at `fixtures/evaluation/README.md`
  (date + catalog `0.1.0-demo.1`): no evaluation-set inputs existed, the
  dev-set ceiling-detector photo could not be reused for evaluation, and the
  A/B/C media needs were listed there. The referenced README is not present in
  the current checkout; the current empty evaluation set is summarized in §1.
  No fixture-mode evaluation run was possible in that lane, so none was
  invented.
- Coordinator-run CI evidence reported by the frontend lane (task
  `t_bf5d0dcb`, 2026-10-28; not re-run in this GTM pass): `npm run lint`
  exit 0, `npm run typecheck` exit 0, `npm run test:unit` 130/130,
  `npm run build` exit 0, `npm run test:e2e` 15/15 pass on the production
  build in fixture mode (`APP_ANALYSIS_MODE=fixture`, no Meta key). This
  supersedes the §3 note that no coordinator-executed unit/e2e evidence
  existed. Per protocol §5 it proves fixture behavior only — it is not a
  measured evaluation run and proves neither live inference nor provider
  form confirmation.
- Live status observed by this lane on 2026-10-28 was `unmeasured`; no Meta key
  was available to that lane and it did not observe a live call. The separate
  2026-10-29 synthetic video smoke is now recorded above and returned no
  candidates, so no video mapping-quality result is claimed. Note:
  `docs/sdd/features/
  habitability-walkthrough-mvp/06-release.md` records a historical
  still-image live-smoke success (model `muse-spark-1.3`, mode `live`, requestId
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
