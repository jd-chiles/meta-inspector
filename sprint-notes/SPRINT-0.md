# Sprint 0 notes — REQ-S1…S6 (analysis speed package)

Worktree: isolated sprint worktree off clean dev HEAD `1164a9f` (`git status`
was clean before edits; changes left dirty and uncommitted per instructions).
`02-design.md` / `05-change-log.md` NOT edited; verbatim text for the
integrator is at the bottom of this file.

Note on the task brief: it names `flow.tsx` for the scheduler and
analyze-on-save. `src/app/flow.tsx` holds no batch driver (verified by grep);
per `docs/IMPLEMENTATION_PROMPT.md` REQ-S2/S5 the work went into
`src/features/walkthrough/move-in-ready-flow.tsx` (batch driver,
`handleClipChange`).

## Files changed

- `src/domain/video-format.ts` — new shared `ANALYSIS_CLIP_CAP_SECONDS`
  (30), `ANALYSIS_CLIP_CAP_MS`, `ANALYSIS_WINDOW_NOTE` (client-safe home so
  server JSON and the tour view share one literal; client must never import
  server modules).
- `src/server/video/validate.ts` — `MAX_VIDEO_DURATION_MS` now derived from
  `ANALYSIS_CLIP_CAP_SECONDS` (still 30 000; behavior unchanged).
- `src/server/video/meta-sam.ts` — REQ-S1: `SAM_MAX_CONCURRENT_CONCEPTS`
  env (parsed int, clamp 1–6, default 6) via exported
  `resolveMaxConcurrentSamConcepts`; `mapVideoConcepts` takes the bound.
  REQ-S3: candidate boxes at ≥30 000 ms dropped in `makeCandidates`
  (now exported for the window test); `makeMuseSampleTimestamps` bounded
  by the cap; `VideoSegmentPending.analysisNote` added. REQ-S4:
  `MAX_MUSE_SAMPLE_STILLS` 30→12 (earliest 12, deterministic slice),
  `MAX_MUSE_SAMPLE_TOTAL_BYTES` 8 MB→4 MB. REQ-S6: kitchen loses
  `carbon monoxide detector`; bathroom loses `smoke detector` and
  `carbon monoxide detector`.
- `src/server/video/source-stills.ts` — REQ-S3: `-t 30`
  (`ANALYSIS_CLIP_CAP_SECONDS`) on the FFmpeg decode of the temporary
  analysis copy; caller upload bytes never modified.
- `src/server/video/operation-guard.ts` — REQ-S2: per-session active
  operations keyed by full request-identity digest (was: single active op
  per session), cap 2 per session (`MAX_ACTIVE_OPERATIONS_PER_SESSION`).
  Same-identity duplicate → still `OPERATION_BUSY`; consumed attempts →
  still `STALE_REQUEST`; cross-identity/cross-token mapping → stale.
  Without this, the second room's segment would 409 and 2-room
  concurrency could not run (rooms share one session id).
- `src/features/walkthrough/analysis-identity.ts` — new optional
  `requireSelectedRoom` (default true). Batch pipelines pass false: they
  skip only the UI-selection comparison; session/room/video/attempt/
  schema/catalog/abort/generation checks are unchanged.
- `src/features/walkthrough/batch-scheduler.ts` — NEW. Pure, React-free:
  `MAX_CONCURRENT_BATCH_ROOMS = 2`, `createRoomBatchQueue` (dedup FIFO;
  analyze-on-save rooms enqueued mid-run join the run),
  `runRoomBatch` (worker pool; results attributed by producing room, never
  by completion order; `shouldStop` stops launching while in-flight rooms
  settle; thrown pipelines count as failed). Sibling contract surface for
  REQ-L2's "max 2 concurrent (Sprint 0 scheduler)".
- `src/features/walkthrough/move-in-ready-flow.tsx` — REQ-S2: batch
  driver rewritten on `runRoomBatch` (up to 2 `analyzeRoomFor` pipelines);
  per-room generations, abort controllers, pending-cancel trackers, and
  in-flight set; cancel aborts every in-flight room; progress = settled
  rooms of total; pool runs on capture AND guided steps (tour batch
  previously stalled on the guided step because the driver required
  capture), pausing off those steps with the queue preserved. REQ-S5:
  `handleClipChange` enqueues the saved room when tour consent + batch
  consent hold, funding is LAHSA, mode is live, and online (deduped
  against queue/in-flight/proved; MOV skipped; unresolved batch failures
  or a manual run in flight skip the enqueue; offline does nothing).
  Manual Analyze covers only rooms not analyzed/queued/in-flight, is
  disabled while a batch runs, and capture stays enabled during a batch
  so filming overlaps analysis. Copy updated to stay truthful (two rooms
  at a time; consented auto-send on save).
- `src/features/walkthrough/assistant-script.ts` — analyzing message
  "one at a time" → "up to two rooms at a time" (message only; `speak`
  text unchanged so the voice inventory is untouched).
- `src/features/walkthrough/guided-tour-view.tsx` — REQ-S3: analyze card
  states `ANALYSIS_WINDOW_NOTE` (JSX text, not the pinned spoken script).
- `.env.example` — documents `SAM_MAX_CONCURRENT_CONCEPTS`.
- `tests/e2e/move-in-ready.spec.ts` — batch-consent checkbox regex
  shortened to `/I understand the filmed clips will be sent/` to match
  the reworded (still truthful) copy. E2E not run here (integrator runs
  once); the change is a strict prefix of the new label.
- `tests/unit/server/video/segment.test.ts` — updated: kitchen
  two-detection candidates 12→10; VIDEO_PROMPTS detector assertions →
  absence assertions (REQ-S6); 30 s samples 30→12 earliest;
  bathroom multi-detection candidates 12→8; per-concept overlap bound
  ≤3→≤6; "locks one active session operation" retitled to per-request-
  identity locking (assertions unchanged). New: env clamp table,
  env=1 sequential run, `analysisNote` presence, >30 s clip →
  `VIDEO_TOO_LONG` with zero evidence, `makeCandidates` drops
  ≥30 000 ms boxes, interleaved same-session two-room segment+map
  isolation test.
- `tests/unit/server/video/operation-guard.test.ts` — new: same-session
  isolation by identity (cross-token mapping stale); per-session cap of 2.
- `tests/unit/walkthrough/batch-scheduler.test.ts` — NEW: queue
  dedupe/FIFO; 2-wide pool with out-of-order settle attributed to the
  correct rooms; thrown pipeline → failed; cancel stops launching while
  in-flight settle.
- `tests/unit/walkthrough/analysis-identity.test.ts` — new:
  `requireSelectedRoom: false` skips only the selection comparison.

## Tests + results (all observed in this worktree)

- `npm ci` — clean install, 377 packages.
- `npm run typecheck` — clean.
- `npm run lint` — 0 errors, 2 warnings, both pre-existing in kind
  (verified against base via stash: base had 3 warnings in
  `move-in-ready-flow.tsx`, this tree has 2; the retired one belonged to
  the replaced sequential driver effect).
- `npm run test:unit` (full) — 41 files, 494 passed / 3 skipped
  (baseline 481/3; +13 new tests, 0 failures).
- Touched files run individually first: segment (51), operation-guard
  (11), source-stills (7, 3 skipped), track (3), batch-scheduler (4),
  analysis-identity (5), guided-tour (13), voice-inventory (7) — all pass.
- `node scripts/verify-sdd.mjs` — exit 0 before and after.
- NOT run per instructions: `test:live` (owner-gated spend; no live key
  in this environment), e2e, build (integrator runs once).

## Missing symbols

None. Sprint 0 is first in dependency order and needs no sibling-owned
symbols. Sibling-facing surface this sprint establishes (for REQ-L2's
"max 2 concurrent (Sprint 0 scheduler)" and REQ-E1's catalogue of env):
`MAX_CONCURRENT_BATCH_ROOMS`, `createRoomBatchQueue`, `runRoomBatch`
(`src/features/walkthrough/batch-scheduler.ts`); server-only optional
env `SAM_MAX_CONCURRENT_CONCEPTS` (default 6, safe unset);
`ANALYSIS_CLIP_CAP_SECONDS` / `ANALYSIS_WINDOW_NOTE`
(`src/domain/video-format.ts`).

## Design decisions needing integrator awareness

1. REQ-S1 default stays 6. The required live 6-wide rate check could not
   run (no live key); it is recorded UNVERIFIED below with no numbers.
   If Meta rate-limits 6-wide, the default must drop to 4 with a record.
2. REQ-S2 server change: the session operation guard now isolates by
   full request identity (cap 2/session). Same-identity duplicates and
   replays keep their exact prior codes; only distinct same-session
   identities changed (409-busy → admitted). This was required: without
   it the second room's segment 409s and client concurrency is dead.
3. REQ-S4 "earliest per concept" read as: samples keep the earliest 12
   (deterministic slice); candidate selection (`spreadSample`, 2 per
   prompt) unchanged, since altering it would change proposal content,
   which the sprint acceptance forbids ("no proposal content changes
   beyond fewer concepts").
4. REQ-S5 additionally requires batch consent (the run-level send
   authorization; the driver otherwise stops immediately with "consent
   withdrawn") and skips while unresolved batch failures exist or a
   manual run is in flight. In the tour flow `grantTourConsent` sets
   batch consent too, so S5 fires as specified. This gating is also what
   keeps the committed e2e "a finished manual batch never auto-restarts"
   green: tour-consent-only auto-send would add segments that test
   forbids.
5. Batch pool now runs on the guided step as well as capture (tour batch
   previously stalled: the driver required capture while the tour starts
   the batch on the guided step). Batch finish only auto-navigates to
   review from capture; on the guided step the tour's own settle logic
   advances. Leaving capture/guided pauses launching with the queue
   preserved (prior stall/resume semantics).
6. `parseSegmentResponse` (client) intentionally ignores the new
   `analysisNote` field (tolerant read). Requiring it would break the
   committed e2e route mocks that hand-write segment JSON.
7. Filming scripts / voice checks untouched by REQ-S6: bathroom voice
   checks and shot lists already exclude detectors (verified), and
   filming cues are voice-inventory-pinned (changing them needs
   `VOICE_CLIP_TEXTS` + regenerated audio — out of scope). Only
   server-side `VIDEO_PROMPTS` and its test expectations changed.
8. `docs/DECISIONS.md` decision 9 still says "at most 30 stills per
   room"; REQ-S4 supersedes it to 12. Left for the integrator to amend
   (docs owned outside this sprint).

## Risks / follow-ups

- E2E + build not run here; the one e2e edit (checkbox regex) is a
  strict-prefix match but awaits the integrator's single e2e run.
  Manual-batch, tour, offline-queue, and no-restart e2e flows were
  traced by hand against the new driver (see decision 4/5); the
  2-concurrent batch path itself has no committed e2e.
- No live verification of any kind: 6-wide SAM acceptance, staged-clip
  timings before/after, and the FFmpeg `-t 30` decode path on real long
  clips are all UNVERIFIED (integration FFmpeg tests are env-gated and
  skipped here).
- Two concurrent live rooms double instantaneous provider spend vs the
  old sequential batch; `SAM_MAX_CONCURRENT_CONCEPTS=1` + single-room
  manual runs remain available as a cost throttle.

## Verbatim change-log entry for the integrator (05-change-log.md)

```
### Sprint 0 — Analysis speed package (REQ-S1…S6) — 2026-11-03 (fixture-verified; live UNVERIFIED)

- REQ-S1: SAM concept concurrency is now env-tunable via server-only
  optional `SAM_MAX_CONCURRENT_CONCEPTS` (parsed int, clamped 1–6,
  default 6; safe when unset). 6-wide live acceptance: UNVERIFIED (no
  live key; `test:live` not run). If a live run shows attributable
  429/5xx at 6-wide, the default must drop to 4 with a dated record.
- REQ-S2: batch driver runs up to 2 room pipelines concurrently
  (`MAX_CONCURRENT_BATCH_ROOMS`), with per-room generation counters,
  abort controllers, identity checks, and cancel-everything semantics;
  progress = settled rooms of total. Server session guard now isolates
  by full request identity (cap 2 concurrent operations per session).
- REQ-S3: analysis uses only the first 30 s of a clip
  (`ANALYSIS_CLIP_CAP_SECONDS`; FFmpeg `-t 30` on the temporary
  analysis copy; stored original untouched; evidence at ≥30 s dropped).
  Segment responses and the tour analyze node state: "Analysis uses the
  first 30 seconds — film the shot list, then stop."
- REQ-S4: map payload reduced to 12 sample stills (earliest,
  deterministic) and 4 MB total. Supersedes the "at most 30 stills per
  room" note in `docs/DECISIONS.md` decision 9.
- REQ-S5: saving a room clip with tour + batch consent, LAHSA funding,
  live mode, and a connection enqueues that room immediately (deduped);
  manual Analyze covers only rooms not analyzed/queued/in-flight.
  Offline at save: no queue action (Sprint 3).
- REQ-S6: `VIDEO_PROMPTS` no longer sends `smoke detector` /
  `carbon monoxide detector` for bathrooms or `carbon monoxide
  detector` for kitchens. Filming cues and voice checks unchanged.
- Verification: `test:unit` 494 passed / 3 skipped, `typecheck` clean,
  `lint` 0 errors, `verify-sdd.mjs` exit 0 (all fixture/mocked).
  Staged-clip segment+map timings before/after: UNVERIFIED (no live
  key; no numbers recorded). E2E + build left for the integrator run.
```

## Verbatim design-text for the integrator (02-design.md)

```
Sprint 0 batch pipeline (REQ-S2/S5): `runRoomBatch` in
`src/features/walkthrough/batch-scheduler.ts` is the single batch pool
(max 2 rooms, `MAX_CONCURRENT_BATCH_ROOMS`; REQ-L2 reuses it for the
offline queue runner). Rooms are pulled from a deduped FIFO
(`createRoomBatchQueue`) shared with analyze-on-save, so rooms saved
mid-run join the run. Each room runs the same guarded
`analyzeRoomFor(roomId)` pipeline with per-room generation, abort
controller, and cancel tracker; batch pipelines bind the full
(session, room, video, attempt, schema, catalog) identity but not the
UI selection (`requireSelectedRoom: false`), while manual runs keep the
strict check. Cancel and navigation-away abort every in-flight room;
each room proves by a persisted proposal bound to its current clip.
Server: session operations isolate by full request-identity digest, cap
2 per session, matching the two process-wide admission slots.
```
