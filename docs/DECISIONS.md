# Decisions and changes

## Current decisions — October 29, 2026

1. Build the mobile-first Move-in Ready flow from the supplied product brief and three-screen reference: room video capture, draft review, and evaluator sign-off/export.
2. Use the owner's confirmed LAHSA Form 1083 scope with 11 logical areas. Treat Fire Safety 11a unit detectors and 11b public/common-area detectors as independent decisions. Ask funding type first; route HUD-funded units to an HQS-required notice.
3. Capture kitchen, bathroom, bedroom/living, and hallway video with room-specific prompts. Keep the mobile upload bound to 60 MiB/30 seconds. For compatible MOV, use Mediabunny packet-copy remuxing to produce bounded MP4 locally; do not transcode. Store and analyze only the normalized output, and keep the prior clip if normalization fails.
4. Use Meta SAM 3.1 for one-concept-at-a-time video segmentation and Meta Muse Spark for mapping. If Meta Muse is unavailable and `BASETEN_API_KEY` is configured, use fixed-host Baseten Muse Spark Open as mapping fallback. Muse receives SAM candidate stills plus one source still near each second; the evaluator must review every result. Keep keys, provider IDs, and raw responses server-side. Missing candidate evidence downgrades a proposal to needs-human-check.
5. Keep model proposals separate from evaluator decisions. Only the evaluator's complete decisions and sign-off derive an overall result. An evidence-backed D requires correction and dates.
6. Generate a client-file PDF, landlord fix list, and filled/flattened copy of the unchanged official FY 2022–23 Form 1083 with evidence/continuation pages, plus companion HMIS-ready JSON for manual handling. The mock-only participant/HMIS identity and unit address stay blank; planned reinspection dates go in notes, and the official completed-date field remains blank. No direct HMIS submission, landlord delivery, voucher tracking, or automated approval/denial is in scope.
7. Keep a pseudonym and staged/mock-unit data in the demo. Local deletion does not claim to remove provider-side files or downloaded exports.
8. Keep the app's PWA shell local-first, but never cache clips, stills, provider requests, or keys in the service worker.
9. Use the official Meta SAM parser/video packages plus Mediabunny for frame-aware video access and local, packet-copy MOV normalization. Do not use an in-browser full transcode; unsupported codecs get a clear conversion error. Keep 1-fps Muse sampling bounded to at most 30 stills per room.
10. Treat the 30-second staged kitchen/bathroom clip scorecard as an open release gate. No test clip was attached, so segmentation tracking, Form 1083 mapping quality, evidence coverage, and indoor-light misses remain unvalidated. Test real iOS Safari and Android camera/codec/MOV behavior separately; Chromium tests do not establish device compatibility.

## Superseded decisions

The October 26 concept narrowed the app to a few photo items because the current form was thought unresolved. The October 28 SDD revision treated owner confirmation as confirmation of form existence only. The October 29 owner confirmation that LAHSA Form 1083 is used in the workflow supersedes both assumptions.

The previous photo-first product brief and app surface are superseded by the supplied video walkthrough brief and rendering. Existing photo capture, review, guide, PWA, and export code may be reused only where it fits the new video-first workflow and its stricter evidence/sign-off requirements.

The earlier concept included automated deficiency decisions, direct HMIS submission, multi-device synchronization, and claims about faster placements. These remain out of scope. This app creates a local, reviewable draft for the existing manual process; it does not replace evaluator judgment or make an external submission.
