# Preview and evaluation status

This document records what can currently be previewed and what remains unverified. It is not a demo script. The supplied product brief requires the staged video clip to be evaluated and the miss list recorded before a demo script or mapping-quality claim is prepared.

## Evidence boundaries

- **Fixture flow:** labeled synthetic output proves only deterministic local behavior; it is not a provider result.
- **Live video API smoke (`npm run test:live`):** starts the production server in live mode and sends the synthetic MP4 fixture to `/api/video/segment` once. It may send one token-only Muse mapping request only when SAM returns valid candidate evidence. It disables retries and the optional Baseten fallback, releases an unconsumed mapping lease when possible, and reports `videoQuality: not-assessed`. This is provider connectivity evidence, not a tracking/mapping quality evaluation or the staged-video gate.
- **Video path:** the browser locally normalizes supported MOV clips to bounded MP4 by packet-copy remux and uploads the selected clip once to the same-origin segment route. The server verifies the clip identity, uploads it once to Meta for SAM, and uses FFmpeg to derive candidate and actual 1 fps context JPEGs from those same bytes. Bounded stills stay in the expiring one-time map lease; the follow-on map request sends only identity and token, with no duplicate clip or image upload from the phone. Optional Baseten Muse Spark Open is a fallback for eligible Meta Muse provider failures only. Live frame verification requires server FFmpeg; set `FFMPEG_PATH` if the executable is not on `PATH`. Code presence and mocked tests do not prove a live provider result or mapping quality.
- **Mocked unit tests:** exercise request parsing and failure boundaries with mock data. They do not establish that a provider accepts a clip or that tracking/mapping works on the staged unit.

Never narrate fixture behavior as live inference or the live smoke as video quality evidence. The runner reads local environment files through Next.js's loader without printing values, and it fails closed without `META_API_KEY`. Its default input is `tests/fixtures/synthetic-h264-test-pattern.mp4`; an explicit `SMOKE_VIDEO` override must be a regular `.mp4` prepared from rights-cleared staged/mock-unit media with no tenant or personal data. Run `npm run build` first. The offline-only runner self-test is `node tests/live/smoke.mjs --self-test`.

## Open staged-video evaluation gate

The owner supplied staged/mock kitchen and bathroom clips on 2026-10-31 and authorized live provider processing. The kitchen segment request returned HTTP 504 after about 211 seconds. The bathroom segment endpoint returned HTTP 200 after about 93 seconds, but the browser request was canceled before saving; Muse mapping was not run. Keep tracking and mapping-quality claims blocked until qualifying footage produces a reviewable result and is scored for:

- faucet, fan, lock, and detector track identity;
- mapping to the 11 modeled Form 1083 elements;
- actual timestamped still coverage; and
- misses in normal indoor lighting.

Record misses before revising prompts. Do not substitute a generated still, hand-written fixture, or still-image API smoke for the clip. Details and the unmeasured scorecard are in [video-clip-gate.md](evaluation/video-clip-gate.md).

The supplied set consists of two room clips totaling about 32.8 seconds, while
the current gate asks for one clip of 30 seconds or less and observed footage
does not establish lock/detector coverage. Resolve that mismatch explicitly;
do not silently mark the gate passed.

## Remaining preview/release evidence

- Preview status on 2026-10-31: no app server or Tailscale daemon was running in this worktree, so the phone preview is unavailable. This is not a production deployment.
- Rebuild and inspect the current phone-accessible preview after implementation changes; do not use the preview to trigger live analysis.
- Current local check results and visual-review limits are recorded in `docs/REVIEW_AND_CI.md` and `design-qa.md`.
- Compare equivalent populated Capture, Draft Review, and Sign-Off & Export states with the supplied mobile reference. The current browser review kept evaluator decisions and sign-off empty.
- Confirm whether LAHSA/provider has a newer Form 1083 than the currently linked FY 2022–23 file before representing the modeled catalog as current.
- The owner directed an implementation handoff to Muse Code on 2026-10-31. The handoff package is `docs/MUSE_CODE_HANDOFF.md`; no Muse Code dispatcher is available in this Codex session, so no start is claimed. Native SDD review/evidence remains separate and is reported only if the plugin records it.
- Keep the video-clip gate open until qualifying footage produces a reviewable result and its scorecard is completed.
