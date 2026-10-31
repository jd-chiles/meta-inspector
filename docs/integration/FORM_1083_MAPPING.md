# Form 1083 workflow, video pipeline, and data boundaries

**Form identity:** The project owner confirmed on October 29, 2026 that LAHSA Habitability Standards Inspection Form 1083, FY 2022–23, is the form used and submitted in this workflow. The app embeds the unchanged three-page official form, fills supported fields, flattens it, and appends local evidence/continuation pages. This confirms the source form in the export; it does not establish provider acceptance of the app’s files or an app connection to HMIS.

**Product state:** The supplied brief replaces the former photo-first direction with a four-room video walkthrough, an evidence-linked 11-area review, evaluator sign-off, and local/manual exports. Mobile navigation shows Review, Sign-Off, and Profile; Capture is the first step and is reached through contextual back. See [`docs/PRODUCT_BRIEF.md`](../PRODUCT_BRIEF.md) and the current SDD requirements. Historical photo-first work remains in the repository and is not evidence that the new end-to-end workflow is finished.

## 1. Four rooms and 11 modeled elements

The product guides a staged-unit evaluator through these room videos:

| Room | Capture prompts and fixed SAM concepts in the current server contract |
|---|---|
| Kitchen | Run the faucet and show drainage; show the kitchen and visible fixtures. SAM concepts: water faucet, ventilation fan, kitchen stove. |
| Bathroom | Run the faucet or shower; turn on the exhaust fan; show toilet, bath/shower, and door lock. SAM concepts: water faucet, ventilation fan, toilet, door lock, smoke detector. |
| Bedroom/living area | Show both areas, visible openings, detector, and entry lock. SAM concepts: door lock, smoke detector, heating equipment, ventilation fan. |
| Hallway | Show the walking path, detector, and unit exit. SAM concepts: exit door, smoke detector, light fixture. |

The local product model has 11 area IDs and concise labels. Those labels support the app workflow; the PDF export uses the official form template rather than reconstructing its printed pages. The official form has separate Fire Safety marks for 11a and 11b, so 11 logical areas yield 12 A/D marks.

### 1.1 Export field mapping against the bundled source

The following mapping was checked against the text and AcroForm widgets in `public/forms/lahsa-form-1083-fy-2022-2023.pdf` (three pages; SHA-256 `9c9faf9039d98aa570017f6bf22bafd5a999c1ba3f25a8f8bee3241546602261`). The form itself is kept unchanged as the PDF base. Its A/D fields are not independent: `Approved or DeficientRow4` contains nine widgets for rows 4 through 11b, so the exporter clears that shared field and draws each result into its own widget after flattening.

| Form order / printed section | Local element ID | Exported mark source | Notes field used |
|---|---|---|---|
| 1. Structure and materials | `demo-item-05` | Its evaluator A/D decision | `Notes1 Structure and materials…` |
| 2. Access | `demo-item-06` | Its evaluator A/D decision | `Notes2 Access…` |
| 3. Space and security | `demo-item-07` | Its evaluator A/D decision | `Notes3 Space and security…` |
| 4. Interior air quality | `demo-interior-air` | Its evaluator A/D decision | `Notes4 Interior air quality…` |
| 5. Water Supply | `demo-water-supply` | Its evaluator A/D decision | `5 Water Supply…` |
| 6. Sanitary Facilities | `demo-item-08` | Its evaluator A/D decision | `6 Sanitary Facilities…` |
| 7. Thermal environment | `demo-item-09` | Its evaluator A/D decision | `7 Thermal environment…` |
| 8. Lighting and electricity | `demo-lighting-electric` | Its evaluator A/D decision | `8 Lighting and electricity…` |
| 9. Food preparation and refuse disposal | `demo-item-10` | Its evaluator A/D decision | `9 Food preparation and refuse disposal…` |
| 10. Sanitary condition | `demo-item-11` | Its evaluator A/D decision | `10 Sanitary condition…` |
| 11a. Unit fire-safety criteria | `demo-smoke-co` | `fireSafetyAssessment.unitDetectors` | `11 a. Fire safety…` |
| 11b. Public/common-area smoke detectors | `demo-smoke-co` | `fireSafetyAssessment.publicAreaDetectors` | `11 b The public areas…` |

The local aggregate Fire safety decision is included in the attached evaluator record and determines the app result. It is never copied into both official marks. Official section 11a covers the full unit criteria printed on the form, including smoke and carbon-monoxide detectors; section 11b is the separate public-area smoke-detector criterion. A still or model suggestion alone cannot supply either mark.

Administrative mappings are intentionally limited to supported values:

| Official field / printed location | Source |
|---|---|
| `Participant Name & HMIS #` and `Unit Address incl unit number` | Left blank for staged/mock-unit exports. The pseudonym appears only in the appended local supporting record. |
| `Evaluator and Agency Name` | Evaluator name and agency name, joined in this field. |
| `Discussed with LL` and its `Date` widget | Required human YES/NO choice and, for YES, the recorded discussion date. The source form's default is cleared before filling. |
| `Evaluator's Signature` and `Date 2` | Typed evaluator signature and signed date. The full required attestation is included in the appended record. |
| `Agency Leadership Printed Name and Title`, `Leadership Signature`, and the other `Date` widget | Recorded leadership details when the agency requires leadership sign-off. |
| Six official deficiency rows | Evaluator-confirmed D area, correction, planned completion date, and notes with planned reinspection date. `Date Reinspection Completed` is left blank; additional deficiencies continue in the appended record. |

The JSON is the app's local draft schema, not a confirmed HMIS import schema. Participant/HMIS identity and unit-address mappings, external submission, and recipient acceptance remain unsupported or unverified and are therefore not inferred from the official form's wording.

| Local element ID | Product label | Rooms that can contribute evidence |
|---|---|---|
| `demo-item-05` | Structure and materials | Kitchen, bathroom, bedroom/living, hallway |
| `demo-item-06` | Access | Hallway |
| `demo-item-07` | Space and security | Bedroom/living, hallway |
| `demo-interior-air` | Interior air quality and ventilation | All four rooms |
| `demo-water-supply` | Water supply | Kitchen, bathroom |
| `demo-item-08` | Sanitary facilities | Bathroom |
| `demo-item-09` | Thermal environment | All four rooms |
| `demo-lighting-electric` | Lighting and electricity | All four rooms |
| `demo-item-10` | Food preparation and refuse disposal | Kitchen |
| `demo-item-11` | Sanitary condition | All four rooms |
| `demo-smoke-co` | Fire safety (independent 11a unit-detector and 11b public/common-area outcomes) | All four rooms |

These room associations guide capture and review; they are not an official LAHSA mapping or proof that a visual object satisfies an element. A video cannot establish conditions that require a physical check, such as water temperature, ventilation operation, safe electrical operation, detector operation, or a usable escape route. The evaluator records those checks separately.

Funding type is selected at intake. This build supports the LAHSA/Form 1083 path. HUD-funded units receive an HQS-required route notice; the app must not present an HQS result or let the HUD route produce a Form 1083 export.

## 2. SAM and Muse request contract

### 2.1 Intended sequence and current limits

1. The browser captures or imports a room clip, previews it, extracts actual decoded source-frame stills for local review, and saves the clip and local review stills in versioned IndexedDB.
2. Only after an explicit analysis action does the browser send the clip bytes once to the same-origin `stage=segment` route. The client does not send a URL for the server to fetch.
3. The capture client normalizes supported MOV to MP4 with a size-bounded local packet-copy remux, then checks the resulting duration and required tracks. The server checks the exact multipart shape, actual MP4 container bytes and supported codec. Current limits are 60 MiB and 30 seconds, plus bounded frame count. Filename and MIME type alone are not trusted. The server rejects MOV; conversion failure preserves the prior local clip and blocks live analysis.
4. For MP4, the server requests one expiring provider file upload and sends fixed, one-concept prompts to Meta SAM 3.1 using streamed `POST /v1/responses` calls. The server parses frame-indexed box/mask records with `@meta-sam/parser`; it returns bounded geometry, prompt/element IDs, and the source-video hash. SAM output is segmentation evidence only.
5. Before completing `stage=segment`, the server computes SHA-256 over the uploaded bytes and checks it against the request's expected video hash, matches every SAM candidate frame index to the validated source timeline, and uses FFmpeg to decode those candidate frames plus one actual source frame near the center of each second (at most 30) for Muse context. It bounds the JPEGs and caches them in the in-memory one-time mapping lease associated with the candidate token and full video identity. The server returns candidate metadata, the signed sample schedule, and the token; it does not return image bytes. If there are no SAM candidates, no mapping lease is created.
6. The browser's follow-on `stage=map` request sends only room/media identity and the signed candidate token. It sends neither another copy of the clip nor candidate/context image bytes. The server claims the lease once and supplies its server-derived candidate and context JPEGs to Muse Spark. Muse may cite only actual SAM candidate IDs; the per-second stills provide additional visual context and cannot become fabricated candidate evidence. It returns unreviewed suggestions for the 11 modeled elements. Suggestions need a resolvable current-video candidate still. Without one, the item remains “needs human check.” If Meta Muse returns an eligible provider failure and `BASETEN_API_KEY` is configured, the server may retry mapping once with Baseten Muse Spark Open; this fallback receives the same leased stills/context and never handles the video or replaces SAM.
7. The evaluator reviews the actual still and timestamp, records an independent A, D, or needs-human-check decision, completes required correction/reinspection details, and signs. Fire Safety 11a and 11b are recorded separately: aggregate Fire Safety is D if either is D, A only if both are A, and otherwise unresolved. Model output never writes an evaluator decision or final result.

The current source wires both stages through `/api/video/segment`: the phone uploads the normalized clip once for `stage=segment`; the server runs SAM and derives/hash-binds the selected JPEGs from that same clip before creating its one-time lease. The subsequent `stage=map` request contains only identity and token. Server-side frame bytes remain in bounded process memory for the lease and are released after mapping, cancellation, or expiry; the browser does not upload a second clip or send mapping stills. The Capture/Review/Sign-Off/Profile flow consumes the proposals and creates local exports. This describes implementation present in the checkout; it does not establish that a live provider call, the complete flow, or visual QA passed. The existing `/api/analyze` route remains a separate still-image path. The current `npm run test:live` runner exercises one video segment request with the synthetic MP4 by default and calls Muse mapping at most once only when SAM returns valid candidates. Do not infer video accuracy from package installation, mocked tests, or this connectivity smoke.

### 2.2 Models, routes, and video libraries

- **SAM 3.1:** model ID `sam-3.1`; hosted via Meta Responses API (`POST https://api.meta.ai/v1/responses`). Meta documents streaming for video segmentation; its Files API currently lists `video/mp4` as its supported video MIME. The implementation uses fixed one-concept prompts and the official `@meta-sam/parser` to parse the streamed geometry grammar. [Meta SAM segmentation](https://dev.meta.ai/docs/sam/segmenting) · [SAM client libraries](https://dev.meta.ai/docs/sam/client-libraries) · [Meta file handling](https://dev.meta.ai/docs/file-handling)
- **Muse Spark:** model ID `muse-spark-1.3` in Standard mode for server-side visual draft/mapping calls. The live smoke uses Muse only if its SAM segment response contains structurally valid candidate evidence; it does not measure mapping quality. [Meta model catalog](https://dev.meta.ai/docs/models) · [Meta API overview](https://dev.meta.ai/docs/overview)
- **Phone video decode/remux:** `@meta-sam/video` and Mediabunny 1.63.0 are used from browser-only helpers for frame-aware WebCodecs decoding, local-review still extraction, and bounded MOV-to-MP4 packet-copy remux; native HTML video/canvas remains a codec fallback. Encoded frames are not re-encoded during MOV normalization. The packages do not make provider calls from the browser. [SAM client libraries](https://dev.meta.ai/docs/sam/client-libraries)
- **Server still provenance:** Node's `src/server/video/source-stills.ts` uses FFmpeg 9.0.2 during `stage=segment` to decode candidate frames and scheduled context frames from the hash-verified MP4. Build it from the signed upstream source with `scripts/install-ffmpeg-runtime.sh` and set `FFMPEG_PATH` to the generated absolute path. Missing FFmpeg returns a safe setup error before Muse mapping. This is server tooling and adds no FFmpeg/WebAssembly package to the phone.
- **Format policy:** keep supported MP4/MOV clips available for capture/review, but permit only MP4 for live Meta processing. Supported MOV is packet-copy remuxed locally under a byte cap; unsupported media and failed/oversized outputs remain blocked. No full-frame-rate ffmpeg WebAssembly runtime is shipped to the phone.
- **Mapping fallback:** Meta Muse remains primary. The optional Baseten endpoint/model are fixed in server code and require `BASETEN_API_KEY`; only retryable Meta Muse provider failures use it. Validation, setup, schema, cancellation, and safety errors never trigger the fallback. The UI explains that the selected clip's actual stills may be sent to Baseten. [Baseten Muse Spark Open](https://www.baseten.co/library/muse-spark-open/)

### 2.3 Configuration and the live video smoke

The server reads configuration from `APP_ANALYSIS_MODE`, `META_API_KEY` (or `MODEL_API_KEY`), `META_MODEL`, the allowlisted `META_API_BASE_URL`, optional `BASETEN_API_KEY`, and optional `FFMPEG_PATH`. The Meta model ID is `muse-spark-1.3`; the Baseten model and endpoint are fixed server-side. `FFMPEG_PATH` must point to a compatible executable; when omitted, `ffmpeg` must be on the server's `PATH`. Contributor model IDs are excluded for this mock-unit workflow. Keep secrets server-only. Never add `NEXT_PUBLIC_*` keys, include keys/provider bodies in logs or exports, or trust a client-provided model, prompt, or remote fetch URL.

`npm run test:live` starts a production Next server in live mode and sends one MP4 to `/api/video/segment`. The default is the bundled synthetic fixture; `SMOKE_VIDEO` may select a regular `.mp4` staged/mock-unit file with no tenant or personal data. It loads `.env` through Next.js's env loader without printing values, fails closed without `META_API_KEY`, and emits sanitized metadata only. If SAM returns structurally valid candidate evidence, it sends one token-only `stage=map` request; otherwise it skips Muse and releases the pending lease with `stage=cancel` when possible. It makes no retry and removes `BASETEN_API_KEY` from the smoke server environment to prevent fallback calls. A successful run establishes only connectivity for the exercised API path. It does **not** establish video tracking, Form 1083 mapping quality, or the 30-second evaluation gate. Mock-unit tests are not live provider evidence.

## 3. Human decisions and export mapping

AI observations and SAM detections are unreviewed proposals. Muse may suggest A or D, but no model proposal may:

- mark a manual check performed;
- record or substitute for the evaluator’s A or D decision;
- set an inspection result;
- create a confirmed landlord deficiency; or
- restore approval after the source clip changes.

A clip replacement/removal/reanalysis must invalidate evidence tied to its prior identity and clear affected human decisions. A deficiency requires actual source-frame evidence plus the evaluator’s issue description, proposed correction, completion date, and reinspection date. The evaluator signs and attests: “I understand that I am not a HUD-certified inspector. I evaluated this unit to the best of my ability and completed and reviewed this inspection based on my own assessment. AI suggestions are not my decisions.” Capture agency leadership sign-off where the agency requires it.

The app prepares these local downloads only after its required evaluator decisions and sign-off are complete:

1. **Client-file PDF** — full local inspection record with source-frame evidence and timestamps.
2. **Landlord fix-list PDF** — evaluator-confirmed deficient items only, with issue, correction, dates, and linked evidence.
3. **Official Form 1083 PDF and JSON** — the unchanged official FY 2022–23 three-page Form 1083 is filled for supported fields and flattened; local evidence/continuation pages are appended. The 11a unit-detector and 11b public/common-area marks come from their corresponding evaluator outcomes, not from a copied aggregate. Planned reinspection dates appear in notes while the official “Date Reinspection Completed” field stays blank. The companion JSON carries agency, landlord-discussion, leadership-sign-off, attestation, and recorded human decision data. Staged/mock-only participant/HMIS identity and unit-address fields intentionally remain blank, so this is not case-ready. It is a local/manual-upload file, not an HMIS submission, and provider acceptance is unverified.

The PDFs and JSON are local files for manual handling. There is no direct HMIS upload, landlord delivery, or LAHSA submission, and no claim that a provider accepts these files or that the JSON matches an external HMIS schema. Deleting local app data does not delete downloaded exports or claim provider-file deletion.

## 4. Privacy and retention boundary

- Use staged/mock-unit footage and a pseudonym in the demo. Keep tenant details, faces, documents, addresses, and real case notes out of clips and prompts.
- Captured clips, source stills, evaluator decisions, and signatures remain local in versioned IndexedDB unless the evaluator explicitly requests live analysis. The service worker caches the app shell only.
- A live SAM action transmits the selected video to the server and then to Meta. The current upload request asks the provider Files API for a one-hour expiry; this is not a promise of immediate deletion or a substitute for reviewing provider retention terms.
- On explicit analysis, the browser sends the selected video once to the same-origin server. The server derives candidate and one-per-second context JPEGs from the same hash-verified bytes, then holds bounded stills in an expiring one-time lease for mapping. The browser's map request sends identity and token only; it contains no video or image bytes. Muse receives the leased frames through the server. On an eligible primary-provider failure, those same stills can be sent to Baseten when the optional key is configured. Consent copy identifies this fallback. Provider keys and raw request/response bodies remain server-side. No client URLs are fetched.
- Live video segmentation and image mapping may incur charges under the configured Meta account. The app does not estimate per-inspection cost; check current pricing and account billing before live use. “Live mode enabled; connection untested” reports server mode only; it does not confirm that a provider request ran or succeeded.
- Local delete removes local records and object URLs only; it does not claim provider deletion, remove copies the evaluator already downloaded, or establish zero provider retention.
- Keep the standard `muse-spark-1.3` model ID; contributor mode is excluded. Review current provider terms and the agency’s privacy/security requirements before any tenant-adjacent pilot.

## 5. Sources and verification gate

- LAHSA: [FY 2022–2023 Form 1083 listing](https://www.lahsa.org/documents?id=6886--tls-and-hn-fy-2022-2023-form-1083-habitability-standards-form.pdf). The project owner’s confirmation establishes which form the workflow uses; the embedded PDF is the official source form. Its participant/HMIS identity and unit-address fields remain blank in this staged demo, and provider acceptance remains unverified.
- Meta: [Models](https://dev.meta.ai/docs/models), [SAM segmentation](https://dev.meta.ai/docs/sam/segmenting), [SAM client libraries](https://dev.meta.ai/docs/sam/client-libraries), and [File handling](https://dev.meta.ai/docs/file-handling). Accessed 2026-10-29.
- **Open release/evaluation blocker:** the owner supplied staged/mock kitchen and bathroom videos and authorized provider processing on 2026-10-31, but neither attempt produced a reviewable result; kitchen timed out and bathroom was canceled before saving. Muse mapping and all quality checks remain unmeasured. See `docs/evaluation/video-clip-gate.md`. Keep this gate distinct from fixture checks, unit tests, the JPEG Muse smoke, and visual UI QA.
