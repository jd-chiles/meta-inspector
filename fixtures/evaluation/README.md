# Evaluation set — state record

Date: 2026-10-28. Catalog: `demo-habitability-walkthrough` version
`0.1.0-demo.1`. Protocol: `docs/evaluation/protocol.md`.

Status: **empty — zero measured runs.** Scenarios A, B, and C are all
`unmeasured`. No fixture-mode run and no live run has been filed under this
protocol. Nothing in this directory counts as a result.

## Why empty (no invented runs)

No evaluation-set inputs exist. The only committed mock-unit media,
`fixtures/media/dev-ceiling-detector-01.jpg`, belongs to the **development**
set (see `fixtures/README.md`) and per protocol §2 a mock input belongs to
exactly one set — it cannot be reused for evaluation, and evaluation media
is never tuned on.

## Exact media needed (one input per scenario)

Rights-cleared only (self-shot or generated). No people, addresses, mail,
screens, or identifying views. EXIF stripped on ingest. Each input gets a
manifest row in `fixtures/README.md` (source / author / license / capture
date / size / SHA256, set: `evaluation`):

- Scenario A (visual evidence plus human test): one mock-unit photo showing
  a visible feature plus a condition only a person or test device can
  establish (for example, a faucet that looks intact but needs a
  flow/drainage check).
- Scenario B (poor framing / unknown): one mock-unit photo with poor
  framing, glare, cropping, or obstruction so the item cannot be assessed
  from the image.
- Scenario C (correction and rejection): one mock-unit photo whose initial
  draft the worker judges wrong or unusable.

## Procedure when inputs land

1. Fix the inputs first and list their manifest rows.
2. Copy the blank sheet from protocol §4; fill only observed cells; leave
   the rest `unmeasured`.
3. File the completed sheet here with date + catalog version; summarize
   honestly in `docs/evaluation/results.md`.
4. Fixture and live runs go on separate sheets. Fixture success never
   counts as live.
