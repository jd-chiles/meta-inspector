# Change log

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
