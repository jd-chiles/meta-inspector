# Repository guidance

Walkthrough Kit is a human-led habitability walkthrough companion. Read the relevant product and technical documentation before changing behavior. Use mock-unit data only.

## Engineering rules

1. Preserve evidence identity across asynchronous work. A late response must not replace newer media, attach to another item or revision, restore a deleted session, or retain approval after replacement or reanalysis.
2. Treat AI output as an unreviewed observation. It cannot complete a manual inspection step, produce an inspection verdict, or enter approved export content before evaluator review. Keep synthetic fixtures labeled.
3. Keep provider credentials and raw provider bodies out of browser bundles, logs, and exports. Validate uploaded bytes and resource limits; do not fetch client-supplied URLs. Escape user and model text in printable output. Local deletion does not imply provider deletion.
4. Verification must exercise the actual flow. Do not silently fall back to fixtures, skip required checks, or present fixture results as live/provider confirmation.

Run only the checks relevant to the requested change and report commands and outcomes accurately. Do not claim approvals, reviews, or evidence that were not recorded.
