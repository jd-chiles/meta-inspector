# POST /api/analyze — frontend contract (backend-owned)

Status: current. This doc is the single source of truth the walkthrough client
builds against; `src/server/analyze.ts` (invoked by
`src/app/api/analyze/route.ts`) implements it. On any mismatch the frontend
**blocks** and PM arbitrates — never work around the contract in UI code
(see `docs/RUNBOOK.md` §3). REQ-002, REQ-003, REQ-004, REQ-010.

Provider reference: `docs/integration/FORM_1083_MAPPING.md` §2. Catalog rule:
every checklist surface carries `Demo checklist — not a verified Form 1083
mapping.` No form-specific claim (provider gate §1.2 unmet).

## 1. Endpoint and transport

- `POST /api/analyze` only. Same-origin required:
  - `Origin` must equal the page origin (scheme + host + port). Missing
    `Origin` (non-browser client) is allowed.
  - Loopback aliases are treated as the same host when scheme and port match:
    `localhost`, `127.0.0.1`, `::1` (bracketed IPv6 normalized).
  - Anything else → `403 ORIGIN_FORBIDDEN` (see §4). Bytes are never processed.
- Body must be `multipart/form-data`. Any other content type → `400
  INVALID_MEDIA`. There is no JSON body variant.
- The route module exports only the `POST` handler plus `runtime`; all logic
  lives in the server-only `src/server/analyze.ts`.

## 2. Request fields (multipart)

Required non-empty string fields: `sessionId`, `itemId`, `analysisId`.
Required string field: `catalogVersion` (must equal the server catalog
`version`, currently `0.2.0-demo.1`; mismatch → `409 ITEM_MISMATCH`).
Required file field: `image` — a `Blob`/`File` of JPEG, PNG, or WebP bytes,
non-empty, at most 8 MiB (`413 INVALID_MEDIA` above the bound).

Forbidden fields (never accepted, case-insensitive): `imageUrl`,
`image_url`, `url`, `model`, `modelId`, `systemPrompt`, `prompt`. Any present
→ `400 INVALID_MEDIA` with `never accepted` in the message, and nothing is
ever fetched. The client cannot supply fetch URLs, model IDs, or prompts —
the server sets the model, system instructions, and endpoint.

Media validation (server, bytes only — no URL is ever fetched):
- MIME is sniffed from magic bytes (JPEG/PNG/WebP); anything else → `415`.
  A declared `File.type` that disagrees with the sniffed bytes → `422`.
- Structure is parsed for real (JPEG segments/SOF, PNG IHDR chain, WebP
  VP8/VP8L/VP8X chunks); corrupt or truncated input → `422`.
- Declared area above 20 megapixels → `422` before expensive work.
- Container metadata is stripped (JPEG APPn/COM + EXIF segment, PNG ancillary
  chunks with CRC rebuild, WebP EXIF/XMP/ICCP with VP8X flag clearing);
  EXIF orientation is applied to display dimensions; the canonical stripped
  bytes are SHA-256 digested and given a fresh server-assigned `mediaId`.
- Pixel resampling is an explicit seam: when the longest edge exceeds 1600px
  the response flags `resampleRequired: true` with the exact downscale target;
  a decoder-backed resampler produces the display bytes, else the canonical
  bytes are authoritative.
- The normalized image is returned as base64 and must fit 2 MiB of encoded
  text, else `413 INVALID_MEDIA`.

## 3. Success response (HTTP 200, JSON)

```jsonc
{
  "envelope": {
    "analysisId": "analysis-1",      // echoes request analysisId
    "sessionId": "session-1",        // echoes request sessionId
    "itemId": "demo-water-supply",    // server catalog item id
    "catalogVersion": "0.2.0-demo.1",
    "mediaId": "media-<uuid>",       // fresh server-assigned identity
    "mediaHash": "<64 lowercase hex>", // SHA-256 of canonical bytes
    "model": "muse-spark-1.3",
    "mode": "live | fixture",
    "requestId": "req-... | fixture-...",
    "latencyMs": 1234,               // server-observed, >= 0
    "draft": {
      "observation": "1-600 chars, neutral visible-state only",
      "visibleEvidence": ["0-5 strings, each <= 200 chars"],
      "unknowns": ["0-5 strings, each <= 200 chars"],
      "suggestedManualChecks": ["0-5 strings, each <= 200 chars"]
    }
  },
  "normalizedMedia": {
    "mediaId": "<same as envelope.mediaId>",
    "mime": "image/jpeg | image/png | image/webp",
    "width": 800, "height": 600,     // display dims (EXIF applied)
    "digest": "<same as envelope.mediaHash>",
    "base64": "<canonical bytes, <= 2 MiB encoded>",
    "targetWidth": 800, "targetHeight": 600,
    "resampleRequired": false,
    "pixelTransposeRequired": false
  },
  "mode": "live | fixture",          // always equals envelope.mode
  "model": "muse-spark-1.3",
  "requestId": "<same as envelope.requestId>",
  "latencyMs": 1234,
  // "fixtureNotice": "Fixture output — not live inference."  // fixture only
}
```

Rules the client can rely on:
- IDs and provenance (`analysisId`, `sessionId`, `itemId`, `catalogVersion`,
  `mediaId`, `mediaHash`, `model`, `mode`, `requestId`) are server-assigned;
  model text is never trusted for IDs. Top-level `mode`/`model`/`requestId`
  always equal the envelope values; `normalizedMedia.mediaId`/`digest` always
  equal `envelope.mediaId`/`mediaHash`.
- The draft is strictly neutral: `observation` plus evidence/unknowns/checks,
  at least one of the three lists non-empty. No verdict-like fields
  (`verdict`, `pass`/`fail`, `habitability`, `confidence`, `score`, …) ever
  appear — the server rejects provider output containing them.
- `fixtureNotice` is present **only** in fixture mode. A live response never
  carries it; fixture output must never be presented as live inference.
- The UI labels every draft `AI draft` and every surface with the mode
  (`fixture` or `live` + request ID for live).

## 4. Error responses (JSON, safe by construction)

Shape: `{ "error": { "code": "<CODE>", "message": "<user-safe text>", "retryable": <bool> }, "analysisId": "<id|unknown>" }`.
Messages are user-safe; keys, key-presence signals, provider bodies, and image
bytes never reach the browser, bundles, or logs. Server logs carry event +
IDs/timings/codes only.

| HTTP | code | retryable | meaning / client action |
|---|---|---|---|
| 403 | `ORIGIN_FORBIDDEN` | false | Cross-origin post. Use the same-origin client. |
| 400 | `INVALID_MEDIA` | false | Non-multipart body, missing `sessionId`/`itemId`/`analysisId`, forbidden client field, empty file, unreadable upload, corrupt bytes. Fix the capture and retry as a new attempt. |
| 415 | `INVALID_MEDIA` | false | Unsupported type (not JPEG/PNG/WebP). |
| 422 | `INVALID_MEDIA` | false | Corrupt/truncated bytes, declared-type mismatch, or over 20 MP. |
| 413 | `INVALID_MEDIA` | false | Over 8 MiB upload, over-long resample, or over 2 MiB response payload. Retake smaller. |
| 409 | `ITEM_MISMATCH` | false | Unknown `itemId` or stale `catalogVersion`. Reselect from the current checklist. |
| 409 | `REQUEST_IN_PROGRESS` | true | One active analysis per session. Wait for it or cancel, then retry once. |
| 503 | `SETUP_REQUIRED` | false | Bad `APP_ANALYSIS_MODE`, non-allowlisted `META_API_BASE_URL`, Contributor model ID, missing live credentials, or provider-rejected credentials (HTTP 401/403). Operator fixes server config; the photo is kept. Never falls back to fixture output. |
| 429 | `PROVIDER_RATE_LIMIT` | true | Provider throttling. Wait, then retry once manually. |
| 504 | `PROVIDER_TIMEOUT` | true | 45 s budget exceeded or the attempt was cancelled (client disconnect aborts server-side). Photo kept; retry once if the attempt is still current. |
| 502 | `PROVIDER_UNAVAILABLE` | true | Network failure, non-JSON provider body, or provider 4xx/5xx. Manual single retry only. |
| 502 | `INVALID_MODEL_OUTPUT` | true | Provider text was not valid JSON or failed strict draft validation (incl. verdict-like fields). Manual single retry only. |

Retry policy: the server never retries a billed call automatically. `retryable:
true` means the worker may explicitly retry **once**; `false` means fix the
input or config first.

## 5. Timeout, cancellation, and single-inflight

- One server-side budget: **45 s** per analysis including the provider round
  trip (`META_TIMEOUT_MS`). The route links the client disconnect signal to
  the provider fetch, so closing/cancelling the request aborts server work
  and surfaces `504 PROVIDER_TIMEOUT` — promptly even if the HTTP layer
  ignores the abort signal.
- One active analysis per `sessionId` (guard released in a `finally`, so a
  finished attempt never blocks the next one). A second POST for the same
  session while one runs → `409 REQUEST_IN_PROGRESS`.
- Live smoke (`npm run test:live`) uses a 60 s client timeout for the single
  authorized call; see `tests/live/smoke.mjs`.

## 6. Mode, auth, and request identity

- Mode is explicit and server-side: `APP_ANALYSIS_MODE=live|fixture`
  (blank/absent defaults to `fixture`, the safe keyless default; any other
  value → `503 SETUP_REQUIRED`). Live without credentials fails closed with
  `503`; a failed live call never falls back to fixture output.
- Auth is server-only: `META_API_KEY`, with the official `MODEL_API_KEY`
  accepted as a fallback alias (canonical name `META_API_KEY`). Base URL must
  equal exactly `https://api.meta.ai/v1`; anything else is a setup failure.
  Default model `muse-spark-1.3` (Standard mode); any `*-contributor` model ID
  is rejected at config time. No `NEXT_PUBLIC_*` secret exists; no key or
  provider body is ever returned, logged, or bundled.
- Every success carries `model`, `mode`, `requestId`, and `latencyMs` at top
  level and in the envelope (live: provider request ID or `req-<base36>`;
  fixture: `fixture-<analysisId>` with `latencyMs: 0`).
