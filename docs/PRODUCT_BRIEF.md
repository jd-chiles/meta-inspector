# Product brief: Move-in Ready

Updated October 29, 2026 from the owner-provided product brief and mobile concept rendering.

## Product

Move-in Ready is a mobile-first Habitability Walkthrough Companion for housing navigators and case managers. It guides an evaluator through a staged unit video walkthrough, prepares evidence-linked draft observations for review, records the evaluator's own decisions, and creates local export files for the existing manual workflow.

The form in scope is LAHSA Habitability Standards Inspection Form 1083, FY 2022–23. The project owner confirmed this is the form used and submitted in their workflow. LAHSA's [Housing Navigation page](https://www.lahsa.org/news?article=897-lahsa-housing-navigation-programs) and [Time-Limited Subsidy page](https://www.lahsa.org/news?article=896-lahsa-time-limited-subsidy-tls-) still link Form 1083 to the FY 2022–23 PDF (checked October 29, 2026); the owner/provider must confirm before the app claims no newer version exists. This confirmation does not establish that this app's export is accepted by LAHSA/provider staff or submitted to HMIS.

## User and job

**Primary user:** Housing navigator, TLS/RRH case manager, or evaluator completing an in-unit habitability walkthrough.

**Job:** Capture a short walkthrough of each room, follow a concise filming prompt, review timestamped visual suggestions against actual video evidence, record the evaluator's own outcome and correction details, sign the local inspection record, and prepare the appropriate files for manual handling.

## Main workflow

1. Start a mock-unit inspection using a pseudonym and select funding type. HUD-funded units are routed to an HQS-required notice and cannot be completed as Form 1083 in this app.
2. Record or upload a short clip for kitchen, bathroom, bedroom/living area, and hallway. Prompts include operating the faucet, fan, door lock, and visible detector. Save each clip locally and preview, replace, or remove it.
3. On an explicit connected action, submit a supported clip for server-side Meta SAM 3.1 segmentation and Meta Muse Spark mapping. If Meta Muse is unavailable and a Baseten key is configured, use Baseten-hosted Muse Spark Open for mapping fallback. Muse receives the SAM candidate stills and one original source still sampled near the center of each second, at 1 frame per second. Review timestamped evidence and unreviewed A/D suggestions across all 11 Form 1083 elements.
4. The evaluator separately records A, D, or needs-human-check, corrects any suggestion, and completes required correction/reinspection fields. AI output never sets the inspection result.
5. Sign and attest as the evaluator (and capture agency leadership sign-off when required). Generate three local PDFs: client-file copy, deficient-item-only landlord fix list, and a filled, flattened copy of the unchanged official LAHSA FY 2022–23 Form 1083 with appended evidence/continuation pages, plus JSON for the HMIS-ready record. The demo leaves participant/HMIS identity and unit address blank, so its form is not case-ready. Files are manually handled outside this app; provider acceptance is unverified and the app does not submit to HMIS.

The Form 1083 export requires evaluator agency name and landlord discussion YES/NO (with a date when YES); leadership name/title/signature/date are required only when agency policy requires leadership sign-off. Planned reinspection dates appear in notes and never populate the official “Date Reinspection Completed” field.

## Evidence and decision rules

- A/D suggestions must link to an actual still extracted from the current submitted video and its timestamp. Without evidence, the suggestion becomes needs-human-check.
- Captured stills are original decoded video frames; they are not generated, enhanced, or substituted with illustrative images.
- Model suggestions and confidence are drafts. Only evaluator decisions derive the overall result or appear as confirmed deficiencies in the landlord export.
- Correction text and dates are proposals until the evaluator records them. Replacing/removing a clip invalidates evidence-linked suggestions and affected decisions.
- Fire Safety has separate evaluator decisions for Form 1083 section 11a (unit detectors) and 11b (public/common-area detectors). Its aggregate is deficient if either clause is deficient, acceptable only if both are acceptable, and otherwise needs a human check.
- Any unresolved required human decision blocks completed sign-off. Local PDFs and JSON carry evidence provenance and a manual-upload/local-draft notice.

## Technical and operational limits

- Primary input is a single short video per room, captured in or uploaded from a mobile browser. MP4 is required by the Meta Files API. Compatible MOV files are normalized locally to MP4 with bounded packet-copy remuxing; the video and audio packets are copied without re-encoding, and the normalized bytes are then revalidated and used for preview, still extraction, hashing, storage, and any explicit upload. Unsupported MOV codecs fail with a clear message and keep the previous clip.
- Browser capture, room prompts, previews, derived stills, worker decisions, and signatures are local-first in versioned IndexedDB. The service worker caches only the app shell.
- Meta and optional Baseten credentials and raw provider responses remain server-side. The original room video is sent to Meta for SAM; SAM candidate stills plus 1-fps context stills may go to Meta Muse or, when its endpoint is unavailable and the optional fallback key is configured, Baseten Muse Spark Open. Provider files are temporary with expiry; deleting local data does not claim to delete provider-side copies or downloaded exports. Provider pricing and retention terms can change, so Profile points staff to current provider terms/dashboard rather than promising a fixed cost.
- Fixture examples are explicitly synthetic. A fixture pass is never described as a live provider result.
- No direct HMIS submission, landlord delivery, voucher tracking, automated eligibility/approval, or reinspection scheduling is included.

## Evaluation gate

Before claiming useful segmentation/mapping or preparing a demonstration script, evaluate one real staged 30-second kitchen/bathroom clip. Score faucet/fan/lock/detector track identity, Form 1083 element mapping, timestamp/still coverage, and misses in normal indoor lighting. Record misses and decisions before revising prompts. The clip was not included with the supplied brief, so this gate remains open until it is provided.

## Success measures

Measure staff time, usable evidence coverage, retakes, corrected/rejected suggestions, unresolved checks, rework, and sample size. Report only observed results; do not claim that the product improves placement timing or replaces evaluator judgment.
