# Sprint 1 notes — REQ-V1, REQ-F1, REQ-F2 (Meta voice + form legitimacy)

Base: clean dev HEAD 1164a9f (verified `git status` clean before work).
Left dirty, uncommitted, per delegation. Did NOT edit 02-design.md or 05-change-log.md;
verbatim text for the integrator is at the bottom of this file.

## Files changed

New:
- src/server/voice/muse-transcribe.ts — Muse Voice Transcribe ASR client (REQ-V1).
- tests/unit/server/voice/muse-transcribe.test.ts — config, WAV args, cookbook wire format, error mapping.
- tests/unit/walkthrough/voice-checks.test.ts — checksForRoom on/off/unknown (REQ-F2).

Modified (src):
- src/server/voice/handlers.ts — VOICE_ASR_PROVIDER selection (default muse), flagged Fish
  fallback, providerUsed in transcribe responses. Speak path untouched (TTS stays Fish).
- src/features/walkthrough/voice-conversation.ts — transcribeClip returns { text, providerUsed }.
- src/features/walkthrough/voice-prompt.tsx — "Transcribed by backup provider" status line.
- src/domain/move-in-ready.ts — ParticipantSignoff, PARTICIPANT_ATTESTATION_TEXT,
  validateParticipantSignoff. deriveFinalInspectionResult UNCHANGED (still evaluator-based).
- src/features/walkthrough/inspection-store.ts — record fields participantSignoff |
  null and participantVisualAlarmsRequired (default false); validation with legacy
  defaults; stale-version reset of participantSignoff (flag preserved); all migration
  paths default the new fields.
- src/features/walkthrough/voice-checks.ts — VISUAL_STROBE_ALARM_CHECK + checksForRoom(record, roomId).
- src/features/walkthrough/guided-tour.ts — firstUnansweredCheck via checksForRoom.
- src/features/walkthrough/guided-tour-view.tsx — room-check question via checksForRoom.
- src/domain/element-criteria.ts — checklistItemsForElement(record, elementId); Fire Safety
  gains VISUAL_ALARMS_FIRE_SAFETY_CRITERION when the flag is on. Constant tables unchanged.
- src/features/walkthrough/move-in-ready-flow.tsx — participant sign-off block + save/revoke,
  dual resets at every signoff reset (profile, unit, room toggle, save/clear decision,
  needs-check, inspection note, revoke, session-switch UI reset, 4 invalidation helpers),
  buildExportFile participant gate, export buttons + help text, Profile visual-alarms toggle,
  capture checks + advanceVoiceTurn via checksForRoom, review criteria via helper.
- src/export/move-in-ready-pdf.ts — MoveInReadyExportInput requires participantSignoff;
  HMIS JSON gains participant block; all 3 PDFs render both signatures; assertExportable gates.

Modified (tests):
- tests/unit/server/voice/handlers.test.ts — fish selection, muse default, fallback, both-fail,
  bad provider, providerUsed propagation.
- tests/unit/domain/move-in-ready.test.ts — participant validation mirror.
- tests/unit/domain/element-criteria.test.ts — criteria on/off.
- tests/unit/walkthrough/guided-tour.test.ts — flag on yields room-check bedroom index 2.
- tests/unit/walkthrough/inspection-store.test.ts — defaults + validation.
- tests/unit/export/move-in-ready-pdf.test.ts — fixture + gate/JSON/PDF participant tests.
- tests/e2e/move-in-ready.spec.ts — both sign-and-export tests do dual sign-off; the 11-decision
  test asserts exports stay disabled after evaluator-only sign, then succeed after both.

## Tests + results

- `npx tsc --noEmit` — clean.
- `npx eslint` on all 21 touched/new files — 0 errors; 3 warnings, all pre-existing in
  move-in-ready-flow.tsx (react-hooks/exhaustive-deps, tolerated per prompt).
- `npm run test:unit` (full) — 42 files, 508 passed / 3 skipped (baseline 481/3; +27 new, 0 regressions).
- Touched suites individually green (voice, walkthrough, domain, export).
- `node scripts/verify-sdd.mjs` — exit 0.
- NOT run: e2e, build (integrator runs once), test:live (owner-gated spend).

## Missing symbols (cross-sprint refs)

None. Sprint 1 exposes for siblings, exactly per prompt contracts:
- REQ-F2 → Sprint 2 REQ-E1: record.participantVisualAlarmsRequired: boolean (default false).
- REQ-F1 → Sprint 2 REQ-E1/E2: record.participantSignoff: ParticipantSignoff | null
  { participantName, typedSignature, attested, signedAt }; export JSON participant block
  { name, typedSignature, attested, attestationText, signedAt }.
- checksForRoom(record, roomId) in voice-checks.ts for any sibling deriving room checks.
Sprint 1 consumes no sibling-owned symbols.

## Risks / integrator notes

1. transcribeClip return shape changed string → { text, providerUsed }. Only in-repo caller
   (voice-prompt.tsx) updated; e2e voice stubs omit providerUsed and the client tolerates that
   ("unknown", no backup line). Any sibling calling transcribeClip must use .text.
2. /api/voice/transcribe now answers providerUsed: "muse" | "fish". Default provider is muse.
3. deriveFinalInspectionResult intentionally unchanged (e2e "Not Approved"/"Approved" result
   text after evaluator-only sign is preserved); the second signature is enforced in
   buildExportFile, assertExportable, and the export-button disabled props.
4. Evaluator revoke clears BOTH sign-offs (literal "every place that resets signoff" rule);
   participant revoke clears only the participant side. Either sign order is allowed.
5. HmisReadyJson schema string kept at move-in-ready-hmis-draft-v2 (additive participant field).
6. No live Meta ASR verification (fixture only; test:live not run). Muse path needs META_API_KEY
   (or MODEL_API_KEY alias) + server FFmpeg; without them it falls back to Fish, flagged.
7. F2 guided-tour e2e assertion skipped: covering flag-on-in-bedroom at unit level
   (guided-tour.test.ts) instead — an e2e would need a full extra tour run with video uploads.
   Existing voice e2e (stubbed transcribe) unaffected by design; integrator's e2e run confirms.
8. Worst-case transcribe latency is ~20s Muse + 60s Fish fallback vs route maxDuration 60s;
   the Fish leg can be cut off on slow failures (surfaces as failure, never silent).

## Verbatim change-log entry (for 05-change-log.md)

Sprint 1: REQ-V1, REQ-F1, REQ-F2 — Meta voice + form legitimacy (fixture-verified; no live
Meta ASR call made, test:live not run).
- REQ-V1: ASR provider is Muse Voice Transcribe by default (POST {base}/asr/transcribe,
  model muse-voice-transcribe-1.0, cookbook multipart: JSON "request" part { mode
  PUSH_TO_TALK, model, audioEncoding WAV } + WAV "audio" part; mic clips converted to mono
  24 kHz s16 WAV via server FFmpeg, 20 s timeout). New env, server-only/optional/safe-unset:
  VOICE_ASR_PROVIDER=muse|fish (default muse), META_TRANSCRIBE_MODEL (default
  muse-voice-transcribe-1.0). Any Muse failure falls back to Fish once with providerUsed
  in the response; the client shows "Transcribed by backup provider". Empty transcript is
  silence, not failure. TTS stays Fish. Key via META_API_KEY (MODEL_API_KEY alias); base URL
  must pass META_API_ALLOWLIST; contributor models rejected.
- REQ-F1: dual attestation. ParticipantSignoff { participantName, typedSignature, attested,
  signedAt } + PARTICIPANT_ATTESTATION_TEXT ("I walked through this unit with the
  evaluator. The findings above match what I saw.") + validateParticipantSignoff; record
  field participantSignoff (validated/stored; legacy records default null; name + signature
  only, VAWA posture). Sign-off UI has a participant block after the evaluator block; every
  signoff reset also resets participantSignoff (either sign order allowed); buildExportFile
  and all PDFs + HMIS JSON require and render both signatures; export buttons stay disabled
  until both exist.
- REQ-F2: record flag participantVisualAlarmsRequired (default false), Profile toggle
  "Participant needs visual (strobe) alarms". When on, bedroom/hallway checks gain "Is a
  working visual strobe alarm installed for the sleeping area?" via checksForRoom(record,
  roomId), and Fire Safety criteria mention visual alarms. No new SAM concept.
- Gates: tsc clean; eslint 0 errors (3 pre-existing warnings); unit 508 passed / 3 skipped;
  verify-sdd exit 0. E2E + build deferred to integrator; no live verification.

## Verbatim design text (for 02-design.md)

- ASR routing: handleTranscribeRequest validates the mic clip once (existing
  MAX_TRANSCRIBE_BYTES/sniff rules), then routes by VOICE_ASR_PROVIDER (default "muse").
  The Muse path (src/server/voice/muse-transcribe.ts) converts to WAV with server FFmpeg
  (FFMPEG_PATH, same resolution as video) and POSTs the Meta cookbook wire format with a
  20 s timeout. Any Muse error falls back to Fish transcribeAudio exactly once; the JSON
  response always carries providerUsed ("muse"|"fish") and the voice prompt surfaces the
  backup engine. Unknown provider values fail closed (503, no provider called).
- Dual sign-off: MoveInReadyInspection carries signoff and participantSignoff
  independently; all existing signoff invalidations clear both, while participant revoke
  clears only the participant side. Completion of rooms/decisions (deriveFinalInspectionResult)
  is unchanged; the participant signature is an additional export gate enforced in
  buildExportFile, export assertExportable, and the export-button disabled state (honest
  "Participant sign-off is required" copy). Exports embed a participant block mirroring the
  evaluator block (JSON) and both signatures plus both attestation texts (all PDFs).
- Record-aware checks: VOICE_ROOM_CHECKS and MOVE_IN_READY_ELEMENT_CRITERIA stay the
  constant base; checksForRoom(record, roomId) and checklistItemsForElement(record,
  elementId) append the strobe question / Fire Safety criterion only when
  participantVisualAlarmsRequired is true. All four room-check derivations (tour engine,
  tour view, capture section, voice-turn advance) and the review criteria panel use the
  helpers, so on/off behavior is consistent everywhere.
