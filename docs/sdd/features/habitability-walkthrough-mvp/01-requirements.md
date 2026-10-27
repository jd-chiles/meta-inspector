# Requirements

Baseline 1. All requirements below are mandatory for MVP readiness. Limits are application defaults, not claims about provider API limits.

## REQ-001 — Honest versioned catalog

Provide 3–4 items with stable IDs, catalog version, capture guidance and predefined manual checks. Illustrative items display “Demo checklist — not a verified Form 1083 mapping.” Provider-confirmed catalogs record exact mapped fields, source, version, verifier/date. Missing confirmation never promotes a demo item. Include one check a photograph cannot establish.

## REQ-002 — Guided validated capture

Support rear-camera capture where available and JPEG/PNG/WebP upload, with preview, replace, retake and cancel. One image per analysis; maximum 8 MiB and 20 megapixels. Validate decoded bytes, format and dimensions server-side; reject corrupt/unsupported/oversized/mismatched input. Normalize orientation, strip metadata, resize to a 1600px longest edge, assign fresh media ID and SHA-256 digest. Failure preserves earlier usable evidence.

## REQ-003 — Real Meta inference and explicit fixtures

A server-only Muse Spark adapter uses an official endpoint/schema checked during implementation. Missing credentials return setup error. Keys and raw provider errors never reach browser, bundles or logs. Explicit fixture mode stays visible in UI/export and never silently replaces a failed live call. Record model, mode, request ID and latency without media/secret logging.

## REQ-004 — Neutral validated drafts

Strict output contains observation, visible evidence, unknowns and suggested manual checks. Reject extra/prohibited verdict fields, bad structure, oversized strings and unusable empty output. Label output AI draft. Preserve catalog-required checks even if the model says they are unnecessary. Treat image/narration as untrusted data. No authoritative Approved/Deficient or habitability verdict.

## REQ-005 — Worker review and manual checks

Every draft begins unreviewed. Support accept, edit-and-accept, reject and reanalyze; preserve original draft, worker revision, disposition/time and manual-check responses separately. Required checks remain pending until worker records performed or not-performed plus note; not-performed stays unresolved. Rejection is not acceptance. Changing media/item or reanalyzing invalidates previous review and associated manual-check evidence.

## REQ-006 — Provenance and async correctness

Bind evidence to session, catalog/item/version, normalized media ID/hash/time, analysis ID, model/mode and review revision. Late responses after replacement, item change, cancellation or deletion cannot overwrite current evidence or restore removed records. Prevent duplicates; retry is explicit. Persist schema versions and offer recovery/reset for incompatible or corrupt data instead of trusting it.

## REQ-007 — Local recovery and deletion

Persist mock sessions/media in IndexedDB and recover after refresh. Delete-session and clear-all remove related media/drafts/revisions/object URLs and cancel analysis. Quota/private-mode failures allow an explicit in-memory session with warning. No server database, cloud storage, analytics or media service-worker cache. Local deletion does not claim to revoke provider submissions or downloaded exports.

## REQ-008 — Review-only export

Generate self-contained printable HTML with browser print-to-PDF: catalog/mode/version, item, photo, time, reviewed note, provenance, manual checks and unresolved items. Pending/rejected/failed items appear only as unresolved, without unapproved draft text. Every page says “Draft for worker review — not an approved inspection or HMIS submission.” Escape text, avoid remote image requests and exclude secrets/debug data. An entirely unreviewed session cannot export as completed.

## REQ-009 — Accessible mobile flow

Complete flow works at 360px and desktop without horizontal scrolling; keyboard access, visible focus, labels, announced loading/errors and non-color status cues. Camera denial offers upload. Empty, unknown, pending check, rejected, API error and storage error states expose recovery. No hover-only review/export controls.

## REQ-010 — Bounded local prototype API

Local single-user prototype accepts same-origin multipart only; no client fetch URLs, model IDs or system prompts. Fixed allowlisted Meta origin, upload/decode limits, one active analysis per session, 45-second timeout and cancellation. Stable safe errors for setup, invalid media/item, conflict, throttling, timeout, provider and output failures. No automatic billed retry. Public deployment needs a new authentication/rate-limit/retention design.

## REQ-011 — Honest fixtures and evaluation

Rights-cleared mock cases cover visual evidence plus human test, poor framing/unknown, and correction/rejection. Distinguish fixture/live output. Separate development and evaluation sets. Evaluation records current/assisted minutes, coverage, retakes, edits, unresolved checks and sample size. No fabricated metrics, practitioner validation or live smoke result. Missing credentials remain a limitation.

## REQ-012 — CI and independent Codex review

Document setup, environment names, ownership and actual executable checks. CI validates SDD immediately; after scaffold require lint, typecheck, unit, browser and production build. Missing scripts cannot silently skip. PRs identify REQ/TASK coverage and gaps. Codex follows AGENTS.md on races, review/unknown states, exports and secret/data boundaries. Record GitHub activation separately from local setup. Green CI proves neither live inference nor provider form confirmation.
