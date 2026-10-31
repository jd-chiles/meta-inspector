# Move-in Ready

A mobile-first Habitability Walkthrough Companion for housing navigators and case managers. It guides an evaluator through short room videos, keeps visual model suggestions separate from the evaluator’s decisions, and prepares local files for the existing manual workflow.

The in-scope form is LAHSA Habitability Standards Inspection Form 1083, FY 2022–23. The project owner confirmed that this is the form used and submitted in their workflow. The HMIS-ready PDF uses the unchanged official template and fills supported fields; participant/HMIS identity and unit address stay blank in the staged demo. The app does not submit to HMIS and provider acceptance is unverified.

## Product workflow

1. Start a staged-unit inspection with a pseudonym and choose the funding route. HUD-funded units receive an HQS-required notice; this app does not complete an HQS inspection.
2. Capture or choose one short video for each room: kitchen, bathroom, bedroom/living area, and hallway. Follow the room prompts for fixtures such as faucets, fans, locks, and detectors.
3. On an explicit analysis action, review timestamped stills and unreviewed model proposals against the 11 modeled Form 1083 elements.
4. Record the evaluator’s separate A, D, or needs-human-check decision, deficiency details, and required sign-off.
5. Generate a client-file PDF, a landlord fix-list PDF containing evaluator-confirmed deficiencies, a filled/flattened copy of the official LAHSA FY 2022–23 Form 1083 with appended evidence pages, and companion JSON. The staged demo leaves participant/HMIS identity and unit address blank, so the form is not case-ready. Download and handle those files outside the app; no HMIS submission or provider acceptance is claimed.

AI may propose an unreviewed A or D suggestion, but it cannot complete a manual check, record the evaluator’s decision, or determine the inspection result. Every proposed deficiency must be tied to an actual still from the current clip and its source timestamp. A missing or stale still means needs-human-check. The stills are decoded from the video; they are not generated or enhanced.

## Implementation status and release gate

The current source contains the three-step mobile flow, local video storage, a two-stage SAM/Muse video path, evaluator review and sign-off, and local export code. This describes code in the checkout, not passing verification, completed visual QA, provider accuracy, or field evaluation. The project brief and current SDD requirements are in [`docs/PRODUCT_BRIEF.md`](docs/PRODUCT_BRIEF.md) and [`docs/sdd/features/habitability-walkthrough-mvp/`](docs/sdd/features/habitability-walkthrough-mvp/). Historical photo-first code remains in the repository. Use the task plan and latest check output for implementation status; do not treat a fixture pass or an SDD document update as a completed live evaluation.

The required staged 30-second kitchen/bathroom test clip was not supplied. Until it is evaluated, SAM tracking across faucet, fan, lock, and detector; element mapping; timestamp/still coverage; and misses under normal indoor lighting are unvalidated. Do not claim product accuracy or prepare a result-based demo script from fixtures.

## Video and model boundaries

- Browser capture, previews, local clips, and source-frame stills stay in local browser storage until the evaluator explicitly requests analysis.
- Live video analysis is a server action. Supported MOV clips are normalized locally to MP4 using a size-bounded packet-copy remux. The browser sends the selected MP4 once to the same-origin segment route; the server validates its bytes and limits, uploads it once to Meta’s Files API with a requested expiry, and calls SAM 3.1 through the Responses streaming API using fixed, one-concept prompts. The server parses segmentation records and returns bounded geometry, frame references, and the source-video hash. SAM geometry is not a condition or inspection judgment.
- During that segment request, the server verifies the clip hash and uses FFmpeg to decode the actual SAM candidate frames plus source context frames sampled at 1 fps. It caches only bounded JPEGs in the short-lived, one-time mapping lease. The later map request sends the video identity and signed candidate token only; it sends no video or still bytes, so the phone does not upload the clip a second time. Muse uses the server-derived frames for unreviewed Form 1083 proposals. If Meta Muse has an eligible provider failure, a configured Baseten Muse Spark Open key can enable a one-time mapping fallback; it receives the same stills and does not replace SAM. The UI discloses this provider transfer. `npm run test:live` now exercises one video segment request with the synthetic MP4 by default and maps only when SAM returns valid candidates; it disables the optional fallback and does not assess video quality. See [`docs/integration/FORM_1083_MAPPING.md`](docs/integration/FORM_1083_MAPPING.md) for implementation status and boundaries.
- Live server-side frame verification requires FFmpeg with decoders for the accepted video codecs and an MJPEG encoder. The maintained server runtime is FFmpeg 9.0.2; `scripts/install-ffmpeg-runtime.sh` builds it from the signed upstream source release. Set server-only `FFMPEG_PATH` to its absolute executable path. The system FFmpeg on the current VPS is older and is only a fallback. FFmpeg is not shipped in the phone app.
- Meta and Baseten keys, file IDs, and provider request/response bodies remain server-side. The browser never sends a provider URL for the server to fetch. Logs and exports must not contain credentials or raw provider bodies.
- The browser video path uses Meta's `@meta-sam/video` with Mediabunny 1.63.0 for frame-aware WebCodecs decoding, bounded packet-copy remux, and timestamped still extraction, plus a native media/canvas fallback when a browser cannot decode the selected codec through WebCodecs. Mediabunny is pinned by npm override because the Meta wrapper pins an older exact release. No full-frame-rate ffmpeg WebAssembly transcode is added to the phone path.
- A local delete removes local clips, stills, decisions, and signatures only. It does not claim to delete provider-side files or downloaded exports.

## Run locally

Node.js 22 is the project runtime.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Set `APP_ANALYSIS_MODE=fixture` for local fixture work. For live calls, set `APP_ANALYSIS_MODE=live` and provide `META_API_KEY` (or the documented `MODEL_API_KEY` alias) in a server-side environment file. Restart the server after changing environment variables. Never put a key in a `NEXT_PUBLIC_*` variable or commit a key file. The live video route fails closed when live mode or credentials are missing; it does not fall back to fixture video results.

When a trusted reverse proxy serves the app on a different public origin, set `APP_PUBLIC_ORIGIN` to that exact HTTP(S) origin (scheme, host, and optional port only). This keeps same-origin protection working when the proxy forwards requests to a loopback address.

Each checkout or worktree reads its own environment files. A `.env` in a different checkout is not inherited by this app process.

The live smoke loads local environment files through Next.js's environment loader without printing values. It requires `META_API_KEY`, starts the production server in live mode, and sends the bundled synthetic H.264 MP4 to `/api/video/segment` once. Set `SMOKE_VIDEO` only to an explicit safe, rights-cleared staged/mock-unit MP4. Muse mapping is sent at most once and only when SAM returns valid candidates; retries and the optional Baseten fallback are disabled. The smoke reports sanitized connectivity metadata and `videoQuality: not-assessed`; it does not satisfy the missing 30-second clip evaluation. Run `npm run build` first. `node tests/live/smoke.mjs --self-test` checks the runner offline without loading `.env` or reading media.

## Project references

- [Product brief](docs/PRODUCT_BRIEF.md)
- [Move-in Ready SDD request, requirements, design, plan, and verification](docs/sdd/features/habitability-walkthrough-mvp/)
- [Form 1083 mapping and Meta integration contract](docs/integration/FORM_1083_MAPPING.md)
- [Demo plan and evidence limits](docs/DEMO.md)
- [Decisions and superseded directions](docs/DECISIONS.md)
- [Codex review and CI notes](docs/REVIEW_AND_CI.md)
- [LAHSA FY 2022–2023 Form 1083 listing](https://www.lahsa.org/documents?id=6886--tls-and-hn-fy-2022-2023-form-1083-habitability-standards-form.pdf)
- [Meta Models](https://dev.meta.ai/docs/models), [SAM segmentation](https://dev.meta.ai/docs/sam/segmenting), and [SAM client libraries](https://dev.meta.ai/docs/sam/client-libraries)
