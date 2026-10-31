# Evaluation protocol (REQ-011)

Status: protocol only. No measured evaluation runs or practitioner validation
have been recorded. One synthetic live video connectivity smoke is recorded
below; it is not a quality run. Every value not observed stays `unmeasured`.
Fixture output never counts as live inference.

## 1. Scope and honesty rules

- Covers REQ-001 (owner-confirmed Form 1083 identity) and REQ-011 (honest
  fixtures and evaluation). The project owner confirmed on 2026-10-29 that this
  workflow uses and submits LAHSA Form 1083; earlier notes that the form itself
  was unconfirmed are superseded.
- The app's eleven area names follow the owner's supplied form model. This
  evaluation does not claim verbatim transcription of every field or that a
  provider accepts the app's local draft/export. The app does not submit to
  HMIS. See `docs/integration/FORM_1083_MAPPING.md` §1 for these boundaries.
- Case-manager conversations reported by the owner (see `docs/RESEARCH.md`) are
  qualitative input only: no sample size, dates, quotations, or measured times
  are on record. Do not report them as measured results.
- Housing placement timelines are outside the evaluation. Measure only the
  walkthrough task: staff minutes, evidence coverage, corrections/rework, manual
  checks, and worker disposition of drafts.
- Live credentials are configured for the private preview. Fixture runs, unit
  tests, and browser checks never prove live inference or model quality.

## 2. Development / evaluation separation

| Set | Location | Purpose | Rule |
|---|---|---|---|
| Development | `fixtures/responses/`, `fixtures/media/dev-*`, `tests/fixtures/` | Deterministic checks and synthetic connectivity input | May be used for debugging and prompt iteration; never counts as evaluation media |
| Evaluation | `fixtures/evaluation/` (no measured run recorded) | Measured runs under this protocol | Fix rights-cleared inputs before a run; never use them for tuning or copy them into development paths |

A mock input belongs to exactly one set. Provenance and license for every input
are recorded in `fixtures/README.md`. The development set contains a self-shot
detector photo and `tests/fixtures/synthetic-h264-test-pattern.mp4`; the latter
is a synthetic test pattern, not a property walkthrough. Neither is evaluation
media. Add rights-cleared staged mock-unit video to the evaluation set only
with provenance and manifest records.

## 3. Required scenarios

Run all three scenarios with rights-cleared, staged mock-unit **video** in
fixture mode first (deterministic, labeled `mode: "fixture"`). A live run
repeats them only when credentials are provisioned and the owner authorizes the
transfer; record it separately per §5 and never merge it with fixture results.

### Scenario A — visual evidence plus human test

- **Input:** a rights-cleared mock-unit room video showing a visible feature
  and a condition that needs a human test, such as a faucet that appears intact
  but needs a flow/drainage check.
- **Steps:** capture/upload → fixture draft → worker reviews the suggestion,
  timestamped source still, unknowns, and required manual checks → worker records
  the manual check as performed (with note) or not performed → export the local
  review record.
- **Expected honest behavior:** the suggestion stays unreviewed and does not
  produce an inspection verdict; required checks remain pending until the worker
  records them; accepting suggested text never marks a physical test performed.

### Scenario B — poor framing / unknown

- **Input:** a rights-cleared mock-unit room video with poor framing, glare,
  cropping, motion blur, or obstruction so a feature cannot be assessed from its
  source frames.
- **Steps:** capture/upload → fixture draft → worker inspects the linked stills,
  timestamps, and unknowns.
- **Expected honest behavior:** unsupported suggestions become `needs human
  check`; no pass/fail or habitability verdict appears; unresolved items remain
  unresolved in exports and unapproved draft text is not presented as a finding.

### Scenario C — correction and rejection

- **Input:** a rights-cleared mock-unit room video whose initial suggestion the
  worker judges wrong or unusable.
- **Steps:** capture/upload → fixture draft → worker edits or rejects the
  suggestion → optionally replace the clip or reanalyze → verify prior review
  is invalidated and prior draft text is preserved only as history.
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

- One live smoke on 2026-10-29 exercised the video segment route with the
  synthetic MP4. SAM 3.1 returned no candidates after one segment request
  (12,155 ms); Muse mapping was not called, no inspection quality was assessed,
  and the mapping lease was released. This is connectivity evidence only, not
  a measured run or validation on staged property footage. Historical
  still-image smoke evidence is not evidence for this video path.
- The smoke runner loads local env through Next.js's loader and does not print
  key values. It makes one token-only Muse mapping request only if SAM returns
  valid candidate evidence; retries and Baseten fallback were disabled for
  the recorded smoke.
- The live check must fail clearly without credentials and must never pass via
  fixtures. If an authorized live attempt is run, record model, mode, request
  ID, and latency without media, secrets, or full provider bodies — and keep
  that record separate from fixture runs.
- Green unit/browser/build checks prove only fixture behavior. They prove
  neither live inference nor provider form confirmation.

## 6. Recording a run

1. Fix the evaluation inputs and list their manifest rows.
2. Copy the blank sheet, fill only observed cells, leave the rest `unmeasured`.
3. Label every draft `fixture` or `live`; keep the two modes in separate sheets.
4. File the completed sheet under `fixtures/evaluation/` with date and catalog
   version; summarize honestly in the current evaluation/release records
   without inventing results.
