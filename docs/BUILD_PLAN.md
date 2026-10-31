# Build plan — Move-in Ready

For the current ordered path from implementation to a limited production MVP,
see [`PRODUCTION_MVP_ROADMAP.md`](PRODUCTION_MVP_ROADMAP.md). The roadmap
sequences existing active SDD tasks and does not mark them accepted.

## Product path

Build the supplied mobile-first, video-led workflow for the owner-confirmed LAHSA Habitability Standards Inspection Form 1083 (FY 2022–23): **intake → Video Capture → Draft Review → Sign-Off & Export**. The evaluator records a pseudonym and funding type, captures one short clip for each of four rooms, reviews evidence-linked model proposals for all 11 modeled elements, records their own decisions and sign-off, and downloads local files for the existing manual process.

The owner confirmed the form identity and workflow use. The export embeds the unchanged official FY 2022–23 PDF and fills supported fields; participant/HMIS identity and unit address stay blank in the staged demo, and provider acceptance/external HMIS compatibility remain unverified. HUD-funded units route to an HQS-required notice; this app does not perform an HQS inspection. Product scope and decision rules are in [`PRODUCT_BRIEF.md`](PRODUCT_BRIEF.md) and [`DECISIONS.md`](DECISIONS.md).

## Current implementation snapshot

The current source tree contains a mobile Capture/Review/Sign-Off/Profile flow, local four-room clip and inspection stores, a two-stage server video endpoint, and local PDF/JSON export code. The HMIS-ready PDF uses the unchanged official LAHSA FY 2022–23 Form 1083, fills supported fields, flattens it, and appends local evidence/continuation pages; 11a and 11b are marked independently. Mock-only participant/HMIS identity and unit address remain blank. The browser normalizes supported MOV clips to bounded MP4 using packet-copy remux and sends the selected clip once to the same-origin segment route. The server validates and hashes those bytes, uploads the MP4 once to Meta, runs fixed one-concept SAM 3.1 prompts, then derives the actual candidate frames and 1 fps context frames from the same verified source with FFmpeg. Bounded JPEGs are held in the short-lived one-time mapping lease. The follow-on map request carries only media identity and the signed candidate token, so it does not upload the phone clip or stills again. Model proposals remain separate from evaluator decisions. A configured Baseten Muse Spark Open provider is an optional fallback for eligible Meta Muse failures.

These statements describe code present in the checkout, not passed verification, product-design approval, or provider accuracy. Use the current SDD task ledger and latest command output to report checks; this document does not record execution or native SDD review evidence. Existing photo-first components and historical evaluation records are retained but do not define the new product path.

## Build and verification gates

### Gate 0 — Intake and route gate

- Require a pseudonym and funding-type selection before starting a local inspection record.
- Allow the LAHSA/Form 1083 path. For HUD-funded units, show the HQS-required notice and do not offer Form 1083 completion or exports.
- Keep the official source template unchanged. Verify supported field mapping and preserve the explicit mock-only blank identity/address fields; provider acceptance and external HMIS compatibility remain open.

### Gate 1 — Mobile capture and local evidence

- Complete intake with a pseudonym and funding route; keep the HUD/HQS route outside Form 1083 completion and export.
- Support kitchen, bathroom, bedroom/living area, and hallway video capture or upload.
- Save supported MP4/MOV clips for local review up to the product limits; validate actual bytes and metadata, not only a file name or browser MIME label. Meta's current Files API accepts `video/mp4` only, so the browser performs a bounded packet-copy remux for supported MOV before live upload; it does not re-encode. Failed/unsupported conversion preserves the previous clip and blocks upload. The current server contract caps videos at 60 MiB and 30 seconds.
- Save each room clip and actual decoded timestamped stills locally; support preview, replace, remove, and reload recovery.
- Keep camera/video decode and bounded remux work in the browser with `@meta-sam/video`/Mediabunny and a native video/canvas fallback. Do not add a full-frame-rate phone-side ffmpeg WebAssembly transcode. Unsupported media needs a clear upload path.
- Pin the server frame-decoder runtime to FFmpeg 9.0.2 from the signed upstream source release. Build with `scripts/install-ffmpeg-runtime.sh`, set server-only `FFMPEG_PATH`, and verify the selected-frame extraction smoke before enabling live mapping.

### Gate 2 — Server-only SAM and Muse video path

- Require an explicit analysis action and consent before any clip leaves the device.
- Send normalized MP4 bytes to the same-origin server endpoint; validate container, supported video codec, size, duration, and bounded frame count. The server never accepts a MOV upload. Never fetch a client-supplied URL.
- Upload the clip once for the room, request a provider-side expiry, and issue fixed one-concept SAM 3.1 calls through Meta Responses streaming. Parse segmentation output with `@meta-sam/parser`; treat box/mask confidence as segmentation confidence only.
- After SAM returns candidate frame indexes, hash-check the same uploaded MP4 and use server-side FFmpeg to decode those actual candidate frames and one actual source frame near the center of each second (at most 30 context frames). Cache the bounded JPEGs with the one-time candidate token in the in-memory map lease; release them after mapping, cancellation, or expiry. This server decode binds the model images to the original submitted clip.
- The map request carries the current clip identity and signed candidate token only. It contains no clip, candidate-image, or context-image bytes, so the phone never uploads the clip a second time. The server maps its leased JPEGs with prompt/element context to Meta Muse. On eligible Meta Muse provider failures, use the optional fixed-host Baseten Muse Spark Open fallback only when `BASETEN_API_KEY` is configured; invalid output or setup/validation failures do not trigger fallback.
- Install FFmpeg on the Node server with decoders for accepted input video codecs and an MJPEG encoder. The route runs `ffmpeg` from `PATH` by default; configure server-only `FFMPEG_PATH` with an absolute executable path when it is elsewhere. Missing FFmpeg fails closed before Muse mapping. No FFmpeg is required on the phone.
- Validate Muse’s proposal shape and candidate references. Missing or stale stills become needs-human-check; non-detection never proves absence or deficiency. No model output sets the evaluator’s A/D decision or overall result.
- Preserve session, room, clip revision/hash, attempt, and candidate identity across asynchronous segment/map work. Cancel or discard stale results when the room or clip changes; no automatic paid retry.

### Gate 3 — Review, sign-off, and local exports

- Present 11 modeled Form 1083 elements in a compact mobile review. Each proposal links to actual frame evidence and timestamp and is labeled unreviewed.
- Keep the evaluator’s A, D, or needs-human-check selection and required physical checks separate from model output. A D decision needs evidence, issue details, proposed correction, completion date, and reinspection date.
- Require the evaluator’s explicit typed sign-off and attestation; capture agency leadership sign-off where agency policy requires it. Unresolved required decisions block completed sign-off.
- Generate four local downloads after completion: client-file PDF, deficient-item-only landlord fix-list PDF, filled/flattened official Form 1083 with evidence/continuation pages, and companion JSON. Planned reinspection goes in notes; the completed-reinspection field stays blank.
- Keep export labels and notices clear: local draft/manual handling only. Do not submit to HMIS, LAHSA, or a landlord, and do not claim the export matches an external schema or is accepted by a provider.

### Gate 4 — Verification and product QA

- Run the configured docs, lint, typecheck, unit, browser, build, and live-smoke checks against the current source fingerprint. Report exact command output; do not infer a current pass from historical logs or fixture results.
- Verify the actual mobile path at the concept’s phone viewport: all four capture rooms, draft evidence/timestamps, a needs-human-check case, separate 11a/11b evaluator decisions, signature gate, and all downloads. Follow with physical iOS Safari and Android checks for camera capture, supported codecs, and MOV remux; desktop Chromium coverage does not establish phone compatibility.
- `npm run test:live` now sends one synthetic MP4 to the current `/api/video/segment` route. It may call token-only Muse mapping once only when SAM returns valid candidate evidence; it makes no retry, disables the Baseten fallback, and cancels an unconsumed map lease when possible. It reports connectivity only and does not evaluate video quality. The offline-only runner check is `node tests/live/smoke.mjs --self-test`.
- Run any actual-provider video evaluation only with the staged mock-unit clip, one explicit attempt, and sanitized evidence. Mocked unit/e2e tests do not prove provider processing.

## Open evaluation/release gate

The owner supplied separate staged/mock kitchen and bathroom clips on 2026-10-31 and authorized live processing. The kitchen request timed out; the bathroom segment endpoint returned 200 but its browser request was canceled before saving. Muse mapping and quality scoring did not occur. The supplied set also does not establish the gate's lock/detector moments and exceeds the authored single-clip 30-second limit in combined duration. See [`evaluation/video-clip-gate.md`](evaluation/video-clip-gate.md). Until the input mismatch is resolved and the clip scorecard is completed, do not claim tracking, element mapping, source-frame coverage, or normal-indoor-light performance. Record faucet/fan/lock/detector track identity, all 11 element mappings, timestamp/still coverage, and misses; record prompt changes after the miss list. The synthetic live smoke, fixture, generated image, or mocked test cannot substitute for this gate.

## Data and privacy boundaries

- Demo with a staged/mock unit and a pseudonym. Do not place tenant data, faces, addresses, real case notes, or personal documents in clips or prompts.
- Clips, local review stills, decisions, and signatures remain in browser-local versioned storage until explicit analysis. During that action the clip is sent once to the same-origin server; verified JPEG derivatives are held only in the expiring in-memory map lease and are not persisted or sent by the browser in a second request. The service worker caches the app shell only.
- Meta/Baseten credentials, provider file IDs, and raw provider bodies stay on the server. A configured provider upload requests expiry; local delete does not claim provider deletion or remove downloaded exports. Profile and the capture consent disclose the optional Baseten transfer.
- Use the Standard `muse-spark-1.3` model ID. Contributor model IDs are excluded for this workflow.
- No direct HMIS submission, landlord delivery, voucher tracking, automatic approval/denial, or reinspection scheduling is in scope.

## Tracked work

The current implementation and verification tasks are tracked in [`sdd/features/habitability-walkthrough-mvp/03-plan.md`](sdd/features/habitability-walkthrough-mvp/03-plan.md) and [`tasks.json`](sdd/features/habitability-walkthrough-mvp/tasks.json). Keep REQ/TASK mappings current there. TASK-110 is open pending a reviewable, scored result, not merely footage delivery. The owner directed a Muse Code implementation handoff; see [`MUSE_CODE_HANDOFF.md`](MUSE_CODE_HANDOFF.md). This does not change native SDD review/evidence state or claim an approval the plugin has not recorded.
