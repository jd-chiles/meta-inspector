# Native SDD tool status (historical OpenCode handoff)

This file remains to satisfy the SDD documentation contract. It is a status
note, not an instruction to open or use OpenCode. Codex owns implementation and
coordination for this project.

## Current implementation

Feature slug: `habitability-walkthrough-mvp`. The authored request,
requirements, design, task map, and verification plan are in
`docs/sdd/features/habitability-walkthrough-mvp/`. The owner confirmed this
workflow uses LAHSA Form 1083 and supplied the three-screen mobile concept.

The current worktree contains the mobile Capture / Draft Review / Sign-Off &
Export / Profile flow, room-scoped video capture and local storage, a server-side
SAM/Muse video path, evaluator-only decisions and sign-off, local PDF/JSON
exports, and the installable/offline PWA shell. Video processing uses pinned
Mediabunny and FFmpeg runtime tooling. This is a code inventory, not an SDD
approval, provider-quality result, or release verdict.

## Native SDD coordination status

This Codex work did not reconcile native SDD plugin state or edit
`.sdd/state/` or `.sdd/evidence/`. The current feature documents and
implementation have not received native spec, plan, implementation, QA,
security, or release reviews. `node scripts/verify-sdd.mjs` is structural
traceability validation only; it is not application verification or plugin
evidence.

An earlier `/sdd-doctor` attempt through `opencode run` started a generic agent
session; it reported that SDD run context was unavailable and denied edits and
shell. No native doctor, coordinator transition, or review completed. This is
historical context and does not block Codex implementation. Do not hand-edit
generated plugin state or evidence to make a native run appear current.

## Historical handoff notes

The earlier workflow proposed running `/sdd-doctor` and `/sdd-status` in
OpenCode and asking its coordinator to reconcile the feature/task graph. That
workflow is not active. Keep native plugin state unchanged unless its supported
tooling is available and explicitly invoked.
4. Keep the live Meta check separate from fixture CI. Do not rerun the live
   smoke as a substitute for the staged-video quality gate; one synthetic
   connectivity smoke is already recorded in the evaluation notes.

Named local checks in `.sdd/config.json`:

```sh
node scripts/verify-sdd.mjs
npm run lint
npm run typecheck
npm run test:unit
npm run test:e2e
npm run build
npm run test:live
```

`test:e2e` builds the production app before running the browser suite. The
current Playwright host needs the installed Chromium path supplied through
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; see the current check record in
`docs/REVIEW_AND_CI.md`. Use mock-unit inputs for non-live checks.

## Remaining evidence gates

- Native SDD reconciliation, check evidence, independent reviews, and release
  verdict are open.
- A rights-cleared staged kitchen/bathroom video is still needed for SAM/Muse
  quality evaluation. The synthetic live smoke established only that the SAM
  route connected; it returned no candidates, did not call Muse, and assessed
  no mapping or inspection quality. See `docs/evaluation/video-clip-gate.md`.
- The rendering's populated Draft Review and signed export states have not
  been recreated for visual comparison. The browser review used a synthetic
  clip and left all evaluator decisions and sign-off empty.
- The official FY 2022–23 Form 1083 PDF is embedded unchanged, filled for
  supported fields, flattened, and extended with evidence pages. Staged-only
  participant/HMIS identity and unit address remain blank, so this export is
  not case-ready. Provider acceptance and HMIS submission are not claimed;
  exports remain local files for the existing manual workflow.

## Preview

The app is currently served at
`https://vps-27b87dbf-1.taile8712d.ts.net:3100/` through Tailscale Serve.
The phone must be connected to the same tailnet. The loopback preview is
`http://127.0.0.1:3100/`.
