# Meta-Inspect — PM Brief (2026-10-28)

Source snapshot inspected: SDD slug `habitability-walkthrough-mvp`, stage
`verifying` (`.sdd/state/habitability-walkthrough-mvp.json`, updated
2026-10-28); `docs/sdd/features/habitability-walkthrough-mvp/03-plan.md`
records TASK-001…TASK-010 plus repairs TASK-013…TASK-027 all passed;
`docs/evaluation/results.md` snapshot `0318bbea…` (2026-10-27, stage
`implementing`). Live command status below is the coordinator-reported state
of 2026-10-28 from the intake task (lint/typecheck/unit/build pass; e2e and
live NOT run) — **not** independently re-run for this brief (no execution
surface in this pass). Unmeasured stays `unmeasured`.

## 1. Audience first

**Primary user:** Housing navigator or TLS/RRH case manager completing a unit
habitability walkthrough and preparing its record — high caseload, limited
walkthrough experience, time-pressured (per owner-reported qualitative
feedback; no measured baseline on record).

**Job to be done:** Move through 3–4 selected form items without losing
required evidence; distinguish what a camera can show from what a person must
check; leave a clear draft for worker review and sign-off.

**Who this is not for (yet):** inspectors certifying habitability, landlords,
HMIS administrators, or anyone needing an approved submission. Nothing in the
app is an approved inspection or HMIS submission.

## 2. Scope

**In scope (hackathon):** Mobile-friendly flow for 3–4 illustrative demo items;
guided still-photo capture; optional short spoken note (stretch, gated);
Muse Spark neutral draft observation per item with visible evidence,
unknowns, and suggested manual checks; worker edit/accept/reject + manual
check recording; review-only printable evidence card; honest fixture mode for
CI/demo backup; measured task comparison per evaluation protocol.

**Out of scope:** pass/fail or habitability verdicts, certification,
eligibility decisions, HMIS upload/scheduling/rent-reasonableness/landlord
portal, production deployment, real tenant records, all-item coverage,
continuous tracking, automatic frame ranking, offline sync, Muse Wonder
orchestration. Do not imply an export is an accepted HMIS packet until a
provider confirms the format.

**Catalog rule (hard):** Every checklist surface carries
`Demo checklist — not a verified Form 1083 mapping.` until the
provider-confirmation gate in `docs/integration/FORM_1083_MAPPING.md` §1.2 is
fully recorded. Missing confirmation never promotes a demo item.

## 3. AI + data boundaries

- **Muse Spark** (`muse-spark-1.3`, Standard mode, server-only): drafts a
  neutral, editable observation for the selected item. Never a verdict.
  Constrained JSON stabilizes shape, not factual accuracy — every field stays
  editable and every draft stays labeled `AI draft`.
- **Voice Transcribe / SAM 3.1:** stretch only, after the core image-to-draft
  path is reliable. A mask locates pixels; it never proves condition,
  function, or safety.
- **Data:** synthetic or self-shot mock-unit media only. No tenant data, no
  identifying media, no `NEXT_PUBLIC_*` secrets, no client-supplied model
  IDs/prompts/URLs. Meta Standard mode is not a zero-retention guarantee —
  confirm endpoint data handling before any real pilot.
- **Contributor model IDs** (`*-contributor`) must not be used for pilot data;
  the app default is the Standard-mode ID.

## 4. Impact hypothesis + honest measures

**Hypothesis:** Guided evidence-linked capture reduces time and tracking
effort for this walkthrough step and makes omissions and required manual
checks easier to see. Placement timelines are outside the claim.

**Measures** (per `docs/evaluation/protocol.md` §4 sheet; report sample size
with every claim; a single walkthrough is a sample of one, not a rate):
staff minutes (current vs assisted), items with usable linked evidence,
missing-evidence items, retakes, worker edits/rejections, manual checks
flagged/performed/not-performed, unresolved checks at export, errors and
recovery observed.

## 5. Where we really are — Gates 0–4

| Gate | Verdict |
|---|---|
| Gate 0 — Verify the instrument | **Blocked on provider.** No operative Form 1083 copy; FY22–23 vs 2024 unresolved; demo catalog only. |
| Gate 1 — Prove the core model path | **Fixture-only, blocked on credentials.** Server-only adapter + `/api/analyze` + mocked boundary tests exist; zero live calls ever. |
| Gate 2 — Narrow vertical slice | **Fixture-only, e2e unverified by coordinator.** Capture/review/export components exist in `src/`; SDD plan marks TASK-005…009 passed, but no coordinator-executed `test:e2e` evidence exists and the 10-27 record notes unwired testids. Treat as unproven until CI/browser runs green on a stable fingerprint. |
| Gate 3 — Evaluate the workflow | **Unmeasured.** Protocol + blank sheet exist; zero runs; evaluation set empty. |
| Gate 4 — Stretch | **Not started, gated.** Only after the core slice is reliable. |

## 6. REQ-001…012 status

- **Completed (structural/behavioral, fixture-bounded):** REQ-001 demo catalog
  + labeling; REQ-002 media validation/normalization; REQ-004 strict neutral
  schema; REQ-005 review/manual-check rules; REQ-006 provenance + stale-
  response invalidation; REQ-007 IndexedDB recovery/deletion; REQ-008
  review-only export policy; REQ-009 mobile/a11y flow; REQ-010 bounded local
  API; REQ-012 docs/lint/typecheck/unit/build per 10-28 coordinator report.
  All behavioral proof is mocked/fixture unit tests — none of it proves live
  inference.
- **Fixture-only (works, but never against the real API):** REQ-002, REQ-003,
  REQ-004, REQ-010 server path.
- **Blocked on provider:** any form-specific claim under REQ-001.
- **Blocked on credentials:** live half of REQ-003, REQ-010 timeout/cancel
  against the real endpoint, REQ-011 live column.
- **Unmeasured:** every cell of REQ-011 results; REQ-012 browser/live halves
  (no coordinator-run evidence).

## 7. Hard blockers (not papered over)

- **(a) Operative Form 1083 copy + 3–4 provider-selected items unverified.**
  No provider has confirmed version, wording, numbering, physical tests, or
  draft acceptance. Owner: **project owner** (obtain copy + selection).
- **(b) No Meta API key provisioned → no live smoke.** `APP_ANALYSIS_MODE`
  stays `fixture` in CI/local; fixture success ≠ live. Owner: **project
  owner** (provision `META_API_KEY` server-side; then backend runs
  `npm run test:live` and records model/mode/request-ID/latency only).

## 8. Open questions with owners

1. Which Form 1083 copy is operative, and which 3–4 items suit a camera-assisted draft? — **project owner** (blocks Gate 0 and any form claim).
2. When/how is a server-side Meta key provisioned for the live smoke, and what spend cap applies? — **project owner** (blocks Gate 1/Gate 3-live).
3. What rights-cleared mock-unit inputs seed dev vs evaluation sets (manifest rows in `fixtures/README.md`)? — **gtm**, with owner supplying self-shot media.
4. Is Codex automatic review + branch-required CI active on the public repo? — **project owner** (activation), verified by **backend** on next PR.

## 9. What is next (sequenced)

1. **backend:** close Gate 1 — real Spark path server-only, no secret leakage; harden `/api/analyze` per REQ-010; run live smoke once (b) clears.
2. **frontend:** complete capture → review → export slice per REQ-002/005/007/008/009 against the backend contract; prove it with `test:e2e` green.
3. **gtm:** honest evaluation sheet + demo narrative + launch copy from evidence only per REQ-011; record the 3-min demo (fixture-labeled until a live take exists).
4. Stretch (Transcribe, SAM 3.1) only after 1–3 are reliable — explicit gate, not a backlog slide.

## Verdict

**Done:** scoped brief/decision record, demo catalog + labeling, full
capture-to-export implementation with mocked/fixture tests, evaluation
protocol, SDD plan chain to `verifying`.
**Fixture-only:** the entire model path and every behavioral claim about it.
**Next:** backend closes Gate 1, frontend proves the slice in a real browser,
gtm measures nothing until there is something measured to report.
