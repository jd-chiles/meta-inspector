# Hackathon and portfolio narrative

## The story

For a household waiting a long time for housing assistance, receiving a voucher is not the end of the search. The household and case manager still have to find a suitable apartment and complete the work needed to document its condition. Visits to units that later fail the applicable requirements can consume scarce time. Walkthroughs also ask busy staff—some with limited inspection experience—to gather evidence and make careful, accountable judgments.

Move-in Ready explores how a mobile companion can support that job. It guides a room-by-room video walkthrough, links draft observations to timestamped evidence, and prepares local files for the existing manual process. The evaluator remains responsible for decisions and sign-off.

## Why Meta tools

- **Meta SAM 3.1** identifies candidate moments for visual concepts in the submitted room video.
- **Meta Muse Spark** uses server-derived frames to draft observations associated with the supported Form 1083 elements.
- The system keeps these outputs in the evidence-review path. They do not decide the result or replace required human checks.

The technical integration, fallback boundary, and live-evaluation evidence are described in [the architecture guide](ARCHITECTURE.md), [the mapping contract](integration/FORM_1083_MAPPING.md), and [the evaluation record](evaluation/video-clip-gate.md).

## Demo framing

Show the real capture, review, and sign-off flow. State whether a visible result is a fixture or a live provider response. Use only staged/mock-unit footage. Do not imply that empty screenshots show completed inspections, and do not present a connectivity smoke as quality evaluation.

The project has a scored owner-authorized two-room variance and a separate authored single-clip gate that remains open. The exact state and evidence are in [current status](STATUS.md) and [the clip gate](evaluation/video-clip-gate.md). Do not claim measured time saved, reduced wasted visits, inspection accuracy, or recipient acceptance.

## Product direction beyond this build

The project owner also wants to explore checking a candidate address and relevant SAM.gov records before scheduling a visit. The hypothesis is that earlier checks might identify issues before a case manager and household spend time on an unsuitable unit. This is not implemented, and the reliable meaning and limits of those data sources have not been established. Present it as future exploration only, not as part of the demo or current system.

## Submission and portfolio checklist

- Add the final public demo-video URL when available.
- Identify which work was built for the event and link the relevant commits or release record.
- Verify final event rules and submission metadata from the organizer before publishing.
- Link to the public repository after confirming the final repository name and URL.
- Keep impact statements qualitative unless supported by documented measurements and sample size.
