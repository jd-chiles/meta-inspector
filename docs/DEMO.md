# Preview and evaluation status

This document records what can currently be previewed and what remains unverified. It is not a demo script. The supplied product brief requires the staged video clip to be evaluated and the miss list recorded before a demo script or mapping-quality claim is prepared.

## Evidence boundaries

- **Fixture flow:** labeled synthetic output proves only deterministic local behavior; it is not a provider result.
- **Live video API smoke (`npm run test:live`):** starts the production server in live mode and sends the synthetic MP4 fixture to `/api/video/segment` once. It may send one token-only Muse mapping request only when SAM returns valid candidate evidence. It disables retries and the optional Baseten fallback, releases an unconsumed mapping lease when possible, and reports `videoQuality: not-assessed`. This is provider connectivity evidence, not a tracking/mapping quality evaluation or the staged-video gate.
- **Video path:** the browser locally normalizes supported MOV clips to bounded MP4 by packet-copy remux and uploads the selected clip once to the same-origin segment route. The server verifies the clip identity, uploads it once to Meta for SAM, and uses FFmpeg to derive candidate and actual 1 fps context JPEGs from those same bytes. Bounded stills stay in the expiring one-time map lease; the follow-on map request sends only identity and token, with no duplicate clip or image upload from the phone. Optional Baseten Muse Spark Open is a fallback for eligible Meta Muse provider failures only. Live frame verification requires server FFmpeg; set `FFMPEG_PATH` if the executable is not on `PATH`. Code presence and mocked tests do not prove a live provider result or mapping quality.
- **Mocked unit tests:** exercise request parsing and failure boundaries with mock data. They do not establish that a provider accepts a clip or that tracking/mapping works on the staged unit.

Never narrate fixture behavior as live inference or the live smoke as video quality evidence. The runner reads local environment files through Next.js's loader without printing values, and it fails closed without `META_API_KEY`. Its default input is `tests/fixtures/synthetic-h264-test-pattern.mp4`; an explicit `SMOKE_VIDEO` override must be a regular `.mp4` prepared from rights-cleared staged/mock-unit media with no tenant or personal data. Run `npm run build` first. The offline-only runner self-test is `node tests/live/smoke.mjs --self-test`.

## Staged-video evaluation gate — status 2026-11-02

Both owner-supplied staged clips now complete segment+map on
production and are scored under the owner-authorized two-room
variance: tracking/mapping/timestamp/still-identity pass on observed
cues, with two recorded cautions (one overstated observation detail,
loose late-clip labels). The authored single-clip gate (one clip
≤30 s showing faucet, fan, lock, and detector) stays open and
unevaluated — supplied footage does not establish lock/detector
coverage. Record misses before revising prompts. Do not substitute a
generated still, hand-written fixture, or still-image API smoke for
the clip. Details, variance scorecard, and the unmeasured authored
scorecard are in [video-clip-gate.md](evaluation/video-clip-gate.md).

## Remaining preview/release evidence

- Production on 2026-11-02: `metainspect:mvp13` (revision `metainspect-app--0000015`, Healthy, 100% traffic) behind the pilot passcode gate. This is a limited pilot deployment, not a public launch.
- Re-verify one live room end to end from a physical phone on LTE after every redeploy (film, analysis, report, sign-off, export download).
- Current local check results and visual-review limits are recorded in `docs/REVIEW_AND_CI.md` and `design-qa.md`.
- Compare equivalent populated Capture, Draft Review, and Sign-Off & Export states with the supplied mobile reference.
- Confirm whether LAHSA/provider has a newer Form 1083 than the currently linked FY 2022–23 file before representing the modeled catalog as current.
- The owner delegated the implementation sprint to Muse Code on 2026-10-31 (`docs/MUSE_CODE_HANDOFF.md`). Native SDD review/evidence remains separate and is reported only if the plugin records it.
- No timed practitioner workflow runs exist; do not claim measured time savings or coverage rates.
