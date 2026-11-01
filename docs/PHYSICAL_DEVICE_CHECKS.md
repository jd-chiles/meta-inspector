# Physical device checks (Slice 5)

Owner-executed pass on one iPhone (Safari) and one Android phone (Chrome),
on LTE — not wifi. Chromium E2E does not establish any row below. Use a
staged mock unit and pseudonym only; no tenant faces, addresses, or case
data. Record pass/fail plus the evidence noted per row; any fail blocks
the Slice 5 exit.

## Setup (both phones)

- [ ] Open the production URL, unlock with the pilot passcode. Wrong
      passcode is rejected; correct passcode persists across reload.
      Evidence: screenshot of unlocked home.
- [ ] Add to Home Screen; relaunch from the icon. App opens on Inspection
      Home with no browser chrome errors.
- [ ] Deny camera once: the app shows the upload fallback with no crash.
      Then grant camera.

## Capture (both phones)

- [ ] Film all four room prompts in-app (faucet on, fan running,
      lock/unlock, detector in frame). Each clip saves locally with a
      visible count; prompts complete only for the filmed room.
- [ ] iOS only: verify the filmed/uploaded MOV normalizes (packet-copy,
      no re-encode wait) and analysis accepts it; an unsupported codec
      fails with a clear message and keeps the prior clip.
- [ ] Replace one clip mid-flow and remove another: counts, prompts, and
      prior drafts invalidate as messaged; no stale result reappears.
- [ ] Reload mid-capture and toggle airplane mode for 60 s: saved clips
      and progress recover; nothing uploads while offline.

## Analysis, review, sign-off (both phones)

- [ ] With consent checked, analyze one room on LTE: bounded progress
      shows, Cancel stops it cleanly, Retry after an error sends exactly
      one new attempt.
- [ ] Review: AI drafts are editable proposals only — nothing saves a
      decision or checks the in-person box without the evaluator.
- [ ] Resolve all 11 (incl. separate 11a/11b), sign with typed signature
      + attestation, download all four local files and open each.
- [ ] Confirm the mock identity/address fields are blank and every file
      carries the local/manual-upload notice.

## Reporting

Append results (device, OS, browser, pass/fail per row, screenshots kept
off-repo) to `design-qa.md` or the release record. Do not mark Slice 5
closed until both phones complete every row.
