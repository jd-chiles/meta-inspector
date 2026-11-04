# Contributing

Thanks for your interest in Walkthrough Kit. Contributions should preserve the distinction between AI observations and evaluator decisions.

## Before submitting a change

- Read the relevant product, architecture, and integration documentation.
- Use fixture data for routine development. Do not add tenant, address, case, or other personal data to source, tests, screenshots, or commits.
- Keep provider credentials and raw provider bodies server-side and out of logs, exports, and browser bundles.
- Preserve evidence identity across asynchronous work; stale results must fail closed.
- Do not describe local deletion as provider deletion or local exports as HMIS submissions or accepted records.

## Verification

Run the relevant project checks and list the exact commands and outcomes in your change description. Live provider checks are separate from fixture checks and require authorized staged media. Do not claim reviews, evidence, or acceptance that were not recorded.

## Pull requests

Explain the user-visible change, relevant requirements, verification performed, and known limitations. Keep changes focused and include documentation updates when behavior or user-facing claims change.
