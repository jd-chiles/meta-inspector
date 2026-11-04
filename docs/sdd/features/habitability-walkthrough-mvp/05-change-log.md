# Change log

## Resume verify: 52/52, mvp32 live connectivity, staged footage missing — November 4, 2026 (Muse Code)

Verified the sibling session's passcode removal (both apps root 200, warm <0.3 s) and re-ran the full suite on the mvp32 tree: 52/52 green, so `reinspection.spec.ts:145` stands as an intermittent flake (room varies; sibling 0/2, this session 2/2) — kept, not skipped; diagnosis open. Staged clips are gone from `/tmp` and no copy exists in-repo, blocking staged quality re-proof until the owner resupplies. Ran the authorized synthetic connectivity probe against dev mvp32: segment 200 in 5.8 s, 0 candidates (correct abstention), no map call. No staged-gate claim; no task acceptance or native evidence.

## Passcodes removed, dev warmed, e2e 51/52 — November 4, 2026 (Muse Code)

Owner directed removal of both passcodes: `INSPECTION_PASSCODE` env + `inspection-passcode` secret deleted on dev (rev 27) and prod (rev 25); both verified open (root 200, manifest 200). Against project rules (no public unauthenticated deployment); recorded as an open risk with spend exposure (billed-analysis endpoints public — quota alerts required). Dev warmed to minReplicas 1 (rev 28): root 0.1–0.3 s, was 44 s cold. Gate re-run on the mvp32 tree: verify-sdd/lint(0 err)/typecheck/unit(760+3)/build green; e2e 51/52 — `reinspection.spec.ts:145` fails 2/2, tour stalls at `film-room:<room>` with the room VARYING (hallway, living-room), a race signature around re-inspection clip-state reset vs tour derivation. No code changed (docs only); diagnosis open. No live provider call; no task acceptance or native evidence.

## mvp32 deploy: segment+map restore, cloud wire, untrusted-dev replacement — November 4, 2026 (Muse Code)

Analysis path restored to segment+map (02-design compliant; stills stage server-resident but uncalled); minimal consent-gated cloud upload wired with hash-verified status; cloud specs rescoped to it (full thin-client UI remains future scope); dead cloud dupes removed. ACR held unrecorded images mvp28–mvp31 from unknown trees with dev running mvp31; mvp32 (`ccd71d5`, `APP_VERSION` 32) redeploys dev + prod from the known tree. Gates green (unit 760+3, e2e 52/52); live $0 probes pass. Dev passcode set (rev 26, gate verified); cloud secrets still an owner action. No live provider call; no task acceptance or native evidence.

## Phase 0 freeze — November 4, 2026 (Muse Code docs closure)

`dev` frozen at `96cb3c2` as the Phase 0 baseline. Commits on `dev` after `d7065be`: `1bf0d85` (deps: Langfuse v6 packages + pg/pg-boss + test:live switch), `7d9051e` (Langfuse v6 migration; see the entry below), `c1fb0ec` (stills analysis stage + e2e refactor + batch cap 3 + design-qa refresh, including one no-explicit-any lint fix in `tests/e2e/move-in-ready.spec.ts`), `96cb3c2` (thin-client cloud port, dev-only unscoped). Baseline gates on frozen content: docs exit 0; lint 0 errors + 2 pre-existing exhaustive-deps warnings; typecheck exit 0; unit 71 files, 750 passed / 3 skipped. Build + full e2e pending (running in parallel at freeze time; no result claimed). The stills analysis stage and the thin-client cloud port are unscoped additions needing an SDD scope decision. Docs-only record update; no task accepted; no native SDD approval, review, or evidence claimed; no live/provider/device/recipient result claimed.

## Stills analysis stage + e2e refactor + batch cap 3 — November 4, 2026 (`c1fb0ec`)

Commit `c1fb0ec` adds a stills analysis stage, refactors the e2e suite, caps batch concurrency at 3, and refreshes design-qa (including one no-explicit-any lint fix in `tests/e2e/move-in-ready.spec.ts`). The stills stage is an unscoped addition needing an SDD scope decision; behavior and verification claims for it live with the implementing agents and their executed checks, not this record entry. No task acceptance or native SDD evidence.

## Langfuse JS SDK v6 migration (v4 platform) — November 4, 2026 (Muse Code)

`langfuse@3.x` is below the v4 cutover floor (JS SDK 5.4.0+, Cloud cutover 2026-11-16), so tracing moves to `@langfuse/client@6`, `@langfuse/tracing@6`, `@langfuse/otel@6` plus `@opentelemetry/sdk-trace-node` and `@opentelemetry/context-async-hooks` (all 6.1.1 / 2.12.0, lockfile updated; `langfuse@3` removed). `src/server/observability/langfuse-trace.ts` is rewritten on the OTEL model with the same caller interface (no `meta-sam.ts` changes): deterministic W3C trace id (sha256 sync mirror of `createTraceId`, parity-tested), one root observation per stage joined by explicit parentSpanContext, session/tags/environment propagated onto every observation including generations, stage summaries as root output, and an isolated provider initialized once per process. Live verification caught and fixed a real bug: without a registered async context manager, `propagateAttributes()` silently drops every attribute (session/tags/environment missing on export); setup now registers `AsyncLocalStorageContextManager` (the only global OTEL state touched). `LANGFUSE_BASE_URL` is now canonical (legacy `LANGFUSE_BASEURL` still accepted as fallback; `.env.example` updated). The eval-push script uses `api.datasets.create` + `dataset.createItem` + `shutdown()`. Verified live against Cloud project "1083" (server v4.74.0): one labeled probe trace showed both stage roots, correct nesting, session/tags/env on all four observations, and generation usage; both probe traces were deleted afterward (zero footprint). No evaluators, rules, or datasets exist in the project (API-verified); legacy-row UI check and blob-export settings remain owner actions (project key lacks `projects:read`). Verified: tsc clean, lint 0 errors, unit green, build green (full counts below).

## SAM.gov owner checks live — November 4, 2026 (Muse Code)

- The owner-supplied free `SAM_API_KEY` (Azure secret, server-side only) activates both federal legs: exclusions by owner name plus a new owner-identity source (registration status, UEI, registered-address-vs-property match). The pre-screen form gains an optional owner field; without a name both legs report skipped with the assessor-portal remedy. Live probes fixed a parser bug (the array key is `excludedEntity`, verified against api.sam.gov) and confirmed the entity record paths. A bounded 24 h process-local cache (5 min for transport failures) protects small personal-key daily quotas; 401/403 and 429 degrade with key/quota-specific remedies.
- Verification: live exclusions + entities probes 2026-11-04 (valid key, real record shape); new server unit tests (identity match/multi-match/unknown-address, rejected-key and quota remedies, cache hit isolation, request owner passthrough, overlong-owner rejection) + pre-screen e2e asserts all nine sources. Full gates below.

## Voice walkthrough reliability — November 3, 2026 (Muse Code)

Owner reported the guided voice sometimes read only the first filming prompt. Three defects: (1) cues raced fixed timers against playback and could be dropped; (2) iOS only lets an Audio element play from timers after it played inside a user gesture, so delayed cues were rejected; (3) the assistant-speech effect cleanup cancelled speech on every record-derived identity change, killing narration mid-take. Fix: recording start primes a shared playback element; tour and capture narration walk cues sequentially (next waits for the current one, a failed cue never blocks the rest); the harmful generic cleanup is removed. Verified: lint/typecheck clean, unit green, browser green (full counts in the session record). No REQ change; no task acceptance or native evidence.

## Pre-screen round 2: assisted housing, emissions, exclusions (REQ-R1) — November 3, 2026 (Muse Code)

- Three more sources join the fan-out: HUD assisted multifamily within 1 km (subsidy, REAC score, troubled flag, risk), EPA TRI facilities by ZIP (emissions context), and SAM.gov exclusions by owner name (dormant: needs free `SAM_API_KEY` plus an owner name; parcel coverage for owner identity unverified, so it reports skipped with the assessor-portal remedy). LAHD rows gain the APN. Upstream body reads are now time-bounded (5 s) after a trickling EPA response hung the route past the client timeout; full 8-source live report returns in ~4 s.
- Verified live before wiring: assisted-properties proximity (Angelus Plaza REAC 92), TRI-by-ZIP facilities, SAM endpoint/params from GSA docs. ECHO facility-radius stays deferred (service URL not in static docs); LA parcel owner identity stays deferred (only a regional Zone_8 layer and APN-only tables found).
- Verification: extended server unit tests (troubled flag, SAM key/owner gating) + pre-screen e2e asserts all eight sources. Full gates below.

## Live building pre-screen, free sources (REQ-R1 live path) — November 3, 2026 (Muse Code)

- REQ-R1 live: `POST /api/prescreen` (`src/server/prescreen/`) runs one Census geocode, then five keyless sources in parallel — LADBS open cases (Socrata `u82d-eh7z`), LAHD violations (Socrata `cr8f-uc4j`), FEMA NFHL flood Layer 28, HUD deteriorated-paint index by tract, OpenFEMA disaster declarations. Each source degrades independently (ok/empty/unavailable/skipped); the demo literal still answers from the labeled example. Queries are sent only to the allowlisted endpoints, never persisted, never logged, and the route has no tracing (addresses stay out of Langfuse).
- Verified live before wiring: Census coords+tract, LADBS/LAHD SoQL address queries, NFHL flood zone, DPI tract join, OpenFEMA state filter — all returned real records 2026-11-03. Owner/APN + SAM exclusions and EPA facility proximity stay deferred (parcel zone coverage and ECHO params unverified).
- Verification: 12 server unit tests (parser, per-source degradation, fixture determinism, handler validation) + pre-screen e2e in fixture mode. Full gates below.

## Langfuse v4-safe tracing (join mode) — November 3, 2026 (Muse Code)

The shared-trace design re-sent client.trace with the same id from the
map stage, and finish() used trace.update (which re-sends a
trace-create). Per the Langfuse FAQ "How to update traces...", v4
backends ingest re-sent ids as duplicate traces. createAnalysisTracer
gains joinExistingTrace: the segment stage creates the trace, the map
stage binds by explicit traceId for spans/generations, and finish()
records a closing "stage-result" span instead of trace.update.
Covered by tests/unit/server/observability/langfuse-join.test.ts with
a mocked SDK (join mode never calls client.trace; both modes emit the
result span). Verified: tsc clean, unit 642 passed / 3 skipped,
e2e 47/47.

## Sprint 5 — Observability (REQ-O1, REQ-O2) — November 3, 2026 (Muse Code)

- REQ-O1: server-only Langfuse tracing (`src/server/observability/langfuse-trace.ts`, `langfuse@3.39.2`). One trace per analysis attempt shared by the segment and map stages via a deterministic trace id; spans per phase (`preflight-decode`, `sam-upload`, `sam-concept:*`, `select-candidates`, `frame-decode`, `validate-proposals`) plus a `muse-map` generation; best-effort flush per request. Configured only when both `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY` are set (optional `LANGFUSE_BASEURL`); unset means zero overhead and no network calls, and tracing never throws into the pipeline. Payloads are metadata only — never media bytes, pseudonyms, names, keys, or provider bodies (Muse response text excepted as the debugging target). Imported only by server code (both video API routes); no client path reaches it.
- REQ-O2: eval dataset `meta-inspect-walkthrough-v1` (`src/server/observability/eval-cases.ts`) with five validated reference-only seed cases (water-flow-accuracy, object-classification, evidence-grounding, uncertainty-abstention, false-positives) plus owner-run `scripts/langfuse-eval-push.mjs` (`--dry-run` verified; refuses invented hashes and missing keys; never in CI). Scoring runs in Langfuse against recorded traces.
- Verification: 12 new unit tests, no network; segment suite unaffected. Full merged gates below.

## Sprint 4 — Reach, honesty-gated (REQ-R1…R4) — November 3, 2026 (Muse Code)

- REQ-R1: Home "Building pre-screen" card; blank shows the explainer, the literal `123 Demo St (example)` shows a labeled example under `Illustrative example — live records not connected.`, anything else answers `Live check not connected for this address.` No live LAHD path (dataset unverified, no env var); queries never persisted or sent.
- REQ-R2: `tourLanguage` record field + Profile toggle (ES disabled with `Spanish voice not configured.` unless server-only `FISH_VOICE_ID_ES` is set); Spanish narration for tour setup/filming/checks/analyze/review/finish, sí/si/no + Spanish numbers in `voice-parse`, ES speak path (400/503 fail-closed), `VOICE_CLIP_TEXTS_ES` inventory + `generate-voice --lang es` into `public/voice/es/` (not yet generated — needs owner-approved billed synthesis). AI Guide popup stays English and says so. Review/sign-off/exports stay English.
- REQ-R3: bedroom/living-room/hallway detector cards show `Press the detector's test button now` with tap-to-start `Capture still` (canvas snapshot, JPEG bounds, stored as `detector-test-` local evidence, visible in the Fire Safety picker) and `Skip still` (records nothing). Human chirp answer unchanged.
- REQ-R4: Profile About line plus the `docs/DEMO.md` scorecard shell with BLANK run fields (live protocol run deferred, spend-gated). No accuracy percentage anywhere.
- Integration: added strobe-exclusion assertions (EN+ES) and an ES review-item narration test.
- Verification: fixture/unit only; full merged gates below.

## Sprint 3 — Lifecycle (REQ-L1, REQ-L2, REQ-L3) — November 3, 2026 (Muse Code)

- REQ-L1: signed records with any D decision show "Re-inspect deficiencies" on Home; starting snapshots each D deficiency into `priorDeficiency`, resets those decisions to unreviewed and both sign-offs, and the tour queues only those elements; review cards show Before stills (best-effort, honest missing-stills copy); `deriveFinalInspectionResult` unchanged. Saving while still unreviewed preserves the snapshot.
- REQ-L2: persisted `analysisQueue` on the record (enqueue on save, dequeue on removal/analysis, prune on room removal); runner triggers the batch driver on online/`visibilitychange` under walkthrough/batch consent; per-room "Analysis queued" chips + tour queue counts. The runner mirrors REQ-S5's failure guard: a finished failed batch never auto-restarts; retry stays manual.
- REQ-L3: sign-off "Add location" (tap-only, 10 s timeout) storing rounded `inspectionLocation`; denial shows "Location not recorded" and never blocks; consumed by REQ-E1 as `property_address.geolocation` (null when absent).
- Tests: 25 unit + new L1 re-inspection and L2 offline-queue e2e specs. Full merged gates below.

## Sprint 2 — Workflow outputs (REQ-E1, REQ-E2, REQ-E3) — November 3, 2026 (Muse Code)

- REQ-E1: `src/export/lahsa-1083.ts` `buildLahsa1083Json` as export kind `lahsa-1083-json` ("LAHSA JSON" button): `inspection_id`, `inspection_timestamp`, boolean `checklist_criteria` plus nested `fire_safety` (`emergency_exit`, `unit_smoke_detectors`, `common_area_detectors`, `visual_alarms_required`, `visual_alarms_approved`), derived `overall_determination` ("APPROVED" only when every criterion is true, else "NOT APPROVED") with an internal consistency assertion, dual `signatures`, null-not-invented address/HMIS fields, and the rule-7 `mapping_notice`. Gates: complete A/D decisions (needs-human-check blocks), both signatures, LAHSA funding. `additional_standards` derives from aggregate Fire safety (interpretation — owner to confirm against the program spec). Built against the canonical Sprint 1 contracts (no placeholders remain).
- REQ-E2: `case-note` export (`text/plain`, shareable): deterministic template delegating gating/determination to the LAHSA JSON builder, labeled "Case note draft — review before pasting into HMIS." Optional polish via `POST /api/exports/polish-case-note` only when `TEXT_POLISH_ENABLED=1`; every failure returns the template.
- REQ-E3: `landlord-fix-list` gains `en`|`es` (`FIX_LIST_STRINGS` table, "Fix list (EN/ES)" actions, `-es` filename, plain-language header, per-D rows, agency from `evaluatorAgencyName`, hostile-text escaping test).
- Verification: 42+ unit tests; full merged gates below.

## Sprint 1 — Meta voice + form legitimacy (REQ-V1, REQ-F1, REQ-F2) — November 3, 2026 (Muse Code)

- REQ-V1: ASR defaults to Muse Voice Transcribe (`POST {base}/asr/transcribe`, `muse-voice-transcribe-1.0`, cookbook multipart, mic clips to mono 24 kHz s16 WAV via server FFmpeg, 20 s timeout). `VOICE_ASR_PROVIDER=muse|fish` (default muse); any Muse failure falls back to Fish once with `providerUsed` surfaced as "Transcribed by backup provider" (silent fallback would violate rule 4). Empty transcript is silence. TTS stays Fish. No live Meta ASR call made (fixture only).
- REQ-F1: dual attestation — `ParticipantSignoff` mirroring `EvaluatorSignoff` ("I walked through this unit with the evaluator. The findings above match what I saw."), record field, sign-off UI block, every signoff reset clears both (either order allowed), export gates + both signatures in all PDFs/JSON. Name + signature only (VAWA posture).
- REQ-F2: `participantVisualAlarmsRequired` flag + Profile toggle; bedroom/hallway gain the strobe check via record-aware `checksForRoom`, Fire Safety criteria mention visual alarms. No new SAM concept.
- Verification: unit + e2e dual-sign coverage; full merged gates below.

## Sprint 0 — Analysis speed package (REQ-S1…S6) — November 3, 2026 (Muse Code)

- REQ-S1: `SAM_MAX_CONCURRENT_CONCEPTS` (int, clamp 1–6, default 6; safe unset). 6-wide live acceptance UNVERIFIED (no live key); if a live run shows attributable 429/5xx at 6-wide, drop the default to 4 with a dated record. Never claim 6-wide without that record.
- REQ-S2: batch driver on `runRoomBatch` (max 2 rooms, per-room generations/aborts/identity, cancel-everything, progress = settled/total, runs on capture + guided). Server guard isolates by full request identity (cap 2/session).
- REQ-S3: analysis uses the first 30 s (`ANALYSIS_CLIP_CAP_SECONDS`, FFmpeg `-t 30` on the temp copy, original untouched, ≥30 s evidence dropped); segment responses and the tour state the window note.
- REQ-S4: map payload 12 earliest sample stills / 4 MB. Supersedes the "at most 30 stills per room" note in `docs/DECISIONS.md` decision 9.
- REQ-S5: analyze-on-save via the pure `shouldAutoEnqueueOnSave` gate (tour + batch consent, LAHSA, live, online, deduped; skips on manual-in-flight, unresolved failures, MOV; offline saves enqueue nothing immediate). Covered by a 15-case unit matrix.
- REQ-S6: `VIDEO_PROMPTS` drops bathroom smoke/CO detectors and kitchen CO detector. Kitchen filming cues still mention detectors (voice-pinned; filming/analysis diverge there by design).
- Staged-clip before/after timings UNVERIFIED (no live key; no numbers recorded).
- Integration fixes on the merged tree: batch-finish auto-navigation waits for filming completeness (partial auto-batches no longer yank capture to review); L2 runner mirrors the S5 failure guard; no-restart e2e rewritten for auto-start + failure-guard semantics (1 auto + 3 retry = 4 segments, no restart on 4th save); Sign-Off e2e asserts export reachability via scroll (dual sign-off + new exports legitimately extend the screen); capture room-header actions wrap (queued chip overflowed 360px).
- Merged verification (all fixture/mocked except the honest UNVERIFIED notes above; `test:live` never run): `verify-sdd.mjs` exit 0; `lint` 0 errors (2 pre-existing-kind warnings); `typecheck` clean; `test:unit` 54 files, 634 passed / 3 skipped; `build` success; `playwright --workers=1` 47/47 green (incl. new L1 re-inspection + L2 offline-queue specs). No native SDD approval/evidence claimed.

## Review friction removal + room skip + bathroom scope — November 2, 2026 (Muse Code)

Owner: review forced a checkbox tap per requirement, AI-asked answers did
not populate draft-less requirements, bathrooms wrongly asked for a smoke
detector, and units missing a room had no path. Saving a decision is now
the in-person acknowledgment (checkbox and its save gate removed; the
decision record still stores evaluator name + timestamp). Opening any
requirement without an AI draft quotes its rooms' spoken yes/no answers
into the observation field, so nothing is re-typed. Each filming card has
"Skip — not in this unit", reusing the room toggle (drops pending checks,
invalidates running analysis, resets sign-off). Bathroom shot list and
voice check are faucet/toilet/fan only. Covered by the tour spec: skip
advances kitchen→bathroom; draft-less detail prefills Voice checks and
saves to Approved with no checkbox.

## Single entrance enforced + instant repeat loads — November 2, 2026 (Muse Code)

Owner found the AI Guide popup offered its own way into the flow
("Set up the unit", "Film the …") alongside Home's Start button. The
guide script now takes a flowStarted flag (real evidence: clips,
drafts, decisions, or sign-off — setup-form-only does not count) and
shows a no-action prestart node before the flow starts, pointing at
Start inspection. Tour film nodes link to the full capture screen so
manual capture stays reachable inside the flow; specs drive the same
single entrance (Start → tour setup → film node → capture link).
Navigations are now cache-first with background refresh (shell v5):
repeat visits paint instantly even on a cold container, since
progress restores from IndexedDB; only plain 200s are cached by final
URL so passcode redirects can never strand anyone. Dev and prod apps
set to minReplicas 1 (warm; reversible, ~$1–2/day each). Verified on
the origin/dev merge: docs/lint/typecheck/unit green, build green,
44/44 e2e green. No REQ change; no task acceptance or native
evidence.

## Voice-led review + boot splash — November 2, 2026 (Muse Code)

Owner asked for (1) a loading screen for the ~30 s cold-start wait and
(2) a voice-led journey from unit setup to a completed form. Tour
review items now take a spoken yes (same guarded confirm path,
evaluator identity, and timestamp as the Confirm tap) or no (opens the
detail form for a differing verdict); the evaluator name fills by
voice, reads back, and saves on yes; agree/disagree/confirm join the
yes/no vocabulary. The review voice prompt does not auto-speak (the
tour script carries the instruction live), so no new static clips were
needed — inventory still 40 pinned. Start tap stays (browser audio
policy), consent and needs-human-check stay taps, signature stays
typed. Launch is voice-first: a fresh Home leads with the voice-agent
entry (same Start/New labels and testids). Fixed a preview-only voice
split the owner reported — the tailnet preview had no Fish credentials,
so every dynamic line fell back to the device voice; audit confirms
device speech is reachable only through the speakPrompt fallback, and
the preview now serves Fish for static and live lines. Boot shows an
inline splash card with staged status and elapsed
seconds, removed when the app or unlock page renders; shell cache
bumped v3 to v4. Caught in testing: the splash observer's
unconditional status write retriggered itself into a renderer hang
(fixed with compare-before-write), plus a node-turnover race in the
new tour spec (fixed with transition waits). Verified: docs exit 0;
lint 0 errors (3 pre-existing warnings); typecheck clean; unit 474
passed / 3 skipped (38 files); browser 43/43 with no flakes or skips;
build green. No REQ change; no task acceptance or native evidence.

## Single entrance + capture dashboard — November 2, 2026 (Muse Code)

Owner-directed: Home had two entrances (guided tour vs manual Continue) for one workflow. Now one Start/Continue button always enters the guided tour, which resumes from saved data; manual screens stay as free-nav stops and tour finish links to sign-off as the single exit. Specs reach manual capture through the AI guide's next action (shared helper rewritten; single-entrance assertion added). The helper dismisses the guide after its action: the first full run showed 29 passed / 12 failed because the open guide panel covered content actions on later screens, a state manual capture never shows. Also: capture dashboard — the camera viewport + record actions pin to the top of the main scroller (app shell uses overflow:clip so sticky works; older browsers degrade to normal scroll), the live filming cue captions on the viewport, and saving a clip scrolls the yes/no checks into view. The pixel-geometry viewport spec was replaced by dashboard-contract tests (pinned dock, nav clearance, no overflow, auto-scroll). Verified this session on the combined tree: docs exit 0; lint 0 errors (3 pre-existing warnings); typecheck exit 0; unit 471 passed / 3 skipped (37 files); browser 41/41 with no flakes or skips; build green. No REQ change; no task acceptance or native evidence.

## Live-proof removal — November 2, 2026 (Muse Code)

Owner-directed: the live proof clips section and guided-tour live stops are removed; review drafts come from room-footage mapping only, and elements without drafts go to manual review. Deleted the capture card, tour live nodes/scripts/progress section, bindings, handlers, LiveCapture, live-elements, and their specs. Previously saved element clips still load, reconcile, and display (no migration, old records intact). Guard: browser absence assertion for the removed card. Verified: lint/typecheck clean, unit 471 passed / 3 skipped, browser 40/40, build green. No REQ change; no task acceptance or native evidence.

## One-voice fix — November 2, 2026 (Muse Code)

Owner reported the app fell back to the stock device voice. Diagnosis: two voice systems — the tour spoke Fish while assistant guidance and main-capture filming cues spoke device speechSynthesis directly. Fish credentials/quota verified healthy (single 2-char probe, 200 audio/mpeg); static manifest closed 31/31 against the inventory, so the fix was unification, not repair. Guide speech now goes through the static-first Fish pipeline with speaker injection for tests; added 6 static assistant speeches + 3 reprompts to the inventory (9 synthesized, 31 reused, 40 total, manifest pins a voice hash). Verified: lint/typecheck clean, unit 474 passed / 3 skipped, browser 42/42, build green. No REQ change; no task acceptance or native evidence.

## Guided-journey simplification — November 1, 2026 (Muse Code)

Owner field-tested on a phone: journey choppy, AI popup covered half the screen, voice lagged badly. Owner picked film+confirm+sign gates, film-first-ask-after timing, and pre-generated voice. No REQ wording changed: decisions/acknowledgment/sign-off gates stand; friction was removed from capture, not from verdicts.

- AI Guide opens on phones as a collapsed one-line banner (step title always visible, expands on tap, <=46vh when open); while recording it captions the current filming cue so muted users keep guidance. Voice/mute/close stay reachable collapsed.
- Film-first-ask-after made visible: tour film-room nodes show the shot list as a checklist with the spoken cue highlighted and speak only a short intro; questions already followed clips in tour and capture order. Setup questions moved to shared consts so voice clips match by exact text.
- One-tap Confirm beside each current AI draft (detail, mobile sticky bar, tour card): the tap is the in-person acknowledgment and plan review, then auto-advances. D without a complete suggested plan, without still evidence, or with an empty observation opens the detail form instead; fire safety confirms 11a+11b together, splits stay manual. Draft alone still never checks or saves (browser guard test still green).
- Voice static-first: 31 fixed-script clips pre-generated per voice/model into content-addressed public/voice files (scripts/generate-voice.mjs; inventory contract-tested against sources); client plays exact-text clips instantly, dynamic prompts synthesize live with a bounded 16 MiB immutable server cache, then device voice, then silent text. Generation run (~31 Fish calls) still needs owner approval; until then the live+cache path applies.
- New tests: decision-draft unit table (7), voice inventory contract (5), static lookup (3), server speech cache (1), film-room short-intro updates, collapsed-banner + shot-list + one-tap-confirm browser coverage. Verified this session: docs exit 0; lint 0 errors (3 pre-existing warnings); typecheck exit 0; unit 469 passed / 3 skipped (37 files); browser 42/42; build green. No task acceptance, native SDD evidence, or release decision. tasks.json/active-tasks.json untouched (native tooling owns them).

## UI overhaul + walkthrough guide — October 31, 2026 (Muse Code)

Visual overhaul of the Move-in Ready app within the pinned layout geometry (no box, spacing, or type-size changes; color/depth/typography only): dark camera-viewfinder empty state, refined cards/buttons/rows/nav, pulsing REC dot with reduced-motion guard, antialiased type. Added an always-available walkthrough guide: floating entry pill plus a 5-step checklist sheet (setup → film → review → sign-off → export) derived deterministically from saved progress, with jump actions; HUD route excluded. New tests: guide-model unit table (5), guide FAB/sheet browser spec (2). Verified: lint/typecheck clean, unit green, browser 19 passed / 2 skipped (fixture-only). No behavior, copy, testid, or layout-box changes to existing flows.

## Sprint slices 1, 2, 5 (agent parts) — October 31, 2026 (Muse Code)

Slice 1 audit: video picker offers/accepts video coherently (`video/mp4`, `video/quicktime`; camera input carries `capture="environment"`); HUD exit, acknowledgment migration, 11a/11b aggregate, conditional landlord date, and Add-note boundaries all have passing unit/browser coverage. The stills-picker iOS sheet quirk found earlier sits in orphaned code nothing mounts; left untouched. No Slice 1 code changes; no gaps demonstrated.

Slice 2 reliability repair: SAM per-concept calls now run with bounded overlap (max 3, order-preserving, fail-fast with sibling abort) instead of sequentially, addressing the reproducible kitchen 23 s clip timeout against the coded 150 s stage deadline; added elapsed ticker (aria-hidden) during segmenting/mapping and a pagehide keepalive cancel so a closed tab cannot wedge the session for the 15-minute lease. New tests: 2 server concurrency tests (overlap bounds/order, fail-fast abort) + 2 cancel-tracker unit tests. Verified: lint/typecheck clean, unit 388 passed / 3 skipped, browser 17 passed / 2 skipped (fixture-only), build green. No live call was made; kitchen wall-time improvement is unmeasured until an owner-initiated live attempt. Server per-request logging noted as follow-up, not implemented.

Slice 5 agent part: added `output: standalone`, root `Dockerfile` (FFmpeg 9.0.2 build stage + standalone run as non-root), `.dockerignore`. Verified: `docker build` succeeds; container serves 200 on `/`, `/manifest.webmanifest`, `/sw.js`; `/opt/ffmpeg/bin/ffmpeg` reports 9.0.2; process runs as `app`. Azure provisioning/execution remains an owner-operator step per the existing ACA plan. No task acceptance or native SDD evidence claimed; release stays Not ready.

## Tree unification + Slice 0 baseline verification — October 31, 2026 (Muse Code)

Unified the Codex worktree video app (Move-in Ready flow, room video, `/api/video/segment`, `/api/guide`, PDF/JSON exports, new suites) with the stills walkthrough and UI polish into this checkout; committed and pushed as `38d51d3` on `origin/main` with a clean tree. Executed checks on that exact tree, all observed this session: `node scripts/verify-sdd.mjs` passed (15 requirements, 11 active acyclic tasks, 7 named checks); `npm run lint` clean; `npm run typecheck` clean; `npm run test:unit` 384 passed / 3 skipped (22 files); `npm run build` green (routes `/`, `/api/analyze`, `/api/guide`, `/api/video/segment`); `npx playwright test` 17 passed / 2 skipped against a fresh loopback production server in fixture mode with provider keys scrubbed. No task acceptance, native SDD approval/evidence/review, live provider result, clip-gate score, device check, recipient acceptance, or deployment is claimed. Release stays Not ready.

## Epoch 3 rescope — 11-item Form 1083 + installable PWA — October 28, 2026

Documentation and planning pass only; no product implementation started. Owner-directed rescope for the November 4 hackathon deliverable. Epochs 1–2 implementation and all verification evidence preserved in history.

- 01-requirements rescoped to exactly 11 confirmed items (confirmation user-attested; version/source/verifier/date/wording/tests/sign-offs/output marked OPEN/TBD; LAHSA listing stays a working reference); REQ-007 extended (offline shell, saved progress, pending-while-offline queue); REQ-008 extended (PDF parity); new REQ-013 (installable PWA); HMIS/landlord/broader-sync explicitly later-phase.
- 02-design: PWA architecture (manifest, icons, shell-caching SW with trust boundaries, offline queue semantics), catalog v0.2 fail-closed TBD contract, PDF-via-print-CSS acceptance.
- 03-plan: reuse table (domain/session/UI/server/export/storage/tests reusable), five new tasks TASK-069–073 with estimates/deps/acceptance, fit flags, deferred list.
- 04-verification: REQ-013 row; 11-item, offline, reconnect-race, and PDF coverage; loopback-server workaround recorded.
- 00-request/06-release/07-retrospective aligned (release stays Not ready).
- Out-of-packet updates specified as deferred actions: README.md + IDEA.md pointers (implementation-phase docs tasks), Kanban board + worker prompts (owner-executed; external changes forbidden in this pass).

Record note: on October 28 the pre-existing entries below were accidentally overwritten during epoch-3 drafting and are restored here from cross-references in 06-release.md and 07-retrospective.md; substance verified against those records. No implementation or evidence was affected.

## TASK-041 READY promotion — October 27, 2026

Documentation-only update under TASK-041 (REQ-012). Input snapshot: `5f7c89129b9b984666e747caff47f385e6d2946e7d6a450ee3b8f044db530f73` (SDD revision 267, stage `implementing`). No product code, check, commit, publication, deployment, or live call is part of this change. Gate TASK-040 returned READY (passed) on the complete evidence chain; 06-release.md Status flipped from Not ready to Ready on that verdict; 07-retrospective.md closed with the final outcome (all reviews passed, one live call, single-call discipline, no publish/merge/deploy). Carried limitation: catalog remains illustrative demo; no provider confirmation, mapping, or pilot claim.

## TASK-036 live-smoke success — October 27, 2026

Documentation-only update under TASK-036 (REQ-012). Input snapshot: `5f7c89129b9b984666e747caff47f385e6d2946e7d6a450ee3b8f044db530f73` (SDD revision 250, stage `implementing`). No product code, approval, release-status promotion, commit, publication, deployment, or secret handling (key loaded from local `.env` into process env, never printed). Live-smoke success recorded in 06-release.md: coordinator-side `SMOKE_IMAGE=/tmp/live-smoke-detector.jpg npm run test:live`, exit 0 — model `muse-spark-1.3`, mode `live`, requestId `5b303073-787c-481d-8725-8c2b9a865666`, latencyMs `6108`, canonical sha256 `2c93bab0335436542c071f99c3eea08026d1e7866d7ac730dde160262ebdafba`, 3024x4032, item `demo-smoke-alarm`, one call only, no retries; self-test 18/18, fail-closed exit 1 without key, fresh build exit 0, six re-run checks passed at revision 248. Status stayed Not ready pending fresh QA/gate; provider gap open; no publish/merge/deploy claimed. 07-retrospective.md completed with live outcome and remaining QA/gate/provider gaps.

## Baseline 1 — October 26, 2026

Prepared request, twelve requirements, proposed architecture, ten implementation tasks, executable-check definitions and Codex/CI handoff. Existing project notes remain the product source. Resolved the form-version dependency by allowing an explicit illustrative catalog; provider confirmation still required for form-specific mapping claims. Proposed Next.js/TypeScript/local IndexedDB, a real server-only Meta adapter and printable HTML export as the smallest coherent implementation. No product code or live API call is part of this documentation/setup change. Setup validation (verify-sdd.mjs structural pass, ci-app.mjs docs-only report, plugin Config/TaskInput schema parse, CI guard fixtures) passed; no independent spec/plan review or approval fabricated.

## TASK-034 stale-record fix — October 27, 2026

Documentation-only update under TASK-034 (REQ-012) closing the stale-record blocker named by gate TASK-033 (NOT READY). Input snapshot: `975914a824c601ecaaa55bc8708aa9c3f54a6bb5906bdc71969b27534fd947c3` (SDD revision 235, stage `implementing`); observed evidence at SDD revision 228 on stable fingerprint `ee9df466771f0e906cf4a18a5699e03576d3454a52e7e9d55770fff69863b23c`. Recorded builder history (TASK-001–010 plus repairs, spec TASK-011, plan TASK-012), six green checks with red-command controls, honest live-smoke failure (no key, exit 1, no fixture substituted), code TASK-032 pass (2 info notes), security TASK-030 pass (1 low note), QA TASK-029 failed on credentials, gate TASK-033 NOT READY. 06-release.md kept Not ready with the three blockers; non-blocking notes accepted as backlog. No live success, confirmation, or publish/merge/deploy claimed.

## TASK-010 verification and readiness-gap record — October 27, 2026

Documentation-only update under TASK-010 (REQ-003, REQ-011, REQ-012). Source snapshot: `0318bbea7a44c20df9fda285897eef71cafb2b54c05a94d5ec10d8f34` (SDD revision 67, stage `implementing`). Wrote `docs/evaluation/results.md` (all cells unmeasured, sample size zero, fixture-only inputs, live pending, demo-only form status); extended `docs/REVIEW_AND_CI.md` with exact configured commands, two observed `docs`-check entries, absence of app checks, hosted docs-only CI run `40432010484` as the only CI success, no live smoke, no independent reviews, setup names only, Not-ready readiness. Release stayed Not ready; form status illustrative demo.

## 2026-10-29T21:38:41.564Z

Re-declare the active-worktree task graph TASK-103–TASK-110 after the runtime registry was recreated empty; no historical evidence from /home/hermes/workspace/meta-inspect is imported and no code checks run while Codex audits are in flight.

## 2026-10-29T23:46:45.562Z

Refresh the stale TASK-103 acceptance contract from the updated authored requirements; make mobile viewport fit measurable in REQ-009, TASK-109, and verification; preserve prior evidence/history and re-declare current TASK-103–TASK-110 from the feature tasks.json. No app code checks or source edits are included.

## 2026-10-30T00:02:22.224Z

Reconcile the two open non-blocking independent-review findings and correct stale TASK-103 dependency wording in authored SDD documents. Preserve all prior evidence/history, reset review baselines, and re-register active tasks with TASK-103 dependencies=[] before fresh spec/plan reviews. No application-source changes or code checks.

## 2026-10-30T00:14:21.275Z

Repair documentation-only QA boundaries and serialized phase ownership; assign measured Capture-fit implementation to frontend TASK-107, preserve legacy evidence/history, and require fresh independent spec/plan reviews without app work, checks, or approval.

## 2026-10-30T00:20:23.588Z

Plan TASK-113 active graph-aware docs validator repair before TASK-103–106, preserve all historical records/evidence, keep implementation and docs checks unexecuted, and obtain fresh spec/plan reviews without approval.

## 2026-10-30T00:22:55.069Z

Finalize TASK-113 ordered docs gate and align TASK-103 description with its new prerequisite before fresh read-only reviews; no validator, manifest or application implementation and no checks/approval.

## 2026-10-30T00:26:41.240Z

Correct only TASK-112 acceptance: TASK-103 depends on TASK-113 and historical TASK-069–073 are not active prerequisites. Preserve history/evidence and unchanged plan/requirements; obtain fresh independent reviews without implementation, checks or approval.

## 2026-10-30T00:29:23.596Z

Repair REQ-006/design schemaVersion omission: name schema version and catalog version separately across four authored artifacts and TASK-111. Preserve TASK-113 ordering/history/evidence; no implementation, checks or approval; fresh independent spec then plan reviews required.

## 2026-10-31

Requirement-first UX redesign: app opens on Inspection Home (next-step hero, stage progress, 11-requirement status list, room shortcuts) instead of the Capture form; bottom navigation gains Home. Capture is headed "Film the unit" with a next-room/checklist bar above the camera. Review is headed "Requirement checklist": ordered Form 1083 checklist with progress bar, continue-to-next-undecided, and an explicit "Use AI draft to pre-fill" action that fills editable fields only — the in-person acknowledgment and save stay evaluator actions, so no AI text completes a manual check. Headings/back-labels and e2e specs updated; new home-checklist-flow spec covers the sequence.

## 2026-10-31

Voice-guided inspection agent: auto-opening AI Guide overlay with speech readout (SpeechSynthesis, mutable, persisted) narrates every stage and timed filming cues during takes; tap-to-respond actions deep-link setup, per-room camera start, one-tap batch analysis, requirement confirm, and sign-off. Batch analysis runs the guarded per-room pipeline sequentially with per-room consent derivation and proposal-proven success. Checklist gains pre-fill-all and save-all-confirmed (in-person acknowledgments stay per-item and explicit). GuideSheet FAB removed and superseded. Service-worker shell cache bumped v2 to v3 so installed devices pick up new builds.

## 2026-10-31

Hands-free walkthrough rebuild (Paraspot/SnapInspect-style journey): one upfront walkthrough consent, film 4 rooms, AI batch auto-starts on the 4th saved clip and auto-opens the report; issues-first AI Report section surfaces deficient and evidence-less drafts with video timestamps. Per-room manual analysis remains as fallback. Auto-batch covered by a mock-live e2e; issue selection covered by unit test.

## 2026-10-31

CI repair: commit the previously missing modules, upgrade @playwright/test 1.49.1 to 1.64.1 and default e2e to full Chromium (headless shell cannot decode H.264), and fall back to the video seek position when requestVideoFrameCallback never fires for detached video. Guide moves from floating button to a fifth bottom-nav tab so it cannot cover content actions; Home offers Continue versus Start-new when progress exists.

## 2026-10-31

Mobile cutoff repair: requirement/AI-report grids and content stacks now constrain minimum track widths so no-wrap text can no longer force the page wider than the phone. E2E runs all mobile specs with real mobile rendering (isMobile) and asserts element-level viewport fit on Home, Capture, checklist, and the open assistant, proven by a negative control (reverted CSS fails the new assertion).

## 2026-10-31

Saved inspections: list/switch/start-new/delete from Home with per-inspection clips, drafts, decisions, and signatures. InspectionStore gains list(); VideoClipStore gains removeSession(); switching resets all per-inspection UI state and reloads clips from the session id. Starting new keeps prior work saved; deletion confirms and removes record plus clips. Covered by list/switch/delete e2e.

## 2026-10-31

Live pipeline unblocked: Next.js serves request.url with a localhost host even when bound to 127.0.0.1, so the same-origin gate rejected every live video request. Loopback spellings (localhost, 127.0.0.1, [::1]) now compare as one app origin; foreign origins still rejected (regression test). First real live proof: SAM segmentation plus Muse mapping returned unreviewed suggestions end to end. Also adds baseline production response headers and a no-store service-worker response.

## 2026-10-31

Production deploy: Azure Container Apps (metainspect-prod / metainspect-app, westus2, consumption scale-to-zero) serving image metainspect:mvp3 at https://metainspect-app.livelyriver-978b26d8.westus2.azurecontainerapps.io/. ACA ingress strips Origin and Referer, so video segment/map/cancel POSTs now also send a non-secret same-app marker header (src/domain/walkthrough-client.ts) that the server accepts when both browser headers are absent; still CSRF-safe because cross-origin pages cannot set custom headers without a CORS preflight the API does not answer. Live production proof: real SAM-3.1 segmentation HTTP 200. App gated by Entra ID Easy Auth (beacon tenant only): browsers 302 to Microsoft login, anonymous API calls 401. Leaked-then-rotated Entra client secret during setup; active secret stored only as a Container App secret.

## 2026-10-31

Access gate replaced: Entra Easy Auth redirect unusable on iOS (Safari never loads the form_post handshake; Chrome iOS downloads it as a file). Production (image mvp4) now uses an in-app passcode gate: /unlock collects the shared passcode server-side (timing-safe, throttled), middleware requires the stateless HMAC cookie everywhere else. Easy Auth set to AllowAnonymous. Gate inert when INSPECTION_PASSCODE unset (local/CI). Verified on production: 307 to /unlock, 401 wrong code, 200 + cookie on correct code.

## Close-out sprint opened: VPS + walkthroughkit.com — 2026-11-04 (owner-directed, 2h window)

**Decision:** New OVH VPS `vps-27b87dbf` (15.204.81.189 / 100.125.105.36) + apex `walkthroughkit.com` is the production target; Azure `metainspect-app` (`20.112.45.178`, `app.walkthroughkit.com` Disabled) is rollback for 7 days. Not an SDD scope change — TASK-103→113 acceptance and `active-tasks.json` (= exactly TASK-103→113 per `scripts/sdd-validation.mjs`) unchanged.

**Why:** 98% disk block, no 80/443 listener, apex NXDOMAIN, app binding Disabled→TLS reset (verified `python socket.getaddrinfo` + `az containerapp hostname list`). Tailnet serve `:3100` tailnet-only today; VPS needs Caddy + Let's Encrypt + `APP_PUBLIC_ORIGIN=https://walkthroughkit.com` + disk triage (<85%) + full verify suite before any `Ready` claim.

**Plan:** `docs/PRODUCTION_MVP_CLOSEOUT_2026-11-04.md` (7 tasks VPS-01→07, stop conditions, rollback to `metainspect:mvp32`). `HOSTING_OPTIONS.md` now records VPS-vs-Azure decision; `PRODUCTION_MVP_ROADMAP.md` slice 7 and `PRODUCTION_DEPLOY.md` VPS runbook added; `03-plan.md`/`04-verification.md` close-out addenda added (no validator change).

**Concurrency:** `/tmp/voicefix` (detached at `ccd71d5`, 10 tracked + ~180 voice clips, `APP_VERSION 34`) runs disjoint (`public/voice/*`, `scripts/voice-inventory.mjs`) and merges after VPS-05 green.

**Deploy:** VPS still `mvp32` (`fe31f5d` + `ccd71d5`, `APP_VERSION 32`, `next-server` pid 414583 on :3100 → `307`). No domain serves walkthroughkit.com yet; no new `06-release.md` status flip in this commit — gate stays Not ready until VPS serves + checks + phone proof.
