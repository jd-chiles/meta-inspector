# Build plan

## Delivery rule

Build a reliable vertical slice first: one real Muse Spark image call produces a reviewable, editable evidence card tied to a selected item. Add other models only after that path works. The participant guide requires the demo to show features and code built during the event; preserve a clear record of new work and reused material.

## Gates and sequence

### Gate 0 — Verify the instrument

- Obtain the Form 1083 copy a current provider actually uses.
- Compare title, version/date, fields, rating guidance, required tests, and signature requirements with the public FY 2022–2023 listing.
- Ask a navigator to select three or four items appropriate for a camera-assisted draft and identify items that still require an in-person test.
- Do not hard-code unverified counts or labels.

### Gate 1 — Prove the core model path

- Send one self-shot mock-unit image and a confirmed item description to Muse Spark.
- Request structured output: neutral observation, visible evidence, uncertainty, manual check needed, and rationale tied to the image.
- Validate output shape, display errors and uncertainty, and make every field editable.
- Record latency, parse success, and token usage. No latency guarantee is published for this workflow.

### Gate 2 — Build the narrow vertical slice

- Script three or four confirmed items.
- Capture or select an image, link it to item and capture time, show model draft, edit/accept/reject, record manual check, and generate review-only evidence card.
- Keep source image and model output provenance visible in review.
- Make “unknown” a valid outcome; prompt for retake if framing is poor rather than silently discarding a potentially important frame.

### Gate 3 — Evaluate the workflow

- Compare a small set of current-process and assisted walkthrough tasks with navigators.
- Track task time, usable evidence coverage, missing items, corrections, retakes, manual checks, and worker edits/rejections.
- Use separate development and held-out mock fixtures. Report small sample sizes and errors; do not claim general defect-detection accuracy.

### Gate 4 — Add stretch work only if time remains

1. Muse Voice Transcribe for a short optional narrated note.
2. SAM 3.1 highlight for one selected area only if it improves review.
3. Any packet export polish after a provider confirms the intended format.

Defer Muse Wonder orchestration, all-item coverage, continuous tracking, automatic frame ranking, HMIS integration, offline sync, and production deployment.

## Working backlog

| Phase | Work item | Done when |
|---|---|---|
| Verify | Get the active provider Form 1083 and field map | Navigator confirms source version and 3–4 selected items |
| Spike | Make a real Muse Spark image request | Validated response appears in an editable evidence card |
| Core | Implement guided capture and item selection | User can complete the scripted path with no dead end |
| Core | Preserve evidence provenance and uncertainty | Card shows item, capture time, media, draft, and manual-check state |
| Core | Implement worker review | Accept, edit, reject, retake, and delete paths work |
| Core | Produce review-only output | Draft is clearly not represented as approved/submitted |
| Evaluate | Run small task comparison | Measures and sample size are recorded with limitations |
| Demo | Record the three-minute walkthrough | One complete flow, actual Meta call, human check, and limitations visible |
| Submit | Publish repository and identify new work | Public access works; new vs reused work is explicit |

## Technical notes

- Keep Meta API keys server-side.
- Use a fixed scripted sequence rather than an open-ended agent for the first demo.
- Constrained JSON stabilizes shape, not factual accuracy; validate and allow edits.
- Avoid an 11-item live agent, automated A/D mapping, continuous tracking, and frame-quality ranking in the hackathon build.
- Capture one still by default; add video only when it gives useful context.
