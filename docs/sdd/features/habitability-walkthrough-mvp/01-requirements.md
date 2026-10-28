# Requirements — 11-item Form 1083 + installable PWA (epoch 3)

Epoch 3 rescopes the MVP to the confirmed full checklist and a modern installable PWA for November 4. Epochs 1–2 implementation and evidence are preserved in history and reused (see 03-plan). All requirements below are mandatory for November 4 readiness unless marked otherwise. Limits are application defaults, not claims about provider API limits.

## REQ-001 — Confirmed 11-item versioned catalog

Provide exactly 11 items with stable IDs, catalog version `0.2.x` (prerelease `0.2.0-demo.1` accepted by validation; later `0.2.x` patches keep the same IDs), capture guidance and predefined manual checks. Provider confirmation uses a two-field model that separates existence from detail: `confirmation.attested = true` (owner statement, October 28, 2026 — the 11-item Form 1083 scope is confirmed to exist) and `confirmation.details = OPEN` for everything not provided: exact form version/date, source document identity, verifier name/role, verification date, official item wording, required physical tests and sign-offs per item, and provider-accepted output format. Until an item's details are confirmed, every surface keeps the label “Demo checklist — not a verified Form 1083 mapping” and no item claims operative mapping. The LAHSA FY22–23 public listing is a working reference only, never confirmation. Missing confirmation details never promote a demo item. Every item carries at least one check with `photoCannotEstablish=true` AND `requiresPhysicalTest=true` (a photograph cannot establish the physical test, and the physical test is mandatory).

## REQ-002 — Guided validated capture (unchanged, now ×11 items)

Support rear-camera capture where available and JPEG/PNG/WebP upload, with preview, replace, retake and cancel. One image per analysis; maximum 8 MiB and 20 megapixels. Validate decoded bytes, format and dimensions server-side; reject corrupt/unsupported/oversized/mismatched input. Normalize orientation, strip metadata, resize to a 1600px longest edge, assign fresh media ID and SHA-256 digest. Failure preserves earlier usable evidence. Applies identically to all 11 items.

## REQ-003 — Real Meta inference and explicit fixtures (unchanged)

A server-only Muse Spark adapter uses an official endpoint/schema checked during implementation. Missing credentials return setup error. Keys and raw provider errors never reach browser, bundles or logs. Explicit fixture mode stays visible in UI/export and never silently replaces a failed live call. Record model, mode, request ID and latency without media/secret logging.

## REQ-004 — Neutral validated drafts with uncertainty (unchanged, now ×11 items)

Strict output contains observation, visible evidence, unknowns and suggested manual checks. Draft suggestions are editable and carry explicit uncertainty; unknowns are first-class. Reject extra/prohibited verdict fields, bad structure, oversized strings and unusable empty output. Label output AI draft. Preserve catalog-required checks even if the model output contradicts them. Treat image/narration as untrusted data. No authoritative Approved/Deficient or habitability verdict.

## REQ-005 — Worker review and manual checks (unchanged, now ×11 items)

Every draft begins unreviewed. Support accept, edit-and-accept, reject and reanalyze; preserve original draft, worker revision, disposition/time and manual-check responses separately. Required checks remain pending until worker records performed or not-performed plus note; not-performed stays unresolved. Rejection is not acceptance. Changing media/item or reanalyzing invalidates previous review and associated manual-check evidence.

## REQ-006 — Provenance and async correctness (unchanged, now ×11 items)

Bind evidence to session, catalog/item/version, normalized media ID/hash/time, analysis ID, model/mode and review revision. Late responses after replacement, item change, cancellation or deletion cannot overwrite current evidence or restore removed records. Prevent duplicates; retry is explicit. Persist schema versions and offer recovery/reset for incompatible or corrupt data instead of trusting it.

## REQ-007 — Local recovery, deletion, and offline-tolerant progress (extended)

Persist sessions/media in IndexedDB and recover after refresh. Saved local progress survives app restart and offline periods. The PWA app shell loads offline from service-worker cache. While offline, new analyses are queued and shown as pending; no draft is synthesized offline and no verdict is ever implied. On reconnect, queued items analyze explicitly (worker action or explicit retry), preserving attempt identity. Delete-session and clear-all remove related media/drafts/revisions/object URLs and cancel analysis, including queued offline items. Quota/private-mode failures allow an explicit in-memory session with warning. No server database, cloud storage, analytics or media service-worker cache of evidence bytes. Local deletion does not claim to revoke provider submissions or downloaded exports.

## REQ-008 — Review-only printable and PDF export (extended)

Generate self-contained printable HTML with browser print-to-PDF covering all reviewed items: catalog/mode/version, items, photos, times, reviewed notes, provenance, manual checks and unresolved items. Pending/rejected/failed items appear only as unresolved, without unapproved draft text. Every page says “Draft for worker review — not an approved inspection or HMIS submission.” PDF output carries the identical banner and content policy as HTML. Escape text, avoid remote image requests and exclude secrets/debug data. An entirely unreviewed session cannot export as completed.

## REQ-009 — Accessible mobile flow (unchanged, now ×11 items)

Complete flow works at 360px and desktop without horizontal scrolling; keyboard access, visible focus, labels, announced loading/errors (including offline/pending states) and non-color status cues. Camera denial offers upload. Empty, unknown, pending check, rejected, offline, API error and storage error states expose recovery. No hover-only review/export controls.

## REQ-010 — Bounded local prototype API (unchanged)

Local single-user prototype accepts same-origin multipart only; no client fetch URLs, model IDs or system prompts. Fixed allowlisted Meta origin, upload/decode limits, one active analysis per session, 45-second timeout and cancellation. Stable safe errors for setup, invalid item/media, conflict, throttling, timeout, provider and output failures. No automatic billed retry. PWA installation and offline caching do not widen this trust boundary. Public deployment needs a new authentication/rate-limit/retention design.

## REQ-011 — Honest fixtures and evaluation (updated: 11-item coverage)

Rights-cleared mock cases cover visual evidence plus human test, poor framing/unknown, and correction/rejection across the 11-item catalog. Distinguish fixture/live output. Separate development and evaluation sets. Evaluation records current/assisted minutes, coverage, retakes, edits, unresolved checks and sample size. No fabricated metrics, practitioner validation or live smoke result. Missing credentials remain a limitation. Demo plan and launch copy may claim only what evaluation results plus executed CI evidence show.

## REQ-012 — CI and independent review (unchanged)

Document setup, environment names, ownership and actual executable checks. CI validates SDD immediately; after scaffold require lint, typecheck, unit, browser and production build. Missing scripts cannot silently skip. PRs identify REQ/TASK coverage and gaps. Codex follows AGENTS.md on races, review/unknown states, exports and secret/data boundaries. Record GitHub activation separately from local setup. Green CI proves neither live inference nor provider form confirmation.

## REQ-013 — Installable PWA (new)

Ship a valid web app manifest (name, icons, display, theme), a service worker that caches the app shell for offline launch, and an install path (install prompt/beforeinstallprompt handling plus manual-install guidance). Installed app opens to saved local progress. Offline launch shows the shell with saved state and pending analysis states; offline boot needs no network. Service worker caches application shell/assets only — never evidence bytes, provider payloads, keys, or full-resolution media beyond the existing IndexedDB store. No background sync of analysis results in this phase.

## Later phase (explicitly out for November 4)

HMIS integration and accepted packet formatting, landlord-facing fix lists and deadlines, broader offline synchronization (multi-device, background result sync). These enter only with confirmed requirements and schedule.
