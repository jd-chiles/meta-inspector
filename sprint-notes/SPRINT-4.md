# Sprint 4 notes — REQ-R1..R4 (Reach, honesty-gated)

Base: clean dev HEAD `1164a9f` (`git status` clean before work; work left
uncommitted per instructions). `02-design.md` / `05-change-log.md` NOT edited;
verbatim text for the integrator is at the bottom of this file.

## REQs done

- **R1 — Building pre-screen, illustrative-first.** New Home card
  `Building pre-screen` with an address input. Blank → explainer only;
  literal `123 Demo St (example)` → labeled example result with banner
  `Illustrative example — live records not connected.`; anything else →
  `Live check not connected for this address.` No live LAHD query is wired:
  the official code-enforcement dataset was not verified against
  data.lacity.org this sprint, so no `LAHD_PRESCREEN_LIVE` path exists.
  The query is never persisted or sent anywhere (address hygiene).
- **R2 — Spanish tour.** Record field `tourLanguage: "en" | "es"`
  (Profile → Unit panel radio; ES disabled with `Spanish voice not
  configured.` unless server `FISH_VOICE_ID_ES` is set). ES narration for
  welcome, setup questions, filming cues + shot lists + film intro,
  room checks, analyze, review-item scripts + review voice question,
  name read-back, and finish/sign-off scripts; `voice-parse` accepts
  sí/si/no (+claro) and Spanish number words for unit/bath counts.
  TTS: `POST /api/voice/speak` accepts `{language: "es"}` and uses the
  `FISH_VOICE_ID_ES` owner voice (fails closed 503 when unset); static
  inventory `VOICE_CLIP_TEXTS_ES` + `generate-voice.mjs --lang es` write
  `public/voice/es/` clips + manifest. AI Guide popup stays English and
  says `This guide answers in English.` when the tour is Spanish.
- **R3 — Guided detector test shot.** On bedroom/living-room/hallway
  detector-presence check cards, below the yes/no check:
  `Press the detector's test button now` with `Capture still` (explicit
  tap starts the camera preview; `Save still` takes a canvas snapshot of
  the live preview, JPEG ≤1280px/1MP/512KiB) and `Skip still` (records
  no claim). The still is stored on the room's current clip and appended
  to its clip-identity evidence (`frameIndex: null`, `detector-test-`
  still id), so it appears in the Fire Safety (`demo-smoke-co`) review
  evidence picker labeled `live detector-test capture`. The human's
  chirp yes/no answer is unchanged and never substituted.
- **R4 — Accuracy scorecard.** In-app About line added (Profile → More
  settings & privacy → About this checklist):
  `Demo checklist — not a verified Form 1083 mapping. Known AI misses are
  listed in the demo notes.` `docs/DEMO.md` gained a Sprint 4 scorecard
  shell with BLANK run fields. The live single-clip protocol run is
  DEFERRED (see Risks). No accuracy percentage appears anywhere.

## Files changed

Modified (24):

- `src/features/walkthrough/voice-parse.ts` — accent-insensitive
  normalize; sí/si/claro yes; estudio/dormitorio/habitación unit Types;
  uno…ocho + baño(s) bath counts.
- `src/features/walkthrough/voice-checks.ts` — `VOICE_ROOM_CHECKS_ES`,
  `SETUP_VOICE_QUESTIONS_ES`, `TOUR_REPROMPTS_ES`.
- `src/features/walkthrough/assistant-script.ts` —
  `ASSISTANT_FILMING_SCRIPTS_ES`; `filmingScriptForRoom(roomId, lang?)`.
- `src/features/walkthrough/guided-tour.ts` — `TOUR_SCRIPT_ES`,
  `roomLabelEs`, `REVIEW_VOICE_QUESTION(_ES)`, `nameReadbackScript`,
  `tourScriptForNode(..., lang?)`, `filmRoomShots(..., lang?)`,
  `filmRoomScript(..., lang?)`; check sequencing reads
  `record.tourLanguage`. All EN strings byte-identical.
- `src/features/walkthrough/guided-tour-view.tsx` — `lang` wiring for
  scripts/questions/reprompts/cues; Sí/No/Omitir check buttons;
  detector-test panel on detector cards; new required binding
  `attachDetectorStill`.
- `src/features/walkthrough/inspection-store.ts` — `TourLanguage`,
  `tourLanguage` field (default `"en"`, legacy→`"en"`, else invalid).
- `src/features/walkthrough/voice-manifest.ts` — per-language manifests
  (`/voice/manifest.json`, `/voice/es/manifest.json`).
- `src/features/walkthrough/voice-conversation.ts` — `speakPrompt`
  `{language}` option (EN wire format unchanged).
- `src/features/walkthrough/voice-prompt.tsx` — optional `language` prop.
- `src/features/walkthrough/assistant-guide.tsx` — optional
  `tourLanguage` prop; English-only note when `"es"`.
- `src/features/walkthrough/move-in-ready-flow.tsx` — `esVoiceConfigured`
  prop; `setTourLanguage` (no sign-off reset: presentation preference);
  `attachDetectorStill`; Home pre-screen card; Profile language toggle;
  About disclosure; picker live-capture label; tour binding.
- `src/server/voice/fish.ts` — `resolveFishConfigForLanguage`
  (`FISH_VOICE_ID_ES` for `"es"`; transcribe path untouched).
- `src/server/voice/handlers.ts` — speak body `{text, language?}`;
  invalid language → 400; ES-unconfigured → 503. Cache already
  voice-scoped.
- `src/app/page.tsx` — server-computed `esVoiceConfigured` prop.
- `scripts/voice-inventory.mjs` — `VOICE_CLIP_TEXTS_ES`; EN list gains
  the review voice question + detector prompt.
- `scripts/generate-voice.mjs` — `--lang es` (ES voice id, ES texts,
  `public/voice/es/`).
- `.env.example` — documents `FISH_VOICE_ID_ES`.
- `docs/DEMO.md` — R4 scorecard shell (blank fields, run deferred).
- Tests: `voice-parse`, `voice-inventory`, `guided-tour`,
  `voice-manifest`, `inspection-store`, `server/voice/handlers`
  (all extended, see below).

Added (5):

- `src/features/walkthrough/building-prescreen.tsx` (+ `DEMO_PRESREEN_ADDRESS`,
  `prescreenDecisionForAddress` pure routing).
- `src/features/walkthrough/detector-test.ts` (prompt constants, room/
  question matchers, free-timestamp slot, reference builder).
- `src/features/walkthrough/detector-test-capture.tsx` (two-step
  capture UI; camera starts only on tap).
- `tests/unit/walkthrough/detector-test.test.ts`
- `tests/unit/walkthrough/building-prescreen.test.ts`

Not edited: `02-design.md`, `05-change-log.md` (integrator owns).

## Tests + results (all fixture/offline; `test:live` never run)

- `npx vitest run <8 touched files>` — **87/87 pass** (new: ES parse
  2 tests, ES inventory 3 + EN prompt coverage 1, ES tour 2, ES
  manifest 1, tourLanguage store 1, ES speak handler 3, detector 4,
  prescreen 3).
- Full `npx vitest run` — **42 files, 501 passed / 3 skipped** (base:
  481/3; +20 new, zero regressions).
- `npx tsc --noEmit` — **clean**.
- `npx eslint <all touched files>` — **0 errors**; 3 warnings in
  `move-in-ready-flow.tsx` batch effects, proven pre-existing via
  `eslint --stdin` on the `HEAD` version (same 3, shifted lines).
- Full `npm run lint` — 0 errors, same 3 warnings. `node
  scripts/verify-sdd.mjs` — exit 0.
- NOT run per instructions: e2e, build (integrator runs once),
  `test:live` (owner-gated spend).

## Missing symbols (cross-sprint refs)

None. Every cross-sprint reference resolved against base HEAD:

- R3 evidence target `demo-smoke-co` exists in
  `MOVE_IN_READY_ELEMENTS` (all room types contribute, so room-bound
  detector stills surface in its picker with no sibling API).
- R3 still path reuses base `addStillsIfSourceMatches`,
  `findVerifiedEvidenceStill`, `sha256Blob`, `EvidenceReference`
  (`frameIndex: null` local-still convention).
- R2 touches only base voice/tour modules; transcribe/ASR untouched
  (Sprint 1 V1 area — no conflict, no shared edit).
- R2 `FISH_VOICE_ID_ES` is new and self-contained (server-only,
  optional, safe unset; app builds/tests green without it).
- R1 adds no env var (live path deferred). R4 adds no code refs.

## Risks / integrator notes

1. **E2E + build not run here** (per instructions). EN tour paths are
   byte-identical and all EN unit/e2e-adjacent contract tests pass,
   but the integrator's e2e run is the proof.
2. **No live verification.** No provider calls were made. In
   particular: the ES Fish voice, ES live-speech path, and ES static
   clips (`public/voice/es/*`, needs owner-approved billed
   `generate-voice --lang es` with `FISH_VOICE_ID_ES`) are all
   unproven against the provider.
3. **R3 sequencing interpretation.** The detector prompt + capture
   render *below the check on the same room-check card* (tour engine
   untouched, zero e2e churn) rather than as a separate post-answer
   node. All testable criteria hold: prompt shown, still attaches to
   Fire Safety evidence, check still answered by the human, skip
   records nothing.
4. **Mid-tour language switch** re-asks checks (answers key by
   question text per language). ES answers are invisible to the
   capture-screen EN check list (`advanceVoiceTurn` stays EN — R2
   scope is the tour). Harmless but asymmetric; noted, not fixed.
5. **Fish ASR language stays `"en"`** for transcription (transcribe
   path untouched; Sprint 1 sibling area). Spanish recognition
   quality is unverified — parse handles ES text once transcribed.
6. **Detector still timestamp is a free storage slot** in the clip's
   still timeline, not a video moment (required by the
   timestamp-keyed still resolution). Picker labels it `live
   detector-test capture`; replacement clips preserve its bytes as
   generic evidence.
7. **Sibling-merge watch:** Sprint 1 F2 (record-aware `checksForRoom`)
   may add questions — `isDetectorPresenceQuestion` matches by text,
   not index, so it stays correct. Sprint 2 E3 (ES fix list) and
   Sprint 1 V1 (transcribe provider) touch disjoint code.
8. **R4 live run deferred** to owner/integrator with spend approval;
   DEMO.md shell holds blank fields until then.

## Verbatim change-log entry (for `05-change-log.md`)

```md
### Sprint 4 — REQ-R1…R4: reach, honesty-gated (fixture-verified, no live calls)

- REQ-R1 (Building pre-screen, illustrative-first): new Home card with an
  address input. Blank input shows the explainer; the literal demo address
  `123 Demo St (example)` shows a labeled example result under the banner
  `Illustrative example — live records not connected.`; any other address
  answers `Live check not connected for this address.` No live LAHD query
  is wired — the official code-enforcement dataset was not verified against
  data.lacity.org, so no `LAHD_PRESCREEN_LIVE` path exists. Queries are
  never persisted or sent anywhere. Verification: fixture unit tests only.
- REQ-R2 (Spanish tour): new record field `tourLanguage: "en" | "es"`
  (Profile toggle; legacy records default `"en"`). Spanish narration for
  the welcome, setup, filming, room-check, analyze, review, and sign-off
  tour scripts; `voice-parse` accepts sí/si/no and Spanish number words
  for unit/bath counts. New server-only optional env `FISH_VOICE_ID_ES`
  (documented in `.env.example`; safe unset — the app builds and all
  gates pass without it): TTS uses it for `language: "es"` speak
  requests and fails closed (503) when unset, in which case the ES
  toggle is disabled with `Spanish voice not configured.` Static
  inventory `VOICE_CLIP_TEXTS_ES` + `generate-voice.mjs --lang es`
  target `public/voice/es/` (not yet generated — needs owner-approved
  billed synthesis). The AI Guide popup stays English and says so.
  Review/sign-off/exports and the Form 1083 catalog stay English.
  Verification: fixture unit tests only; no live Spanish TTS/subtitle
  run was made.
- REQ-R3 (Detector test shot): bedroom/living-room/hallway detector
  check cards show `Press the detector's test button now` with
  `Capture still` (camera starts only on tap; canvas snapshot of the
  live preview, JPEG ≤1280px/1MP/512KiB) and `Skip still` (records no
  claim). The still is stored on the room's current clip as local
  evidence (`frameIndex: null`, `detector-test-` still id) and appears
  in the Fire Safety review evidence picker labeled as a live capture.
  The human chirp yes/no answer is unchanged. Verification: fixture
  unit tests only.
- REQ-R4 (Accuracy scorecard): in-app About line under Profile → More
  settings & privacy → About this checklist; `docs/DEMO.md` holds the
  scorecard shell with BLANK run fields — the live single-clip protocol
  run is deferred to the owner/integrator (`test:live` spend-gated).
  No accuracy percentage appears anywhere. Verification: none yet
  (pending the recorded run).
```

## Verbatim design text (for `02-design.md`)

```md
### Sprint 4 — Reach, honesty-gated (REQ-R1…R4)

- Pre-screen is illustrative-first: the Home card answers only the
  literal demo address from a labeled example and reports every other
  address as not connected. No building data is persisted, and no live
  records call exists until an LAHD dataset is verified and cited.
- The guided tour is bilingual in narration only. `tourLanguage` on the
  inspection record selects English or Spanish tour scripts, setup
  questions, filming cues, room checks, reprompts, and review/finish
  narration; check sequencing, review detail, sign-off, exports, and
  the Form 1083 catalog stay English. Spanish speech uses the separate
  server-only `FISH_VOICE_ID_ES` owner voice for live TTS and for
  `public/voice/es/` pre-generated clips; without it the ES toggle is
  disabled and ES speak requests fail closed. Voice answers parse in
  both languages through the shared deterministic parser.
- The detector test is evidence-only: a live-preview still captured
  beside (never instead of) the human's detector yes/no answer, stored
  on the room's current clip under a `detector-test-` still id with a
  free still-timeline slot, and surfaced in the Fire Safety evidence
  picker as a live capture. Skip records nothing; failures return
  messages and never block the tour.
- Accuracy claims stay gated: the app carries the demo-checklist
  mapping notice plus a pointer to the demo-notes miss list, and the
  scorecard shell in `docs/DEMO.md` holds blank fields until the
  recorded live protocol run fills them.
```
