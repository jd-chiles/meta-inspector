# Architecture

Walkthrough Kit is a Next.js application with a local-first mobile walkthrough and server-side provider routes. The implementation details and API shapes remain documented in the [video mapping contract](integration/FORM_1083_MAPPING.md), [analysis contract](integration/ANALYZE_CONTRACT.md).

## Walkthrough data flow

1. The worker creates a staged inspection and records room clips in the browser. Clips, derived local evidence, evaluator decisions, and signatures are stored on the device.
2. Only after the worker explicitly requests live analysis does the browser send the selected video to the same-origin server route.
3. The server validates the actual media bytes, sends the clip to Meta SAM for segmentation, and derives bounded still frames from the verified video. The follow-up mapping request uses a short-lived identity-bound token and server-held frames.
4. Muse Spark drafts observations tied to returned evidence. The client validates identity and still hashes before showing those drafts.
5. The evaluator reviews every required item and records human decisions and sign-off. Local export code builds PDFs and JSON from the evaluator's record.

## Trust boundaries

- Provider keys, provider request/response bodies, and temporary provider file IDs stay on the server.
- The browser does not give the server a URL to fetch. The server accepts the uploaded media bytes and fixed, allowlisted request fields.
- Model output is unreviewed evidence-associated text. It cannot complete a manual check, set the inspection result, or create an approved deficiency.
- Room/media identity includes the relevant session, clip, hash, frame, timestamp, schema, catalog, analysis attempt, and revision. Stale asynchronous results must be discarded.
- The service worker caches the app shell only. Local deletion does not claim to erase provider copies or downloaded exports.

## Current and proposed systems

Address and SAM.gov checks are not implemented in the current architecture. Any future screening workflow would need defined data sources, matching rules, human review, failure handling, privacy analysis, and evaluation.
