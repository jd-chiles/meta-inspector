# Project instructions

Build the Habitability Walkthrough Companion from docs/sdd/features/habitability-walkthrough-mvp/. Read the request, requirements and design before changing behavior. Product context is in docs/PRODUCT_BRIEF.md and docs/DECISIONS.md.

## Workflow

Codex owns implementation, coordination, independent review, and CI diagnosis unless the project owner explicitly delegates work to a named coding agent. On 2026-10-31, the owner authorized a handoff of the remaining production-MVP sprint to Muse Code; the handoff and staged roadmap are in `docs/MUSE_CODE_HANDOFF.md` and `docs/PRODUCTION_MVP_ROADMAP.md`. Muse Code may continue the active implementation tasks and run their configured checks when working from that handoff. This is a user-directed implementation delegation, not an SDD approval, task acceptance, or native state transition. This delegation is to Muse Code only; OpenCode is not running this project and must not be assumed. Use the feature request, requirements, design, task graph, and verification plan as the source of scope; keep REQ/TASK mappings current and use parallel agents for independent work when task ownership and shared-file boundaries allow it.

An explicit owner instruction authorizes the current owner-designated implementation agent to implement the requested work. If native SDD state/evidence tooling is unavailable, continue authorized code work, leave plugin-owned state and evidence unchanged, and report any missing native record accurately. Never hand-edit plugin state/evidence or claim an approval, review, check, or evidence record that did not actually happen. Do not advance SDD stage or approval status outside its native command. Check commands are in .sdd/config.json and the verification plan.

Node 22 is the proposed application runtime. Before scaffold, run node scripts/verify-sdd.mjs. Once package.json exists, run the relevant lint, typecheck, test:unit, test:e2e and build scripts. test:live is separate and requires a real Meta call; fixture tests never prove it. Use only mock-unit data.

## Code Review Rules

Prioritize concrete correctness, regression and data-boundary findings with file/line and reproduction conditions. Focus on these project rules:

1. Evidence identity must survive asynchronous work correctly. A delayed response must not replace newer media, attach to another item/version, restore a deleted session, or retain approval after replacement/reanalysis.
2. AI output is an unreviewed observation. Accepting text cannot complete a manual check, remove required unknowns, produce an inspection verdict, or include pending/rejected draft text as approved export content. Fixture mode and illustrative catalogs must remain labeled.
3. Keep Meta keys/provider bodies out of browser bundles, logs and exports. Validate actual image bytes and resource limits; never fetch client URLs. Escape worker/model text in printable HTML. Local deletion must not claim provider deletion.
4. Verification must exercise the actual flow. Flag silent fixture fallback, no-op/skipped required checks, missing acceptance tests, or fabricated live/provider confirmation. Keep formatting and mechanical checks in CI.

Codex CI diagnosis: read the failing job/step and reproduce its command, identify a concrete cause, make the smallest authorized fix, rerun affected checks, and report remaining environment/credential blockers. Do not weaken assertions, remove required checks, add secrets to PR workflows, or turn fixture success into a live claim. Do not alter workflow permissions or repository protection merely to make a run green.
