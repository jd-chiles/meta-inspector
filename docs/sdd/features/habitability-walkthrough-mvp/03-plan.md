# Implementation plan

Baseline 1. Machine-readable task inputs are in tasks.json; each object matches the installed plugin's TaskInput contract. They are import inputs, not fabricated runtime state.

## Dependency graph

Tasks form a serial chain TASK-001 → TASK-002 → TASK-003 → TASK-004 → TASK-005 → TASK-006 → TASK-007 → TASK-008 → TASK-009 → TASK-010. This prevents shared manifest, entrypoint, fixture and UI ownership conflicts. Repartition only after a plan revision and review. Each task records requirements, difficulty/rationale, dependencies, owned files and check IDs.

## Tasks

- [ ] TASK-001 — Confirm catalog and Meta integration contracts

  Profile: architect; difficulty: medium; risk: medium.
  Requirements: REQ-001, REQ-003, REQ-010, REQ-011.
  Depends on: none.
  Ownership: `docs/integration`, `fixtures/README.md`.
  Checks: docs.
  Rationale: The active form and provider API contract are unresolved; separate illustrative mode from verified mappings.
  Acceptance: Record official Meta endpoint, model identifier, image payload/output schema and data-handling links with access dates. Document the demo catalog mode and provider-confirmation gate; do not fabricate form fields. Record credential availability without values; permit generic scaffold work while a live smoke is pending.

- [ ] TASK-002 — Scaffold app and executable verification

  Profile: implementer; difficulty: medium; risk: medium.
  Requirements: REQ-009, REQ-012.
  Depends on: TASK-001.
  Ownership: `package.json`, `package-lock.json`, `next.config.ts`, `next-env.d.ts`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `.env.example`, `.github/workflows/ci.yml`, `scripts/ci-app.mjs`.
  Checks: docs, lint, typecheck, build.
  Rationale: Establish the single shared manifest/lockfile and CI commands before component work.
  Acceptance: Pin compatible dependencies and Node 22; add lint, typecheck, test:unit, test:e2e, test:live, build, dev and start scripts. Make test:e2e start a production build server in fixture mode without a Meta key. CI runs actual required scripts; no passWithNoTests, optional scripts or swallowed errors. Keep API secrets out of client configuration and commit only .env.example names.

- [ ] TASK-003 — Implement catalog, evidence contracts and state reducer

  Profile: implementer; difficulty: medium; risk: medium.
  Requirements: REQ-001, REQ-004, REQ-005, REQ-006.
  Depends on: TASK-002.
  Ownership: `src/domain`, `src/data`, `tests/unit/domain`.
  Checks: typecheck, unit.
  Rationale: Domain rules control evidence integrity, reviews and stale responses.
  Acceptance: Versioned illustrative catalog has 3–4 items and at least one required manual test. Strict schemas reject malformed/extra/verdict fields and preserve required checks. Reducer ignores stale attempts and invalidates review after image/item changes; tests cover races and rejection.

- [ ] TASK-004 — Implement bounded media and Meta API path

  Profile: backend; difficulty: high; risk: high.
  Requirements: REQ-002, REQ-003, REQ-004, REQ-010.
  Depends on: TASK-003.
  Ownership: `src/app/api/analyze`, `src/server`, `fixtures/responses`, `tests/unit/api`, `tests/live`.
  Checks: typecheck, unit, live-smoke.
  Rationale: Untrusted uploads, decoder resource limits and paid upstream inference cross trust boundaries.
  Acceptance: Validate/decode/normalize image bytes with limits and metadata stripping; never fetch client URLs. Implement real configured Meta adapter and explicit fixture adapter without silent fallback. Enforce same-origin, timeout, cancellation, single-session inflight limits and safe errors. Use mocked HTTP for deterministic boundary tests; test:live fails clearly without credentials and records actual provider success separately.

- [ ] TASK-005 — Build local storage and guided capture

  Profile: frontend; difficulty: medium; risk: medium.
  Requirements: REQ-002, REQ-006, REQ-007, REQ-009.
  Depends on: TASK-004.
  Ownership: `src/storage`, `src/features/walkthrough/capture`, `src/features/walkthrough/session`, `src/app/page.tsx`, `tests/unit/storage`, `tests/unit/capture`.
  Checks: typecheck, unit.
  Rationale: Connect camera/file input with async persistence, replacement and deletion.
  Acceptance: Camera denial falls back to upload; preview/retake/cancel work at mobile width. IndexedDB refresh recovery, schema errors and quota failures expose explicit states. Delete and replace invalidate inflight responses and revoke media URLs; storage operations do not restore deleted records.

- [ ] TASK-006 — Implement worker review and manual-check UI

  Profile: frontend; difficulty: medium; risk: medium.
  Requirements: REQ-004, REQ-005, REQ-006, REQ-009.
  Depends on: TASK-005.
  Ownership: `src/features/walkthrough/review`, `src/features/walkthrough/session`, `src/app/page.tsx`, `tests/unit/review`.
  Checks: typecheck, unit.
  Rationale: Human control must remain independent of model suggestions and async state.
  Acceptance: Draft, unknowns, required checks and provenance remain visible together. Accept/edit/reject create revisions; accepting text cannot mark a physical test performed. Unresolved/rejected/loading/error states have keyboard-accessible recovery and mode labels.

- [ ] TASK-007 — Implement safe review-only printable export

  Profile: frontend; difficulty: medium; risk: medium.
  Requirements: REQ-005, REQ-006, REQ-008.
  Depends on: TASK-006.
  Ownership: `src/export`, `src/features/walkthrough/summary`, `src/app/page.tsx`, `tests/unit/export`.
  Checks: typecheck, unit.
  Rationale: Export must enforce review policy and avoid HTML injection or false completion.
  Acceptance: Export uses a stable snapshot, embeds normalized images, escapes text and repeats draft banner. Exclude unapproved draft text while listing pending/rejected/failed items as unresolved. Fixture/live and manual-check states remain visible; no HMIS approval or completed inspection claim.

- [ ] TASK-008 — Prepare rights-cleared fixtures and evaluation protocol

  Profile: documentation; difficulty: low; risk: low.
  Requirements: REQ-001, REQ-011.
  Depends on: TASK-007.
  Ownership: `fixtures/media`, `fixtures/evaluation`, `fixtures/README.md`, `docs/evaluation`, `docs/DEMO.md`.
  Checks: docs, unit.
  Rationale: Document a small reproducible mock set and measured outcomes without unsupported claims.
  Acceptance: Document provenance/license for mock inputs and separate development/evaluation sets. Provide three required scenarios and blank measurement sheet with missing values marked unmeasured. Demo script distinguishes qualitative feedback, fixture output and actual live inference.

- [ ] TASK-009 — Exercise integrated mobile and failure scenarios

  Profile: tests; difficulty: medium; risk: medium.
  Requirements: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012.
  Depends on: TASK-008.
  Ownership: `tests/e2e`, `tests/unit/integration`.
  Checks: docs, lint, typecheck, unit, browser, build.
  Rationale: API/state/storage/export boundaries need real browser proof beyond isolated tests.
  Acceptance: Browser tests cover 360px capture/upload, review, edit, rejection, manual checks and printable output. Delay fixture responses to verify retake/delete races; cover storage failure/reload, corrupt image, timeout, invalid output and missing key. Run CI without provider credentials using explicit fixtures; no skipped acceptance or zero-test passes.

- [ ] TASK-010 — Record verification and release readiness gaps

  Profile: documentation; difficulty: low; risk: low.
  Requirements: REQ-003, REQ-011, REQ-012.
  Depends on: TASK-009.
  Ownership: `README.md`, `docs/REVIEW_AND_CI.md`, `docs/integration`, `docs/evaluation`, `docs/sdd/features/habitability-walkthrough-mvp/05-change-log.md`, `docs/sdd/features/habitability-walkthrough-mvp/06-release.md`, `docs/sdd/features/habitability-walkthrough-mvp/07-retrospective.md`.
  Checks: docs, lint, typecheck, unit, browser, build, live-smoke.
  Rationale: Final documentation must describe only observed checks and remaining activation gates.
  Acceptance: Record exact commands, source revision, CI/live outcomes and independent review findings without invented success. Document real vs illustrative form status, new vs reused work, setup and remaining limitations. Mark Ready only after current required checks and independent reviews pass; publish/deploy remain separate.

## Gates and execution

Before implementation, use the plugin to obtain current independent spec and plan reviews and the required user approval. Do not self-approve. Existing run state was initialized through the installed plugin's initialize function at draft stage; do not hand-edit .sdd/state, evidence or runtime records.

TASK-002 creates the commands referenced by future checks. Docs validation runs now. Application commands fail until their implementations exist; this is expected and must not be replaced by no-op checks. Credential-dependent live-smoke is intentionally separate from secret-free PR CI and is required before claiming the submitted workflow uses a real Meta model.

After implementation, obtain independent code, QA, security (for high-risk backend/workflow changes) and final gate review against the current source. Codex PR review complements, but does not automatically create, the SDD plugin's own recorded review verdicts.

No task authorizes publishing, committing, merging or deploying. Record form confirmation and actual live-call gaps explicitly. Illustrative catalog mode can remain the demo mode; do not fabricate provider approval.
