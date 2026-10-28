# Codex review and CI

## Responsibility split

OpenCode SDD Autopilot builds the task graph and records its own lifecycle evidence. GitHub Actions runs deterministic checks. Codex independently reviews PR changes and can diagnose/fix failing CI when asked. Root AGENTS.md contains repository-specific review rules; the PR template asks for requirement coverage and actual verification.

## Local setup prepared

- .github/workflows/ci.yml runs on PRs, pushes to main and manual dispatch.
- Docs validation checks the eight-artifact contract, unique IDs, task DAG, serialized shared ownership and task/check coverage.
- Before scaffold, CI explicitly reports documentation-only validation.
- Once package.json or application source exists, the guard requires a manifest, lockfile and all verification scripts. The workflow runs lint, typecheck, unit checks, production build and Playwright Chromium acceptance. Missing scripts or commands fail.
- CI has read-only repository permissions, no persisted checkout credentials and no model secrets. Browser runs use explicit fixtures.
- Live Meta smoke is a separate required SDD check, not a secret-dependent PR job.
- No auto-merge, deployment or autonomous CI-repair workflow is configured.

## GitHub activation still needed

The public repository is [jd-chiles/meta-inspector](https://github.com/jd-chiles/meta-inspector), created at the project owner's request. The initial publication includes the CI workflow and review rules. GitHub Actions execution and account-level Codex automatic review are distinct activation steps; repository files do not switch on Codex's account settings.

Initial publication commit: 91f65ba7dd257c059c328e9cacdbe728806685b4. [First hosted CI run](https://github.com/jd-chiles/meta-inspector/actions/runs/40432010484): succeeded. This run validates documentation structure; the app is not scaffolded, so no application or live Meta acceptance is claimed. Codex automatic-review activation remains pending.

Repository activation and verification:

1. Push these files through the normal Git workflow and observe a real CI run.
2. Connect the repository to Codex, then in Codex settings choose the repository and enable Automatic review under Review code. Configure your personal automatic-review trigger if desired.
3. Open a representative PR. If automatic review is unavailable, request it with `@codex review` in a PR comment.
4. After the first real CI run, configure the main-branch ruleset to require the resulting CI / verify status before merging. Do not treat an informal Codex comment as a mechanically enforced passing status.
5. Confirm the bot's actual review and resolve actionable findings. Changes need fresh CI/review.

Automatic reviews need a connected repository and push/admin permission. Repository rules can guide Codex, while CI and branch protections enforce deterministic gates. Sources: [official GitHub review setup](https://learn.chatgpt.com/docs/third-party/github) and [custom review rules](https://developers.openai.com/blog/custom-code-review-rules-for-codex), consulted October 26, 2026.

## CI repair handoff

When a job fails, give Codex the PR URL and ask: “Inspect the failing CI run, reproduce the failing command, fix the cause without weakening checks, and rerun affected verification. Follow AGENTS.md.”

Codex should inspect the precise failing step, distinguish environment/credential failures from product failures, change only the needed code/config, add meaningful regression coverage when warranted, and record commands actually run. Keep media/keys out of logs. A missing live Meta credential is a named verification gap, not a reason to substitute a fixture.

This setup provides review policy, executable CI and a repair handoff. It does not claim Codex background monitoring or automatic CI repair is active.

## TASK-010 verification snapshot — 2026-10-27 (REQ-003, REQ-011, REQ-012)

Source revision for this record: `0318bbea7a44c20df4fda285897eef71cafb2b45c0558c350a94d5ec10d18f34`
(SDD slug `habitability-walkthrough-mvp`, revision 67, stage `implementing`).
No commits, publication, deployment, or live calls were made for this
documentation-only update. Publish/deploy remain separate actions.

### Exact configured commands (from `.sdd/config.json`)

- docs: `node scripts/verify-sdd.mjs` (REQ-001–REQ-012)
- lint: `npm run lint` (REQ-012)
- typecheck: `npm run typecheck` (REQ-001, REQ-003, REQ-004, REQ-006, REQ-012)
- unit: `npm run test:unit` (REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-010, REQ-011)
- browser: `npm run test:e2e` (REQ-001–REQ-012)
- build: `npm run build` (REQ-003, REQ-009, REQ-012)
- live-smoke: `npm run test:live` (REQ-003, REQ-010, REQ-011)

### Executed evidence observed (read-only, `.sdd/evidence/habitability-walkthrough-mvp.jsonl`)

Only two `docs`-check entries were present at read time; both report
`exitCode: 0, outcome: "passed"` for structural traceability only:

1. id `cfa00775-b9cf-4675-a20b-8adda3611ff3`, started `2026-10-27T11:59:37.395Z`,
   command `node scripts/verify-sdd.mjs`, cwd `/home/hermes/workspace/meta-inspect`,
   fingerprint `a7d346e09497b7f73cc744eff6f570cfffac74976f942a42da3446ad768cc2bd`,
   output `SDD structure passed: 12 requirements, 10 acyclic tasks, 7 named checks. Application behavior is not verified by this check.`
2. id `cb9d100f-81e6-4ee9-a6d6-fbacd61dc4c3`, started `2026-10-27T13:27:55.739Z`,
   same command, fingerprint `a25bd31bc3fdd0812b6e9309b013494bef31b3c3e27f7c5c81363a4c3a481ff3`,
   same output.

Current status of that evidence is stale: source edits after those fingerprints
changed the tree (input snapshot above), so the prior docs pass does not cover
the current tree. Docs validation proves contract consistency only, never
application behavior.

No executed evidence was present for `lint`, `typecheck`, `unit`, `browser`,
`build`, or `live-smoke` at read time. No pass is claimed for any of them.

Additional observed checkout state: the root listing showed `.env.example`,
`scripts/verify-sdd.mjs`, `scripts/ci-app.mjs`, `src/`, `tests/`, `fixtures/`,
and `docs/`, but no `package.json`, `package-lock.json`, `next.config.ts`,
`vitest.config.ts`, `playwright.config.ts`, or `.github/` workflows. Without a
manifest, `npm run lint/typecheck/test:unit/test:e2e/build/test:live` have no
runnable definition in this tree, so no such outcome is recorded here. The
coordinator must run those commands natively to create current evidence; child
sessions are denied shell and cannot do so.

### CI / live outcomes

- Hosted GitHub CI: the only run on record in these docs is the initial
  docs-only publication (`91f65ba7dd257c059c328e9cacdbe728806685b4`,
  run `https://github.com/jd-chiles/meta-inspector/actions/runs/40432010484`,
  succeeded). It validates documentation structure; no application or live Meta
  acceptance is claimed by it. No app-check CI run has been observed since
  scaffold/test files appeared.
- Live smoke (`npm run test:live`): no executed evidence; no Meta API key is
  provisioned (names only in `.env.example`). Fixture success never counts as
  live. Missing credentials remain a named limitation, not a pass.
- TASK-009 worker report (unexecuted diagnostic context, not verification
  evidence): created `tests/unit/integration/flow.test.ts` (vitest races,
  storage tombstones, route boundaries 400/403/409/413/415/422, provider
  502/504, 429, SETUP_REQUIRED without fixture fallback, export honesty) and
  `tests/e2e/walkthrough.spec.ts` (360px fixture flow). All fixture-only
  synthetic bytes, no credentials. The worker reports browser acceptance
  currently fails against the scaffold page (no wired capture/review/export
  testids) as the correct fail-for-absent-feature signal. Shell denial meant
  the coordinator still needs to run `npm run test:unit` and `npm run test:e2e`
  plus lint/typecheck/build to record executed evidence.

### Independent review findings

None recorded. No native SDD code, QA, security, or gate review verdicts exist
in inspected state, and no Codex PR review with findings/resolution is on
record for the current tree. Codex automatic-review activation for the new
repository remains pending (see activation steps above). Green CI, when it
exists, proves neither live inference nor provider form confirmation.

### Real vs illustrative / new vs reused / setup / limitations

- Real vs illustrative: demo catalog only (`Demo checklist — not a verified
  Form 1083 mapping.`); operative Form 1083 copy/version/wording/tests remain
  unconfirmed per `docs/integration/FORM_1083_MAPPING.md` §1. No form-specific
  mapping claim is made.
- New vs reused: new event-built work is `src/`, `tests/`,
  `fixtures/responses/fixture-draft.json`, `fixtures/README.md` contract,
  `docs/integration/FORM_1083_MAPPING.md`, `docs/evaluation/protocol.md`,
  `docs/evaluation/results.md`, and SDD artifacts. Pre-existing notes are
  `docs/PRODUCT_BRIEF.md`, `docs/RESEARCH.md`, `docs/DECISIONS.md`,
  `docs/BUILD_PLAN.md`, `IDEA.md`. No third-party media or tenant data added.
- Setup: `.env.example` names only (`META_API_KEY`, `META_MODEL=muse-spark-1.3`,
  `META_API_BASE_URL=https://api.meta.ai/v1`, `APP_ANALYSIS_MODE=fixture`);
  no key provisioned; browser runs must use explicit fixtures.
- Remaining limitations: unexecuted app checks, missing manifest/lockfile and
  runner configs in this tree, no live call, no provider confirmation, no
  independent reviews, no measured evaluation runs, no completed-export claim.

### Readiness

Status remains Not ready. Ready requires current passing evidence for all
required checks on one stable source revision plus recorded independent
code/QA/security/gate reviews and the separate live-smoke success; none of
those exist for the current tree, so Ready is not marked here. `06-release.md`
is outside this task's owned paths and is left unchanged by this update.
