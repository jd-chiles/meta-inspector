# Meta-Inspect — Runbook

How backend, frontend, and gtm coordinate without asking PM again. Normative
for handoffs; the SDD plan (`docs/sdd/features/habitability-walkthrough-mvp/`)
remains the task-level contract.

## 1. Workspace layout

- Repo: `/home/hermes/workspace/meta-inspect`, branch `main`. Board
  `meta-inspect`, default workdir the repo root.
- `src/domain` + `src/data` — evidence contracts, catalog (implementer-owned
  shapes; extend only via plan revision).
- `src/server` + `src/app/api/analyze` — backend-owned. No other lane edits here.
- `src/features/walkthrough` + `src/storage` + `src/export` + `src/app/page.tsx`
  + `src/app/flow.tsx` — frontend-owned UI composition.
- `fixtures/` — `responses/` (dev/fixture drafts), `media/` (reserved),
  `evaluation/` (reserved; fixed before a run, never tuned on).
- `docs/` — PM-owned briefs/runbook; `docs/evaluation/` gtm-owned content;
  `docs/integration/FORM_1083_MAPPING.md` architect/backend-owned contract.
- `.env.example` holds names only. Never commit values. No `NEXT_PUBLIC_*`
  secrets, no tenant data, no identifying media.

## 2. File naming

- Catalog items: `demo-*` prefix while illustrative; provider-mapped IDs only
  after the §1.2 confirmation gate is recorded.
- Fixtures: `fixtures/responses/<scenario>.json` with `mode: "fixture"` +
  `fixtureNotice`; media slots `fixtures/media/dev-*` vs evaluation set
  (never shared).
- Evidence cards/exports embed catalog version + `mode` on every surface.

## 3. Handoff protocol

1. **backend → frontend:** backend leaves `docs/integration/ANALYZE_CONTRACT.md`
   (request/response JSON shapes, error codes, timeout/cancel semantics,
   mode header, request-ID/latency headers) and keeps it current with
   `src/app/api/analyze/route.ts`. Frontend builds only against that doc +
   `src/domain` schemas; on mismatch, frontend **blocks** and PM arbitrates —
   never works around the contract in UI code.
2. **frontend → gtm:** frontend announces the frozen demo route (URL + mode +
   catalog version) that gtm may record; any UI change after announcement
   requires re-announcement.
3. **gtm → board:** gtm files completed measurement sheets under
   `fixtures/evaluation/` with date + catalog version; unobserved cells stay
   `unmeasured`.
4. Collisions: one lane edits one ownership area at a time (serial
   backend → frontend → gtm). If a change keeps colliding in one file, leave
   a `hotspot: <path> — <reason>` comment on your card and flag it in
   completion metadata instead of piling on.

## 4. Backend contract doc (required)

Location: `docs/integration/ANALYZE_CONTRACT.md`. Contents: endpoint +
   allowlisted base URL, auth (server-only `META_API_KEY`, alias of official
   `MODEL_API_KEY`), `muse-spark-1.3` default (Contributor IDs blocked for
   pilot data), single-image multipart limits (8 MiB / 20 MP), 45 s timeout +
   cancellation, one active analysis per session, same-origin only, stable
   safe-error table (setup / invalid media-item / conflict / throttling /
   timeout / provider / output), fixture-mode labeling (`mode`, request ID,
   latency recorded without media/secrets). REQ-003/REQ-010.

## 5. GTM artifacts + length budgets

- `docs/evaluation/results.md` — one row per run from the protocol §4 sheet;
  no invented values. No budget (record what was observed).
- `docs/DEMO.md` 3-min script — keep the 0:00–3:00 beats; mode line read aloud
  verbatim (fixture vs live take).
- Launch copy (README/portfolio one-liner ≤ 280 chars + 3-bullet limitations
  ≤ 100 chars each): may claim only what `results.md` + coordinator-run CI
  evidence shows; must name fixture-vs-live status and the demo-checklist
  label.

## 6. Definition of done (per task)

- Acceptance criteria in the card body are met against the cited REQs; no
  weakened assertions.
- Exact commands run with exit codes recorded (lint, typecheck, unit,
  browser, build as applicable); live smoke recorded separately with
  model/mode/request-ID/latency, never secrets or provider bodies.
- No `NEXT_PUBLIC_*` secret, no client-supplied model ID/prompt/URL, no
  tenant/identifying media in diff, fixtures, logs, or exports.
- Fixture output never presented as live; `unmeasured` never filled by
  inference.
- SDD stage/evidence updated where the plan requires it; release stays
  Not-Ready until live smoke + provider confirmation + final reviews pass.

## 7. Fixture-vs-live labeling rules

- UI, export banner, and demo narration always state the mode: `fixture` or
  `live` (+ request ID for live). Fixture backup takes are labeled recorded
  fixture output, never a live call.
- `APP_ANALYSIS_MODE=fixture` is the safe default for local/CI without
  credentials; live mode requires a provisioned server-side key and must fail
  clearly without one — never silently fall back.
- Green unit/browser/build prove fixture behavior only. They prove neither
  live inference nor provider form confirmation.
