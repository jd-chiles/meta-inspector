# Production MVP roadmap — Move-in Ready

## Objective and boundary

Launch a limited, reviewable production MVP for staged/mock-unit LAHSA Form 1083 walkthroughs. A worker records room videos, reviews unreviewed AI observations against source evidence, makes every inspection decision, signs, and downloads local files for the existing manual process. The MVP does not submit to HMIS or LAHSA, deliver landlord notices, make automated inspection decisions, or replace HQS inspection. Public deployment without authentication is out of scope.

This roadmap sequences the active SDD tasks; it does not mark tasks accepted or change native SDD status. Read `AGENTS.md`, `docs/PRODUCT_BRIEF.md`, `docs/DECISIONS.md`, and `docs/sdd/features/habitability-walkthrough-mvp/00-request.md` through `04-verification.md` before implementation.

## Current starting point

The main product surfaces and supporting code are present, including the mobile Capture/Review/Sign-Off flow, room-video storage and normalization, server-side SAM/Muse routes, evaluator-only decisions, local exports, and broad unit/browser coverage. Presence is not acceptance: all active tasks `TASK-103` through `TASK-113` remain unchecked in the plan, and the current dirty tree has not been verified against the checks listed below. The last recorded green local check set is a prior snapshot and must not be treated as current.

The owner supplied staged/mock kitchen and bathroom clips and authorized live processing. One kitchen request timed out with HTTP 504 after about 211 seconds. The bathroom segment endpoint returned HTTP 200 after about 93 seconds, but its browser request was canceled before the result was saved; Muse mapping and the quality scorecard were not completed. The current gate record is `docs/evaluation/video-clip-gate.md`.

## Ordered delivery slices

| Slice | Goal | SDD alignment | Exit criteria |
|---|---|---|---|
| 0. Establish a trustworthy baseline | Preserve the shared dirty worktree, inspect its diffs, identify stale results, and verify the active SDD graph before changing code. | TASK-113 | `node scripts/verify-sdd.mjs` and focused validator tests pass on the current tree; current lint, typecheck, unit, browser, and build results are recorded. Failures are fixed at their cause. No native state/evidence is edited. |
| 1. Complete the worker walkthrough | Verify the whole local path: intake/funding route, four room clips, recovery/replacement/removal, 11-element review, independent evaluator checks, sign-off, and gated local exports. Repair only demonstrated gaps in the existing implementation. | TASK-103–TASK-108; REQ-001–REQ-009, REQ-013–REQ-015 | Current browser and unit checks cover the real UI flow, async identity, deletion/recovery, HUD exit, human-only decisions, and export restrictions. No model output creates an evaluator decision or completed result. |
| 2. Make live video processing reliable | Diagnose the kitchen timeout and bathroom response/cancel path. Improve bounded progress, timeout/error handling, cancellation cleanup, and user-initiated retry without duplicate billed requests or silent fixture fallback. Keep keys/provider bodies server-side and use the existing browser Mediabunny plus server FFmpeg design unless evidence requires a change. | TASK-106, TASK-108; REQ-002–REQ-006, REQ-010 | Mocked tests prove success, timeout, abort, replacement, and stale-response behavior. A deliberate live attempt, if needed, is initiated by the user after a fix and is reported separately from fixture tests. |
| 3. Pass the real evidence gate | Score source frames for faucet, fan, lock, detector, all 11 mappings, timestamp/still identity, and indoor-light misses; revise prompts or behavior from observed misses, then rescore. | TASK-110; REQ-003, REQ-004, REQ-011 | The evaluator can open the exact source still/time for each proposal; uncertain or unsupported items remain needs-human-check; scorecard records observed evidence and misses. The gate stays open until these conditions are met. |
| 4. Accept the form and exports | Compare supported fields with the unchanged official Form 1083, verify the 11a/11b split, signatures, corrections/dates, printable escaping, and each local file. Obtain recipient/agency acceptance for the manual outputs. | TASK-107–TASK-109; REQ-001, REQ-005, REQ-008, REQ-015 | Human-confirmed content only appears in the appropriate export. Blank mock identity/address fields and manual-upload notices remain clear. The receiving workflow accepts the files; no direct integration is implied. |
| 5. Validate actual phones and operating conditions | Exercise camera permission, capture/upload, codecs, MOV packet-copy normalization, safe areas, offline recovery, and persistence on physical iOS Safari and Android devices. Review data retention, provider disclosure, access control, deployment secrets, and support/incident handling for a limited pilot. | TASK-105, TASK-109; REQ-002, REQ-007, REQ-009, REQ-010, REQ-013 | Both target phone platforms complete the worker walkthrough. A deployment target, authenticated access, retention policy, and operational owner are documented before any production exposure. |
| 6. Release decision | Obtain fresh independent spec/plan/code/security/QA/gate reviews and record native SDD evidence only through supported tooling. | TASK-111–TASK-113; REQ-011–REQ-012 | Required current checks and reviews are recorded; the real clip gate, device checks, form acceptance, and deployment controls are closed. Otherwise release remains **Not ready**. |

## Immediate blockers and decisions

- The current live path is too slow or does not return a usable result to the browser: one request timed out and the other was canceled before saving. Do not hide this with fixture output or rerun automatically.
- The supplied clips did not produce a saved candidate or Muse draft. Their analyzed durations were about 23.1 seconds for kitchen and 9.7 seconds for bathroom. The authored gate currently describes a single clip of 30 seconds or less that demonstrates faucet, fan, lock, and detector; this two-room set is about 32.8 seconds combined, and the inspected moments do not establish lock or detector coverage. Preserve the gate as unmeasured until the owner provides footage matching it or the authorized SDD requirements are deliberately updated to define a room-based evaluation set.
- The app server and Tailscale daemon are not running in this worktree as of 2026-10-31. The tailnet preview is unavailable until deliberately restarted; it is not a production deployment.
- Exact recipient acceptance, physical phone behavior, production hosting/authentication/retention controls, current full-suite checks, independent reviews, and native SDD evidence remain open.

## Verification commands

Run in the current checkout and report exact results. The live provider check is separate; do not run it as a substitute for local checks or the scored video gate.

```sh
node scripts/verify-sdd.mjs
npm run lint
npm run typecheck
npm run test:unit
npm run test:e2e
npm run build
npm run test:live
```

The configured browser command builds the app before Playwright. Use staged/mock-unit media and pseudonyms only. Do not publish, deploy, or promote a release as part of these slices without the owner's separate direction.
