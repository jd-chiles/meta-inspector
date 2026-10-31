# Codex review and CI

## Current status update — 2026-10-31

The active checkout is heavily modified after the local checks recorded below;
those results are historical and must not be used as current passes. No
configured docs/lint/typecheck/unit/browser/build checks were rerun during the
handoff preparation. The owner supplied staged/mock kitchen and bathroom
clips and authorized processing: kitchen timed out with HTTP 504 after about
211 seconds; bathroom segment returned HTTP 200 after about 93 seconds, but
the browser request was canceled before saving. Muse mapping and video-quality
scoring did not occur. See `docs/evaluation/video-clip-gate.md`.

The owner directed a Muse Code implementation handoff on this date. Its
paste-ready package and production-MVP sequence are in
`docs/MUSE_CODE_HANDOFF.md` and `docs/PRODUCTION_MVP_ROADMAP.md`. No Muse Code
dispatcher is available in this Codex session, so no start is claimed. The
worktree had no active app server or Tailscale daemon when checked. Release
remains Not ready.

## Muse Code sprint verification — 2026-10-31

Delegated implementation agent: Muse Code (owner handoff in
`docs/MUSE_CODE_HANDOFF.md`, sequence in `docs/PRODUCTION_MVP_ROADMAP.md`).
No native SDD approval, review, or evidence is claimed; `.sdd/state` and
`.sdd/evidence` were not edited. The worktree remains on a detached HEAD with
all pre-existing uncommitted changes preserved; no live or billed provider
call was made.

Current executed results on this tree (commands run in the worktree root):

- `node scripts/verify-sdd.mjs`: pass — 15 requirements, 11 active acyclic
  tasks, 7 named checks.
- `npx vitest run tests/unit/sdd/verify-sdd.test.ts`: 7/7 pass (TASK-113
  focused validator tests).
- `npm run lint`: pass, no warnings.
- `npm run typecheck`: pass.
- `FFMPEG_PATH=/home/hermes/.local/ffmpeg-9.0.2/bin/ffmpeg npm run test:unit`:
  22 files, 384 passed, 3 optional FFmpeg integration tests skipped.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/hermes/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome npm run test:e2e`:
  28/28 pass (includes `next build`; suite uses loopback port 3101 per its
  own config).
- `npm run build`: pass (separate run).
- `git diff --check`: pass.
- `npm run test:live`: not run (separate authorization required; fixture
  results never prove it).

Tests added by this sprint (no application source changed):

- `tests/unit/walkthrough/inspection-store.test.ts`: acknowledgment
  migration resets ack-less A/D to unreviewed while retaining clips and
  proposals (REQ-005).
- `tests/unit/domain/move-in-ready.test.ts`: Fire Safety D with one
  deficient clause validates and derives not-approved.
- `tests/unit/server/video/segment.test.ts`: unsupported codec (vp09) and
  audio-only tracks rejected 415; Meta Muse 4xx maps to SETUP_REQUIRED with
  no Baseten fallback.
- `tests/e2e/move-in-ready.spec.ts`: unknown funding shows choose-funding
  gates on Review/Sign-Off with zero LAHSA controls.

Audit rulings (read-only four-area sweep plus skeptic review; details in the
sprint completion report):

- The flagged migration proposal-wipe is not a defect: the version-staleness
  path correctly clears proposals per REQ-006 and 02-design, while the
  acknowledgment migration preserves them per REQ-005 (now locked by the
  test above).
- Bathroom 200-then-cancel matches the designed cancel path (explicit
  cancel, keepalive stage=cancel release, no mapping, no fixture
  substitution).
- Kitchen 504 at ~211s exceeds the coded 150s-per-stage and 160s route
  caps, so it cannot be attributed to a coded timeout; server/proxy logs
  are needed. The coded timeout path releases the operation guard and
  retains no lease (covered by unit tests). No client-timeout change was
  made: the observed attempt resolved to an error with explicit retry
  available.
- HUD handler guards remain invocation-untested (unreachable via UI: zero
  controls render); carried as documented backlog with other
  edge-hardening items.

Release remains **Not ready**: real clip gate unscored, no
physical-device evidence, no recipient acceptance, no independent reviews,
and no native SDD evidence.

## Implementation status — 2026-10-30

The project owner confirmed this workflow uses LAHSA Form 1083. The mobile app
has separate Capture, Draft Review, and Sign-Off & Export screens, four-room
local video capture/storage, a server-side SAM 3.1 segmentation and Muse Spark
mapping route, and local PDF/JSON exports. Exports are for manual handling:
the app does not submit to HMIS or claim provider acceptance. The mobile UI
uses the concept's three-item navigation, Capture prompts, separate Review
overview/detail and Sign-Off screens, and guided Profile setup. A clean first
launch now shows the honest empty camera state and filming prompts below unit
setup; record/upload controls remain gated until the unit pseudonym and LAHSA
funding route are set. HUD routes to an HQS-required screen. The latest
acceptance measured 360 × 640 and 390 × 844 phones plus a 1365 px desktop, with
no horizontal overflow. The preview contains no fabricated footage, AI
decisions, or signature. Codex owns implementation. Native SDD
approval/evidence is reported only when recorded by its plugin tooling.

Current local checks: `node scripts/verify-sdd.mjs` passed (15 requirements,
11 active acyclic tasks, 7 named checks); lint and typecheck passed; unit tests
passed 380 tests in 22 files with 3 optional FFmpeg tests skipped; the
production Playwright suite passed 27/27 and ran `next build`; a separate
`npm run build` passed. Screenshots and layout measurements are in
`design-qa.md`. The tailnet-only preview is
<https://vps-27b87dbf-1.taile8712d.ts.net:3100/>.

Release remains **Not ready**. A historical still-image smoke and a separate
synthetic video smoke are recorded. In the video smoke, SAM returned no
candidates and Muse was not called, so it did not assess real video quality. A
consented, rights-cleared staged kitchen/bathroom clip,
physical iOS/Android recording checks, exact Form 1083 field/recipient
acceptance, and native SDD review/evidence remain open. Local checks do not
replace hosted CI or those external gates.

## Previous local verification snapshot — 2026-10-29

These results describe the 2026-10-29 snapshot only. They do not verify the
current uncommitted changes or the current design; rerun affected checks before
relying on them:

| Check | Result |
|---|---|
| `node scripts/verify-sdd.mjs` | Pass: 15 requirements, 17 acyclic tasks, 7 named checks; structural validation only |
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run build` | Pass: optimized production build after the final UI and Profile disclosure edits |
| `npm run test:unit` | Pass: 20 files, 352 passed, 3 optional FFmpeg integration tests skipped |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/hermes/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome npm run test:e2e` | Pass: all 22 production browser tests, including 360px Capture/Profile, three-tab flow, separate Review states, offline recovery, MOV normalization, async evidence identity, and export gates |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/hermes/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome npx --no-install playwright test tests/e2e/move-in-ready.spec.ts --grep "360px shows"` | Pass: final helper copy and disclosure layout, 1/1 focused phone flow |
| `FFMPEG_PATH=/home/hermes/.local/ffmpeg-9.0.2/bin/ffmpeg npm run test:live` | Pass: one real SAM segment request; zero candidates, no Muse call, video quality not assessed |
| `git diff --check` | Pass |

Playwright used the installed Chromium executable because the default
headless shell in this environment could not decode the synthetic H.264
fixture. The MOV fixture is packet-copied from the synthetic MP4; its browser
test confirms local normalization, storage, and preview without a provider
call. The unit run used the locally built FFmpeg 9.0.2 binary through
`FFMPEG_PATH`; `/usr/bin/ffmpeg` 5.1.9 is only the fallback when that server
setting is absent.

The preview is served through Tailscale at
`https://vps-27b87dbf-1.taile8712d.ts.net:3100/`. The selected 390 × 844 mobile
preview was inspected in Capture, Review, Sign-Off, and Profile. It contains no
room clips, evaluator decisions, or sign-off.

The recorded video smoke used the 1.77-second synthetic test pattern. SAM
returned zero candidates; the smoke therefore made no Muse request and
assessed no live video quality. This confirms only that the configured video
segment path is reachable and does not close the staged-video quality gate. A
separate historical still-image smoke is recorded in the release history. See
`design-qa.md` and `docs/evaluation/video-clip-gate.md`.

## Responsibility split

Codex owns implementation, task coordination, and local verification. GitHub
Actions runs deterministic checks. Native SDD plugin state/evidence is
separate and is reported only when its tools actually record it. Root
AGENTS.md contains repository-specific review rules; the PR template asks for
requirement coverage and actual verification.

## Local setup prepared

- .github/workflows/ci.yml runs on PRs, pushes to main and manual dispatch.
- Docs validation checks the eight-artifact contract, unique IDs, task DAG, serialized shared ownership and task/check coverage.
- The guard allows docs-only validation only before application source is added; it fails if source exists without a manifest. The current checkout has application source and `package.json`, so the workflow requires a lockfile and check scripts, then runs lint, typecheck, unit checks, production build and Playwright Chromium acceptance. Missing scripts or commands fail.
- CI has read-only repository permissions, no persisted checkout credentials and no model secrets. Browser runs use explicit fixtures.
- Live Meta smoke is a separate required SDD check, not a secret-dependent PR job.
- No auto-merge, deployment or autonomous CI-repair workflow is configured.

## GitHub activation still needed

The public repository is [jd-chiles/meta-inspector](https://github.com/jd-chiles/meta-inspector), created at the project owner's request. The initial publication includes the CI workflow and review rules. GitHub Actions execution and account-level Codex automatic review are distinct activation steps; repository files do not switch on Codex's account settings.

Initial publication commit: 91f65ba7dd257c059c328e9cacdbe728806685b4. [First hosted CI run](https://github.com/jd-chiles/meta-inspector/actions/runs/40432010484): succeeded. At that historical publication snapshot, the app had not yet been scaffolded, so this run validates documentation structure only and makes no application or live Meta claim. It says nothing about the current checkout. Codex automatic-review activation remains pending.

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

Historical checkout observation (2026-10-27): the root listing showed `.env.example`,
`scripts/verify-sdd.mjs`, `scripts/ci-app.mjs`, `src/`, `tests/`, `fixtures/`,
and `docs/`, but no `package.json`, `package-lock.json`, `next.config.ts`,
`vitest.config.ts`, `playwright.config.ts`, or `.github/` workflows. Without a
manifest, `npm run lint/typecheck/test:unit/test:e2e/build/test:live` had no
runnable definition in that historical tree, so no outcome was recorded for
that snapshot. This is not a current-checkout limitation or a handoff to an
external project owner.

### CI / live outcomes

- Hosted GitHub CI: the only run on record in these docs is the initial
  docs-only publication (`91f65ba7dd257c059c328e9cacdbe728806685b4`,
  run `https://github.com/jd-chiles/meta-inspector/actions/runs/40432010484`,
  succeeded). It validates documentation structure; no application or live Meta
  acceptance is claimed by it. As of this 2026-10-27 snapshot, no app-check CI
  run had been observed since scaffold/test files appeared; this is not a
  current CI status.
- Live smoke (`npm run test:live`): no executed evidence was present in this
  2026-10-27 snapshot; no Meta API key was provisioned in that observed checkout
  (names only in `.env.example`). This is a historical credential/evidence
  statement, not a claim about current configuration. Fixture success never
  counts as live.
- TASK-009 worker report (unexecuted diagnostic context, not verification
  evidence, from the 2026-10-27 scaffold snapshot): created
  `tests/unit/integration/flow.test.ts` (vitest races,
  storage tombstones, route boundaries 400/403/409/413/415/422, provider
  502/504, 429, SETUP_REQUIRED without fixture fallback, export honesty) and
  `tests/e2e/walkthrough.spec.ts` (360px fixture flow). All fixture-only
  synthetic bytes, no credentials. At that historical source state, the worker
  reported browser acceptance failing against the scaffold page (no wired
  capture/review/export test IDs). This is not a report about the current UI.
  No `npm run test:unit` or `npm run test:e2e` outcome was recorded for that
historical source snapshot; the worker report was not verification evidence.

### Independent review findings

None recorded. No native SDD code, QA, security, or gate review verdicts exist
in inspected state, and no Codex PR review with findings/resolution is on
record for the current tree. Codex automatic-review activation for the new
repository remains pending (see activation steps above). Green CI, when it
exists, proves neither live inference nor provider form confirmation.

### Real vs illustrative / new vs reused / setup / limitations

- Real vs illustrative (historical 2026-10-27 snapshot): the demo catalog was
  explicitly illustrative and did not claim a verified Form 1083 mapping.
  Since the project owner confirmed the form identity on 2026-10-29, the current
  product scope models all 11 owner-provided elements; exact printed-field
  transcription and provider acceptance remain unverified. See
  `docs/integration/FORM_1083_MAPPING.md`.
- New vs reused: new event-built work is `src/`, `tests/`,
  `fixtures/responses/fixture-draft.json`, `fixtures/README.md` contract,
  `docs/integration/FORM_1083_MAPPING.md`, `docs/evaluation/protocol.md`,
  `docs/evaluation/results.md`, and SDD artifacts. Pre-existing notes are
  `docs/PRODUCT_BRIEF.md`, `docs/RESEARCH.md`, `docs/DECISIONS.md`,
  `docs/BUILD_PLAN.md`, `IDEA.md`. No third-party media or tenant data added.
- Setup observation (historical 2026-10-27 snapshot): `.env.example` listed
  `META_API_KEY`, `META_MODEL=muse-spark-1.3`,
  `META_API_BASE_URL=https://api.meta.ai/v1`, and
  `APP_ANALYSIS_MODE=fixture`; no key was provisioned in that observed
  checkout. This does not describe current credentials or configuration.
- Remaining limitations recorded in that snapshot: unexecuted app checks,
  missing manifest/lockfile and runner configs in that tree, no live call, no
  provider confirmation, no independent reviews, no measured evaluation runs,
  and no completed-export claim. These are not current execution results.

### Readiness

At the 2026-10-27 snapshot, readiness was recorded as Not ready because that
snapshot lacked current passing evidence and independent reviews. This
historical record does not set readiness for the current checkout. `06-release.md`
is outside this task's owned paths and is left unchanged by this update.

### Historical UI/UX snapshot — 2026-10-29

This preserves the preceding responsive-flow implementation and check
snapshot. The 2026-10-30 results at the top of this file supersede its check
counts and first-run description. It does not edit or claim native SDD plugin
evidence.

- **Implemented:** Capture-first mobile flow with one prominent room prompt,
  four-item navigation, short Review summary, focused one-element assessment,
  separate Sign-Off/Export and Profile screens. Tablet widths through 959 px
  keep review summary/detail separate; from 960 px the desktop review uses
  side-by-side independently scrollable panes sized to the viewport. See
  `design-qa.md` and `artifacts/design-qa/flow-comparison-final.png`.
- **Commands:** `npm run lint` and `npm run typecheck` passed after component
  edits. The final `npm run build` passed and reported successful compilation,
  lint/type validation, static page generation, and trace collection.
  `node scripts/verify-sdd.mjs` passed after REQ-009 and TASK-109 were updated:
  15 requirements, 17 acyclic tasks, 7 named checks. `git diff --check` passed
  on the final working tree.
- **Manual browser evidence:** Chrome DevTools capture at 360 × 844 showed no
  horizontal scrolling and all four nav items within the viewport. At 390 ×
  844, Review summary fits the screen and the focused-review action bar sits
  above bottom navigation. At 768 × 900 the focused element scrolls within its
  own panel below sticky nav and the document remains 900 px high. At 1365 ×
  900 the review document also remains 900 px high with the two review panes
  side by side. Current screenshots are stored in `artifacts/design-qa/`.
- **At that snapshot:** `npm run test:unit`, `npm run test:e2e`, and
  `npm run test:live` were not rerun for that UI pass. The browser screenshots
  are manual visual/layout evidence, not suite results. The app status remained
  `Meta live · untested`.
- **Remaining release blockers:** provide a rights-cleared, consented 30-second
  staged room video and real phone recording session; validate the exact Form
  1083 transcription and recipient acceptance; validate native iOS/Android
  behavior; and record native SDD lifecycle evidence only when the native tools
  actually produce it. Codex owns implementation and local verification.
