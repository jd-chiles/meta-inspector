# Evaluation protocol (REQ-011)

Status: protocol only. No measured runs, no practitioner validation, and no live
smoke have been recorded under this protocol. Every value below that has not
been observed stays `unmeasured`. Fixture output never counts as live inference.

## 1. Scope and honesty rules

- Covers REQ-001 (illustrative demo catalog stays labeled) and REQ-011 (honest
  fixtures and evaluation).
- The demo catalog (`Demo checklist — not a verified Form 1083 mapping.`) is the
  only checklist until a provider confirms the operative Form 1083 copy per
  `docs/integration/FORM_1083_MAPPING.md` §1.2. Evaluation never promotes a demo
  item to a form claim.
- Case-manager conversations reported by the owner (see `docs/RESEARCH.md`) are
  qualitative input only: no sample size, dates, quotations, or measured times
  are on record. Do not report them as measured results.
- Housing placement timelines are outside the evaluation. Measure only the
  walkthrough task: staff minutes, evidence coverage, corrections/rework, manual
  checks, and worker disposition of drafts.
- Missing Meta credentials remain a limitation (see §5). Fixture runs, unit
  tests, and browser checks never prove live inference.

## 2. Development / evaluation separation

| Set | Location | Purpose | Rule |
|---|---|---|---|
| Development | `fixtures/responses/`, `fixtures/media/dev-*` | Deterministic unit/browser checks, fixture-mode UI | May be used for debugging and prompt iteration |
| Evaluation | `fixtures/evaluation/` (reserved, currently empty) | Measured runs under this protocol | Fixed before a run; never used for tuning; never copied into development paths |

A mock input belongs to exactly one set. Provenance and license for every input
are recorded in `fixtures/README.md`. No binary media is committed yet; the
reserved directories stay empty until rights-cleared self-shot or generated
inputs are added with manifest rows.

## 3. Required scenarios

Run all three scenarios in fixture mode first (deterministic, labeled
`mode: "fixture"`). A live run repeats the same scenarios only when credentials
are provisioned, and its outcome is recorded separately per §5 — never merged
with fixture results.

### Scenario A — visual evidence plus human test

- **Input:** one rights-cleared mock-unit photo showing a visible feature plus a
  condition only a person or test device can establish (for example a faucet that
  looks intact but needs a flow/drainage check).
- **Steps:** capture/upload → fixture draft → worker reviews observation, visible
  evidence, unknowns, and required manual checks → worker records the manual
  check as performed (with note) or not-performed → export review-only summary.
- **Expected honest behavior:** draft stays neutral with no verdict; catalog
  required checks remain pending until the worker records them; accepting text
  never marks the physical test performed; export repeats the review-only banner.

### Scenario B — poor framing / unknown

- **Input:** one rights-cleared mock-unit photo with poor framing, glare,
  cropping, or obstruction so the item cannot be assessed from the image.
- **Steps:** capture/upload → fixture draft → worker reviews unknowns.
- **Expected honest behavior:** draft reports what is not visible in `unknowns`
  and suggests manual checks; no pass/fail or habitability verdict appears;
  unresolved items export only as unresolved without unapproved draft text.

### Scenario C — correction and rejection

- **Input:** one rights-cleared mock-unit photo with an initial draft the worker
  judges wrong or unusable.
- **Steps:** capture/upload → fixture draft → worker edits-and-accepts or rejects
  → optionally replace media or reanalyze → verify prior review is invalidated
  and prior draft text is preserved as history, not as approved content.
- **Expected honest behavior:** rejection is never acceptance; replacing media or
  changing item invalidates prior review and manual-check evidence; a late
  response after replacement, item change, cancellation, or deletion never
  overwrites current evidence.

## 4. Blank measurement sheet

Copy this table per run. Leave any unobserved cell as `unmeasured` — do not
invent values, averages, or percentages.

| Field | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Date | unmeasured | unmeasured | unmeasured |
| Scenario (A / B / C) | unmeasured | unmeasured | unmeasured |
| Mode (`fixture` or `live`) | unmeasured | unmeasured | unmeasured |
| Catalog version | unmeasured | unmeasured | unmeasured |
| Model (fixture: `muse-spark-1.3` label only; live: serving model echo) | unmeasured | unmeasured | unmeasured |
| Current-workflow minutes (baseline, if observed) | unmeasured | unmeasured | unmeasured |
| Assisted-workflow minutes (measured task time) | unmeasured | unmeasured | unmeasured |
| Items with usable linked evidence (count) | unmeasured | unmeasured | unmeasured |
| Missing-evidence items (count) | unmeasured | unmeasured | unmeasured |
| Retakes (count) | unmeasured | unmeasured | unmeasured |
| Worker edits to drafts (count) | unmeasured | unmeasured | unmeasured |
| Rejections (count) | unmeasured | unmeasured | unmeasured |
| Manual checks flagged / performed / not-performed (counts) | unmeasured | unmeasured | unmeasured |
| Unresolved checks at export (count) | unmeasured | unmeasured | unmeasured |
| Sample size (sessions, items, workers) | unmeasured | unmeasured | unmeasured |
| Errors and recovery observed | unmeasured | unmeasured | unmeasured |
| Notes (qualitative only, labeled as such) | unmeasured | unmeasured | unmeasured |

Report sample size with every claim. A single walkthrough is a sample of one,
not a rate.

## 5. Live-inference limitation

- The live smoke (`npm run test:live`: real `muse-spark-1.3` call over
  `https://api.meta.ai/v1` with rights-cleared media) is a separate check. As of
  2026-10-27 no Meta API key is provisioned, so no live result exists.
- The live check must fail clearly without credentials and must never pass via
  fixtures. When credentials exist, record model, mode, request ID, and latency
  without media, secrets, or full provider bodies — and keep that record
  separate from fixture runs.
- Green unit/browser/build checks prove only fixture behavior. They prove
  neither live inference nor provider form confirmation.

## 6. Recording a run

1. Fix the evaluation inputs and list their manifest rows.
2. Copy the blank sheet, fill only observed cells, leave the rest `unmeasured`.
3. Label every draft `fixture` or `live`; keep the two modes in separate sheets.
4. File the completed sheet under `fixtures/evaluation/` with date and catalog
   version; summarize honestly in TASK-010 records without inventing results.
