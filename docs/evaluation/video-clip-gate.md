# Staged video evaluation gate (REQ-003, REQ-004, REQ-011)

Status: **open — the authored single-clip gate below is unchanged and
unevaluated.** Under the owner-authorized two-room variance recorded in this
file (2026-10-31), the bathroom room set produced a reviewable SAM+Muse
result and is scored; the kitchen room set produced no reviewable result
(repeated provider timeouts) and is unscored. Synthetic test patterns
and fixture responses cannot satisfy this gate.

## Required input

The current authored gate requires one 30-second or shorter rights-cleared
mock-unit clip that includes faucet flow and drainage, a running ventilation
fan, a door lock, and a smoke or carbon-monoxide detector. Avoid people, tenant
belongings, addresses, case records, and identifying details. The owner has
authorized the supplied staged clips for provider evaluation. The supplied
set contains separate kitchen and bathroom clips totaling about 32.8 seconds;
their observed moments do not establish lock or detector coverage. Resolve
this input mismatch with qualifying footage or an explicit SDD scope update;
do not silently waive or reinterpret the gate.

## Owner-authorized evaluation variance — 2026-10-31 (two-room set)

The owner explicitly directed proceeding with the two supplied room clips
instead of the single clip above, with room-specific cue lists, and approved
live attempts within a $10 Muse API budget. This variance does not edit the
authored gate, REQ-003/REQ-004/REQ-011, or TASK-110; it records a separate
scored evaluation set alongside them.

- Bathroom (~9.7 s, 15.7 MB, portrait): toilet, vent fan, faucet.
- Kitchen (~23.1 s, 43.3 MB, 1920×1080 landscape): vent fan, sink, AC.
- Footage note: both clips are owner-confirmed staged/mock-unit remuxes
  (`/tmp/kitchen-clean.mp4`, `/tmp/bathroom-clean.mp4`; temporary host files,
  not repository fixtures). One brief partial hand is visible operating the
  bathroom faucet (~8.5 s); no faces, addresses, documents, or other
  identifying content was observed in sampled frames.
- Prompt-set note: kitchen SAM prompts cover faucet/stove/refuse-bin/CO
  detector/wall/countertop — vent fan and AC are not kitchen concepts, so a
  kitchen run cannot track them without a prompt change. Bathroom prompts do
  cover faucet/vent-fan/toilet/lock/detectors.
- Attempt method: direct same-origin route calls (multipart
  stage=segment then identity/token-only stage=map) against the tailnet dev
  deployment, using the already-authorized staged clips. No browser, no
  fixture substitution, no automatic retry. Dollar spend is not metered
  client-side; the owner confirms spend on the provider dashboard.

## Run record

| Field | Observed value |
|---|---|
| Date and time | 2026-10-31; exact time not recorded |
| Clip provenance / license | Owner-shot staged/mock kitchen and bathroom clips; owner authorized provider use |
| Clip duration / resolution / codec | Kitchen about 23.1 s; bathroom about 9.7 s; H.264 video in MOV originals, locally normalized for upload |
| Consent to live provider attempt | Explicit owner authorization; staged/mock unit confirmed |
| App and prompt version | Current local app/video route; source fingerprint not recorded |
| Analysis mode | Live |
| Provider model identifiers / request IDs | SAM segment path attempted for each room; no usable response was saved to the browser; Muse was not called; request IDs not recorded here |
| Sanitized latency and error record | Kitchen: HTTP 504 after about 210,851 ms. Bathroom: segment endpoint HTTP 200 after about 92,609 ms; browser request canceled before saving; no automatic retries. No scoreable result. |

The browser's saved result was empty after both attempts. The bathroom server
response must not be represented as a saved candidate or Muse result. Neither
attempt assessed tracking, mapping, timestamps, still identity, or indoor-light
misses. No retry was made. Raw clips, exact provider payloads, credentials,
and identifying metadata are not stored in this repository.

Do not place the clip, credentials, provider file IDs, raw provider bodies, or
identifying information in this repository or logs. Record only the minimum
sanitized details needed to reproduce findings.

## Run record — 2026-10-31 variance attempts (Muse Code)

| Attempt | Result |
|---|---|
| Bathroom segment, session-live-bathroom-02 | HTTP 200 in 99.8 s; 6 SAM candidates (faucet frames 189/289, toilet frames 0/177, smoke-detector frames 130/157); 10 sample timestamps; media hash matched submitted bytes |
| Bathroom map, same identity+token | HTTP 200 in 12.1 s via muse-spark-1.3; 2 proposals: demo-water-supply A (conf 0.85, cand-0004 frame 289@9642ms) and demo-item-08 A (conf 0.92, cand-0002 frame 0@0ms); both stills SHA-256-verified against served bytes |
| Bathroom segment, session-live-bathroom-01 | Abandoned client-side at 30 s during origin-header probing; server-side op ran on and expired unmapped. Counts as one extra billed segment attempt. No result. |
| Kitchen segment, session-live-kitchen-01 | Client gave up at 170 s with 0 bytes; server-side op continued. No result. Counts as one extra billed segment attempt. |
| Kitchen segment, session-live-kitchen-02 | HTTP 504 PROVIDER_TIMEOUT in 189.4 s (coded 150 s/stage deadline + overhead). No result. Consistent with the earlier ~211 s kitchen timeout: the 23 s clip reproducibly exceeds the coded deadline. No further identical attempts were made. |
| Validation probes (2) | HTTP 400 INVALID_REQUEST in <0.1 s (missing Origin, then loopback Origin). Rejected before any provider call. No spend. |

Provider request IDs are not recorded: the route returns sanitized
responses and the server log carries no per-request entries. Total
provider-touching calls this session: 4 segment + 1 map. The owner confirms
dollar spend on the provider dashboard against the $10 approval.

## Room-set scorecard (owner variance)

Scored from served still bytes (SHA-256-verified), segment/map payloads, and
ffmpeg-decoded source frames. Served stills are server-derived re-encoded
region crops (563×1000), not full raw frames; frame/timestamp identity was
spot-verified (served cand-0004 matches source frame 289).

| Room cue | Tracking | Mapping | Evidence |
|---|---|---|---|
| Bathroom toilet | Pass: SAM frames 0, 177 | Pass: demo-item-08 A, conf 0.92, still verified visually (white toilet) | Served still hash-verified; Muse: "White toilet with raised seat and lid…" |
| Bathroom faucet | Pass: SAM frames 189, 289 | Pass: demo-water-supply A, conf 0.85, still verified visually (sink+faucet+drain) | Served still hash-verified; flow visible at source ~8.5 s |
| Bathroom vent fan | Not tracked (no candidate) | Not mapped | Not observed in 9 sampled moments spanning the clip — footage gap, not established as a model miss |
| Bathroom smoke detector (not in room list; observed) | SAM frames 130, 157 on an ambiguous round ceiling fixture | Correctly declined: no demo-smoke-co proposal | Caution, not failure: uncertain detection was not mapped |
| Kitchen vent fan / sink / AC | Unmeasured: no segment response | Unmeasured | Footage check only: AC visible ~2 s, range hood (fan housing) ~10 s, sink+faucet+drain ~18 s. Kitchen prompts lack vent-fan/AC concepts, so tracking them also needs a prompt change. |
| Timestamp accuracy | Pass (bathroom spot check) | — | Served frame 289@9642ms selects the faucet moment in source decode |
| Still identity | Pass | — | Both served stills match their SHA-256; bytes are crops of the hash-verified upload (media hash matched submit hash) |
| Human-review boundary | Pass | — | Proposals carry draft state/confidence only; no decision, signature, or result was produced by any call |

## Scorecard

Score each criterion against the video and the returned source-frame stills.
Leave a value `unmeasured` until someone observes it. A fixture, unit test, or
still-image Muse call is not evidence for these rows. (Rows below belong to
the authored single-clip gate and are unchanged by the variance above.)

| Criterion | Expected behavior | Result | Evidence / notes |
|---|---|---|---|
| Faucet tracking | Faucet and flow/drain moments receive stable, relevant frame references | unmeasured | unmeasured |
| Fan tracking | Running fan/vent receives a relevant frame reference | unmeasured | unmeasured |
| Lock tracking | Lock and operation receive a relevant frame reference | unmeasured | unmeasured |
| Detector tracking | Smoke/CO detector receives a relevant frame reference | unmeasured | unmeasured |
| Form 1083 element mapping | Suggestions map to the correct supplied element; uncertain mappings remain unknown | unmeasured | unmeasured |
| Timestamp accuracy | Each returned frame index and timestamp selects the matching source-video moment | unmeasured | unmeasured |
| Still identity | Each review still is an unaltered frame from the current uploaded clip | unmeasured | unmeasured |
| Normal-light misses | Visible fixtures or conditions missed in ordinary indoor light are listed | unmeasured | unmeasured |
| Human-review boundary | Model output remains an unreviewed suggestion and never creates an evaluator decision or result | unmeasured | unmeasured |

## Release decision

**Not evaluated.** Do not claim that SAM tracking, Muse mapping, timestamp
accuracy, or phone capture is validated until a reviewable result is produced,
the required cues are covered, and this scorecard is completed from the actual
source moments. A successful segment HTTP response, fixture, or local-browser
run does not change this status.
