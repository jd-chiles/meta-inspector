# Sprint 3 — Lifecycle (REQ-L1, REQ-L2, REQ-L3)

Base: clean dev HEAD (verified `git status` clean before work; tree left dirty, uncommitted).
Scope: REQ-L1 re-inspection mode, REQ-L2 offline analysis queue, REQ-L3 GPS attestation.
Sibling sprints (0/1/2/4) NOT present in this worktree. Cross-sprint refs are coded
defensively per the prompt contracts (see "Missing symbols"); nothing was reimplemented.

## Files changed

Modified:
- `src/domain/move-in-ready.ts` — `PriorDeficiencySnapshot` + `validatePriorDeficiencySnapshot`;
  `unreviewed` decisions accept optional `priorDeficiency` (A/D reject it, so re-deciding
  drops the snapshot); `extractPriorDeficiency`, `startReinspectionDecisions`,
  `reinspectionElementIds`, `hasDeficientDecisions`; queue helpers
  (`enqueue/dequeue/pruneAnalysisQueue`); `InspectionLocation` +
  `roundCoordinate`/`buildInspectionLocation`/`validateInspectionLocation`.
  `deriveFinalInspectionResult` deliberately UNCHANGED.
- `src/features/walkthrough/inspection-store.ts` — record fields `analysisQueue: roomId[]`
  and `inspectionLocation: InspectionLocation | null`; `createInitialInspectionRecord`
  defaults (`[]`/`null`); `validateInspectionRecord` normalizes both (legacy records
  without them validate to defaults; invalid entries fail closed). No schema-version bump.
- `src/features/walkthrough/guided-tour.ts` — `guidedReviewQueue` gains the re-inspection
  filter: while any decision carries `priorDeficiency`, only those elements queue.
- `src/features/walkthrough/move-in-ready-flow.tsx` — Home "Re-inspect deficiencies" entry
  + `startReinspection` (snapshot D decisions, reset both sign-offs, open guided tour);
  review-card "Before" section (prior plan + resolvable stills); clip save enqueues /
  clip removal dequeues; `replaceRoomProposals` dequeues analyzed rooms; room removal
  prunes the queue; online/visibilitychange queue runner delegating to `startBatchAnalysis`;
  sign-off "Add location" button + status (never blocking).
- `src/features/walkthrough/guided-tour-view.tsx` — `analysisQueue` binding; analyze node
  shows queued/in-progress counts (`tour-analysis-queue-counts`); tour review cards show a
  re-inspection tag pointing at full-review Before stills; queued ids passed to capture.
- `src/features/walkthrough/video-capture.tsx` + `video-capture.module.css` — optional
  `queuedRoomIds` prop; per-room "Analysis queued" chip (current-room header +
  `room-step` marker, aria-labels).

Added (untracked tests):
- `tests/unit/walkthrough/reinspection.test.ts` (9 tests)
- `tests/unit/walkthrough/analysis-queue.test.ts` (8 tests)
- `tests/unit/walkthrough/inspection-location.test.ts` (8 tests)

Not edited per instructions: `docs/sdd/features/habitability-walkthrough-mvp/02-design.md`,
`05-change-log.md` (verbatim text for the integrator below).

## Tests + results

- `npm ci` — ok.
- Touched suites: reinspection (9) + analysis-queue (8) + inspection-location (8) = 25 passed.
- Neighbors: guided-tour (13), inspection-store (32), domain move-in-ready (27) — all pass.
- Full `npm run test:unit`: 43 files, 506 passed / 3 skipped (baseline was 481/3; +25 new).
- `npm run typecheck` — clean, no gaps.
- `npx eslint` on all touched files — 0 errors, 3 warnings (the 3 pre-existing
  react-hooks/exhaustive-deps warnings in move-in-ready-flow.tsx; the new runner effect
  carries an explicit disable like guided-tour-view's).
- `node scripts/verify-sdd.mjs` — exit 0 before and after.
- NOT run per child-task constraint: e2e, build (integrator runs once), test:live (never).

E2E coverage is unit-only in this sprint (constraint: "No e2e"). Suggested integrator e2e:
L1: decide one D + rest A → sign → Home shows "Re-inspect deficiencies" → start →
tour queues only that element → re-decide A → sign-off unblocked. L2: Playwright offline,
save clip, "Analysis queued" chip appears; online, stubbed analysis route called. L3:
deny geolocation → "Location not recorded", sign/export still enabled.

## Missing symbols (absent from base; referenced per contract, never reimplemented)

- REQ-F1 (Sprint 1): `ParticipantSignoff`, `PARTICIPANT_ATTESTATION_TEXT`,
  `validateParticipantSignoff`, record field `participantSignoff`. Coded via
  `siblingSignoffReset()` (resets the field only if present) and
  `isSignedForReinspection()` (requires it only if present). In base, evaluator
  sign-off alone gates re-inspection; with F1 both are required/reset.
- REQ-E1 (Sprint 2): `src/export/lahsa-1083.ts` `buildLahsa1083Json`, export kind
  `lahsa-1083-json`. This sprint provides record field `inspectionLocation`
  `{lat, lng, accuracyM, capturedAt} | null` (coords pre-rounded to 3 decimals).
  Integrator/E1 wiring: `property_address: { geolocation: inspectionLocation }`,
  still null when no location was captured. No existing export was touched.
- REQ-S0 (Sprint 0): 2-room concurrent scheduler, `SAM_MAX_CONCURRENT_CONCEPTS`.
  The L2 runner delegates to the existing sequential `startBatchAnalysis`; 2-wide
  concurrency arrives with Sprint 0 with no Sprint 3 change needed.
- REQ-S5 (Sprint 0): analyze-on-save conditions. L2 supersedes with always-enqueue on
  clip save (dedupe); the runner gates the actual run on online + live + LAHSA +
  prior consent (walkthrough or batch disclosure). Manual Analyze already skips
  analyzed rooms, satisfying "covers only rooms not yet analyzed".

## Risks / deliberate interpretations

1. Queue runner consent basis: L2 says "starts queued rooms when onLine" without naming
   consent. Auto-sending clips with no consent would violate the app's consent
   architecture (the batch driver itself refuses to run unconcented). The runner fires
   only under walkthrough consent or manual batch consent, once per queue state
   (session+queue key; cancel is respected, new saves re-arm). Owner to confirm.
2. Tour re-inspection entry: `startReinspection` opens the guided tour; with all rooms
   filmed and current proposals, the analyze node settles without re-sending paid
   analysis, then reviews only re-inspected elements. Manual review shows Before stills.
3. Before stills resolve best-effort against on-device stills by stillId; replaced clips
   render the prior plan text-only with "Prior stills are no longer on this device."
4. No schema-version bump (stays 5): new record fields are optional-with-defaults, so
   pre-Sprint-3 records validate and migrate paths are untouched.
5. GPS `maximumAge`/high-accuracy intentionally unset; `getCurrentPosition` 10 s timeout
   only. Coordinates rounded client-side before storage; raw values never persisted.

## Verbatim changelog entry (for 05-change-log.md)

Sprint 3 (REQ-L1, REQ-L2, REQ-L3) — Lifecycle. REQ-L1: signed records with any D
decision show "Re-inspect deficiencies" on Home; starting snapshots each D deficiency
{issueDescription, correction, completionDate, reinspectionDate, evidence stillIds,
decidedAt} into decision field `priorDeficiency`, resets those decisions to unreviewed
and both sign-offs (evaluator + REQ-F1 participant when present), and the guided tour
queues only those elements; review cards show Before stills beside new evidence;
`deriveFinalInspectionResult` unchanged. REQ-L2: persisted `analysisQueue: roomId[]` on
the record; clip save always enqueues (dedupe), clip removal dequeues, room removal
prunes, successful analysis dequeues; a queue runner triggers the batch driver when
online on `online`/`visibilitychange` under existing walkthrough/batch consent (max-2
concurrency arrives with Sprint 0; no new env vars); per-room "Analysis queued" chips
in capture and queued/in-progress counts on the tour analyze node. REQ-L3: sign-off
"Add location" button (explicit tap only, 10 s geolocation timeout) storing
`inspectionLocation` {lat, lng rounded to 3 decimals (~100 m), accuracyM, capturedAt};
denied/unavailable shows "Location not recorded" and never blocks signing or exports;
REQ-E1 consumes it as `property_address.geolocation` (null when absent). Verification:
fixture/unit only — 25 new unit tests, full suite 506 passed / 3 skipped, tsc clean,
eslint 0 errors (3 pre-existing warnings), verify-sdd exit 0; e2e/build deferred to the
integrator; no live calls (no test:live spend). No new env vars; app builds and passes
gates with none set.

## Verbatim design text (for 02-design.md)

Re-inspection (REQ-L1): `PriorDeficiencySnapshot` lives only on `unreviewed`
decisions; saving a new A/D decision replaces the decision and drops the snapshot,
which releases the `guidedReviewQueue` re-inspection filter element by element.
`startReinspectionDecisions` is pure (decision set in/out + count); sign-off resets
stay at the record layer. Before stills are snapshot stillIds resolved best-effort
against on-device evidence views at render time. Offline queue (REQ-L2):
`analysisQueue` is the persisted source of truth for rooms needing analysis; all
mutations go through `enqueue/dequeue/pruneAnalysisQueue`; the runner is a trigger
only — scheduling, identity guards, cancel, and progress remain owned by the batch
driver (Sprint 0 contract). GPS attestation (REQ-L3): `InspectionLocation` is
write-on-tap, rounded at construction via `buildInspectionLocation`, validated by
`validateInspectionLocation`, and is not an input to finalization, sign-off, or any
export gate.
