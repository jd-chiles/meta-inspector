# Contributing

Thanks for your interest in Walkthrough Kit. The repository handles inspection evidence and provider data, so contributions must preserve the distinction between model suggestions and evaluator decisions.

## Before changing code

- Read `AGENTS.md`, the product brief, decisions, and the active feature request, requirements, design, task plan, and verification plan.
- Follow the active SDD task graph and its file ownership. Keep requirement/task mappings current.
- Use fixture data only for routine development. Never add tenant, address, case, or other personal data to source, tests, screenshots, or commits.

## Safety and evidence rules

- Do not let AI output complete a human check, set an inspection result, or enter approved exports without evaluator review.
- Preserve media/session/version identity across asynchronous work; stale results must fail closed.
- Keep provider credentials and raw provider bodies server-side and out of logs and exports.
- Keep fixture behavior clearly labeled and separate from live-provider evidence.
- Do not describe local deletion as provider deletion, or local exports as HMIS submissions or accepted provider records.

## Verification

Run the checks required by the task and list the exact commands and outcomes in the change description. The CI workflow runs the configured docs, lint, typecheck, unit, build, and browser checks. Live provider checks are separate and require explicit authorization and rights-cleared staged media.

## Pull requests

Use the repository pull request template. Summarize the user-visible change, requirement/task mapping, verification results, review focus, and remaining limitations. Do not claim reviews or evidence that were not recorded.
