# TASK ID
t_9ff7d101
# TASK TITLE
[BUILD/EXECUTOR] Produce executor receipt for meta-inspect verify + VPS deploy + public repo
# OBJECTIVE
Run the executor harness (opencode) to produce an executor receipt for task t_9ff7d101 that documents the local build and fixture verification steps already executed. The executor run must not push, create remotes, or use secrets. It should validate tests/lint/typecheck and emit a receipt JSON in the profile's executor-logs directory.
# REPOSITORY
/home/hermes/workspace/meta-inspect
# SPECIFICATION
Verify the repository builds and the fixture walkthrough artifacts exist. Produce executor receipt linking to logs and artifacts. Do not change source files.
# REQUIREMENTS
- Run the standard verification commands in the repo root: npm run lint, npm run typecheck, npm run test:unit, npm run build, and verify the server responds on 127.0.0.1:3200.
- Confirm /tmp/analyze_resp6.txt and /home/hermes/.hermes/cache/scratch/meta-inspect_walkthrough_notes.txt exist and reference the fixture run.
- Do not require META_API_KEY; do not run live smoke.
- Do not push to any remote, create GitHub repos, or run sudo.
# CONSTRAINTS
Preserve repository. No network calls that create resources. No secrets in logs. Use opencode executor as primary.
# ACCEPTANCE CRITERIA
1. Executor prints a JSON receipt that includes task_id t_9ff7d101 and repo path; receipt saved to /home/hermes/.hermes/profiles/dev/executor-logs/<timestamp>-*/receipt.json.
2. The receipt's executor field equals "opencode".
3. The run validated lint/typecheck/test:unit/build (may be previously cached) and included their exit codes/status in the receipt output.
# REQUIRED VALIDATION
Commands (repo root):
- npm run lint
- npm run typecheck
- npm run test:unit
- npm run build
- curl -sS -I http://127.0.0.1:3200/ | head -n 1
# RETURN FORMAT
1. Implementation summary
2. Path to executor receipt
3. Any deviations or blockers
