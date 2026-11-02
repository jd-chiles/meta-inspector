# Change log

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
