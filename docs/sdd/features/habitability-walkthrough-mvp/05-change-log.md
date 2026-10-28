# Change log

## TASK-063 Not-ready correction — October 28, 2026

Documentation-only update under TASK-063 (REQ-011, REQ-012).
Input snapshot: `ca373d3f6e5dd2c7f784c5d82973a401fccc0ce82530a43f96e4bd8288f57f77`
(SDD revision 382–383, stage `implementing`). No product code, check, commit,
publication, deployment, or live call is part of this change.

- 06-release.md Status flipped from Ready to Not ready; the TASK-041 READY
  promotion and any r228-era READY language are explicitly superseded, not
  deleted, to preserve history.
- Epoch-2 baseline recorded: six checks green on the current fingerprint
  (`docs`/`lint`/`typecheck`/`unit`/`browser`/`build` passed in ledger);
  prior code/QA/security passes carried as pending re-review; gate TASK-058
  NOT READY with two blocking findings (stale Ready record; live-smoke
  ledger gap).
- Live-smoke ledger gap recorded with shell-vs-ledger distinction: no
  executed `live-smoke` pass in the ledger for the current fingerprint
  (observed ledger outcome: failed, exit 1, REQ-003/REQ-010/REQ-011); no
  shell output is claimed as ledger proof.
- Carried limitation: catalog remains illustrative demo
  (`Demo checklist — not a verified Form 1083 mapping.`); no provider Form
  1083 confirmation and no form-specific mapping or real-pilot claim is made.
- No READY, live ledger proof, or provider confirmation is claimed.

## TASK-041 READY promotion — October 27, 2026

Documentation-only update under TASK-041 (REQ-012).
Input snapshot: `5f7c89129b9b984666e747caff47f385e6d2946e7d6a450ee3b8f044db530f73`
(SDD revision 267, stage `implementing`). No product code, check, commit,
publication, deployment, or live call is part of this change.

- Gate TASK-040 returned READY (passed) on the complete evidence chain.
- 06-release.md Status flipped from Not ready to Ready on that gate verdict.
- Carried documented limitation: catalog remains illustrative demo
  (`Demo checklist — not a verified Form 1083 mapping.`); no provider Form
  1083 confirmation and no form-specific mapping or real-pilot claim is made.
- 07-retrospective.md closed with the final outcome (all reviews passed, one
  live call, single-call discipline, no publish/merge/deploy).

## TASK-036 live-smoke success — October 27, 2026

Documentation-only update under TASK-036 (REQ-012).
Input snapshot: `5f7c89129b9b984666e747caff47f385e6d2946e7d6a450ee3b8f044db530f73`
(SDD revision 250, stage `implementing`). No product code, approval,
release-status promotion, commit, publication, deployment, or secret handling
is part of this change (key loaded from local `.env` into process env,
never printed).

- `live-smoke` success recorded in 06-release.md: coordinator-side
  `SMOKE_IMAGE=/tmp/live-smoke-detector.jpg npm run test:live`, exit 0.
  Sanitized output: model `muse-spark-1.3`, mode `live`, requestId
  `5b303073-787c-481d-8725-8c2b9a865666`, latencyMs `6108`, canonical
  sha256 `2c93bab0335436542c071f99c3eea08026d1e7866d7ac730dde160262ebdafba`,
  3024x4032 orientation-normalized from the 4032x3024 iPhone JPEG (sha256
  `7c9035c0` of the staged `/tmp` copy), item `demo-smoke-alarm`, one call
  only, no retries.
- Supporting evidence recorded: `tests/live/smoke.mjs` self-test 18/18,
  fail-closed exit 1 without key, fresh production build exit 0, and the six
  re-run checks (`docs`/`lint`/`typecheck`/`unit`/`browser`/`build`) all
  passed at SDD revision 248.
- 06-release.md keeps Status: Not ready pending the fresh QA and gate
  verdicts delegated alongside this task; provider Form 1083 confirmation
  gap stays open (catalog remains illustrative demo). No publish, merge,
  deploy, provider confirmation, QA pass, or READY gate is claimed.
- 07-retrospective.md completed with the live outcome and remaining
  QA/gate/provider gaps.

## Baseline 1 — October 26, 2026

Prepared request, twelve requirements, proposed architecture, ten implementation tasks, executable-check definitions and Codex/CI handoff. Existing project notes remain the product source. Initialized draft metadata through the installed plugin's initialize function at draft stage; no runtime approval or review evidence was fabricated.

Resolved the form-version dependency by allowing an explicit illustrative catalog; provider confirmation is still required for a form-specific mapping claim. Proposed Next.js/TypeScript/local IndexedDB, a real server-only Meta adapter and printable HTML export as the smallest coherent implementation.

No product code or live API call is part of this documentation/setup change. Record future baseline changes through the SDD revision flow before changing established requirements.

## Setup validation

Executed node scripts/verify-sdd.mjs: passed structural coverage for 12 requirements, 10 acyclic tasks and 7 checks. Executed node scripts/ci-app.mjs: correctly reported documentation-only stage. Both scripts passed node --check.

Parsed .sdd/config.json and all tasks against the installed plugin's actual Config and TaskInput schemas using Bun; passed. The installed artifactGate for planned/standard returned no document-structure issues. This is not an independent spec/plan review or approval.

Exercised the CI guard in temporary fixtures: docs-only allowed; source without manifest rejected; missing required scripts rejected; missing lockfile rejected; complete script/lockfile shape accepted. No application commands, live Meta call, GitHub-hosted CI or Codex PR review have run.

## TASK-034 stale-record fix — October 27, 2026

Documentation-only update under TASK-034 (REQ-012) to close the stale-record
blocker named by gate TASK-033 (NOT READY).
Input snapshot: `975914a824c601ecaaa55bc8708aa9c3f54a6bb5906bdc71969b27534fd947c3`
(SDD revision 235, stage `implementing`); observed evidence cited at SDD
revision 228 on stable source fingerprint
`ee9df466771f0e906cf4a18a5699e03576d3454a52e7e9d55770fff69863b23c`.
No product code, approval, release-status promotion, commit, publication,
deployment, or live call is part of this change.

- Builder history now recorded: 29 builder tasks passed — TASK-001 through
  TASK-010 plus repairs TASK-013 through TASK-027, spec TASK-011, plan
  TASK-012. This supersedes the prior 06-release.md claim that implementation
  had not started and the change log stopping at revision 67.
- Checks observed on stable source: `docs` (`node scripts/verify-sdd.mjs`)
  passed; `lint` (`npm run lint`) passed; `typecheck` (`npm run typecheck`
  with red-command negative control) passed; `unit` (`npm run test:unit` with
  red-command negative control) passed; `browser` (`npm run test:e2e` with
  red-command negative control) passed; `build` (`npm run build`) passed.
- `live-smoke` (`npm run test:live`) honestly failed: no `META_API_KEY`,
  exit 1, no fixture substituted, no live Meta call made.
- Reviews observed: code TASK-032 passed with 2 non-blocking info notes;
  security TASK-030 passed with 1 low hardening note; QA TASK-029 failed on
  missing live credentials; gate TASK-033 NOT READY naming (1) no live Meta
  call, (2) no provider Form 1083 confirmation, (3) QA failed on credentials,
  plus this stale-record gap.
- 06-release.md keeps Status: Not ready and names the three blockers above.
  Non-blocking notes (staging digest labeling, per-item vs per-session 409,
  absent-Origin hardening) are recorded as accepted backlog without code
  changes. No live success, provider confirmation, or publish/merge/deploy is
  claimed.
- 07-retrospective.md records the blocked-release outcome and remaining
  limitations without prefilling success.

## TASK-010 verification and readiness-gap record — October 27, 2026

Documentation-only update under TASK-010 (REQ-003, REQ-011, REQ-012).
Source snapshot: `0318bbea7a44c20df4fda285897eef71cafb2b45c0558c350a94d5ec10d18f34`
(SDD revision 67, stage `implementing`). No product code, approval, release-status
change, commit, publication, deployment, or live call is part of this change.

- Wrote `docs/evaluation/results.md`: no measured runs; all cells `unmeasured`;
  sample size zero; existing TASK-009 test files described as fixture-only
  inputs with no executed unit/browser evidence claimed; live pending; demo-only
  form status and new-vs-reused record included.
- Extended `docs/REVIEW_AND_CI.md` with a TASK-010 snapshot: exact configured
  commands, the two observed `docs`-check executed entries
  (`cfa00775…` fingerprint `a7d346e0…`, `cb9d100f…` fingerprint `a25bd31b…`,
  both `node scripts/verify-sdd.mjs` exit 0, structural pass only, now stale
  after source edits), absence of lint/typecheck/unit/browser/build/live-smoke
  executed evidence, missing `package.json`/lockfile/runner-config observation,
  hosted docs-only CI run `40432010484` as the only CI success, no live smoke,
  no independent code/QA/security/gate or Codex review verdicts, setup names
  only, and Not-ready readiness with publish/deploy separate.
- This change-log entry records the documentation action itself. Form status
  stays illustrative demo (`Demo checklist — not a verified Form 1083 mapping.`);
  provider confirmation, live inference, current app checks, independent reviews,
  and measured evaluation all remain outstanding. `06-release.md` ownership sits
  outside this TASK-010 subtask split and was left unchanged here; release stays
  Not ready until current required checks and independent reviews pass.
## 2026-10-28T17:00:21.469Z

Adopt src/app/walkthrough.css (frontend styling created by Kanban lane, imported by layout, verified correct by three code reviews) into the implementation baseline via a narrow audit-only ownership task, and baseline the nine preserved foreign PM/infra/docs files; correct 06-release.md Ready->Not ready per gate TASK-058 finding without claiming live ledger proof.
