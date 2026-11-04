# Muse Code handoff — Walkthrough Kit production MVP

## Handoff status

Prepared November 4, 2026 at the owner's request. This is a paste-ready handoff; it does not claim Muse Code has started or that any SDD task has been accepted.

- **Repository:** `https://github.com/jd-chiles/meta-inspector`
- **Working checkout:** `/home/hermes/.codex/worktrees/404a/meta-inspect`
- **Branch:** `codex/docs-and-matching-quality`
- **Product brand:** Walkthrough Kit
- **Intended domain:** `walkthroughkit.com` is being purchased; do not assume it is registered or deployed.

Use the pushed branch and its final commit as the handoff baseline. Preserve the existing SDD ledger and all historical evaluation records. Muse Code is authorized by the project instructions to continue the remaining production-MVP work; this handoff is not an SDD approval, task acceptance, or native state transition.

## Read first

1. `AGENTS.md`
2. `docs/PRODUCTION_MVP_ROADMAP.md`
3. `README.md`, `docs/PRODUCT_BRIEF.md`, and `docs/DECISIONS.md`
4. `docs/sdd/features/habitability-walkthrough-mvp/00-request.md` through `04-verification.md`, plus `tasks.json`
5. `docs/evaluation/video-clip-gate.md`, `docs/REVIEW_AND_CI.md`, and `design-qa.md`

Use the current main checkout, not an older handoff path. Inspect branch/status and diffs before edits. Keep requirement/task mappings current. Start by confirming the active SDD graph and the exact handoff commit; do not rebuild completed work from scratch.

## Implemented in the handoff branch

- Room-specific capture and validation limits: kitchen 30 seconds, bathroom 30, bedroom/living 30, hallway 15. The front door and lock are part of the hallway walkthrough. Element-only clips remain capped at 30 seconds.
- Room duration policy is shared across browser capture, stored clips, analysis identity, server MP4 validation, signed mapping-token checks, response timestamp validation, and evidence-still extraction.
- Kitchen voice guidance is spaced through the longer clip; hallway cues are scheduled early enough to finish before the 15-second recording stops.
- Kitchen instructions cover faucet flow/drainage, sink/counters/outlets, the running fan, and smoke/CO detector. Front door/lock instructions and SAM prompts are in the hallway. The kitchen SAM prompt set still covers all 11 modeled elements by combining stove/refuse as one food-preparation prompt while retaining wall-surface, fan, and countertop prompts.
- The review UI displays all linked source stills, and the mapper receives criteria/manual-check context for the 11 Form 1083 areas. This is implementation work, not evidence of improved accuracy; the authored clip gate remains required.
- README, app header, page title, PWA install name, app icons, PDF label/download filenames, package metadata, and active product docs use **Walkthrough Kit**. Internal storage keys and schema identifiers retain their legacy names to preserve saved-data compatibility. The GitHub URL still uses `meta-inspector`; the new domain is not yet verified live.
- Playwright can use an alternate port through `PLAYWRIGHT_PORT` to avoid interrupting an existing local preview.

## Check results

Fill this section from the final run on the pushed handoff commit. Never infer a check from an earlier snapshot.

- `node scripts/verify-sdd.mjs`: passed on the current tree — 15 requirements, 11 active acyclic tasks, 7 named checks. This validates SDD structure only.
- `npm run typecheck`: passed.
- `npm run lint`: passed with three existing React hook warnings in `src/features/walkthrough/move-in-ready-flow.tsx` (lines 834, 943, 1015).
- `npm run test:unit`: 476 passed, 3 skipped, 38 files passed. Includes a Walkthrough Kit export-filename assertion.
- `npm run build`: passed on the current tree; Next.js compiled, type-checked, generated all 11 static pages, and produced the route bundle. It emitted the same three React hook warnings noted above.
- `PLAYWRIGHT_PORT=3111 npm run test:e2e`: passed, 43 tests in 3.3 minutes. The default port 3101 was already held by another preview, which was left running. Playwright's build emitted the three existing React hook warnings; browser tests used fixture data and made no live provider call. The desktop browser check also confirms the visible Walkthrough Kit app header.
- `npm run test:live`: not run. No live provider quality claim is made.

## Critical remaining risk: hosted analysis latency

The browser and server now cap every room clip at 30 seconds or less, but the analysis route remains synchronous. A historical kitchen segment request returned HTTP 504 after about 211 seconds; a bathroom segmentation returned HTTP 200 after about 93 seconds but its browser request was canceled before saving. Muse mapping and quality scoring did not complete in that historical run. The `/api/video/segment` route's Next.js `maxDuration` is 160 seconds, and the hosted ingress may impose a separate deadline. Shortening kitchen capture to 30 seconds reduces input duration but does not prove hosted analysis completes within the request deadline.

Do not auto-retry or make another billed provider request in the background. After local checks, ask the owner for a fresh, explicit live-analysis action using rights-cleared staged/mock-unit footage. Measure segmentation and mapping separately. If a 30-second room request exceeds the actual hosting deadline, propose a durable asynchronous job design and its SDD scope before changing architecture; do not merely raise a timeout beyond the platform limit.

## Remaining production-MVP work

1. Re-prove the revised kitchen, bathroom, bedroom/living, and hallway profile with staged clips. Include front-door/lock footage in hallway. Score timestamp/source-still identity, all 11 area mappings, false matches, misses, and normal indoor lighting. Keep the prior runs historical and separate.
2. Determine whether a 30-second room clip can complete within the real hosted deadline. If not, design and scope durable asynchronous processing with cancellation, retry, replacement, deletion, and stale-result identity guarantees.
3. Run the full fixture-only browser suite on the exact revision; record command, revision, result, skips, and remaining warnings.
4. Complete physical iPhone Safari and Android Chrome LTE runs, including upload/MOV handling, offline recovery, replace/remove, review/sign-off, and opening all four downloaded files.
5. Obtain receiver confirmation of the applicable Form 1083 version and documented manual-packet acceptance. Preserve uncertainty until a recipient reviewer actually responds.
6. Close operational controls: current host configuration and cost controls, access/authentication, secrets, provider retention disclosures, deletion limits, monitoring, contact/escalation, provenance, and rollback.
7. Obtain independent spec, plan, code, security, QA, and evidence-gate reviews. Use native SDD tools for any approvals/evidence; never hand-edit `.sdd/state` or `.sdd/evidence`.
8. Keep release **Not ready** until the video gate, both phones, recipient acceptance, operational controls, reviews, and SDD evidence are complete.

## Constraints

- Mock-unit data only; never use tenant, HMIS, or real case data.
- AI is an unreviewed observation. Human checks, decisions, signatures, and the final inspection result remain evaluator-only.
- Keep provider keys and request bodies server-side. Local deletion must not claim provider-side deletion.
- Do not claim measured time savings, avoided visits, accuracy, recipient acceptance, or production readiness without evidence.
- Do not publish/deploy/promote a release as part of local verification. The current dirty/branch state should first be resolved and pushed as a reviewable change; release promotion stays separate.

## Paste-ready kickoff prompt

> Continue the owner-authorized Walkthrough Kit production-MVP sprint from the current `codex/docs-and-matching-quality` branch in `/home/hermes/.codex/worktrees/404a/meta-inspect`. Read `AGENTS.md`, `docs/PRODUCTION_MVP_ROADMAP.md`, `docs/PRODUCT_BRIEF.md`, `docs/DECISIONS.md`, and the feature SDD request through verification before editing. Preserve SDD state/evidence and historical evaluations. The current branch implements kitchen/bathroom/bedroom/living up to 30s and hallway up to 15s, slower kitchen cues, and front door/lock in hallway across capture, validation, storage, analysis timestamps, and still extraction. Re-run configured checks on the branch tip. Hosted analysis quality and latency are unproven: a historical kitchen request timed out at about 211s and the endpoint is synchronous with a 160s Next route budget. Do not auto-call providers; make another live run only after an explicit owner action. Complete current-profile staged-video scoring, physical-phone runs, recipient packet acceptance, operational controls, independent reviews, and native SDD evidence. Use mock-unit data only, keep human decisions/sign-off and local/manual exports, and keep release Not ready until every gate closes.
