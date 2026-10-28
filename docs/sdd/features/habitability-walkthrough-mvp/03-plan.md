# Implementation plan

Baseline 1. Machine-readable task inputs are in tasks.json; each object matches the installed plugin's TaskInput contract. They are import inputs, not fabricated runtime state.

## Dependency graph

Tasks form a serial chain TASK-001 → TASK-002 → TASK-003 → TASK-004 → TASK-005 → TASK-006 → TASK-007 → TASK-008 → TASK-009 → TASK-010. This prevents shared manifest, entrypoint, fixture and UI ownership conflicts. Repartition only after a plan revision and review. Each task records requirements, difficulty/rationale, dependencies, owned files and check IDs.

## Tasks

- [x] TASK-001 — Confirm catalog and Meta integration contracts

  Profile: architect; difficulty: medium; risk: medium.
  Requirements: REQ-001, REQ-003, REQ-010, REQ-011.
  Depends on: none.
  Ownership: `docs/integration`, `fixtures/README.md`.
  Checks: docs.
  Rationale: The active form and provider API contract are unresolved; separate illustrative mode from verified mappings.
  Acceptance: Record official Meta endpoint, model identifier, image payload/output schema and data-handling links with access dates. Document the demo catalog mode and provider-confirmation gate; do not fabricate form fields. Record credential availability without values; permit generic scaffold work while a live smoke is pending.
  Status: passed. Wrote docs/integration/FORM_1083_MAPPING.md and fixtures/README.md; docs check passed.

- [x] TASK-002 — Scaffold app and executable verification

  Profile: implementer; difficulty: medium; risk: medium.
  Requirements: REQ-009, REQ-012.
  Depends on: TASK-001.
  Ownership: `package.json`, `package-lock.json`, `next.config.ts`, `next-env.d.ts`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `.env.example`, `.github/workflows/ci.yml`, `scripts/ci-app.mjs`.
  Checks: docs, lint, typecheck, build.
  Rationale: Establish the single shared manifest/lockfile and CI commands before component work.
  Acceptance: Pin compatible dependencies and Node 22; add lint, typecheck, test:unit, test:e2e, test:live, build, dev and start scripts. Make test:e2e start a production build server in fixture mode without a Meta key. CI runs actual required scripts; no passWithNoTests, optional scripts or swallowed errors. Keep API secrets out of client configuration and commit only .env.example names.
  Status: passed (app shell slice; manifest completed by TASK-013 after ownership split).

- [x] TASK-003 — Implement catalog, evidence contracts and state reducer

  Profile: implementer; difficulty: medium; risk: medium.
  Requirements: REQ-001, REQ-004, REQ-005, REQ-006.
  Depends on: TASK-002.
  Ownership: `src/domain`, `src/data`, `tests/unit/domain`.
  Checks: typecheck, unit.
  Rationale: Domain rules control evidence integrity, reviews and stale responses.
  Acceptance: Versioned illustrative catalog has 3–4 items and at least one required manual test. Strict schemas reject malformed/extra/verdict fields and preserve required checks. Reducer ignores stale attempts and invalidates review after image/item changes; tests cover races and rejection.
  Status: passed (4-item demo catalog, strict schemas, pure reducer, 24 unit tests).

- [x] TASK-004 — Implement bounded media and Meta API path

  Profile: backend; difficulty: high; risk: high.
  Requirements: REQ-002, REQ-003, REQ-004, REQ-010.
  Depends on: TASK-003.
  Ownership: `src/app/api/analyze`, `src/server`, `fixtures/responses`, `tests/unit/api`, `tests/live`.
  Checks: typecheck, unit, live-smoke.
  Rationale: Untrusted uploads, decoder resource limits and paid upstream inference cross trust boundaries.
  Acceptance: Validate/decode/normalize image bytes with limits and metadata stripping; never fetch client URLs. Implement real configured Meta adapter and explicit fixture adapter without silent fallback. Enforce same-origin, timeout, cancellation, single-session inflight limits and safe errors. Use mocked HTTP for deterministic boundary tests; test:live fails clearly without credentials and records actual provider success separately.
  Status: passed (validation, server-only adapter, analyze route, 20 mocked-HTTP tests; live-smoke honestly blocked without credentials).

- [x] TASK-005 — Build local storage and guided capture

  Profile: frontend; difficulty: medium; risk: medium.
  Requirements: REQ-002, REQ-006, REQ-007, REQ-009.
  Depends on: TASK-004.
  Ownership: `src/storage`, `src/features/walkthrough/capture`, `src/features/walkthrough/session`, `src/app/page.tsx`, `tests/unit/storage`, `tests/unit/capture`.
  Checks: typecheck, unit.
  Rationale: Connect camera/file input with async persistence, replacement and deletion.
  Acceptance: Camera denial falls back to upload; preview/retake/cancel work at mobile width. IndexedDB refresh recovery, schema errors and quota failures expose explicit states. Delete and replace invalidate inflight responses and revoke media URLs; storage operations do not restore deleted records.
  Status: passed (IndexedDB + tombstones, session manager, accessible capture, 15 tests).

- [x] TASK-006 — Implement worker review and manual-check UI

  Profile: frontend; difficulty: medium; risk: medium.
  Requirements: REQ-004, REQ-005, REQ-006, REQ-009.
  Depends on: TASK-005.
  Ownership: `src/features/walkthrough/review`, `src/features/walkthrough/session`, `src/app/page.tsx`, `tests/unit/review`.
  Checks: typecheck, unit.
  Rationale: Human control must remain independent of model suggestions and async state.
  Acceptance: Draft, unknowns, required checks and provenance remain visible together. Accept/edit/reject create revisions; accepting text cannot mark a physical test performed. Unresolved/rejected/loading/error states have keyboard-accessible recovery and mode labels.
  Status: passed (review revisions, manual-check rules, reanalyze invalidation, 14 tests).

- [x] TASK-007 — Implement safe review-only printable export

  Profile: frontend; difficulty: medium; risk: medium.
  Requirements: REQ-005, REQ-006, REQ-008.
  Depends on: TASK-006.
  Ownership: `src/export`, `src/features/walkthrough/summary`, `src/app/page.tsx`, `tests/unit/export`.
  Checks: typecheck, unit.
  Rationale: Export must enforce review policy and avoid HTML injection or false completion.
  Acceptance: Export uses a stable snapshot, embeds normalized images, escapes text and repeats draft banner. Exclude unapproved draft text while listing pending/rejected/failed items as unresolved. Fixture/live and manual-check states remain visible; no HMIS approval or completed inspection claim.
  Status: passed (snapshot policy gate, escaping, embed bounds, banner, 9 tests).

- [x] TASK-008 — Prepare rights-cleared fixtures and evaluation protocol

  Profile: documentation; difficulty: low; risk: low.
  Requirements: REQ-001, REQ-011.
  Depends on: TASK-007.
  Ownership: `fixtures/media`, `fixtures/evaluation`, `fixtures/README.md`, `docs/evaluation`, `docs/DEMO.md`.
  Checks: docs, unit.
  Rationale: Document a small reproducible mock set and measured outcomes without unsupported claims.
  Acceptance: Document provenance/license for mock inputs and separate development/evaluation sets. Provide three required scenarios and blank measurement sheet with missing values marked unmeasured. Demo script distinguishes qualitative feedback, fixture output and actual live inference.
  Status: passed (provenance manifest, three scenarios, blank sheet, demo script).

- [x] TASK-009 — Exercise integrated mobile and failure scenarios

  Profile: tests; difficulty: medium; risk: medium.
  Requirements: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012.
  Depends on: TASK-008.
  Ownership: `tests/e2e`, `tests/unit/integration`.
  Checks: docs, lint, typecheck, unit, browser, build.
  Rationale: API/state/storage/export boundaries need real browser proof beyond isolated tests.
  Acceptance: Browser tests cover 360px capture/upload, review, edit, rejection, manual checks and printable output. Delay fixture responses to verify retake/delete races; cover storage failure/reload, corrupt image, timeout, invalid output and missing key. Run CI without provider credentials using explicit fixtures; no skipped acceptance or zero-test passes.
  Status: passed (integration flow tests + 15 Playwright specs, all green on a fresh production build).

- [x] TASK-010 — Record verification and release readiness gaps

  Profile: documentation; difficulty: low; risk: low.
  Requirements: REQ-003, REQ-011, REQ-012.
  Depends on: TASK-009.
  Ownership: `README.md`, `docs/REVIEW_AND_CI.md`, `docs/integration`, `docs/evaluation`, `docs/sdd/features/habitability-walkthrough-mvp/05-change-log.md`, `docs/sdd/features/habitability-walkthrough-mvp/06-release.md`, `docs/sdd/features/habitability-walkthrough-mvp/07-retrospective.md`.
  Checks: docs, lint, typecheck, unit, browser, build, live-smoke.
  Rationale: Final documentation must describe only observed checks and remaining activation gates.
  Acceptance: Record exact commands, source revision, CI/live outcomes and independent review findings without invented success. Document real vs illustrative form status, new vs reused work, setup and remaining limitations. Mark Ready only after current required checks and independent reviews pass; publish/deploy remain separate.
  Status: passed (gaps recorded; release stays Not ready pending live smoke, provider confirmation, and final reviews).

## Repair follow-ups (owned-file subsets; no weakened assertions)

- [x] TASK-013 — Scaffold manifest, configs and CI workflow (implementer). Native file-ownership rules exclude only .sdd/.git/.opencode/.env*, so this task owns package.json, lockfile, configs and scripts; .env.example (names-only) was created by the coordinator and the pre-existing CI workflow needed no edit.
- [x] TASK-014 — Static type/lint mismatches across workers (implementer, bugFix).
- [x] TASK-015 — Export renderer undefined-field crash (implementer, bugFix).
- [x] TASK-016 — Session/storage race invalidation codes (implementer, bugFix).
- [x] TASK-017 — Meta adapter credential-boundary logging and abort timing (backend, bugFix).
- [x] TASK-018 — Route helper moved out of Next.js route module (backend, bugFix).
- [x] TASK-019 — Export snapshot hostile-text path (implementer, bugFix).
- [x] TASK-020 — Stale route imports and edit disposition (implementer, bugFix).
- [x] TASK-021 — Export escaping gap and delete-race code (implementer, bugFix).
- [x] TASK-022 — Page composition from built components incl. granted src/app/flow.tsx client island (frontend).
- [x] TASK-023 — tsc artifact noise, test pre-state alignment, escaping assertion correction (implementer, bugFix).
- [x] TASK-024 — Same-origin loopback-alias gate fix with regression tests (backend, bugFix).
- [x] TASK-025 — Live session snapshots pushed to the UI (frontend, bugFix).
- [x] TASK-026 — Ref-object misuse in analyze serialization (implementer, bugFix).
- [x] TASK-027 — Deduplicated failure error reporting (frontend, bugFix).

## Gates and execution

Before implementation, use the plugin to obtain current independent spec and plan reviews and the required user approval. Do not self-approve. Existing run state was initialized through the installed plugin's initialize function at draft stage; do not hand-edit .sdd/state, evidence or runtime records.

TASK-002 creates the commands referenced by future checks. Docs validation runs now. Application commands fail until their implementations exist; this is expected and must not be replaced by no-op checks. Credential-dependent live-smoke is intentionally separate from secret-free PR CI and is required before claiming the submitted workflow uses a real Meta model.

After implementation, obtain independent code, QA, security (for high-risk backend/workflow changes) and final gate review against the current source. Codex PR review complements, but does not automatically create, the SDD plugin's own recorded review verdicts.

No task authorizes publishing, committing, merging or deploying. Record form confirmation and actual live-call gaps explicitly. Illustrative catalog mode can remain the demo mode; do not fabricate provider approval.

## Catch-up amendment — October 28, 2026

**Status: proposed execution amendment; not yet registered or approved by SDD Autopilot.** Do not hand-edit plugin state or evidence. The coordinator should register any repair task and obtain the required plan review/approval before implementation. No new TASK ID is assigned here.

### Objective and scope

Target an integrated release candidate by Friday, October 30, leaving the following days for current-snapshot reviews, demo rehearsal, and submission. The user is unavailable Thursday, October 29, so no critical work may depend on that day. The [official event page](https://dev.meta.ai/events/global-hackathon) currently lists project submissions due November 4 at 9:00 PM ET (6:00 PM Pacific); recheck the portal before submission because dates may change.

Do not restart completed implementation tasks or add stretch features. Keep the clearly labeled illustrative catalog: provider confirmation is required before claiming a Form 1083 mapping or real pilot, but it is not a blocker to finishing the demo-only prototype. Keep TASK-004's historical result intact; record the newly discovered REQ-002 gap as a separate Autopilot repair task that supersedes its acceptance for the current snapshot.

### Critical path — complete the major implementation chunk today

1. **Autopilot coordinator, morning:** register one high-risk repair task mapped to REQ-002 and REQ-010, with owned server/media and focused test paths. Acceptance must require actual pixel decoding and transformation: apply JPEG EXIF orientation before removing orientation metadata; resize pixel data to a 1600px longest edge; validate decoded dimensions/resource limits for JPEG, PNG, and WebP; compute the digest from the canonical transformed bytes; ensure the provider request and locally persisted/returned media use those same canonical bytes; and return a safe actionable failure while preserving prior evidence when decoding or normalization fails. Tests must prove the route uses the resampler and cover orientation, resize, corrupt/oversized input, output dimensions, metadata removal, digest identity, and encoded response limits.
2. **Backend implementer, today:** implement the repair in an isolated worktree with exclusive ownership of `src/server/media`, the analyze path, and the assigned media/API tests. Do not modify SDD runtime/evidence or unrelated UI paths.
3. **Coordinator, today:** integrate the repair and run focused media/API tests first. If they pass, run `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:e2e`, and `npm run build` on one integrated snapshot. Triage only failures introduced or exposed by this repair. If current-snapshot live proof is required after the request-image path changes, perform one deliberate smoke call only after the local suite passes; no automatic retry and no fixture substitution.
4. **Documentation/PM lane, parallel today:** audit `docs/DEMO.md`, `docs/RUNBOOK.md`, and the release notes for stale credential/live-smoke, release-readiness, and Form 1083 statements. Prepare corrections without editing `.sdd/state`, `.sdd/evidence`, or claiming a review/gate. Apply final factual wording only after the coordinator confirms current evidence.

**End-of-day milestone (October 28):** repaired image path integrated; focused tests and the full configured local suite pass on one fingerprint, or a short concrete blocker list exists with no scope expansion. Save the exact fingerprint and check outcomes for the review pass. No planned work on October 29.

### Closeout and submission buffer

- **Friday, October 30:** finish any narrowly scoped repair needed to meet the acceptance criteria; rerun affected checks and, if source changes, the full suite on the new fingerprint. Obtain fresh code, QA, and security reviews against that exact snapshot, then a final Autopilot gate. Reconcile release/docs status from those results. Do not carry the prior READY verdict forward automatically.
- **Saturday–Monday, October 31–November 2:** freeze features. Rehearse the three-minute capture-to-review story with the demo label, uncertainty, manual check, worker decision, and accurate fixture/live mode. Prepare a labeled live take if the verified route supports it and keep the fixture take as an honestly labeled backup. Complete repo, contributor, reuse/new-work, and submission-link checks.
- **Tuesday, November 3:** submission rehearsal and final source/evidence freeze. No feature changes after the final checks unless a blocking defect is found; any such fix restarts affected checks and reviews.
- **Wednesday, November 4:** submit with a buffer before the currently listed 6:00 PM Pacific deadline; confirm the official portal's deadline and required fields first.

### Agent coordination

Use one coordinator for SDD registration, integration, evidence, and release status. Keep the backend repair and the documentation audit in separate worktrees with disjoint file ownership. Documentation work must not rewrite historical review results or plugin records. Independent reviewers are read-only and start after integration on the frozen fingerprint. The current `concurrency: 1` remains in force unless Autopilot formally revises the plan and ownership; do not increase it as a substitute for resolving file conflicts.
