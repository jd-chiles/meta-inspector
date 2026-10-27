# Codex review and CI

## Responsibility split

OpenCode SDD Autopilot builds the task graph and records its own lifecycle evidence. GitHub Actions runs deterministic checks. Codex independently reviews PR changes and can diagnose/fix failing CI when asked. Root AGENTS.md contains repository-specific review rules; the PR template asks for requirement coverage and actual verification.

## Local setup prepared

- .github/workflows/ci.yml runs on PRs, pushes to main and manual dispatch.
- Docs validation checks the eight-artifact contract, unique IDs, task DAG, serialized shared ownership and task/check coverage.
- Before scaffold, CI explicitly reports documentation-only validation.
- Once package.json or application source exists, the guard requires a manifest, lockfile and all verification scripts. The workflow runs lint, typecheck, unit checks, production build and Playwright Chromium acceptance. Missing scripts or commands fail.
- CI has read-only repository permissions, no persisted checkout credentials and no model secrets. Browser runs use explicit fixtures.
- Live Meta smoke is a separate required SDD check, not a secret-dependent PR job.
- No auto-merge, deployment or autonomous CI-repair workflow is configured.

## GitHub activation still needed

The public repository is [jd-chiles/meta-inspector](https://github.com/jd-chiles/meta-inspector), created at the project owner's request. The initial publication includes the CI workflow and review rules. GitHub Actions execution and account-level Codex automatic review are distinct activation steps; repository files do not switch on Codex's account settings.

Repository activation and verification:

1. Push these files through the normal Git workflow and observe a real CI run.
2. Connect the repository to Codex, then in Codex settings choose the repository and enable Automatic review under Review code. Configure your personal automatic-review trigger if desired.
3. Open a representative PR. If automatic review is unavailable, request it with `@codex review` in a PR comment.
4. After the first real CI run, configure the main-branch ruleset to require the resulting CI / verify status before merging. Do not treat an informal Codex comment as a mechanically enforced passing status.
5. Confirm the bot's actual review and resolve actionable findings. Changes need fresh CI/review.

Automatic reviews need a connected repository and push/admin permission. Repository rules can guide Codex, while CI and branch protections enforce deterministic gates. Sources: [official GitHub review setup](https://learn.chatgpt.com/docs/third-party/github) and [custom review rules](https://developers.openai.com/blog/custom-code-review-rules-for-codex), consulted October 26, 2026.

## CI repair handoff

When a job fails, give Codex the PR URL and ask: “Inspect the failing CI run, reproduce the failing command, fix the cause without weakening checks, and rerun affected verification. Follow AGENTS.md.”

Codex should inspect the precise failing step, distinguish environment/credential failures from product failures, change only the needed code/config, add meaningful regression coverage when warranted, and record commands actually run. Keep media/keys out of logs. A missing live Meta credential is a named verification gap, not a reason to substitute a fixture.

This setup provides review policy, executable CI and a repair handoff. It does not claim Codex background monitoring or automatic CI repair is active.
