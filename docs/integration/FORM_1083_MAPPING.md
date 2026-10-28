# Form 1083 mapping status and Meta integration contract

Status: draft for TASK-001. No provider-confirmed Form 1083 mapping exists in this checkout.
Active form version is unresolved. Do not treat this file as an approved inspection mapping.

Access dates: all official Meta and LAHSA links below were accessed 2026-10-27.

## 1. Catalog mode

### 1.1 Current mode: demo only

- The app uses a clearly illustrative demo catalog until a participating provider confirms
  the exact operative Form 1083 copy, version, and 3–4 selected items.
- Every demo surface (UI, printable export, fixtures) must carry the label:
  `Demo checklist — not a verified Form 1083 mapping.`
- Demo catalog shape (implemented in TASK-003 under `src/data/catalog.demo.json`):
  `schemaVersion`, `catalogId`, `version`, `mode: "demo"`, `source-confirmation`
  metadata, and 3–4 items each with stable `id`, `label`, `captureGuidance`,
  and required `manualChecks` (at least one check a photograph cannot establish).
- Demo item IDs use the `demo-*` prefix (for example `demo-item-01`). They are
  illustrative placeholders. They are not official Form 1083 numbering, wording,
  or physical-test requirements.

### 1.2 Provider-confirmation gate (blocks any form-specific claim)

No item may claim a mapping to Form 1083 until all of the following are recorded:

1. Exact operative Form 1083 copy and version (title, fiscal year, issuer, issue date).
2. Source and verifier: who supplied the copy, who verified it, and on what date.
3. Exact mapped fields: official item number/wording plus the app `itemId` it maps to.
4. Required physical tests and sign-off: which checks require a person/test device,
   and who must approve or sign the final form.
5. Accepted output: what worker output (if any) the provider accepts as a draft input,
   with explicit statement that app export is not an approved inspection or HMIS submission.

Missing confirmation never promotes a demo item. Fake provider confirmation in a test
must not promote it either (browser check covers this in REQ-001).

### 1.2.1 Public-only source record (2026-10-28 — not a confirmation)

- Source: public LAHSA FY 2022–2023 Form 1083, extracted 2026-10-28 from
  `https://www.lahsa.org/item.ashx?id=6886` (listing published 10/31/2022,
  last updated 1/31/2023; PDF footer `12-19-22 FORM 1083`).
- Source-confirmation for gate purposes: status `unconfirmed`
  (public listing only — not provider-confirmed as the operative copy);
  `suppliedBy=null`, `verifiedBy=null`, `verifiedAt=null`.
- Effect: no demo item is promoted. All `demo-*` IDs stay illustrative
  placeholders under the §1.1 demo notice. Provider-mapped (non-`demo-*`)
  IDs and any exact field table remain blocked until every §1.2 gate item
  is recorded.
- Open: which provider confirms this copy and the 4 short-listed items in
  `docs/ITEM_SELECTION.md` (owner question). The 2024-version note from
  §1.3 is still unresolved — neither the public FY22–23 PDF nor earlier
  2024 references establish the operative copy.

### 1.3 What is unresolved

- Public LAHSA listing points to an FY 2022–2023 form:
  https://www.lahsa.org/documents?id=6886--tls-and-hn-fy-2022-2023-form-1083-habitability-standards-form.pdf
  (listed in `docs/RESEARCH.md`). Earlier project notes refer to a 2024 version.
  Neither establishes which copy a participating provider uses today.
- Field counts, official wording, physical-test requirements, and acceptance of any
  draft workflow are unverified. This file intentionally contains no field table
  so it cannot be mistaken for a mapping.

## 2. Meta integration contract (checked against official docs)

### 2.1 Endpoint and auth

| Field | Value | Source |
|---|---|---|
| Base URL (allowlisted) | `https://api.meta.ai/v1` | Overview, Models, API reference |
| Text+vision endpoint (primary for this app) | `POST /v1/chat/completions` (OpenAI-compatible) | Chat Completions protocol |
| Alternate endpoint | `POST /v1/responses` (recommended for agentic/multi-turn; same models/auth) | Responses API, Image understanding |
| Model catalog endpoint | `GET /v1/models`, `GET /v1/models/{model}` | Models guide |
| Token-estimate endpoint | `POST /v1/responses/input_tokens` | Image understanding |
| Auth header | `Authorization: Bearer $MODEL_API_KEY` | Authentication guide |
| Server env var (official) | `MODEL_API_KEY` | Authentication, Overview |
| Key format | `LLM_<numeric-id>_<secret>`; created once in Model API dashboard, revocable per key | Authentication guide |
| Key management | Unique key per app; server-side only; never commit; rotation = create new, migrate, delete old | Authentication safety rules |

Application config (pinned in TASK-002 `.env.example`, names only, no values):

- `META_API_KEY` (server-only; maps to official `MODEL_API_KEY` bearer token —
  TASK-002/004 must document the alias and use exactly one canonical name).
- `META_MODEL` (default `muse-spark-1.3`; see §2.2).
- `META_API_BASE_URL` (checked against allowlist `https://api.meta.ai/v1`; any other
  host is rejected — REQ-010).
- `APP_ANALYSIS_MODE=live|fixture` (explicit; no silent fallback — REQ-003).
- No `NEXT_PUBLIC_*` secret. No client-supplied model ID, system prompt, or fetch URL.

### 2.2 Model identifier

Recommended production model: `muse-spark-1.3` in Standard mode.

- Source: Models guide (`https://dev.meta.ai/docs/models`, accessed 2026-10-27).
- Input: text, image, video, audio, PDF. Output: text. Context window: 1,048,576 tokens.
- `muse-spark-1.3` is the latest version, tuned for agentic workflows; recommended
  for new work. Prior versions `muse-spark-1.2` / `muse-spark-1.1` exist on the same
  endpoints (model-ID swap only). `muse-wonder-1.0` takes the same requests but is
  preview, higher-cost, and unnecessary for this bounded draft task.
- Contributor variants `muse-spark-1.3-contributor` / `muse-spark-1.2-contributor`
  select discounted Contributor mode (content may train future models). They must
  not be used for any real pilot or tenant-adjacent data. The app default is the
  Standard-mode ID. Contributor IDs appear here only to identify what to block.
- Open-weight `Muse Spark Open` / `Muse Glimmer` are self-hosted and out of scope;
  they have no Model API endpoint.

### 2.3 Image request payload (Chat Completions)

Images go only in `user`-role messages. One image per analysis request.

```json
{
  "model": "muse-spark-1.3",
  "messages": [
    { "role": "developer", "content": "<bounded neutral-draft instructions>" },
    { "role": "user", "content": [
      { "type": "text", "text": "<item context + strict JSON instruction>" },
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,<bytes>" } }
    ]}
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "AnalysisDraft",
      "schema": {
        "type": "object",
        "properties": {
          "observation": { "type": "string" },
          "visibleEvidence": { "type": "array", "items": { "type": "string" } },
          "unknowns": { "type": "array", "items": { "type": "string" } },
          "suggestedManualChecks": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["observation", "visibleEvidence", "unknowns", "suggestedManualChecks"],
        "additionalProperties": false
      }
    }
  }
}
```

Notes from official Image understanding guide (accessed 2026-10-27):

- Chat Completions wraps the image as an `image_url` object with a `url` string
  (public `https` URL or `data:` URL). The Responses API equivalent is an
  `input_image` block with a plain-string `image_url`. Same model/capability.
- This app always sends server-normalized `data:` bytes. It never sends client
  URLs and the server never fetches client URLs (REQ-002/REQ-010).
- Official per-image limits: 50 MB inline `image_url`, 1 GiB via Files API,
  max 50 images per request, supported MIME `image/jpeg`, `image/jpg`,
  `image/png`, `image/gif`, `image/webp`, `image/x-icon`. Undecodable bytes
  return HTTP 400. PDF uploads contribute at most first 50 page-images.
- Application limits are stricter by design (REQ-002/REQ-010): one image per
  request, 8 MiB and 20 megapixels max, server-side decode/validate, EXIF strip,
  orientation normalize, resize to 1600px longest edge. Official limits do not
  relax app limits.
- `temperature`/`top_p` stay at defaults (1.0); `reasoning_effort: "none"` is
  rejected by the provider for Muse Spark (HTTP 400).

### 2.4 Output schema (strict, neutral draft)

- Success shape: `choices[0].message.content` holds a JSON string matching the
  `AnalysisDraft` schema above; `usage` carries token counts; `model` echoes the
  serving model. The app parses with `JSON.parse` then validates with Zod
  (TASK-003/004): `observation` 1–600 chars; `visibleEvidence`/`unknowns`/
  `suggestedManualChecks` each 0–5 strings, ≤200 chars each; no verdict,
  confidence, pass/fail, or habitability-judgment fields. Extra or missing fields,
  oversized strings, or unusable empty output are rejected as
  `INVALID_MODEL_OUTPUT` (HTTP 502 to the client).
- Structured-output constraints enforced provider-side (accessed 2026-10-27):
  nesting depth ≤10, ≤5,000 total properties, ≤120,000 chars of names/enums,
  recursive `$ref` schemas rejected with HTTP 400. The app schema above is
  intentionally flat to stay well inside these bounds.
- IDs, timestamps, and provenance (`analysisId`, `mediaHash`, `model`, `mode`,
  `requestId`, `latencyMs`) are application-generated in the `AnalysisEnvelope`.
  Model text is never trusted for IDs (design § Contracts).

### 2.5 Data handling and retention

- Standard mode: content (prompts, files, context sent + model responses) is not
  used to train Meta models. Contributor/Discounted mode: content (inputs +
  outputs) may be used to train, develop, evaluate, and improve Meta AI models,
  with disassociation steps before training use but not before safety/abuse review.
  Customer Data (account/roles/profile) is never used for training.
  Sources: Pricing and rate limits (`https://dev.meta.ai/docs/pricing-rate-limits`),
  Models guide, Data Commitments (`https://dev.meta.ai/legal/commitments`) —
  all accessed 2026-10-27.
- Standard mode is not a zero-retention guarantee. Retention, safety/abuse
  processing, legal compliance, and account deletion flows are governed by the
  Terms of Service and Privacy Policy. Confirm endpoint-specific retention before
  any real pilot (open question 5 in `docs/RESEARCH.md`). No real tenant, health,
  address, or identifying data enters hackathon model calls; mock-unit media only.
- Transport: TLS 1.2+ in transit; PCI-DSS handling for payment data; ISMS and
  incident-response program described in Data Commitments. Do not infer more than
  the page states.

Official links (access date 2026-10-27 for all):

- https://dev.meta.ai/docs/overview
- https://dev.meta.ai/docs/models
- https://dev.meta.ai/docs/authentication
- https://dev.meta.ai/docs/image-understanding
- https://dev.meta.ai/docs/structured-output
- https://dev.meta.ai/docs/protocols/chat-completions
- https://dev.meta.ai/docs/pricing-rate-limits
- https://dev.meta.ai/legal/commitments
- https://dev.meta.ai/legal/terms-of-service

## 3. Trust boundaries and data flow

```
capture UI → same-origin POST /api/analyze (multipart: image + sessionId/itemId/catalogVersion/mediaId/analysisId)
  → server validates origin, version, single-inflight guard
  → decode/validate/normalize bytes + SHA-256 (authoritative server copy)
  → server-only Meta adapter (Bearer key, allowlisted base URL, 45s timeout, cancellation)
  → strict output validation (Zod; reject verdict/extra/oversized/empty)
  → commit only if session/item/media/attempt still current; else discard (async correctness)
  → client persists canonical normalized bytes + envelope in IndexedDB; export reads a stable snapshot
```

- Browser is untrusted: no keys, no provider bodies, no raw media in logs.
  Server logs only safe IDs, timings, and error codes.
- Image/narration are untrusted input: bound bytes/dimensions before expensive
  decode, strip metadata, never fetch client URLs, escape worker/model text in UI
  and printable HTML.
- Local deletion removes local media/drafts/revisions/URLs and cancels analysis.
  It does not claim to delete provider copies or downloaded exports.

## 4. Compatibility

- Provider SDK compatibility: any OpenAI-compatible client works by setting
  `base_url="https://api.meta.ai/v1"` and `model="muse-spark-1.3"`. Moving between
  Muse Spark versions (or to `muse-wonder-1.0`) is a model-ID change on the same
  endpoints. Do not substitute OpenAI credentials or a non-allowlisted base URL.
- App compatibility: catalog `snapshot` travels with each session so later catalog
  edits cannot reinterpret old evidence. Schema-versioned IndexedDB with explicit
  recovery/reset on incompatible data. Printable export is self-contained HTML
  (embedded normalized media, no remote fetches) printed via browser print-to-PDF.

## 5. Failure modes (client-safe mapping)

| Condition | Client code | HTTP | Retryable |
|---|---|---|---|
| Missing/unconfigured server key | `SETUP_REQUIRED` | 503 | no (fix config) |
| Corrupt/unsupported/oversized/mismatched image | `INVALID_MEDIA` | 400/413/415/422 as applicable | no (recapture) |
| Unknown item / catalog version mismatch | `ITEM_MISMATCH` | 409 | no (reselect) |
| Duplicate analysis for same attempt / one active per session | `REQUEST_IN_PROGRESS` | 409 | user-gated |
| Provider rate limit | `PROVIDER_RATE_LIMIT` | 429 (honor `Retry-After`, backoff+jitter; no automatic billed retry) | user-gated |
| Provider timeout (45s) / cancellation | `PROVIDER_TIMEOUT` | 504 | user-gated |
| Provider unavailable / error | `PROVIDER_UNAVAILABLE` | 502 | user-gated |
| Output fails strict validation | `INVALID_MODEL_OUTPUT` | 502 | user-gated |

Rate-limit headers (`x-ratelimit-*`) and `usage` token counts are server-observed;
keys on the same team share limits (per-team RPM/TPM table in Pricing guide).

## 6. Credential availability (no values)

- As of 2026-10-27 in this checkout: no Meta API key is provisioned or stored.
  `.env.example` will carry names only. No key, secret, or full provider body
  appears in this file, in logs, or in evidence.
- Generic scaffold work (TASK-002 onward: app shell, domain schemas, fixture
  adapters, unit/browser checks) is permitted while a live smoke is pending.
- Live smoke (`npm run test:live`, rights-cleared mock-unit media, real
  `muse-spark-1.3` call) remains a separate, explicitly recorded check. It must
  fail clearly when credentials are absent — never pass via fixtures. No live
  success is claimed by this document.
