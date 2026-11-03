# Implementation Prompt — Habitability Walkthrough Companion

**Hand this entire file to Muse Code.** It is
self-contained: mission, current-state facts, non-negotiable rules,
requirements with exact specs, sprint order, and gates. Work through the
sprints in order. Do not ask clarifying questions that this file answers.

Do not use OpenCode. Muse Code is the only authorized implementation
agent for this work (per AGENTS.md).

## Mission

Tighten and finish the Habitability Walkthrough Companion (voice-led Form
1083 habitability inspection for LAHSA supportive-housing navigators) for
the Meta Global AI Developer Hackathon (Startup track: technical execution
+ holds up in production; use of Meta's tools is scored). Hard deadline:
submission Nov 4, 2026. Sprint order below is priority order — if time runs
out, earlier sprints matter most.

## Before writing any code

Read, in this order: `AGENTS.md`, `docs/PRODUCT_BRIEF.md`,
`docs/DECISIONS.md`, `docs/sdd/features/habitability-walkthrough-mvp/`
(request, requirements, design, verification plan), `docs/PM_BRIEF.md`,
`docs/DEMO.md`. Then run `node scripts/verify-sdd.mjs` (must exit 0 before
and after your work).

## Non-negotiable rules (from AGENTS.md — violations fail review)

1. **Evidence identity.** A delayed AI response must never replace newer
   media, attach to another item/version, restore a deleted session, or
   retain approval after replacement/reanalysis. Reuse the existing
   identity guards; never weaken them.
2. **AI output is an unreviewed observation.** Accepting text cannot
   complete a manual check, remove required unknowns, produce a verdict,
   or include pending/rejected draft text as approved export content.
   Fixture mode and illustrative catalogs stay labeled as such.
3. **Secrets.** Meta/Fish keys and provider bodies never appear in browser
   bundles, logs, or exports. Validate actual image bytes and resource
   limits. Never fetch client-supplied URLs. Escape all worker/model/user
   text in printable HTML/PDF. Local deletion never claims provider
   deletion.
4. **No silent fallbacks.** A failed live call must surface as a failure
   with retry — never as fixture success, a skipped check, or a fabricated
   confirmation.
5. **Single entrance, single exit.** Home's Start button begins the guided
   tour; sign-off ends it. The AI Guide popup never starts the flow.
6. **One owner voice.** All narration is the configured Fish owner voice.
   No stock device-voice fallback in the normal flow.
7. **Catalog honesty.** Every checklist surface carries
   `Demo checklist — not a verified Form 1083 mapping.` until the provider
   gate in `docs/integration/FORM_1083_MAPPING.md` §1.2 is recorded.
8. **SDD bookkeeping.** Update `02-design.md` and `05-change-log.md` per
   sprint with your REQ ids. Never hand-edit plugin state/evidence; never
   claim an approval or check that did not run.

Verbatim source — AGENTS.md Code Review Rules (these exact sentences
govern; the list above is only an operational summary):

> 1. Evidence identity must survive asynchronous work correctly. A
>    delayed response must not replace newer media, attach to another
>    item/version, restore a deleted session, or retain approval after
>    replacement/reanalysis.
> 2. AI output is an unreviewed observation. Accepting text cannot
>    complete a manual check, remove required unknowns, produce an
>    inspection verdict, or include pending/rejected draft text as
>    approved export content. Fixture mode and illustrative catalogs
>    must remain labeled.
> 3. Keep Meta keys/provider bodies out of browser bundles, logs and
>    exports. Validate actual image bytes and resource limits; never
>    fetch client URLs. Escape worker/model text in printable HTML.
>    Local deletion must not claim provider deletion.
> 4. Verification must exercise the actual flow. Flag silent fixture
>    fallback, no-op/skipped required checks, missing acceptance tests,
>    or fabricated live/provider confirmation. Keep formatting and
>    mechanical checks in CI.

## Git discipline

- Branch `muse-code/sprints` off `dev`. One commit per sprint, in order,
  only when that sprint's gates are green. Commit messages:
  `Sprint N: <REQ ids> <one-line summary>`.
- Never commit to `dev` directly, never amend, never force-push, never
  deploy. The owner reviews, merges, and deploys.
- Name every file you stage. Leave unrelated working-tree changes alone.

## Verified current state (do not re-derive; build on it)

- App: Next.js (Node 22) in `src/`. Gates: `npm run lint` (0 errors; 3
  pre-existing warnings tolerated), `npm run typecheck`,
  `npm run test:unit`, `npm run build`,
  `npx --no-install playwright test --workers=1` (boots `.next` via
  `npm run start` on :3101 — **run `npm run build` first** or e2e tests a
  stale bundle). Baseline: unit 481 passed / 3 skipped; e2e 45/45.
- Analysis pipeline: phone uploads a room clip once to
  `POST /api/video/segment?stage=segment` (server validates bytes,
  extracts frames with FFmpeg, runs Meta SAM 3.1 video searches from the
  fixed `VIDEO_PROMPTS` table in `src/server/video/meta-sam.ts`, retains
  bounded stills, returns a signed `candidateToken`). Phone then calls
  `?stage=map` with the token; server sends retained stills to Muse Spark
  (`muse-spark-1.3`, `src/server/meta/adapter.ts`) and returns per-element
  unreviewed proposals (suggestion, observation, confidence, evidence
  stills with frame/timestamp/hash, deficiency suggestion). Batch driver:
  `startBatchAnalysis` / `analyzeRoom` / `batchQueueRef` / `batchProgress`
  in `src/features/walkthrough/move-in-ready-flow.tsx`; per-stage client
  timeouts in `src/features/walkthrough/fetch-timeout.ts`
  (`SEGMENT_TIMEOUT_MS=300_000`, `MAP_TIMEOUT_MS=240_000`).
- Rooms currently analyzed strictly sequentially. SAM concepts: 6 per
  room, max 3 concurrent (`MAX_CONCURRENT_SAM_CONCEPTS=3`). Map payload:
  `MAX_MUSE_SAMPLE_STILLS=30`, `MAX_MUSE_SAMPLE_TOTAL_BYTES=8 MB`.
  Observed: a staged 23 s kitchen clip takes ~140–170 s in the segment
  stage. That is the problem Sprint 0 fixes.
- Voice: TTS + ASR currently Fish (`src/server/voice/fish.ts`,
  handlers in `src/server/voice/handlers.ts`; client
  `transcribeClip` → `POST /api/voice/transcribe` with a recorded blob).
  `MAX_TRANSCRIBE_BYTES = 5 MB`. Server env: `FISH_API_KEY`,
  `FISH_VOICE_ID`, `META_API_KEY`, `META_API_BASE_URL=https://api.meta.ai/v1`
  (allowlist enforced in `src/server/meta/adapter.ts`).
- Records/domain: `src/domain/move-in-ready.ts` — 11 elements
  (`MOVE_IN_READY_ELEMENTS`), `EvaluatorSignoff` {evaluatorName,
  typedSignature, attested, signedAt} + `validateEvaluatorSignoff`,
  decisions carry `inPersonCheckAcknowledgment` (written at save; saving
  IS the acknowledgment — no per-item checkbox; do not re-add one),
  fire safety stores `fireSafetyAssessment` {unitDetectors (11a),
  publicAreaDetectors (11b)}. Review queue `guidedReviewQueue` in
  `src/features/walkthrough/guided-tour.ts` covers all 11 elements
  including draft-less ones.
- Exports: `buildExportFile` in `move-in-ready-flow.tsx`; builders in
  `src/export/move-in-ready-pdf.ts` (`buildHmisReadyJson`,
  kinds `client-file` | `landlord-fix-list` | `hmis-ready` PDF + JSON);
  share sheet via `src/features/walkthrough/export-share.ts`
  (`canShareExportFiles`). Exports already gate on complete decisions +
  sign-off + LAHSA funding.
- New env vars you add must be server-only, optional, and safe when
  unset (document each in your change-log entry). The app must build and
  pass all gates with none of them set.

## Sprint 0 — Analysis speed package (REQ-S1…S6)

Goal: 5 filmed rooms analyzed in ≈5 minutes wall-clock (from 20–45 min),
measured on the staged clips, with the measurement recorded honestly.

- **REQ-S1 — SAM concurrency 3 → 6, env-tunable.** In
  `src/server/video/meta-sam.ts`, replace the hardcoded
  `MAX_CONCURRENT_SAM_CONCEPTS = 3` with env `SAM_MAX_CONCURRENT_CONCEPTS`
  (parse int, clamp 1–6, default 6). Verification step (required, not
  optional): run one live segment request against the dev deployment or
  `npm run test:live` path with 6 concepts and record in the change log
  whether Meta accepted 6 concurrent concept calls. If rate-limited
  (429/5xx attributable to concurrency), set the default to 4 and record
  that instead. Never claim the 6-wide figure without that record.
- **REQ-S2 — Two rooms concurrently.** Rework the batch driver in
  `move-in-ready-flow.tsx` so up to 2 `analyzeRoom` pipelines run at
  once. All existing guards must keep working per room: generation
  counter, `analysisIsCurrent` identity checks, cancel (cancels every
  in-flight room), `batchFailedRooms`, progress = completed rooms of
  total. The server is stateless per request — verify two concurrent
  segment requests cannot cross-contaminate (request identity is the
  isolation key; add a unit test with two interleaved mocked pipelines
  proving proposals land on the correct room/video identity).
- **REQ-S3 — 30 s analysis cap.** Server-side, in the segment stage:
  analysis (frames, SAM, retained stills) uses only the first 30 s of
  the clip (`ANALYSIS_CLIP_CAP_SECONDS = 30` constant; FFmpeg `-t 30`
  on the analysis copy). The stored original is untouched. Evidence
  timestamps ≥30 s must not appear. Segment response and the tour's
  analyze node state plainly: "Analysis uses the first 30 seconds —
  film the shot list, then stop." Unit test: a >30 s staged clip yields
  no evidence at ≥30 000 ms.
- **REQ-S4 — Smaller map payload.** `MAX_MUSE_SAMPLE_STILLS` 30 → 12,
  `MAX_MUSE_SAMPLE_TOTAL_BYTES` 8 MB → 4 MB in `meta-sam.ts`. Keep
  still selection deterministic (earliest per concept). Existing unit
  tests updated only where they assert the old constants.
- **REQ-S5 — Analyze on save.** When a room clip is saved
  (`handleClipChange` path) and tour consent is granted, funding is
  LAHSA, mode is live, and the browser is online, enqueue that room for
  analysis immediately (dedupe against the batch queue; the manual
  "Analyze" action then covers only rooms not yet analyzed/queued).
  Offline at save time: do nothing in this sprint (Sprint 3 persists
  the queue). Analysis still never auto-decides anything.
  Test: saving a clip with consent + LAHSA funding + live mode +
  online enqueues that room (deduped); saving while offline or
  without consent enqueues nothing.
- **REQ-S6 — Concept cleanup.** In `VIDEO_PROMPTS`: bathroom loses
  `smoke detector` and `carbon monoxide detector`; kitchen loses
  `carbon monoxide detector`. (Bathroom voice checks and shot lists
  already match; this completes the removal server-side.) Update the
  shot-list unit test expectations accordingly.

Sprint 0 acceptance: staged-clip timing recorded in the change log
(segment + map seconds per room, before/after); full gates green
(command list at the end of this file); no proposal content changes
beyond fewer concepts.

## Sprint 1 — Meta voice + form legitimacy (REQ-V1, REQ-F1, REQ-F2)

- **REQ-V1 — Muse Voice Transcribe for ASR.** New server module
  `src/server/voice/muse-transcribe.ts`. Facts (Meta cookbook,
  `06_muse_voice/01_voice_api_fundamentals`): batch endpoint
  `POST https://api.meta.ai/v1/asr/transcribe`, model
  `muse-voice-transcribe-1.0`, input = mono 16-bit WAV at 24 kHz
  (16 kHz accepted). Before coding the request body, read the cookbook's
  `transcribe_file.py`/`utils.py` and mirror its exact wire format;
  record the format in a code comment. Implementation: take the existing
  mic blob bytes in `handleTranscribeRequest`, convert to WAV (mono,
  24 kHz, s16) with the server FFmpeg (same binary resolution as the
  video pipeline, `FFMPEG_PATH`), POST with `META_API_KEY` (base URL
  must pass the existing `META_API_ALLOWLIST`), model from env
  `META_TRANSCRIBE_MODEL` (default `muse-voice-transcribe-1.0`).
  Provider selection: env `VOICE_ASR_PROVIDER=muse|fish`, default
  `muse`. On any Muse failure (HTTP, timeout 20 s, empty text is NOT a
  failure — it means silence), fall back to Fish `transcribeAudio` and
  include `providerUsed` in the JSON response; the client surfaces
  "Transcribed by backup provider" in the voice status line. Silent
  fallback is a rule-4 violation. Keep `MAX_TRANSCRIBE_BYTES`, byte
  validation, and error-code mapping style of `fish.ts`. TTS stays Fish.
  Tests: unit (mocked fetch) for success, fallback-on-error,
  providerUsed propagation, WAV conversion args; existing voice e2e
  stays green.
- **REQ-F1 — Participant co-signature (dual attestation).** Research
  requirement: Form 1083 is validated by BOTH the evaluator and the
  program participant. In `src/domain/move-in-ready.ts` add
  `ParticipantSignoff` {participantName, typedSignature, attested,
  signedAt} mirroring `EvaluatorSignoff`, plus
  `PARTICIPANT_ATTESTATION_TEXT` = "I walked through this unit with the
  evaluator. The findings above match what I saw." (plain language; no
  legal claims beyond that), `validateParticipantSignoff` mirroring
  `validateEvaluatorSignoff`, and record field
  `participantSignoff: ParticipantSignoff | null`. Sign-off step UI
  (`move-in-ready-flow.tsx`): participant block after the evaluator
  block (typed name, type-to-sign, attestation checkbox — this is a
  signature attestation, allowed; the banned pattern was per-item
  decision checkboxes). Every place that resets `signoff` (room toggle,
  decision clear, session switch) also resets `participantSignoff`.
  `buildExportFile` additionally requires `participantSignoff` with
  honest error copy. All PDFs and the JSON render/include both
  signatures. Privacy: store name + typed signature only — no new
  identifiers (VAWA posture). Tests: unit validation (mirror the
  evaluator sign-off tests), e2e: export buttons stay disabled until
  both signatures exist, then exports succeed.
- **REQ-F2 — Visual alarms (Form 1083 fire safety 10c).** Record field
  `participantVisualAlarmsRequired: boolean` (default false), toggled
  in Profile ("Participant needs visual (strobe) alarms"). When true:
  bedroom and hallway room checks gain "Is a working visual strobe
  alarm installed for the sleeping area?" (checks derivation must
  become record-aware — add a `checksForRoom(record, roomId)` helper
  where the tour derives `room-check` nodes; keep the constant table
  as the base), and the Fire Safety criteria text mentions visual
  alarms. No new SAM concept (protects Sprint 0 timing). Tests: unit
  derivation on/off; the guided-tour e2e gains one assertion only if
  it stays fast (flag on → strobe question appears in bedroom).

## Sprint 2 — Workflow outputs (REQ-E1, REQ-E2, REQ-E3)

- **REQ-E1 — LAHSA-schema JSON export.** New builder
  `src/export/lahsa-1083.ts` exporting `buildLahsa1083Json(input)`,
  wired as export kind `lahsa-1083-json` in `buildExportFile` with a
  "LAHSA JSON" button beside the existing JSON button. Shape (from the
  program's published data specification): `inspection_id` (= sessionId),
  `inspection_timestamp`, `checklist_criteria` with boolean keys
  `structure_materials, space_security, interior_air_quality,
  water_supply, sanitary_facilities, thermal_environment,
  illumination_electricity, food_preparation, sanitary_condition,
  additional_standards` (A → true, D → false) and nested `fire_safety`:
  `emergency_exit` (Access decision), `unit_smoke_detectors`
  (fireSafetyAssessment.unitDetectors), `common_area_detectors`
  (publicAreaDetectors), `visual_alarms_required` (REQ-F2 flag),
  `visual_alarms_approved` (true only when the flag is on and Fire
  Safety is A; null when the flag is off). `overall_determination`:
  "APPROVED" only when every criterion is true, else "NOT APPROVED"
  (any D or needs-human-check ⇒ not APPROVED, matching the repo's
  approved/not-approved result convention) — derived, never stored
  independently; an internal assertion must make an inconsistent
  export impossible. `signatures`:
  `participant_signature` + `staff_signature` {name, signature text,
  timestamp}. Fields this app does not hold (address, HMIS ids) are
  emitted as null — never invented. Top-level
  `mapping_notice: "Demo checklist — not a verified Form 1083 mapping."`
  (rule 7). Existing gates apply (complete decisions, both signatures,
  LAHSA funding); needs-human-check counts as incomplete and blocks.
  Tests: unit mapping matrix (each element A/D), determination
  derivation, fire-safety subfields, blocked states, null-not-invented
  fields.
- **REQ-E2 — HMIS case note.** Export kind `case-note` (plain text,
  `text/plain`, shareable via the existing share path). Deterministic
  template from the record: date, unit pseudonym, determination (same
  derivation as REQ-E1), one line per decided element (label, A/D,
  one-line rationale clipped to 200 chars), evaluator + participant
  names, and for any D: correction + completion/reinspection dates and
  the sentence "Re-inspection required before subsidy release." Optional
  polish: only behind env `TEXT_POLISH_ENABLED=1` (default off), via a
  new server route using `src/server/meta/adapter.ts` with a system
  instruction to polish wording without adding facts, 30 s timeout;
  any failure returns the template. UI labels the result "Case note
  draft — review before pasting into HMIS." Tests: unit template
  content (D and all-A records), polish-off default path.
- **REQ-E3 — Landlord fix list, bilingual.** Extend the existing
  `landlord-fix-list` PDF (`src/export/move-in-ready-pdf.ts`) with a
  language parameter (`en` | `es`); UI gets "Fix list (EN)" and
  "Fix list (ES)" actions. Content per Deficient element: requirement
  label, deficient area, required correction, completion date,
  reinspection date, evidence stills (already supported). Add a
  plain-language header: what this document is, that each item must be
  corrected by its date, and that a re-inspection will verify. The ES
  strings live in one table in the export module; AI/model text is
  never used for the boilerplate. All decision/rationale text passes
  through the existing cleaning/escaping — add a unit test whose issue
  text contains `<script>`-like content and assert it is escaped in
  output. No landlord contact fields are invented; the agency name
  comes from the existing `evaluatorAgencyName` record field.

## Sprint 3 — Lifecycle (REQ-L1, REQ-L2, REQ-L3)

- **REQ-L1 — Re-inspection mode.** When a signed record has any D
  decision, Home's saved-inspection entry shows "Re-inspect
  deficiencies". Starting it: for each D element, snapshot the prior
  deficiency {issueDescription, correction, completionDate,
  reinspectionDate, evidence stillIds, decidedAt} into a new decision
  field `priorDeficiency`, then reset that decision to unreviewed
  (existing invalidation semantics; both sign-offs reset). The guided
  tour and review then queue only those elements (extend
  `guidedReviewQueue` with a re-inspection filter driven by
  `priorDeficiency` presence). Review cards show "Before" stills
  (from the snapshot) beside new evidence. `deriveFinalInspectionResult`
  is unchanged: any standing D still blocks completion; flipping every
  re-inspected item to A unblocks sign-off. Tests: unit snapshot +
  queue filter; e2e: decide one D → sign blocked → re-inspect →
  re-decide A → sign-off unblocked.
- **REQ-L2 — Offline analysis queue.** Persist `analysisQueue: roomId[]`
  on the record. Clip save always enqueues (extends REQ-S5); a queue
  runner starts queued rooms when `navigator.onLine`, on `online` and
  `visibilitychange` events, max 2 concurrent (Sprint 0 scheduler).
  Capture UI shows a per-room "Analysis queued" chip; the tour analyze
  node shows queued/in-progress counts. Removing a room removes its
  queue entry; changing a clip re-queues that room (identity rules
  unchanged). Tests: unit queue add/dedupe/remove/re-queue; e2e with
  Playwright offline: go offline, save a clip, chip appears; go
  online, stubbed analysis route is called.
- **REQ-L3 — GPS attestation.** Sign-off gains an explicit "Add
  location" button (never auto-prompt). On tap:
  `navigator.geolocation.getCurrentPosition` (10 s timeout); store
  `inspectionLocation` {lat, lng rounded to 3 decimals (~100 m),
  accuracyM, capturedAt} on the record. Denied/unavailable shows
  "Location not recorded" and never blocks signing or exports.
  REQ-E1's JSON gains `property_address: { geolocation }` from this
  field (still null otherwise). Unit tests: rounding, denial path,
  no-block assertions.

## Sprint 4 — Reach, honesty-gated (REQ-R1…R4)

- **REQ-R1 — LAHD building pre-screen (illustrative-first).** A Profile/
  Home card "Building pre-screen" with an address text input. Default
  behavior (required): shows an explainer and a clearly labeled
  **example** result for the literal demo address "123 Demo St
  (example)" — banner `Illustrative example — live records not
  connected.` Querying any other address in default mode answers
  "Live check not connected for this address." Only if you locate the
  official LAHD code-enforcement dataset on data.lacity.org, verify
  its dataset id + fields against the portal, and cite both in a code
  comment and the change log, may you wire a live query behind env
  `LAHD_PRESCREEN_LIVE=1` (default off). Presenting fixture data as a
  real building's record is a rule-2/4 violation and fails the sprint.
- **REQ-R2 — Spanish tour.** Record field `tourLanguage: "en" | "es"`
  (Profile toggle). Scope: guided-tour narration strings for the core
  nodes (welcome, unit setup, filming, room checks, analyze, review,
  sign-off) gain `es` variants in the existing script tables;
  `voice-parse` accepts sí/si/no and Spanish number words for the
  count questions. TTS uses env `FISH_VOICE_ID_ES`; when unset, the ES
  toggle is disabled with the honest note "Spanish voice not
  configured." Pre-rendered voice inventory (`scripts/voice-inventory.mjs`)
  covers ES prompts the same way as EN. The AI Guide popup stays
  English and says so. Tests: unit parse (sí/no/números), EN tour e2e
  unchanged.
- **REQ-R3 — Guided detector test shot.** In rooms contributing to
  Fire Safety (bedroom, living-room, hallway), after the detector
  presence check, the tour shows "Press the detector's test button
  now" with a "Capture still" action that grabs the current camera
  preview frame (reuse the existing still-extraction path; if none
  exists in the tour view, a canvas snapshot of the live preview) and
  attaches it as evidence for `demo-smoke-co` with timestamp. The
  human still answers the chirp yes/no check — the still never
  substitutes for it. "Skip still" is allowed and records no claim.
  Acceptance: the captured still appears in the Fire Safety review
  evidence picker.
- **REQ-R4 — Accuracy scorecard.** Run the protocol in
  `docs/evaluation/video-clip-gate.md` (single ≤30 s staged clip:
  faucet + fan + lock + detector) against the live dev deployment.
  Record in `docs/DEMO.md`: date, model ids, clip id, per-concept
  hit/miss, and the miss list. In-app Settings/About line:
  "Demo checklist — not a verified Form 1083 mapping. Known AI
  misses are listed in the demo notes." No accuracy percentage may
  appear anywhere unless it comes from that recorded run.

## Sprint 5 — Observability (REQ-O1, REQ-O2)

Added after Sprints 0–4: the app runs but AI failures are opaque.
Instrument before changing Muse prompts or rewriting the pipeline.

- **REQ-O1 — Langfuse pipeline tracing.** New server-only module
  `src/server/observability/langfuse-trace.ts`: `isLangfuseConfigured`
  (both `LANGFUSE_SECRET_KEY` + `LANGFUSE_PUBLIC_KEY` required,
  optional `LANGFUSE_BASEURL` defaulting to cloud), deterministic
  `analysisTraceId` shared by the segment and map stages of one
  attempt, no-op-safe `AnalysisTracer` (span/generation/flush never
  throw; unset keys mean zero overhead and no network calls), and
  `runSpan`/`runSpanSync` phase wrappers that fail spans with safe
  codes and rethrow. Hooks in `src/server/video/meta-sam.ts`:
  `preflight-decode`, `sam-upload`, per-concept `sam-concept:*`
  (labels, boxes, confidences), `select-candidates`,
  `frame-decode`, a `muse-map` generation (model, still references,
  instructions SHA-256, raw response text), and
  `validate-proposals` (raw vs kept claim counts, per-element
  summaries); one best-effort flush per request. Sanitization is
  structural: metadata only — never media bytes/base64, pseudonyms,
  names, keys, or provider bodies (Muse response text excepted as
  the debugging target). The module is imported only by
  server code; verify no client path reaches it.
  Tests: unit gating/trace-id/no-op/`runSpan` success+failure
  (no network); existing segment/map suites stay green.
- **REQ-O2 — Eval dataset.** New pure module
  `src/server/observability/eval-cases.ts`: dataset
  `meta-inspect-walkthrough-v1`, five dimensions
  (water-flow-accuracy, object-classification, evidence-grounding,
  uncertainty-abstention, false-positives), validated
  `buildEvalCaseItem` (references only: room, clip SHA-256, task,
  expected), and `seedEvalCases` against the staged kitchen/bathroom
  clips. Owner-run push script `scripts/langfuse-eval-push.mjs`
  (`--dry-run` prints without sending; refuses invented hashes and
  missing keys; never in CI). Scoring runs in Langfuse against
  recorded traces. Tests: unit builders/validation/seed coverage.

## Gates — run after every sprint, all must pass before its commit

```bash
node scripts/verify-sdd.mjs          # exit 0
npm run lint                         # 0 errors (3 known warnings ok)
npm run typecheck                    # clean
npm run test:unit                    # all pass
npm run build                        # success — required before e2e
npx --no-install playwright test --workers=1   # all pass
```

`npm run test:live` spends real Meta money and is owner-gated: do not
run it unless the owner approves the spend in writing; fixture results
never prove live behavior, and your change-log entries must say which
mode each verification used. If a gate fails on code you did not touch,
re-run it on the base commit and report the comparison — never skip,
deselect, or weaken a failing test to get green.

## Definition of done (per sprint)

Gates green; new behavior covered by the tests named in its REQs;
`02-design.md` + `05-change-log.md` updated with REQ ids, env vars, and
honest verification mode (fixture vs live); one commit on
`muse-code/sprints`; a short report to the owner listing: REQs done,
files changed, gate outputs, anything verified live vs fixture, and
open risks. No deploy, no merge — the owner takes it from there.


