# Implementation plan — 11 items + PWA (epoch 3)

Epochs 1–2 delivered a verified 3–4-item fixture walkthrough (all builders passed; 6/6 epoch-2 checks green on `ca373d3f`; code/qa/security passed). This plan reuses that implementation and adds the epoch-3 delta for November 4. No product implementation starts until this plan is reviewed and checkpointed.

## Reuse analysis (no rewrite)

| Existing capability | Reuse for 11-item + PWA | New work |
|---|---|---|
| Domain schemas/reducer (`src/domain/`) | Catalogue/evidence shapes already parametric in item lists; extend item count, not logic | None (audit only) |
| Session manager (`session.ts`) | Attempt/generation/pending machinery covers offline queue semantics | Offline queue states + explicit sync action |
| Capture/review UI | Item-driven components render N items unchanged | PWA install affordance; pending/offline banners |
| Server adapter/validation | Unchanged trust boundary | None |
| Export snapshot + print CSS | Snapshot already item-generic | PDF acceptance (same policy) |
| Storage (IndexedDB) | Saved progress rides on existing store | Schema bump only if fields required |
| Tests (129 unit + 15 browser) | Patterns reused; fixtures extended | 11-item + PWA offline + PDF cases |
| walkthrough.css | Adopted epoch 2, verified | None |

Estimated added work: catalog contract + data (S), PWA shell/SW/offline (M), PDF acceptance (S), verification expansion (M), demo/release/docs pointers (S). All fit November 4 except provider-detail mapping (blocked on OPEN details — tracked, not scheduled).

## Dependency graph (new tasks only; epoch 1–2 history preserved)

Serial where ownership overlaps; PWA and catalog proceed in parallel under concurrency 1 in task-ID order:

TASK-069 (catalog contract v0.2) → TASK-071 (catalog data x11 + fixtures) → TASK-072 (verification expansion) → TASK-073 (demo/release/docs pointers).
TASK-070 (PWA shell + offline) → TASK-072.
TASK-080 (repair lint + gate, depends 070+072) → rerun checks. TASK-081 (verify-script alignment, depends 073). TASK-082 (lint leftover + loopback bind, depends 080).

Reviewers run first (read-only): spec → plan → implementation → verifying. Reviewer tasks carry no writable files by design; scripts/verify-sdd.mjs exempts reviewer profiles from the ownership assert.

## Tasks

- [x] TASK-069 — Catalog contract v0.2 (11 items, OPEN mapping blocks)
  Architect. Requirements: REQ-001, REQ-011. Files: 02-design.md (catalog section), src/data/catalog.demo.json (contract shape only — data values in TASK-071). Acceptance: 11 stable IDs; OPEN fields optional-but-fail-closed; demo label retained.
- [x] TASK-070 — PWA shell: manifest, icons, service worker, offline pending
  Frontend, medium. Requirements: REQ-007, REQ-009, REQ-013. Files: public/manifest.webmanifest, public/sw.js, src/features/walkthrough/offline.ts. Acceptance: installable; offline shell loads with saved progress; analyses queue as pending, never auto-verdict; SW never caches evidence/keys/media.
- [x] TASK-071 — Catalog data x11 plus rights-cleared fixtures
  Implementer, medium. Depends on: TASK-069. Requirements: REQ-001, REQ-002, REQ-011. Files: src/data/catalog.demo.json, fixtures/README.md, fixtures/media. Acceptance: 11 items load; official wording left OPEN and verbatim-labeled; fixtures manifest current.
- [x] TASK-072 — Verification expansion (11-item, PWA offline, PDF)
  Tests, medium. Depends on: TASK-070, TASK-071. Requirements: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012, REQ-013. Files: tests/unit/catalog-11.test.ts, tests/e2e/pwa-offline.spec.ts, tests/e2e/catalog-11.spec.ts. Acceptance: new behavioral tests fail without the feature; no weakened assertions; PDF/export parity covered.
- [x] TASK-073 — Demo script, release notes, README/IDEA pointers
  Documentation, low. Depends on: TASK-069, TASK-070, TASK-071, TASK-072. Requirements: REQ-011, REQ-012. Files: docs/DEMO.md, docs/sdd/features/habitability-walkthrough-mvp/06-release.md, README.md, IDEA.md. Acceptance: demo claims match executed evidence; README/IDEA point at the approved SDD revision + task IDs; IDEA.md stays historical. (Kanban board + worker prompts are owner-executed external updates, listed here as deferred actions, not SDD files.)
- [x] TASK-074 — Spec review (superseded failed review, repaired via TASK-076; closed historical)
  Spec-reviewer. Requirements: REQ-001, REQ-003, REQ-004, REQ-006, REQ-010, REQ-011, REQ-013. Acceptance: blocking contradiction recorded; no edits, no shell.
- [x] TASK-075 — Plan review (dead, pending on superseded TASK-074; replaced by TASK-077; closed historical)
  Plan-reviewer. Depends on: TASK-074. Requirements: REQ-001–REQ-013. Acceptance: superseded; no edits, no shell.
- [x] TASK-076 — Spec re-review after confirmation-semantics fix
  Spec-reviewer. Requirements: REQ-001, REQ-003, REQ-004, REQ-006, REQ-010, REQ-011, REQ-013. Acceptance: attested-vs-details consistent; verdict via sdd_submit_result.
- [x] TASK-077 — Plan review of epoch-3 graph (second attempt)
  Plan-reviewer. Depends on: TASK-076. Requirements: REQ-001–REQ-013. Acceptance: graph verified; verdict via sdd_submit_result.
- [x] TASK-078 — Spec review of epoch-3 packet (current fingerprint)
  Spec-reviewer. Requirements: REQ-001–REQ-013. Acceptance: packet reviewed; verdict via sdd_submit_result.
- [x] TASK-079 — Plan review of epoch-3 graph (current fingerprint)
  Plan-reviewer. Depends on: TASK-078. Requirements: REQ-001–REQ-013. Acceptance: plan verified; verdict via sdd_submit_result.
- [x] TASK-080 — Repair verification failures (lint + 11-item gate)
  Tests. Depends on: TASK-072, TASK-070. Requirements: REQ-001, REQ-011, REQ-012. Files: public/sw.js, tests/unit/catalog-11.test.ts, tests/unit/integration/flow.test.ts. Acceptance: lint clean, unit exact-11 contract, no weakened assertions.
- [x] TASK-081 — Align verify script with reviewer practice
  Documentation. Depends on: TASK-073. Requirements: REQ-012. Files: scripts/verify-sdd.mjs. Acceptance: reviewer empty-files allowed; guards intact.
- [x] TASK-082 — Repair lint leftover and loopback test server
  Tests. Depends on: TASK-080. Requirements: REQ-011, REQ-012. Files: tests/unit/catalog-11.test.ts, playwright.config.ts. Acceptance: lint passes, webServer loopback-only, verdict via sdd_submit_result.

Explicit requirement coverage: REQ-001 (TASK-069, TASK-071, TASK-072), REQ-002 (TASK-071, TASK-072), REQ-003 (TASK-072), REQ-004 (TASK-072), REQ-005 (TASK-072), REQ-006 (TASK-072), REQ-007 (TASK-070, TASK-072), REQ-008 (TASK-072), REQ-009 (TASK-070, TASK-072), REQ-010 (TASK-072), REQ-011 (TASK-069, TASK-071, TASK-072, TASK-073), REQ-012 (TASK-072, TASK-073), REQ-013 (TASK-070, TASK-072).

## November 4 fit flags

Fits: 069 (S), 070 (M), 071 (S), 072 (M), 073 (S). Does NOT fit (blocked, tracked as OPEN): provider-detail mapping (official wording, physical tests, sign-offs, accepted output format) — needs the missing confirmation details; catalog ships demo-labeled.

## Later phase (not scheduled)

HMIS packet formatting/acceptance, landlord fix lists/deadlines, multi-device/background-sync. Enter only with confirmed requirements + schedule via a future revision.
