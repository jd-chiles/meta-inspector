# OpenCode SDD handoff

## Target plugin and files

This package targets the installed **OpenCode SDD Autopilot** from [jd-chiles/opencode-v2-sdd-plugin](https://github.com/jd-chiles/opencode-v2-sdd-plugin), whose source uses docs/sdd/features/<slug>/ and .sdd/config.json. The separate [opencode-sdd-v2](https://github.com/jd-chiles/opencode-sdd-v2) repository uses different JSON contracts; do not interchange configurations.

Feature slug: habitability-walkthrough-mvp.

Read all eight artifacts in [the feature folder](sdd/features/habitability-walkthrough-mvp/00-request.md), plus [tasks.json](sdd/features/habitability-walkthrough-mvp/tasks.json). Each task object is an input to sdd_delegate, not runtime state. Configured routing inherits the initiating OpenCode model and uses one worker at a time; no provider/model purchase or account change is configured.

## Prepared state

The installed plugin's initialize function created .sdd/project.json and .sdd/state/habitability-walkthrough-mvp.json at draft stage with empty historical evidence. Keep those plugin-generated draft files when transferring this package: the initializer intentionally refuses existing artifacts without corresponding state. No native coordinator run, workers, approvals or independent reviews have been started.

Do not hand-edit state or fabricate evidence. The plugin will register a native run when sdd_start is called from OpenCode. It should reuse the initialized draft, import tasks and perform its normal transitions.

## Start in OpenCode v2

Open this project on the machine running OpenCode. Confirm your installed plugin with /sdd-doctor. Do not register a duplicate plugin entry. Then use:

```text
/sdd-plan Load the existing habitability-walkthrough-mvp feature from docs/sdd/features/habitability-walkthrough-mvp/. Reuse its initialized draft state; do not overwrite the authored documents with scaffolds. Start/register the native run with that exact slug and planOnly=true. Read all eight artifacts, register each tasks.json entry through sdd_delegate, and configure the named checks from .sdd/config.json. Obtain independent spec and plan review. Report implementation prerequisites and the required approval action.
```

The installed plugin requires user approval for standard/deep runs: its configuration reference says to invoke /sdd-approve yourself after reviewing the plan. This document setup does not approve a later implementation baseline. A plan-only run must be promoted through the plugin's resume operation with delivery=true and the latest revision; plain /sdd-resume does not clear planOnly. Ask the coordinator to perform that supported promotion after approval. Inspect /sdd-status and use /sdd-verify for current evidence. Do not edit state or create a duplicate run to bypass planOnly.

For a full build rather than a planning-only session, the alternative start prompt is:

```text
/sdd-start Build the existing habitability-walkthrough-mvp feature. Use the exact existing feature slug, reuse its plugin-initialized draft and authored artifacts, register tasks.json via sdd_delegate, configure .sdd/config.json checks, and follow its independent spec/plan review and approval gates before dispatch. Preserve all product boundaries and keep live Meta proof separate from fixture CI. Stop at evidence-backed release readiness.
```

## Known prerequisites

- Application scaffold/dependencies do not exist yet. TASK-002 creates them and all app scripts. Only the docs check runs now.
- Repository: https://github.com/jd-chiles/meta-inspector. Clone it on the build host for a normal Git checkout. This managed workspace's .git directory is read-only; publication uses a separate temporary checkout rather than overwriting it.
- META_API_KEY and the current Meta endpoint/model must be configured securely before live verification; no key is requested or written by this setup.
- Provider Form 1083 confirmation is unresolved. Build the explicit illustrative catalog meanwhile.
- Automatic Codex GitHub reviews require a connected repository and settings activation; see [review and CI](REVIEW_AND_CI.md).

## Verification responsibilities

The plugin requires current independent spec/plan and final code/QA/gate reviews, plus security review for the high-risk API/workflow paths. Codex PR review is additional feedback; it does not automatically insert native plugin verdicts. Never lower rigor or bypass a required review merely because CI is green.

Commands for structural validation now:

```sh
node scripts/verify-sdd.mjs
node scripts/ci-app.mjs
```

Application commands and live-smoke definitions are in [04-verification.md](sdd/features/habitability-walkthrough-mvp/04-verification.md). Their absence/failure before implementation is expected; it is not passing application evidence.
