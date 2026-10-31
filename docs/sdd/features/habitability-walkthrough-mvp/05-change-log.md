# Change log

## UI overhaul + walkthrough guide — October 31, 2026 (Muse Code)

Visual overhaul of the Move-in Ready app within the pinned layout geometry (no box, spacing, or type-size changes; color/depth/typography only): dark camera-viewfinder empty state, refined cards/buttons/rows/nav, pulsing REC dot with reduced-motion guard, antialiased type. Added an always-available walkthrough guide: floating entry pill plus a 5-step checklist sheet (setup → film → review → sign-off → export) derived deterministically from saved progress, with jump actions; HUD route excluded. New tests: guide-model unit table (5), guide FAB/sheet browser spec (2). Verified: lint/typecheck clean, unit green, browser 19 passed / 2 skipped (fixture-only). No behavior, copy, testid, or layout-box changes to existing flows.

## Sprint slices 1, 2, 5 (agent parts) — October 31, 2026 (Muse Code)

Slice 1 audit: video picker offers/accepts video coherently (`video/mp4`, `video/quicktime`; camera input carries `capture="environment"`); HUD exit, acknowledgment migration, 11a/11b aggregate, conditional landlord date, and Add-note boundaries all have passing unit/browser coverage. The stills-picker iOS sheet quirk found earlier sits in orphaned code nothing mounts; left untouched. No Slice 1 code changes; no gaps demonstrated.

Slice 2 reliability repair: SAM per-concept calls now run with bounded overlap (max 3, order-preserving, fail-fast with sibling abort) instead of sequentially, addressing the reproducible kitchen 23 s clip timeout against the coded 150 s stage deadline; added elapsed ticker (aria-hidden) during segmenting/mapping and a pagehide keepalive cancel so a closed tab cannot wedge the session for the 15-minute lease. New tests: 2 server concurrency tests (overlap bounds/order, fail-fast abort) + 2 cancel-tracker unit tests. Verified: lint/typecheck clean, unit 388 passed / 3 skipped, browser 17 passed / 2 skipped (fixture-only), build green. No live call was made; kitchen wall-time improvement is unmeasured until an owner-initiated live attempt. Server per-request logging noted as follow-up, not implemented.

Slice 5 agent part: added `output: standalone`, root `Dockerfile` (FFmpeg 9.0.2 build stage + standalone run as non-root), `.dockerignore`. Verified: `docker build` succeeds; container serves 200 on `/`, `/manifest.webmanifest`, `/sw.js`; `/opt/ffmpeg/bin/ffmpeg` reports 9.0.2; process runs as `app`. Azure provisioning/execution remains an owner-operator step per the existing ACA plan. No task acceptance or native SDD evidence claimed; release stays Not ready.

## Tree unification + Slice 0 baseline verification — October 31, 2026 (Muse Code)

Unified the Codex worktree video app (Move-in Ready flow, room video, `/api/video/segment`, `/api/guide`, PDF/JSON exports, new suites) with the stills walkthrough and UI polish into this checkout; committed and pushed as `38d51d3` on `origin/main` with a clean tree. Executed checks on that exact tree, all observed this session: `node scripts/verify-sdd.mjs` passed (15 requirements, 11 active acyclic tasks, 7 named checks); `npm run lint` clean; `npm run typecheck` clean; `npm run test:unit` 384 passed / 3 skipped (22 files); `npm run build` green (routes `/`, `/api/analyze`, `/api/guide`, `/api/video/segment`); `npx playwright test` 17 passed / 2 skipped against a fresh loopback production server in fixture mode with provider keys scrubbed. No task acceptance, native SDD approval/evidence/review, live provider result, clip-gate score, device check, recipient acceptance, or deployment is claimed. Release stays Not ready.

## Epoch 3 rescope — 11-item Form 1083 + installable PWA — October 28, 2026

Documentation and planning pass only; no product implementation started. Owner-directed rescope for the November 4 hackathon deliverable. Epochs 1–2 implementation and all verification evidence preserved in history.

- 01-requirements rescoped to exactly 11 confirmed items (confirmation user-attested; version/source/verifier/date/wording/tests/sign-offs/output marked OPEN/TBD; LAHSA listing stays a working reference); REQ-007 extended (offline shell, saved progress, pending-while-offline queue); REQ-008 extended (PDF parity); new REQ-013 (installable PWA); HMIS/landlord/broader-sync explicitly later-phase.
- 02-design: PWA architecture (manifest, icons, shell-caching SW with trust boundaries, offline queue semantics), catalog v0.2 fail-closed TBD contract, PDF-via-print-CSS acceptance.
- 03-plan: reuse table (domain/session/UI/server/export/storage/tests reusable), five new tasks TASK-069–073 with estimates/deps/acceptance, fit flags, deferred list.
- 04-verification: REQ-013 row; 11-item, offline, reconnect-race, and PDF coverage; loopback-server workaround recorded.
- 00-request/06-release/07-retrospective aligned (release stays Not ready).
- Out-of-packet updates specified as deferred actions: README.md + IDEA.md pointers (implementation-phase docs tasks), Kanban board + worker prompts (owner-executed; external changes forbidden in this pass).

Record note: on October 28 the pre-existing entries below were accidentally overwritten during epoch-3 drafting and are restored here from cross-references in 06-release.md and 07-retrospective.md; substance verified against those records. No implementation or evidence was affected.

## TASK-041 READY promotion — October 27, 2026

Documentation-only update under TASK-041 (REQ-012). Input snapshot: `5f7c89129b9b984666e747caff47f385e6d2946e7d6a450ee3b8f044db530f73` (SDD revision 267, stage `implementing`). No product code, check, commit, publication, deployment, or live call is part of this change. Gate TASK-040 returned READY (passed) on the complete evidence chain; 06-release.md Status flipped from Not ready to Ready on that verdict; 07-retrospective.md closed with the final outcome (all reviews passed, one live call, single-call discipline, no publish/merge/deploy). Carried limitation: catalog remains illustrative demo; no provider confirmation, mapping, or pilot claim.

## TASK-036 live-smoke success — October 27, 2026

Documentation-only update under TASK-036 (REQ-012). Input snapshot: `5f7c89129b9b984666e747caff47f385e6d2946e7d6a450ee3b8f044db530f73` (SDD revision 250, stage `implementing`). No product code, approval, release-status promotion, commit, publication, deployment, or secret handling (key loaded from local `.env` into process env, never printed). Live-smoke success recorded in 06-release.md: coordinator-side `SMOKE_IMAGE=/tmp/live-smoke-detector.jpg npm run test:live`, exit 0 — model `muse-spark-1.3`, mode `live`, requestId `5b303073-787c-481d-8725-8c2b9a865666`, latencyMs `6108`, canonical sha256 `2c93bab0335436542c071f99c3eea08026d1e7866d7ac730dde160262ebdafba`, 3024x4032, item `demo-smoke-alarm`, one call only, no retries; self-test 18/18, fail-closed exit 1 without key, fresh build exit 0, six re-run checks passed at revision 248. Status stayed Not ready pending fresh QA/gate; provider gap open; no publish/merge/deploy claimed. 07-retrospective.md completed with live outcome and remaining QA/gate/provider gaps.

## Baseline 1 — October 26, 2026

Prepared request, twelve requirements, proposed architecture, ten implementation tasks, executable-check definitions and Codex/CI handoff. Existing project notes remain the product source. Resolved the form-version dependency by allowing an explicit illustrative catalog; provider confirmation still required for form-specific mapping claims. Proposed Next.js/TypeScript/local IndexedDB, a real server-only Meta adapter and printable HTML export as the smallest coherent implementation. No product code or live API call is part of this documentation/setup change. Setup validation (verify-sdd.mjs structural pass, ci-app.mjs docs-only report, plugin Config/TaskInput schema parse, CI guard fixtures) passed; no independent spec/plan review or approval fabricated.

## TASK-034 stale-record fix — October 27, 2026

Documentation-only update under TASK-034 (REQ-012) closing the stale-record blocker named by gate TASK-033 (NOT READY). Input snapshot: `975914a824c601ecaaa55bc8708aa9c3f54a6bb5906bdc71969b27534fd947c3` (SDD revision 235, stage `implementing`); observed evidence at SDD revision 228 on stable fingerprint `ee9df466771f0e906cf4a18a5699e03576d3454a52e7e9d55770fff69863b23c`. Recorded builder history (TASK-001–010 plus repairs, spec TASK-011, plan TASK-012), six green checks with red-command controls, honest live-smoke failure (no key, exit 1, no fixture substituted), code TASK-032 pass (2 info notes), security TASK-030 pass (1 low note), QA TASK-029 failed on credentials, gate TASK-033 NOT READY. 06-release.md kept Not ready with the three blockers; non-blocking notes accepted as backlog. No live success, confirmation, or publish/merge/deploy claimed.

## TASK-010 verification and readiness-gap record — October 27, 2026

Documentation-only update under TASK-010 (REQ-003, REQ-011, REQ-012). Source snapshot: `0318bbea7a44c20df9fda285897eef71cafb2b54c05a94d5ec10d8f34` (SDD revision 67, stage `implementing`). Wrote `docs/evaluation/results.md` (all cells unmeasured, sample size zero, fixture-only inputs, live pending, demo-only form status); extended `docs/REVIEW_AND_CI.md` with exact configured commands, two observed `docs`-check entries, absence of app checks, hosted docs-only CI run `40432010484` as the only CI success, no live smoke, no independent reviews, setup names only, Not-ready readiness. Release stayed Not ready; form status illustrative demo.

## 2026-10-29T21:38:41.564Z

Re-declare the active-worktree task graph TASK-103–TASK-110 after the runtime registry was recreated empty; no historical evidence from /home/hermes/workspace/meta-inspect is imported and no code checks run while Codex audits are in flight.

## 2026-10-29T23:46:45.562Z

Refresh the stale TASK-103 acceptance contract from the updated authored requirements; make mobile viewport fit measurable in REQ-009, TASK-109, and verification; preserve prior evidence/history and re-declare current TASK-103–TASK-110 from the feature tasks.json. No app code checks or source edits are included.

## 2026-10-30T00:02:22.224Z

Reconcile the two open non-blocking independent-review findings and correct stale TASK-103 dependency wording in authored SDD documents. Preserve all prior evidence/history, reset review baselines, and re-register active tasks with TASK-103 dependencies=[] before fresh spec/plan reviews. No application-source changes or code checks.

## 2026-10-30T00:14:21.275Z

Repair documentation-only QA boundaries and serialized phase ownership; assign measured Capture-fit implementation to frontend TASK-107, preserve legacy evidence/history, and require fresh independent spec/plan reviews without app work, checks, or approval.

## 2026-10-30T00:20:23.588Z

Plan TASK-113 active graph-aware docs validator repair before TASK-103–106, preserve all historical records/evidence, keep implementation and docs checks unexecuted, and obtain fresh spec/plan reviews without approval.

## 2026-10-30T00:22:55.069Z

Finalize TASK-113 ordered docs gate and align TASK-103 description with its new prerequisite before fresh read-only reviews; no validator, manifest or application implementation and no checks/approval.

## 2026-10-30T00:26:41.240Z

Correct only TASK-112 acceptance: TASK-103 depends on TASK-113 and historical TASK-069–073 are not active prerequisites. Preserve history/evidence and unchanged plan/requirements; obtain fresh independent reviews without implementation, checks or approval.

## 2026-10-30T00:29:23.596Z

Repair REQ-006/design schemaVersion omission: name schema version and catalog version separately across four authored artifacts and TASK-111. Preserve TASK-113 ordering/history/evidence; no implementation, checks or approval; fresh independent spec then plan reviews required.

## 2026-10-31

Requirement-first UX redesign: app opens on Inspection Home (next-step hero, stage progress, 11-requirement status list, room shortcuts) instead of the Capture form; bottom navigation gains Home. Capture is headed "Film the unit" with a next-room/checklist bar above the camera. Review is headed "Requirement checklist": ordered Form 1083 checklist with progress bar, continue-to-next-undecided, and an explicit "Use AI draft to pre-fill" action that fills editable fields only — the in-person acknowledgment and save stay evaluator actions, so no AI text completes a manual check. Headings/back-labels and e2e specs updated; new home-checklist-flow spec covers the sequence.
