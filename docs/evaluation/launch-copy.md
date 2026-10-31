# Launch copy — evidence-bounded (REQ-011, REQ-001)

Drafted 2026-10-28. May claim only what `docs/evaluation/results.md` plus
coordinator-run CI evidence (frontend lane `t_bf5d0dcb`, 2026-10-28:
`npm run lint` exit 0, `npm run typecheck` exit 0, `npm run test:unit`
130/130, `npm run build` exit 0, `npm run test:e2e` 15/15 on the production
build in fixture mode) shows. Names fixture-vs-live status and the
demo-checklist label per `docs/RUNBOOK.md` §5.

## README / portfolio one-liner (198 / 280 chars)

Guided photo-capture walkthrough that drafts neutral AI observations for 3–4 demo-checklist items (not a verified Form 1083 mapping); fixture-mode take, e2e 15/15, zero measured runs, no live claim.

## Limitations (3 bullets, each ≤ 100 chars)

- Fixture output only in this take; no live inference shown or claimed. (69)
- Demo checklist — not a verified Form 1083 mapping; no habitability verdict. (75)
- Zero measured evaluation runs; placement timelines are outside the claim. (73)

## What is deliberately not claimed

- No live `muse-spark-1.3` result in this lane (no key observed here; the
  coordinator-side smoke in `06-release.md` is cited in `results.md` as a
  pointer only, not GTM evidence).
- No practitioner validation, no measured times/coverage/rework, no rates
  (sample size is zero sessions, zero items, zero workers).
- No stretch features (Voice Transcribe, SAM 3.1) — gated behind a reliable
  core slice per `docs/PM_BRIEF.md`.
