# Move-in Ready — Product Brief v1 implementation request

Source: project-owner attachment `product-brief.pdf` (Meta Global AI Developer Hackathon, Oct 26–Nov 4, 2026) and `Photo 2.jpg` concept rendering, received 2026-10-29. The brief supersedes the October 29 photo-first workspace scope and its claim that video was later-phase.

## Outcome

Build a mobile-first LAHSA Form 1083 companion with three connected steps:

1. **Capture:** record or choose short room videos, follow visible prompts, and keep clips/evidence linked to their room and time.
2. **Draft review:** segment video with SAM 3.1, map actual moments/stills to the 11 form elements with Muse Spark, and show every A/D mark as an unreviewed model suggestion. The evaluator makes a separate human decision for every element.
3. **Sign-off & export:** compute the result only from evaluator decisions, collect a typed evaluator signature/attestation, then create client-file, landlord-fix-list, and HMIS-ready PDF/JSON files for manual handling.

The phone UI should follow the supplied white/blue three-screen concept: a room video with live prompts; a compact 11-element draft list with confidence, evidence stills, and timestamps; and sign-off/export options. Use clear step navigation, concise content, a pinned bottom tab bar, and no long run-on page.

## Product rules from the brief

- Ask funding type at intake. HUD-funded units must be routed to the HQS branch notice; the LAHSA Form 1083 flow must not proceed as if it covers HQS.
- A D suggestion requires a real still plus a timestamp from the current walkthrough. If there is no usable evidence, the model result is `needs human check`; never invent a finding.
- Evidence stills come from the submitted video. Do not generate, enhance, or substitute them.
- Record model suggestion and evaluator decision separately. A model proposal never signs, approves, or denies a unit.
- A human-entered deficiency includes the correction and completion/reinspection dates. Landlord export contains only human-confirmed deficiencies.
- HMIS-ready means a local file prepared for manual upload, not a live HMIS connection or provider acceptance.
- Use staged/mock-unit media and a pseudonym only. No real participant data or HMIS records.
- Use Meta SAM 3.1 for per-room object tracking and Meta Muse Spark for element mapping. Sample actual source stills at 1 fps for Muse context, alongside SAM candidates. If Meta Muse has an eligible provider failure, allow the optional fixed-host Baseten Muse Spark Open mapping fallback only when `BASETEN_API_KEY` is configured; never use it for SAM, setup, validation, or output-schema errors. Standard/non-training configuration only. Hosted video is uploaded for processing with the shortest supported expiry; local deletion must not claim to revoke a provider upload.
- Use browser-side WebCodecs/Mediabunny for actual timestamped still extraction and bounded MOV-to-MP4 packet-copy remux before the hosted video route. Do not re-encode MOV on the phone. Failed normalization preserves the previous clip and blocks live upload.

## Build gate and current constraint

The brief makes one real, 30-second kitchen/bathroom clip the evaluation gate before a demo script or claims about mapping quality. Score faucet/fan/lock/detector tracking, element mapping, timestamp/still coverage, and normal-light misses. No video clip was attached to this request. Implement the capture and fail-closed review/export workflow now, but keep the SAM/Muse mapping unvalidated and do not claim the gate passed until the owner supplies the clip and the scorecard is completed.

## Explicit scope boundaries

Do not implement an HQS inspection or Form 1083 completion path for HUD-funded units; show the required HQS notice and stop this workflow. Live HMIS integration, voucher tracking, automated inspection decisions, and reinspection workflow beyond recording a date are also out of scope. Keep clips and inspection data local-first, with provider transfer only after the evaluator explicitly requests live analysis and consents. Preserve explicit live/fixture labeling, strict server-side provider boundaries, and prior evidence identity/deletion invariants.

## Status

This is an owner-requested scope change and implementation target, not a native SDD review, evidence record, or release approval. Keep historical reviews and evidence untouched.
