# Submission draft — Meta Inspect: voice-led Form 1083 walkthroughs

Status: DRAFT for owner review. Facts below are verified in-repo unless
marked [NEEDS OWNER]. Deadline: Nov 4, 2026.

## Title / tagline

**Meta Inspect** — a voice-led mobile companion that walks a housing
navigator through a LAHSA Form 1083 habitability inspection, from unit
setup to signed export, with AI drafts grounded in filmed evidence.

## Problem

Housing navigators place vulnerable Angelenos into permanent supportive
housing, but every placement gates on a paper Form 1083 walkthrough:
eleven requirements, binary Approved/Deficient, zero tolerance (one
uncorrected deficiency blocks the subsidy). Navigators are time-pressed,
often junior, and work in basements with no signal. Missed evidence and
rejected packets delay move-ins by days.

## What it does (user journey)

1. Tap Start. A consistent voice guide narrates the whole inspection:
   unit setup (type, baths, consent), then room-by-room filming with
   shot lists, then spoken yes/no in-person checks per room.
2. Each filmed clip is analyzed: Meta SAM 3.1 locates fixtures in the
   footage; Muse Spark drafts a neutral observation per Form 1083
   requirement, with linked evidence stills (frame, timestamp, hash).
3. The evaluator reviews 11 requirements: one-tap Confirm on AI drafts
   or a detail form prefilled with their own spoken answers. Saving is
   the in-person acknowledgment — no checkbox gauntlets.
4. Dual sign-off (evaluator + participant), then local exports: client
   file, bilingual landlord fix list, LAHSA-schema JSON, HMIS-ready
   case note. Deficient units get a re-inspection mode covering only
   failed items, with before/after stills.

## Meta technology used

- **SAM 3.1** (`sam-3.1`, Meta Model API): fixture localization per
  room clip from a fixed prompt table (faucet, fan, detector, lock…).
- **Muse Spark 1.3** (`muse-spark-1.3`, Meta Model API): neutral draft
  observations + deficiency plans from retained stills; optional case-
  note polish. Baseten-hosted Muse fallback exists and is tested.
- **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`): speech-to-
  text for voice answers (server-side WAV conversion; flagged Fish
  fallback, never silent).
- Voice narration uses a configured owner TTS voice for consistency.

## Architecture honesty (for technical judges)

- AI output is always an unreviewed draft: it cannot decide, complete
  a manual check, or enter exports unreviewed. Evidence identity is
  content-hashed; stale results are discarded, never re-attached.
- Keys stay server-side; exports escape all model/user text; demo
  surfaces stay labeled until provider mapping confirmation.
- Tracing: Langfuse instrumentation (one trace per analysis, span-per-
  phase, token usage) active on dev; eval dataset tooling included.

## Measured results (gates verified 2026-11-04 on frozen dev 96cb3c2)

- Gates: docs exit 0, typecheck clean, lint 0 errors + 2
  pre-existing warnings, unit 750 passed / 3 skipped (71 files).
  Build + full browser e2e are pending on the frozen tree (the
  2026-11-03 e2e 47/47 and live-smoke self-test 28/28 describe the
  older tree and are not current).
- Live provider proof: real SAM 3.1 segment call, correct abstention
  on fixture media (no hallucinated candidates).
- Prod warm response 0.14 s; dev scale-to-zero cold start ~26 s,
  covered by a staged boot splash (no frozen screen).
- [NEEDS OWNER] Real-footage 5-room timing + draft-quality notes from
  the phone run. No accuracy percentage is claimed anywhere.

## Links [NEEDS OWNER to confirm public/submission visibility]

- Live app (prod, passcode-gated):
  https://metainspect-app.livelyriver-978b26d8.westus2.azurecontainerapps.io/
- Repo: https://github.com/jd-chiles/meta-inspector (`dev` branch)
- Demo video: [NEEDS OWNER — record after the phone run]

## What we would build next

HMIS API submission, LAHD pre-screen on live open data (ships
illustrative and labeled today), Spanish narration voice config.
