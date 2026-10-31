# Verification plan — Move-in Ready video walkthrough

Historical photo-first results and tasks remain history, never current video-flow evidence. Preserve async identity, deletion, offline, export escaping and secret boundaries. Fixture success never proves live provider behavior. Run checks listed here for implemented tasks and report exact command results.

## Executable checks and ordered docs prerequisite

- docs: node scripts/verify-sdd.mjs; maps REQ-001–REQ-015.
- lint: npm run lint; maps REQ-009 and REQ-012.
- typecheck: npm run typecheck; maps REQ-001–REQ-010 and REQ-012–REQ-015.
- unit: npm run test:unit; maps REQ-001–REQ-008 and REQ-010–REQ-015; mock-only behavior tests.
- browser: npm run test:e2e; maps REQ-001–REQ-009 and REQ-011–REQ-015; production-build flow and local persistence.
- build: npm run build; maps REQ-003, REQ-009, REQ-012–REQ-015.
- live-smoke: npm run test:live; maps REQ-003, REQ-010, REQ-011. Next.js env loader; one synthetic MP4 stage=segment, token-only map only for valid candidates; retries/Baseten disabled and unused leases cancelled when possible. Connectivity only, not quality or the clip gate. Offline self-test: node tests/live/smoke.mjs --self-test.

TASK-113 implements the active-graph docs check. `active-tasks.json` is a nonempty JSON array listing exactly TASK-103 through TASK-113. Schema and unique IDs are validated across all tasks.json records; plan-checkbox/current REQ coverage/dependency/DAG/shared-path ownership checks apply strictly to active records only. Preserve every historical TASK-069–TASK-076 record and all other history/evidence. Reject missing/malformed/empty manifests, duplicate/unknown/noncanonical IDs, active dependencies outside the manifest, cycles, missing active coverage/check mappings/checkboxes, and unserialized ownership. Legacy records never satisfy active coverage. Focused unit tests exercise these rejection cases.

TASK-103, TASK-104, TASK-105 and TASK-106 depend on TASK-113. Both the configured docs check and TASK-113 focused unit tests must pass before those app tasks are accepted. These changes already exist in this worktree; this is an acceptance gate, not a claim about their historical start order. A local pass is not native plugin evidence. Codex owns configured shell checks in this workspace; never fabricate plugin evidence. Live calls require separate explicit authority, server-only credentials and rights-cleared media.

## Requirement coverage

| Requirement | Required behavioral evidence |
|---|---|
| REQ-001 | Stable 11 area IDs/order; independent Fire Safety 11a/11b; pseudonym/funding/admin intake; HUD exit to HQS. Mock participant/HMIS identity/address remain blank. |
| REQ-002 | Four-room prompts/capture/upload; bounded MP4/MOV; packet-copy MOV normalization preserving tracks/duration; reject bad bytes/codec/limits/conversion, preserve prior clip on failure; removal clears derivatives. |
| REQ-003 | Mocked Files/SAM SSE/Muse allowlist; hash-verified server candidate/context stills and signed 1-fps sampling; identity/token-only map; no fixture fallback on setup/provider failure; optional Baseten only on eligible Meta Muse provider errors; disclose provider transfer; live smoke separate. |
| REQ-004 | A/D drafts cite exact bounded server JPEG bytes Muse received; verify SHA-256/dimensions/candidate/element/concept/frame/time/object/box/SAM confidence. Invalid citations attach no still and become needs-human-check; display/persist same bytes. No-store bounded response; reject normalized MOV responses; confidence is draft-only. |
| REQ-005 | Proposal and evaluator decision independent; A/D requires matching human acknowledgment no later than decision. Migration resets invalid prior A/D while preserving clips/proposals. Evidence-less D rejected; corrections/dates required. 11a/11b marks independent; aggregate D if either D, A only if both A, otherwise unresolved. Four room clips, complete fields, evaluator/signature/attestation gate completion/export. |
| REQ-006 | Full session/room/element/media/hash/frame/time/analysis/revision identity, with schemaVersion and catalogVersion separately bound and exactly matched against request and current state. Test schemaVersion-only mismatch, catalogVersion-only mismatch, either missing version and changes to either version during in-flight work; discard stale results without attaching evidence or changing decisions/restoring deleted sessions. Version changes invalidate affected suggestions/decisions/sign-off and require renewed analysis/human review; preserved clips are not silently rebound. Discard late replacement/room/cancel/delete responses; reanalysis invalidates affected decisions/sign-off. |
| REQ-007 | Offline/refresh recovery, quota/private-mode warning, local reset of all owned data; local deletion does not claim provider/download deletion; service worker shell-only. |
| REQ-008 | Three PDFs plus JSON; landlord only confirmed D; unchanged official form filled/flatted plus evidence pages; independent 11a/11b; planned dates in notes, completed date blank until completed; blank mock identity/address; escaped text, manual-upload notice, unsigned/unresolved never complete. Pending/rejected/unsupported drafts not approved content. |
| REQ-009 | Mobile/tablet/desktop reference hierarchy; separate steps, three safe-area tabs and Capture default/back. Through 959px separate overview/detail; >=960px split scrollable review/two-column capture. TASK-107 implements at 360×640/390×844 gap <=32 CSS px when content fits; otherwise main-pane-only scroll with unobscured reachable actions; document scroll width <= viewport. TASK-109 records measurements/screenshots/P0/P1/P2 only. Extra code defects route to explicitly owned serialized frontend amendment plus fresh QA before pass. Labels/focus/keyboard/errors/upload fallback remain accessible. Room prompt-completion rules match requirements/design. |
| REQ-010 | Same-origin fixed enums/server prompts; actual byte/duration/frame limits; FFmpeg path/prerequisite; bounded one-time leased stills; map identity/token only rejects media; abort/timeouts/one-active-operation; fixed allowlist, no URLs or automatic billed retry. |
| REQ-011 | Staged mock media/pseudonym; synthetic fixture labels; real video-quality gate remains open pending reviewable, scored evidence; no invented tracking/mapping metrics, demo script or quality claim before scored misses. |
| REQ-012 | Plan/tasks/checks consistent; TASK-113 strict active/history schema and graph validation plus executed local docs prerequisite. Report native plugin evidence only when actually recorded. No weakened/no-op checks. |
| REQ-013 | PWA local offline restore; live pending until explicit connected retry; no media/stills/provider bodies/keys in service-worker cache. |
| REQ-014 | Separate Capture/compact four-row Review/All Elements/detail/Add Note/Sign-Off/Profile states; bounded note never affects decisions/exports/provider; back resets focus; one-at-a-time setup panels with completion; landlord date only after YES and required then. |
| REQ-015 | HUD branch blocks completion; evaluator/agency/landlord YES/NO conditional date/typed signature/time/attestation/optional leadership fields; blank mock identity/address; no voucher/payment/delivery/HMIS/scheduling action. |

## Evaluation and release gates

The owner supplied staged/mock kitchen and bathroom clips on 2026-10-31 and authorized provider processing. The kitchen request timed out; the bathroom segment response was canceled before the browser saved it, so Muse mapping and the scorecard did not run. TASK-110 remains open pending a reviewable result and scoring for faucet/fan/lock/detector identity, element mapping, actual timestamps/stills, and indoor-light misses. The current clip set does not establish all gate cues and is about 32.8 seconds total versus the authored single-clip maximum of 30 seconds. Still-image or synthetic connectivity smoke cannot satisfy it. Physical iOS Safari/Android camera/codec/MOV tests remain separate from Chromium synthetic E2E. Recipient acceptance remains unresolved. The owner authorized a Muse Code implementation handoff on 2026-10-31; native SDD approval/evidence remains pending separately.

No release claim until current executed checks, independent code/security/QA/gate verdicts, visual QA screenshots, real clip scoring, and device evidence exist. The owner's implementation handoff does not mark tasks accepted, update native SDD state, or authorize publishing, release promotion, or deployment.
