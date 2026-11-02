# Release record

Status: Not ready (2026-11-02 mvp13 single-entrance + dashboard deployed; see latest entry)

## mvp13 single-entrance + dashboard — 2026-11-02 (Muse Code)

Status stays Not ready. Owner-approved redeploy of `101a67f`
(single-entrance guided tour, capture dashboard, live-proof removal,
spec-helper guide dismissal): built
`metainspectprod.azurecr.io/metainspect:mvp13`
(sha256:028f6077…), smoke-tested locally (307 gate, baseline headers,
FFmpeg 9.0.2, non-root `app`), pushed after `az acr login`, updated
`metainspect-app` — revision `metainspect-app--0000015` active at 100%
traffic, Healthy. Verified live $0: root 307 to /unlock (21.6 s cold /
~0.2 s warm), manifest 200. Build note: ffmpeg.org still unreachable
from all networks here, so the image reuses the verified `/opt/ffmpeg`
9.0.2 bytes from the local mvp12 image; Dockerfile workaround reverted,
`git status` clean for it. Prod live re-proof on this revision is
green (kitchen 200/200 in 105.5/15.1 s, bathroom 200/200 in 52.4/14.0 s,
voice manifest 40 clips + sample clip 200; 2 segments + 2 maps, no
retries — see `video-clip-gate.md`). Remaining: owner LTE phone run,
recipient acceptance, custom domain, quota alerts, ops owner, native
evidence. Not task acceptance or a release decision.

## mvp12 one-voice fix — 2026-11-02 (Muse Code)

Status stays Not ready. Owner-approved redeploy: all spoken guidance
now uses the static-first Fish pipeline (assistant + filming cues no
longer use the device voice), 40 clips total. Built
`metainspectprod.azurecr.io/metainspect:mvp12`
(sha256:20e6b9ed…), smoke-tested locally (manifest 40 clips, sample
clip 200 audio/mpeg), pushed after `az acr login`, updated
`metainspect-app` — revision `metainspect-app--0000014` active at 100%
traffic, Healthy. Verified live $0: root and manifest answer 307 to
/unlock with baseline headers. Remaining: owner LTE phone run (one
voice everywhere is the acceptance check), recipient acceptance,
custom domain, quota alerts, ops owner, native evidence. Not task
acceptance or a release decision.

## mvp11 journey + voice clips — 2026-11-01 (Muse Code)

Status stays Not ready. Owner-approved redeploy with the guided-journey
simplification (collapsed AI Guide banner, shot lists, film-first-ask-after,
one-tap confirm) and 31 pre-generated static voice clips (owner voice).
Built `metainspectprod.azurecr.io/metainspect:mvp11`
(sha256:f858ff8a…), smoke-tested locally (root/manifest/clip 200,
audio/mpeg), pushed, updated `metainspect-app` — revision
`metainspect-app--0000013` active at 100% traffic, Healthy. Deploy note:
the first push failed on an expired ACR login while the update still
rolled the revision; re-pushed after `az acr login` and the revision
provisioned Healthy with no further action. Verified live $0: root,
manifest, and clip answer 307 to /unlock with baseline headers,
confirming middleware coverage on the new revision; clip bytes proven
by same-digest local smoke. Remaining: owner LTE phone run on this
revision (instant voice is the acceptance check), recipient acceptance,
custom domain, quota alerts, ops owner, native evidence. Not task
acceptance or a release decision.

## mvp10 voice origin fix — 2026-11-01 (Muse Code)

Status stays Not ready. Owner reported the live app never uses the
Fish voice. Diagnosis: Fish credentials are valid (direct 2-char TTS
probe returned 200 audio/mpeg), but the voice sender check had no
APP_PUBLIC_ORIGIN awareness — behind ACA ingress every real browser
call 400'd and the client silently fell back to the device voice.
Fixed to video parity (trust request origin or configured public
origin; marker only when both headers absent; malformed config fails
loud 503), plus 3 unit tests (failed 2-before, 8/8 after).
Owner-approved redeploy: `metainspect:mvp10`
(sha256:61c64f26…), revision `metainspect-app--0000012` at 100%,
Healthy. In-container proof: public Origin reaches Fish config
(503 no-key, correct), foreign Origin still 400. Checks: unit 452
passed / 3 skipped, e2e 41, typecheck/lint/docs exit 0. Remaining:
owner phone run, recipient acceptance, domain, alerts, ops owner,
native evidence. Not task acceptance or a release decision.

## mvp9 redeploy — 2026-11-01 (Muse Code)

Status stays Not ready. Owner-approved redeploy of the current tree
(review-findings fixes + OBS-1 wording alignment; pre-build gates
green): built `metainspectprod.azurecr.io/metainspect:mvp9`
(sha256:75b6a3bc…, FFmpeg 9.0.2 compiled from source — upstream
recovered), smoke-tested locally on an ephemeral port (boots, 307
gate, baseline headers, ffmpeg present; note: stale local previews
still occupy 3100/3200, left untouched), pushed, and updated
`metainspect-app` — revision `metainspect-app--0000011` active at
100% traffic, Healthy. Fish secrets (`fish-api-key` from local env,
voice id as owner-supplied) upserted before the update; they take
effect on this revision. Verified live $0: root answers 307 with
baseline headers and unauthenticated video calls hit the passcode
gate, confirming middleware coverage on the new revision. Origin and
video-path behavior is unchanged since mvp8's verified probe; full
proof awaits the owner's LTE phone run. Remaining: physical-phone
end-to-end on this revision, recipient acceptance, custom domain,
quota alerts, ops owner, native evidence. Not task acceptance or a
release decision.

## Review findings SEC-1/SEC-2/OBS-2 resolved — 2026-11-01 (Muse Code)

Status stays Not ready. Resumed on the committed tree (`188f7ff`,
clean) and closed the actionable Slice 6 review findings. Not task
acceptance, native evidence, or a release decision.

- SEC-1: unlock throttle now keys on the rightmost X-Forwarded-For
  entry instead of the spoofable leftmost.
- SEC-2: throttle map is capped (1000 entries) with expiry sweep plus
  oldest-first eviction. Both covered by new unit tests (XFF parsing,
  10-per-window, sweep/eviction).
- OBS-2: the in-flight currency guard is extracted to a pure,
  unit-tested module; new tests pin rejection of pure schema-only and
  catalog-only version bumps mid-flight, plus abort/supersede/retarget.
  A black-box e2e was judged infeasible without test hooks (versions
  live in React state, migration runs at load); unit level covers it.
- OBS-1 (prompt-completion wording drift) left untouched: recorded as
  needing an explicit owner decision (SDD wording alignment vs code
  change).

Checks on this tree: docs/lint/typecheck exit 0; unit 449 passed /
3 skipped; e2e 41 passed (includes build); test:live not run. The
mvp8 Azure deployment predates these fixes — redeploy to pick them up.
Remaining external gates unchanged: physical-phone LTE proof,
recipient acceptance, custom domain, quota alerts, ops owner, native
evidence.

## mvp8 redeploy — 2026-11-01 (Muse Code)

Status stays Not ready. Owner-approved redeploy of the current tree
(HEAD `4fe3218` + verified uncommitted work; pre-build gates green):
built `metainspectprod.azurecr.io/metainspect:mvp8`
(sha256:81facfdf…), smoke-tested locally (boots, 307 gate, headers,
ffmpeg 9.0.2 present), pushed, and updated `metainspect-app` —
revision `metainspect-app--0000010` active at 100% traffic. Verified
live $0: root answers 307 with baseline headers; a browser-identical
video request passes the origin check. Build note: ffmpeg.org was
unreachable from all networks here, so the image reuses `/opt/ffmpeg`
from `metainspect:prod-proof` (script-identical bytes, verified);
Dockerfile workaround reverted; rebuild from source when upstream
recovers. Remaining: physical-phone LTE proof on the new revision,
recipient acceptance, custom domain, quota alerts, ops owner, native
evidence. Not task acceptance or a release decision.

## Azure origin fix — 2026-11-01 (Muse Code)

Status stays Not ready. Owner-approved production config change:
`APP_PUBLIC_ORIGIN=https://<app-fqdn>` set on `metainspect-app`
(revision `metainspect-app--0000009`, upsert — all existing env and
secret refs preserved). Verified with a $0 browser-identical probe:
request now passes the origin check and fails only on the
intentionally bad stage ("Choose a supported video processing
stage."), where before it failed 400 "Submit the video from this
app." No provider spend. The video path is now open to real browsers
on Azure (deployed code is still `mvp7`, predating the Slice 2/4
fixes — redeploy still pending). Not task acceptance or a release
decision.

## Azure video validation — 2026-11-01 (Muse Code)

Status stays Not ready. Owner-authorized: both staged clips through the
Container App — kitchen 200/200 (127 s segment, 4 proposals, 8/8
stills verified), bathroom 200/200 (37 s segment, 2 proposals, 4/4
verified); one transient map 502 passed on retry. First live proof the
1 vCPU sizing works. Deployment finding: browsers currently fail every
video request with 400 because `APP_PUBLIC_ORIGIN` is unset and ACA
preserves Origin against an internal request URL (marker fallback only
covers absent Origin). Runbook corrected to REQUIRED with the one-line
fix; setting it is owner-authorized production work, not taken. Spend:
3 segments + 3 maps (2 early origin-400s cost $0); owner confirms on
the dashboard. Records in `docs/evaluation/video-clip-gate.md`. Not
task acceptance or a quality claim.

## Azure verification + Slice 6 reviews — 2026-11-01 (Muse Code)

Status stays Not ready. Correction: Azure was already provisioned (not
by this agent) — `metainspect-prod` RG, env, running `metainspect-app`,
and registry, with Meta/passcode/Fish secrets. Verified read-only: the
app answers `307 → /unlock` with baseline headers, so the passcode
gate is active. Deployed `mvp7` (01:32 UTC) predates today's Slice 2/4
fixes — a redeploy is owner-authorized work, not taken. Runbook
updated to the provisioned reality plus redeploy steps; `APP_PUBLIC_ORIGIN`
corrected to recommended-with-fallback (deployment works without it).
Ran the approved fresh reviews (recorded in `docs/REVIEW_AND_CI.md`,
same-agent independence limit disclosed, no native evidence): spec
PASS + 1 minor obs (prompt-completion trigger wording drift), plan
PASS, code PASS, security PASS + 2 LOWs (unlock throttle XFF parsing
and unbounded attempt map — fix before wider launch), QA PASS + 1
minor obs (no dedicated in-flight version-bump client test). No
blocking finding. Checks: docs exit 0 (review/doc updates only).
Remaining: redeploy, custom domain, quota alerts, ops owner, physical
phones, recipient acceptance, native evidence. Not task acceptance or
a release decision.

## Slice 5 deployment controls — 2026-11-01 (Muse Code)

Status stays Not ready. Audited production controls against the code:
passcode middleware covers pages + `/api/video/*` (timing-safe check,
HMAC cookie, 10/10min/IP throttle, unit-tested), Dockerfile is
non-root standalone, no `NEXT_PUBLIC_*` secrets, `.env` git-ignored,
baseline headers set. Repaired the stale runbook: it still claimed "no
auth" after the passcode gate landed — now documents the gate,
mandatory `INSPECTION_PASSCODE` container secret (gate is OPEN without
it), instant rotation, pilot limits, as-implemented retention
(device-local data, 15-min/6-h memory-only server state, 3600 s
provider upload expiry, no secret logging), and host-level HSTS/CSP
notes. Added `.env*` to `.dockerignore` (defense in depth; final image
never contained it) and wrote the owner-executable
`docs/PHYSICAL_DEVICE_CHECKS.md` for the iOS/Android LTE pass.
Checks: docs exit 0 (docs/infra-only change; no code behavior touched;
docker image not rebuilt — FFmpeg compile cost, build reads no `.env`).
Still owner-side: Azure subscription + quota alerts, operational owner
name, both physical-phone passes, recipient acceptance, independent
reviews, native evidence. Not task acceptance or a release decision.

## Slice 4 form/export verification — 2026-11-01 (Muse Code)

Status stays Not ready. Verified the export set against the Slice 4
exit criteria: official template hash-pinned and verified on disk
(`9c9faf90…`), all 12 note/decision/deficiency/date/identity field
mappings compared against the template inventory, 11a/11b marks proven
against named field-geometry anchors (unit→11a band, public→11b band;
landlord/leadership dates likewise), completed-date blank with planned
date in notes, blank mock identity/address, D-only landlord list, no AI
draft text in PDFs/JSON, gating on decisions/sign-off/rooms, and text
sanitization. One demonstrated gap repaired: client/landlord PDFs
carried the manual-upload notice on page 1 only — now a footer on every
generated page (official form pages stay clean), appendix wording
unified to the shared constant, with a new unit test asserting
per-page presence (failed 1-vs-5 before, passes after).

Checks: docs/typecheck/lint exit 0; unit 442 passed / 3 skipped;
e2e 41 passed. Note: the first e2e run showed 31/41 with 10 mock-live
load crashes, diagnosed as a stale detached `next start --port 3102`
(05:49, older build) shadowing the spec's mock-live server — not the
code change. Owner authorized its removal; clean rerun is 41/41.
Recipient/agency acceptance of the manual outputs remains owner-side.
Not task acceptance, native evidence, or a release decision.

## Deadline final + kitchen scoring — 2026-11-01 (Muse Code)

Status stays Not ready. Finalized the server per-stage deadline at 240 s
from observed latency (kitchen segment ~140-170 s; ~50% headroom);
unit 441/3 + typecheck green on the change. Then scored the kitchen
variance set from a fresh owner-authorized run: segment 200 in 163.5 s
(8 candidates), map 200 in 10.2 s (4 As), all stills hash-verified, 3/3
timestamp spot checks match source. Two quality cautions recorded: Muse
asserted visible water flow the cited stills don't show, and late-clip
under-sink frames carry loose concept labels (identity/timestamps
correct). Stove/detector/vent-fan/AC gaps are footage/prompt-scope, not
model misses. Authored single-clip gate still unmeasured. Spend: one
segment + one map; owner confirms on the dashboard. Records in
`docs/evaluation/video-clip-gate.md`. Not task acceptance, native
evidence, or a release decision.

## Live kitchen confirmation — 2026-11-01 (Muse Code)

Owner-authorized confirmation with the fixed runner: `test:live` exit 0
on the saved kitchen clip — sam-3.1 + muse-spark-1.3, 1 segment + 1 map,
4 proposals, ~192 s total, no leftover lease. Slice 2 timeout resolved
and measured (192 s fits the provisional 240/270 s budgets, exceeded
the old 150/155 s). Connectivity only; proposals unscored, gate rows
unchanged. Spend: one segment + one map; owner confirms on the
dashboard. Sanitized record in `docs/evaluation/video-clip-gate.md`.
Status stays Not ready (scorecard, form/recipient, devices, hosting,
reviews, native evidence still open). Not task acceptance or a quality
claim.

## Live kitchen diagnostic — 2026-11-01 (Muse Code)

Status stays Not ready. Owner-authorized diagnostic run: server returned
HTTP 200 for BOTH segment and map on the saved kitchen clip — the first
fully successful kitchen run — but the runner rejected the map response
("mapping evidence is invalid"). Root cause was stale runner tooling:
it required a 2-key evidence still while the server contract (type, app
verifier, e2e mocks) is 5 keys with verified bytes, so no real map
response could ever validate. Fixed the runner to the 5-key shape plus
field-wise frame comparison (was order-sensitive stringify); self-test
28/28, lint clean; no product change. Spend: one segment + one map;
owner confirms on the dashboard. Sanitized record in
`docs/evaluation/video-clip-gate.md`. Not task acceptance, native
evidence, or a quality claim.

## Live kitchen measurement — 2026-11-01 (Muse Code)

Status stays Not ready. Owner-authorized measurement after the
provisional deadline raise (server 150 s → 240 s; runner override to
270 s, self-tested): kitchen segment SUCCEEDED within budget — the
timeout is resolved — but map failed with HTTP 502 INVALID_MODEL_OUTPUT
(Muse output rejected by strict validation; exact sub-cause unobserved).
No retry. Spend: one segment + one map; owner confirms on the dashboard.
Runner now surfaces the safe display message for known codes (self-test
24/24, lint clean) so a future attempt names the failing rule.
Sanitized record in `docs/evaluation/video-clip-gate.md`. Not task
acceptance, native evidence, or a quality claim.

## Live kitchen attempt — 2026-11-01 (Muse Code)

Status stays Not ready. Owner-initiated live validation of the overlap
fix using the saved staged kitchen clip: `SMOKE_VIDEO=/tmp/kitchen-clean.mp4
npm run test:live` exit 1 — the runner's segment fetch failed inside its
155 s budget, so no segment response, no map call, and no retry. The
server passed its ready gate and the provider was reachable (keyless
401 probe), but server-side behavior is unobserved; pre-fix kitchen-02
took 189 s server-side, which alone exceeds the 155 s runner budget, so
this attempt cannot confirm or refute the overlap improvement. Likely
one billed segment attempt, no map spend; owner confirms on the
dashboard. Sanitized record in `docs/evaluation/video-clip-gate.md`.
This entry is not task acceptance, native evidence, or a quality claim.
No fixture or CI result is affected; local checks remain green as logged
in the previous entry.

## Resume + Slice 2 audit — 2026-11-01 (Muse Code)

Status stays Not ready. Resumed the sprint on the dirty tree (commit
`4fe3218` + prior uncommitted guided/batch work, still uncommitted),
re-verified the full baseline, and audited the Slice 2 live-video path.
This entry is not task acceptance, native SDD approval/evidence, or a
release decision.

Audit result: the recorded kitchen-02 504 (189 s, serial SAM round trips
vs the coded 150 s/stage deadline) predates the `e685615` bounded-overlap
(3-way) + fail-fast repair, so that fix is implemented but still
unvalidated live. Server claim/lease release on abort/timeout, client
Cancel/replace/room-change invalidation, pagehide keepalive cancel,
identity-only + token cancel, and user-initiated retry with consumed
attempts were all verified in code and already covered by mocked unit
tests. The one coverage gap found and closed: no test proved the client
abort path notifies the server. Added e2e "cancelling an in-flight
segment request releases the server lease and keeps retry available",
which asserts the cancel request carries the exact segment identity with
no token, the late segment body starts no mapping and saves nothing, and
retry stays available.

Checks on this tree: docs exit 0; lint exit 0 (same 3 pre-existing
exhaustive-deps warnings); typecheck exit 0; unit 441 passed / 3 skipped
(33 files); full `npm run test:e2e` 41 passed including the new test
(build included); standalone `npm run build` exit 0. `test:live` not run
(needs separate explicit authorization).

Open gates carried forward unchanged: live validation of the overlap fix
(owner-initiated attempt only), authored single-clip gate unmeasured,
form/recipient acceptance, physical iOS/Android checks, production
hosting/auth/retention controls, independent reviews (TASK-111/112),
native SDD evidence, and the SDD scope decision for unscoped additions
(voice-agent tour, live copilot v2, passcode gate).

## Guided Inspection + batch loop fixes — 2026-11-01 (Muse Code)

Status stays Not ready. Owner-prioritized Guided Inspection work plus the
phone-reported batch restart. Not task acceptance or native SDD evidence.

- Tour narration: each film-room brief now speaks the room's full shot
  list conversationally, and the agent talks through one cue at a time
  while a take records. Stale "Tap Confirm" wording updated to Review draft.
- Tour checks: in-person checks now follow each room's filming (not all
  filming), with big Yes/No tap buttons next to the voice prompt.
- Batch loop: any batch start now consumes the walkthrough auto-start, so
  a finished batch can never auto-restart itself; an early return leaves
  it armed instead of silently losing the run. New browser test failed
  before (extra segment calls after filming the last room) and passes after.
- Voice: verified the spoken path is Fish-first (/api/voice/speak,
  FISH_API_KEY + FISH_VOICE_ID server-side) with device-voice fallback;
  local env has both set. Added the Fish vars to the deploy runbook; the
  phone-facing server needs them set or it keeps the device voice.

Checks: typecheck exit 0; lint exit 0 (same 3 pre-existing warnings);
unit 441 passed / 3 skipped; full e2e 40 passed. test:live not run.

## Slice 1 one-tap-confirm repair — 2026-11-01 (Muse Code)

Status stays Not ready. Slice 1 audit found one demonstrated gap and repaired
it; no other behavior was changed. This entry is not task acceptance, native
SDD approval/evidence, or a release decision.

Gap: three UI surfaces saved A/D evaluator decisions with an
auto-fabricated in-person acknowledgment, bypassing the detail form's
separate acknowledgment checkbox — the review-overview per-row Confirm
button, the "Confirm N from AI drafts" batch button plus assistant
"confirm-all" action, and the guided-tour per-item Confirm button. One tap
accepted AI text and completed the manual check in the same action,
against REQ-009, the design's separate-acknowledgment rule, and the
human-only-decisions exit criterion.

Repair: the per-row and tour actions now copy the draft into editable
fields (voice notes included) and open the detail form; they never save
and never touch the acknowledgment. The batch path is removed; the
overview wide button is now "Review next: {label}" (continue to next
undecided) and the assistant guides per-requirement review. The domain
proposal-to-decision converter is deleted. All saves flow through the
existing acknowledgment-gated detail save.

Checks on the repaired tree: typecheck exit 0; lint exit 0 (same 3
pre-existing exhaustive-deps warnings); unit 440 passed / 3 skipped
(33 files); full `npm run test:e2e` 39 passed including the new
"opening an AI draft never saves a decision or an in-person
acknowledgment" browser test, which failed before the fix (batch control
present) and passes after. `test:live` still not run (needs separate
explicit authorization).

## Slice 0 current-tree baseline — 2026-11-01 (Muse Code)

Status is Not ready. The 2026-10-31 "Ready to deploy" header is superseded:
code-green is not release-ready while the roadmap gates below remain open.
This entry records executed checks on the current tree only; it is not task
acceptance, native SDD approval/evidence, or a release decision.

Tree: commit `4fe3218` on `main`, Node v22.23.2. Dirty files are the six
TASK-109-owned `artifacts/design-qa/*.png` screenshots only (regenerated
binaries, no source edits); they are preserved untouched. No native
`.sdd/state` or `.sdd/evidence` was modified.

Executed checks and exact results:
- docs: `node scripts/verify-sdd.mjs` exit 0 (15 requirements, 11 active
  acyclic tasks, 7 named checks).
- lint: `npm run lint` exit 0 with 3 pre-existing react-hooks/exhaustive-deps
  warnings in `src/features/walkthrough/move-in-ready-flow.tsx` (batch-driver
  effects; functionally guarded, batch e2e tests pass). Recorded, not changed.
- typecheck: `npm run typecheck` exit 0.
- unit: `npm run test:unit` exit 0 — 33 files, 442 passed, 3 skipped,
  including `tests/unit/sdd/verify-sdd.test.ts` (7 tests).
- browser: `npm run test:e2e` exit 0 — 38 passed (includes production build).
- build: `npm run build` exit 0, standalone rerun.
- live: `npm run test:live` deliberately not run; it requires separate
  explicit authorization and a real Meta call, and fixture tests never prove it.

Open gates carried forward: kitchen live reliability (reproducible timeout),
authored single-clip gate unmeasured (bathroom variance scored, kitchen
unscored), form/recipient acceptance, physical iOS/Android checks, production
hosting/auth/retention controls, independent reviews (TASK-111/112), and
native SDD evidence. Recent unscoped additions (voice-agent tour, live copilot
v2 loop, passcode gate replacing Entra) need an explicit SDD scope decision
before any release claim.

## Production candidate — 2026-10-31 (Muse Code)

App code is green and live-proven: lint/typecheck clean, unit 401 passed,
e2e 34 passed (H.264 Chromium), CI success, Docker image builds and serves
200, first real SAM + Muse run returned suggestions end to end. Voice-guided
journey, batch auto-analysis, issues-first report, sign-off/exports, saved
inspections, mobile viewport-fit guards. Deploy per `docs/PRODUCTION_DEPLOY.md`.
Still owner-side: Azure subscription provisioning + custom domain, physical-phone
LTE pass, recipient/form acceptance, auth/quota decision, independent reviews.
No approval or promotion is claimed.

## Tree unification + Slice 0 baseline — 2026-10-31 (Muse Code)

Status stays Not ready. This checkout now holds the unified tree (`38d51d3`, pushed): video app plus stills plus UI polish. Current executed checks on that tree: docs/typecheck/lint/unit/build/browser all green as logged in 05-change-log (unit 384/3 skipped, browser 17/2 skipped, fixture-only). This closes the "checks never rerun on current tree" gap for this checkout only. Still open: live video reliability + scored evidence gate (TASK-110), form/recipient acceptance, physical phones, production hosting/auth/retention, independent reviews, and native SDD evidence. No approval or promotion is claimed.

## Current status update — 2026-10-31

The owner supplied staged/mock kitchen and bathroom video clips and authorized
provider processing. The kitchen segment request returned HTTP 504 after about
211 seconds. The bathroom segment endpoint returned HTTP 200 after about 93
seconds, but the browser request was canceled before saving its result; Muse
mapping and quality scoring did not occur. No automatic retry was made. The
supplied clips total about 32.8 seconds and do not establish all required
faucet/fan/lock/detector moments under the current single-clip, 30-second gate.
See `docs/evaluation/video-clip-gate.md` for the sanitized run record.

The owner explicitly directed an implementation handoff to Muse Code; the
paste-ready package is `docs/MUSE_CODE_HANDOFF.md`, with the staged launch
sequence in `docs/PRODUCTION_MVP_ROADMAP.md`. This handoff is not task
acceptance, native SDD approval/evidence, CI, or a release decision. The current
worktree has not had its configured checks rerun after the latest changes. No
app server or Tailscale daemon was running when checked. Release remains Not
ready pending current verification, live video quality, physical phone checks,
exact form/recipient acceptance, production hosting/authentication and retention
controls, independent reviews, and native SDD evidence.

## Move-in Ready video brief and rendering — October 29, 2026 (REQ-001–REQ-015)

The project owner supplied a new product brief and a three-phone mobile
rendering for a video-first LAHSA Form 1083 workflow. This supersedes the
photo-first application surface and the earlier photo-only product brief.
The current checkout contains separate Capture, Draft Review, Sign-Off & Export,
and Profile screens, local room-video handling, a server-side SAM/Muse path,
evaluator-only decisions and sign-off, and local PDFs plus HMIS-ready JSON for
manual handling. The mobile navigation follows the supplied three-tab layout;
Capture is the first screen, Review uses separate overview/detail states, and
Profile is a guided setup with secondary settings grouped out of the main flow.
Phone/desktop visual and interaction acceptance passed at 360 × 640, 390 × 844,
and 1365 px. The clean first-run screen includes the honest empty Capture state
and keeps recording disabled until required unit setup is complete. See
`design-qa.md` for screenshots, measured layout, and local check results.

Code presence and a connectivity response do not establish provider quality or
release readiness. A historical 2026-10-27 still-image smoke is recorded below.
Separately, the 2026-10-29 synthetic-video smoke reached SAM but returned no
candidates, so Muse mapping was not called and no video quality was assessed.
Current native SDD check/review evidence is not recorded for this worktree.
Codex does not hand-edit plugin state or claim absent native evidence.

Status remains Not ready. The real 30-second staged kitchen/bathroom clip needed
to score tracking, mapping, and timestamp/still coverage was not attached, so
the evaluation gate stays open. Exact printed-form transcription and recipient
acceptance, native iOS/Android device checks, and native SDD review/evidence
also remain open. This Codex work does not fabricate or edit plugin state.

## TASK-073 demo/release/docs pointers — October 28, 2026 (REQ-011, REQ-012)

Status stays Not ready. Documentation-only update under TASK-073; no
product code, check, commit, publication, deployment, or live-call change
is part of this update. Input snapshot:
`6a7a58696429de47f012cc83c41b9ef0e396355f035a7325d29e5da92b9ccead`
(SDD revision 483, stage `implementing`).

Epoch-3 builder record carried from the task input snapshot (authoritative
for dependencies; transcript summaries are not evidence): TASK-069 passed
(catalog v0.2 contract — 11 stable `demo-*` IDs, fail-closed TBD mapping
blocks, demo label retained), TASK-070 passed (PWA shell: manifest,
shell-only service worker, offline pending queue with explicit reconnect
sync), TASK-071 passed (11-item `catalog.demo.json` `0.2.0-demo.1` plus
current fixtures manifest; no fabricated binaries), TASK-072 passed
(verification-expansion tests written: 11-item, PWA offline/reconnect, PDF
parity; strict assertions, none weakened).

What this update claims — and does not claim:

- `docs/DEMO.md` rescoped to the 11-item fixture-only route; no live,
  provider, mapping, or pilot claim beyond executed evidence.
- `README.md` and `IDEA.md` now point at the approved epoch-3 plan (SDD
  `habitability-walkthrough-mvp`, revision 483 at time of writing,
  recorded plan approval `8d202606485e`, tasks TASK-069–TASK-073);
  IDEA.md stays historical.
- Kanban board + worker task-prompt updates recorded as deferred
  owner-executed external actions, not SDD files.
- Executable checks on the epoch-3 fingerprint are NOT claimed here:
  prior `docs`/`lint`/`typecheck`/`unit`/`browser`/`build` outcomes are
  stale and `live-smoke` is failed (exit 1, no key); re-execution is
  coordinator-owned via `sdd_verify`. No READY, live ledger proof,
  provider confirmation, mapping, publish, merge, or deploy is claimed.

## Epoch 3 rescope — October 28, 2026 (planning only, no implementation)

Status stays Not ready. Owner-directed rescope to the confirmed 11-item Form 1083 walkthrough plus installable PWA for November 4; this entry records planning alignment only — no product code, check, approval, commit, publication, deployment, or live call is part of it. Epoch-2 implementation and all verification evidence are preserved in history. New scope: REQ-001 (11 items, confirmation user-attested, version/source/verifier/date/wording/tests/sign-offs/output OPEN/TBD), REQ-007 (offline shell/saved progress/pending queue), REQ-008 (PDF parity), REQ-013 (installable PWA); HMIS/landlord/broader-sync explicitly later-phase. Blockers carried forward: (1) ledger live-smoke gap (accepted SDD-tooling blocker — no evidence-import workflow exists; single shell proof retained, no second paid call); (2) Form 1083 confirmation details TBD (demo labeling retained); (3) epoch-3 implementation, checks, and reviews not yet run. No READY, live ledger proof, provider confirmation, mapping, pilot, publish, merge, or deploy is claimed.

## TASK-063 correction — October 28, 2026 (REQ-011, REQ-012)

This documentation-only update flips Status from Ready to Not ready and
explicitly supersedes the stale Ready claim (TASK-041 READY promotion and
any r228-era READY language retained below). No READY, live ledger proof,
or provider confirmation is claimed. Input snapshot:
`ca373d3f6e5dd2c7f784c5d82973a401fccc0ce82530a43f96e4bd8288f57f77`
(SDD revision 382–383, stage `implementing`). No product code, check,
commit, publication, deployment, or live-call change is part of this
update.

Epoch-2 baseline on the current fingerprint
`ca373d3f6e5dd2c7f784c5d82973a401fccc0ce82530a43f96e4bd8288f57f77`:
six checks green — `docs` (`node scripts/verify-sdd.mjs`), `lint`
(`npm run lint`), `typecheck` (`npm run typecheck` with red-command
negative control), `unit` (`npm run test:unit` with red-command negative
control), `browser` (`npm run test:e2e` with red-command negative
control), `build` (`npm run build`) — all recorded passed in
`.sdd/evidence/habitability-walkthrough-mvp.jsonl` on this fingerprint.
Prior code/QA/security passes are carried but pending re-review on the
current fingerprint; no current QA pass or READY gate is claimed here.

Gate TASK-058: NOT READY with two blocking findings — (1) release record
incorrectly reads Ready on a stale verdict, corrected here to Not ready;
(2) live-smoke ledger gap — no executed `live-smoke` pass is recorded in
the ledger for the current fingerprint (observed ledger outcome: failed,
exit 1, no META_API_KEY); coordinator-shell success
(`muse-spark-1.3/live/requestId 5b303073-787c-481d-8725-8c2b9a865666`)
is narrative evidence only and does not satisfy the ledger gate; no second
paid call is authorized. Form 1083 demo-only limitation carried (no
provider confirmation, mapping, or pilot claim).

## TASK-041 READY promotion — October 27, 2026 (REQ-012)

Gate TASK-040 returned READY (passed) on the complete evidence chain.
This documentation-only update flips Status from Not ready to Ready on that
verdict. Input snapshot:
`5f7c89129b9b984666e747caff47f385e6d2946e7d6a450ee3b8f044db530f73`.
No product code, check, commit, publication, deployment, or live-call change
is part of this update.

Carried documented limitation: the catalog remains illustrative demo
(`Demo checklist — not a verified Form 1083 mapping.`). No provider Form
1083 confirmation and no form-specific mapping or real-pilot claim is made.

## TASK-036 live-smoke success — October 27, 2026 (REQ-012)

The single authorized live Meta call succeeded coordinator-side on the
current source. Command: `SMOKE_IMAGE=/tmp/live-smoke-detector.jpg npm run
test:live` (key loaded from local `.env` into process env, never printed),
exit 0. Sanitized output: model `muse-spark-1.3`, mode `live`, requestId
`5b303073-787c-481d-8725-8c2b9a865666`, latencyMs `6108`, canonical sha256
`2c93bab0335436542c071f99c3eea08026d1e7866d7ac730dde160262ebdafba`,
3024x4032 orientation-normalized from the 4032x3024 iPhone JPEG (sha256
`7c9035c0` of the staged `/tmp` copy), item `demo-smoke-alarm`, one call
only, no retries. Supporting evidence: `tests/live/smoke.mjs` self-test
18/18, fail-closed exit 1 without key, fresh production build exit 0, and
the six re-run checks passed at SDD revision 248. Release stayed Not ready
pending fresh QA/gate; provider gap open; no publish/merge/deploy claimed.

## TASK-034 stale-record fix — October 27, 2026 (REQ-012)

Gate TASK-033 returned NOT READY naming the credential gap, the provider
Form 1083 confirmation gap, the QA gap, and the stale-record gap
(06-release.md unstarted claim, 05-change-log stopping at revision 67,
07-retrospective empty). This TASK-034 fix addresses only the stale-record
blocker. Builder history recorded: 29 builder tasks passed — TASK-001
through TASK-010 plus repairs TASK-013 through TASK-027, spec TASK-011,
plan TASK-012. Checks observed on stable source; `live-smoke` honestly
failed: no `META_API_KEY`, exit 1, no fixture substituted, no live Meta
call made. 06-release.md keeps Status: Not ready with the three blockers.
Non-blocking notes accepted as backlog. No live success, provider
confirmation, or publish/merge/deploy is claimed.
