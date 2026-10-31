# Release record

Status: Not ready

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
