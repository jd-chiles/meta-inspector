# Verification plan

No application checks have run. Docs and plugin-contract validation are the only checks available before implementation. Planned commands must become real, non-empty checks in TASK-002. No bypasses, skipped required tests or fixture results labeled live.

## Executable checks

- **docs**: `node scripts/verify-sdd.mjs`; timeout 30000ms; browser=false. Maps REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012.
- **lint**: `npm run lint`; timeout 120000ms; browser=false. Maps REQ-012.
- **typecheck**: `npm run typecheck`; timeout 120000ms; browser=false. Maps REQ-001, REQ-003, REQ-004, REQ-006, REQ-012.
- **unit**: `npm run test:unit`; timeout 120000ms; browser=false. Maps REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-010, REQ-011.
- **browser**: `npm run test:e2e`; timeout 240000ms; browser=true. Maps REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012.
- **build**: `npm run build`; timeout 240000ms; browser=false. Maps REQ-003, REQ-009, REQ-012.
- **live-smoke**: `npm run test:live`; timeout 90000ms; browser=false. Maps REQ-003, REQ-010, REQ-011.

Docs mapping verifies structural traceability only. It cannot prove application behavior. The browser and unit checks must contain the scenarios below.

## Requirement coverage

| Requirement | Required behavioral evidence |
|---|---|
| REQ-001 | Catalog schema/mode tests; browser sees demo label; fake provider confirmation cannot promote it. |
| REQ-002 | Valid upload/camera fallback; byte/type/dimension/corrupt-file rejection; prior image preserved; normalized orientation/metadata and digest checked. |
| REQ-003 | Mock upstream tests for headers, payload, missing key, errors and explicit fixture labeling; one actual successful live Meta call recorded separately. |
| REQ-004 | Invalid/extra/verdict/long output rejected; unknown and mandatory manual checks retained even if model output contradicts them. |
| REQ-005 | Edit/accept/reject transitions; prior review invalidated after replacement; unresolved checks not marked performed by AI acceptance. |
| REQ-006 | Delayed response A after image B, item change, retry, cancellation and deletion cannot overwrite or resurrect evidence; current IDs/hash/revisions match. |
| REQ-007 | Refresh recovery, incompatible data, quota failure, delete/clear-all and object URL cleanup; verify IndexedDB state after deletion. |
| REQ-008 | Export excludes pending/rejected draft text, preserves unresolved counts and provenance, escapes script/HTML payloads, embeds media, and shows repeating draft banner. |
| REQ-009 | Real browser at 360px and desktop; keyboard traversal, focus, labels/status, upload fallback and actionable error recovery. |
| REQ-010 | Server boundary tests for origin, URL/prompt rejection, payload/decode limits, timeout/cancel, duplicates, rate limit and safe provider failure; no automatic retries. |
| REQ-011 | Rights/provenance manifest; separate development/eval fixtures; measurement sheet contains no invented results; live limitation recorded honestly. |
| REQ-012 | Validate SDD/config/task contracts, required scripts, secret-free Actions workflow and stable build; inspect PR review guidance and activation status separately. |

## CI and live verification

GitHub CI runs docs immediately. App checks are required whenever package.json or src/app-source directories appear. Before scaffold CI reports “application not scaffolded”; that is not application readiness. In fixture mode browser tests must intercept the model boundary or use the explicit fixture adapter and never use real keys.

Live-smoke is a separate local SDD check using configured Meta credentials and rights-cleared media. It must fail clearly when credentials are absent; it must not skip or pass using fixtures. Run it only as part of the authorized implementation verification, recording request/model/mode/timing and sanitized outcome. Never store the key or full provider body as evidence.

After code, run lint/typecheck/unit/build/browser on one stable source fingerprint, then independent code/QA/security/gate review. Codex GitHub review is additional feedback; plugin reviews still need native recorded verdicts. Source/check/spec changes invalidate affected evidence. Release stays not-ready until the mandatory live path and current reviews are proved; form-specific claims remain blocked unless provider confirmation exists.