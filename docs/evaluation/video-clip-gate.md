# Staged video evaluation gate (REQ-003, REQ-004, REQ-011)

Status: **open — the current room-based capture profile below has not been
evaluated.** Historical two-room results and the earlier single-clip gate are
retained as historical evidence only; they do not prove the revised profile or
all-11-area mapping quality. Synthetic test patterns and fixture responses
cannot satisfy this gate.

## Required input

The current requested gate is a rights-cleared room-based mock-unit set with no
people, tenant belongings, addresses, case records, or identifying details:
kitchen up to 30 seconds; bathroom up to 30 seconds; bedroom/living area up to
30 seconds; hallway up to 15 seconds. Kitchen is paced slowly through its
existing faucet/sink, cooking/counter/outlet, and detector cues. Front door and
lock are shown and operated in the hallway clip, not required in kitchen.
Evaluate the actual source frames/timestamps and mapping against all 11 Form
1083 areas, including wrong-image matches, unsupported observations, and
normal-light misses. The historical supplied clips and their prior scores do
not satisfy this revised gate.

All room limits are now at or below 30 seconds, while analysis remains synchronous.
The hosted path must still be exercised with the revised staged footage and scored
for mapping quality; a local capture check alone is not live quality proof. Any
provider evaluation requires fresh explicit authorization.

## Owner-requested profile alignment — 2026-11-04

The owner requested moving the front-door/lock demonstration out of kitchen
and into hallway, slower kitchen cue pacing, and the room-specific capture
targets above. This records the demo target only; it does not assert that the
server supports those durations, that a new staged run occurred, or that
SAM/Muse mapping accuracy has been established. Historical dated run records
below remain unchanged.

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

## Run record — 2026-11-01 kitchen validation attempt (Muse Code)

Method: `SMOKE_VIDEO=/tmp/kitchen-clean.mp4 npm run test:live`
(sanctioned runner: exactly one stage=segment, at most one stage=map,
no retries, Baseten fallback disabled), user-initiated 2026-11-01 after
the `e685615` bounded-overlap (3-way) + fail-fast repair. Same
owner-authorized staged kitchen clip as before (~23.1 s, 43.3 MB).

Result: the runner's segment fetch failed inside its 155 s budget
("timed out or was unreachable"). No segment response was received, so
no candidate validation, no map call, and no retry occurred. The child
server passed its ready gate and the provider endpoint was separately
reachable (keyless probe returned HTTP 401), but server-side behavior
during the attempt is unobserved from this output.

Interpretation limit: pre-fix kitchen-02 took 189.4 s server-side
(150 s deadline + overhead), which alone exceeds the runner's 155 s
budget — so this output cannot distinguish "overlap helped but still
slower than 155 s" from "no improvement" or a mid-request local
failure. The overlap fix remains unvalidated live. No quality, tracking,
mapping, or gate claim follows from this attempt.

Spend: most likely one billed segment attempt (upload + SAM concept
calls started server-side before the runner gave up); no map spend. The
owner confirms actual spend on the provider dashboard against the $10
approval. No clip bytes, credentials, file IDs, or provider bodies are
recorded here or in the repository.

## Run record — 2026-11-01 kitchen measurement attempt (Muse Code)

Method: `SMOKE_VIDEO=/tmp/kitchen-clean.mp4
SMOKE_REQUEST_TIMEOUT_MS=270000 npm run test:live` after two code
changes: server per-stage deadline 150 s → 240 s (provisional; final
value follows observed latency) and a validated runner timeout override
(self-tested). Same owner-authorized staged kitchen clip (~23.1 s).
User-authorized measurement run; no retries.

Result: the segment stage SUCCEEDED within budget — the first
successful kitchen segmentation (under the 240 s server / 270 s runner
budgets; exact latency unrecorded). The follow-on map stage failed with
HTTP 502 code INVALID_MODEL_OUTPUT: Muse Spark output was rejected by
strict response validation. The exact sub-cause (refusal, non-JSON,
schema violation) is unobserved — the runner printed the code only. No
retry was attempted and no quality/score claim follows.

Spend: one billed segment attempt plus one billed Muse mapping call. The
owner confirms actual spend on the provider dashboard against the $10
approval. No clip bytes, credentials, file IDs, or provider bodies are
recorded here or in the repository.

Follow-up: the runner now appends the child server's own safe display
message for allowlisted failure codes (self-tested 24/24), so a future
attempt reports which validation rule failed instead of the code alone.

## Run record — 2026-11-01 kitchen diagnostic attempt (Muse Code)

Method: same measured command as the previous attempt, with the
safe-message runner. User-authorized; no retries.

Result: segment HTTP 200 AND map HTTP 200 — the first fully successful
kitchen segment+map at the server. The RUNNER then rejected the map
response with "mapping evidence is invalid", so the run still exited 1
with no scoreable summary.

Root cause (verified in code, no provider data needed): the runner's
`validateMappedEvidence` required exactly `{sha256, mimeType}` on
evidence stills, but the server contract emits `{sha256, mimeType,
width, height, base64}` (`VideoMappedEvidence`, the app's own
`verifyMappedServerEvidence`, and the e2e mocks all agree). The runner
could never validate a real map response. Fixed the runner to the
5-key still shape with field sanity, and replaced its latent
order-sensitive `JSON.stringify` frame comparison with the app's
field-wise comparison. Self-test 28/28, lint clean. This was test
tooling only; no product behavior changed.

Spend: one billed segment attempt plus one billed Muse mapping call. The
owner confirms actual spend on the provider dashboard against the $10
approval. No clip bytes, credentials, file IDs, or provider bodies are
recorded here or in the repository.

Net: the kitchen path very likely works end to end now (server
200/200); a confirmation run with the fixed runner is still needed for
a green `test:live` and any scoreable evidence.

## Run record — 2026-11-01 kitchen confirmation (Muse Code)

Method: same measured command with the fixed runner. User-authorized;
no retries. Sanitized runner output: mode live, room kitchen,
sam-3.1 + muse-spark-1.3, 43,348,324 bytes submitted (sha256
`37db37ad…18346`), 1 segment + 1 map request, mapping completed with 4
proposals, total latencyMs 192261, no leftover lease. Exit 0.

This is the first green `test:live` on the staged kitchen clip: the
Slice 2 timeout is resolved and measured — kitchen end to end takes
about 192 s with 3-way SAM overlap, inside the provisional 240 s
server / 270 s runner budgets (and conclusively outside the old
150/155 s budgets). Mapping validation passed on both server and runner.

Scope limit: the runner assesses connectivity only (`videoQuality:
not-assessed`). The 4 proposals are unscored — no tracking, mapping, or
still-identity scoring happened here, and no gate row changes. Scoring
is Slice 3 work over retained sanitized evidence.

Spend: one billed segment attempt plus one billed Muse mapping call. The
owner confirms actual spend on the provider dashboard against the $10
approval. No clip bytes, credentials, file IDs, or provider bodies are
recorded here or in the repository.

## Run record — 2026-11-01 kitchen scoring run (Muse Code)

Method: direct same-origin route calls (multipart stage=segment then
identity/token-only stage=map) against a locally spawned production
server, same method as the 2026-10-31 variance; no browser, no fixture
substitution, no retries, Baseten fallback disabled. Owner-authorized
staged kitchen clip (~23.1 s, 43.3 MB). Evidence retained as sanitized
summaries plus /tmp stills/frames only (not in the repository).

Result: segment HTTP 200 in 163.5 s — 8 SAM candidates (faucet frames
386/612, refuse-bin frames 41/689, wall frames 0/690, countertop frames
0/690), 24 sample timestamps, media hash matched. Map HTTP 200 in
10.2 s via muse-spark-1.3 — 4 proposals, all A: demo-water-supply 0.86,
demo-item-10 0.72, demo-item-05 0.75, demo-item-11 0.78. All 8 served
stills SHA-256-verified against served bytes; 3/3 timestamp spot checks
match FFmpeg-decoded source frames. No stove or CO-detector candidates;
no faces, addresses, or documents observed in viewed stills.

Spend: one billed segment attempt plus one billed Muse mapping call. The
owner confirms actual spend on the provider dashboard against the $10
approval. No clip bytes, credentials, file IDs, tokens, or provider
bodies are recorded here or in the repository.

## Run record — 2026-11-01 Azure deployment validation (Muse Code)

Method: direct route calls against the Container App (unlock via pilot
passcode, then multipart stage=segment and identity/token-only
stage=map), both staged clips, no browser. User-authorized; one retry
of a transient map 502, nothing else.

Results: kitchen segment 200 in 127 s (8 candidates, 24 samples), map
200 in 14.5 s (4 proposals, 8/8 stills hash-verified, spot still shows
the faucet frame). Bathroom segment 200 in 37.4 s (6 candidates, 10
samples), map 200 in 12.4 s (2 proposals, 4/4 stills verified).
Unlock 22.5 s cold / ~150 ms warm. First live proof on the 1 vCPU
sizing — decode and both stages healthy; provider variance dominates
latency, not replica size.

Deployment finding: with `APP_PUBLIC_ORIGIN` unset, requests carrying
`Origin: https://<fqdn>` fail 400 "Submit the video from this app."
because the container sees an internal request URL (ACA preserves the
browser Origin; the marker fallback only engages when Origin is
absent). Green runs above used marker-only sender proof. Every real
browser video request fails until `APP_PUBLIC_ORIGIN` is set — recorded
as REQUIRED in the runbook; the config change itself is owner-authorized
work, not taken here.

Spend: three billed segments + three billed maps (one kitchen map 502
retried once); two early origin-400 attempts never reached the
provider ($0). The owner confirms on the provider dashboard against the
$10 approval. No clip bytes, credentials, file IDs, tokens, or provider
bodies are recorded here or in the repository.

## Run record — 2026-11-02 mvp13 prod re-proof (Muse Code)

Method: direct route calls against `metainspect-app--0000015`
(image `metainspect:mvp13`, sha256:028f6077…): unlock via pilot
passcode, then multipart stage=segment and identity/token-only
stage=map with browser-identical `Origin`, both staged clips, no
browser, no retries. User-authorized under the sprint plan.

Results: kitchen segment 200 in 105.5 s (8 candidates, 24 samples,
media hash matched), map 200 in 15.1 s (4 proposals, all A:
demo-water-supply 0.85, demo-item-10 0.72, demo-item-05 0.70,
demo-item-11 0.78). Bathroom segment 200 in 52.4 s (6 candidates, 10
samples, hash matched), map 200 in 14.0 s (2 proposals:
demo-water-supply A 0.75, demo-item-08 A 0.90). Voice: manifest 200
(40 clips), sample clip 200 audio/mpeg; invalid speak body fails 400
INVALID_REQUEST (validation, not origin rejection — the browser
origin path is open). No 502s, no retries.

Spend: two billed segments + two billed maps. The owner confirms on
the provider dashboard against the $10 approval. No clip bytes,
credentials, file IDs, tokens, or provider bodies are recorded here
or in the repository.

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
| Kitchen vent fan / sink / AC | Sink: SAM faucet frames 386, 612. Vent fan + AC visible in footage but not kitchen concepts (prompt-scope gap, pre-recorded) | demo-water-supply A, conf 0.86 (cand-0001 frame 386@12878ms, cand-0005 frame 612@20418ms) | Served stills hash-verified; faucet still matches source frame 386 (sink, faucet, drain visible) |
| Kitchen refuse / wall / countertop | Pass: refuse frames 41, 689; wall frames 0, 690; countertop frames 0, 690 (8 candidates, 24 samples) | Pass: demo-item-10 A 0.72, demo-item-05 A 0.75, demo-item-11 A 0.78 | Served stills hash-verified; frame-41 and frame-612 stills match source decodes |
| Kitchen stove / CO detector | Not tracked (no candidate) | Not mapped | Not observed in surveyed moments — footage gap, not established as a model miss |
| Kitchen observation overstatement | — | Caution: "water stream visible flowing toward drain" is unsupported by the cited stills (sink closeup + under-sink views show no stream) | Mapping-quality miss: the A suggestion is fine, the flow detail is unobserved — exactly what human review must catch |
| Kitchen late-clip concept stretch | Caution: frames 612/689/690 are under-sink views labeled faucet/refuse/wall/countertop | Mapped As stay sensible via paired early stills | Identity and timestamps correct; semantic precision loose at clip end |
| Timestamp accuracy | Pass (bathroom + kitchen spot checks) | — | Bathroom frame 289@9642ms; kitchen frames 41/386/612 stills match source decodes |
| Still identity | Pass (both rooms) | — | Bathroom stills verified; all 8 kitchen stills match their SHA-256; bytes derive from the hash-verified upload |
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
