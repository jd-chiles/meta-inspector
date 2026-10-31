# Muse Code handoff — production MVP sprint

## Handoff status

The owner asked on 2026-10-31 for Muse Code to try to finish the sprint toward a production MVP. No Muse Code dispatcher/connector is available in this Codex session, so this document is a paste-ready handoff for the owner to open in Muse Code. It does not claim Muse Code has started or that any SDD task has passed.

Repository: `/home/hermes/.codex/worktrees/11c3/meta-inspect`

The shared checkout is heavily modified and uncommitted, and `git branch --show-current` returned no branch name. Do not reset, clean, checkout over, or rebase this worktree. Inspect `git status` and diffs first. Source and tests for most of the active task graph are already present; verify and repair them instead of rebuilding the app from scratch. All active tasks `TASK-103` through `TASK-113` are still unchecked in the authored plan.

As of this handoff, no app dev server or Tailscale daemon is running. The app is not currently phone-accessible, and there is no production deployment. Start a local preview only if needed and keep it bound to the intended interface.

## Read first

1. `AGENTS.md`
2. `docs/PRODUCTION_MVP_ROADMAP.md`
3. `docs/PRODUCT_BRIEF.md` and `docs/DECISIONS.md`
4. `docs/sdd/features/habitability-walkthrough-mvp/00-request.md` through `04-verification.md`
5. `docs/evaluation/video-clip-gate.md`, `docs/REVIEW_AND_CI.md`, and `design-qa.md`

Follow `docs/sdd/features/habitability-walkthrough-mvp/03-plan.md` and `tasks.json` in dependency order. Keep requirement/task mappings current. The first implementation gate is TASK-113: validate the active graph and focused validator tests before accepting TASK-103–TASK-106. The main code areas already present include `src/features/walkthrough/`, `src/domain/`, `src/app/api/video/`, `src/server/video/`, `src/export/`, and their unit/browser tests.

## Latest real clip attempt

The owner confirmed both clips were from a staged/mock unit and explicitly authorized their use with provider APIs. No raw clips or credentials belong in the repository.

Metadata-stripped MP4 remuxes from the attempted run are still present on this
host at `/tmp/kitchen-clean.mp4` and `/tmp/bathroom-clean.mp4` (about 43.3 MB
and 15.7 MB). These are temporary files, not repository fixtures; verify they
still exist before use. The owner's consent covers these clips, but any further
provider request must be a fresh explicit analysis action after a code change,
not a background or automatic retry.

- Kitchen: live segment request returned HTTP 504 after approximately 210.9 seconds. No draft was substituted.
- Bathroom: the segment endpoint returned HTTP 200 after approximately 92.6 seconds. The browser request was then canceled/aborted before the result was saved. The app did not perform Muse mapping and no review proposal or scorecard result was produced.
- No automatic retry was made. Do not claim successful mapping or provider quality from the segment response alone.
- Current footage is two room clips totaling approximately 32.8 seconds, while the authored evaluation gate requires one clip of no more than 30 seconds showing faucet, fan, lock, and detector. The observed frames show kitchen/bath fixtures, but do not establish lock/detector coverage. Keep the scorecard open and surface this scope/input mismatch rather than changing the gate silently.

## Work order

Use the ordered slices and exit criteria in `docs/PRODUCTION_MVP_ROADMAP.md`. Start with the current-tree baseline, then finish and verify the local worker walkthrough, repair the slow/cancelled video path, complete the real evidence evaluation, verify form/export acceptance, test physical phones, and close deployment/review gates. Keep the MVP local/manual for HMIS and LAHSA; there is no direct submission feature.

Do not initiate further billed/live calls automatically. After a code fix, use local mocked tests first. Any new provider attempt must be a fresh explicit analysis action using the already-authorized staged/mock-unit footage and must be reported separately from fixture and CI checks. Do not use real participant/HMIS data.

## Paste-ready kickoff prompt

> Finish the owner-authorized production-MVP sprint in `/home/hermes/.codex/worktrees/11c3/meta-inspect`. Read `AGENTS.md`, `docs/PRODUCTION_MVP_ROADMAP.md`, `docs/PRODUCT_BRIEF.md`, `docs/DECISIONS.md`, and the feature SDD request through verification plan before changing behavior. The checkout is shared, heavily dirty, and currently has no branch name; inspect status/diffs and preserve every existing change. Work through active tasks in dependency order, beginning with TASK-113 and its docs/focused-unit acceptance; most implementation files already exist, so audit and repair rather than scaffold again. Use mock-unit data only. Preserve exact media/session/schema/catalog identity across async work; AI text stays an unreviewed proposal, evaluator decisions/signature remain human-only, and exports remain local/manual. Latest real clip attempt: kitchen timed out with 504 at ~210.9s; bathroom segment returned 200 at ~92.6s but the browser request was canceled before saving; Muse mapping and quality scoring did not occur. Do not auto-retry or claim quality. Keep `.sdd/state` and `.sdd/evidence` untouched; do not fabricate task approvals, review, CI, provider, recipient, device, or release results. Run the configured checks on the current tree and report exact commands/outcomes. Do not publish or deploy; keep release Not ready until all roadmap gates are actually satisfied.

## Completion report expected

Return changed files, completed active task IDs with evidence, exact checks and results, remaining blockers, and any owner decision needed. Leave native SDD approval/evidence untouched unless its supported tools actually record it. Keep release status Not ready while any required quality, device, form/recipient, deployment, review, or native-evidence gate remains open.
