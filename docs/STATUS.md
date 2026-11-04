# Project status

This page is the reader-facing status snapshot. It points to dated source records rather than replacing them. Update it when new evidence is recorded.

## Implemented in the repository

- Mobile capture, draft review, evaluator sign-off, and local PDF/JSON export flow.
- Server-side video processing through Meta SAM and Muse with evidence identity checks and a separate evaluator decision model.
- Fixture mode, local persistence, and shell-only service-worker caching.

Code presence does not itself establish release readiness, provider accuracy, field adoption, or recipient acceptance.

## Evaluation and external gates

- A two-room staged evaluation was scored under an owner-authorized variance; the authored single-clip gate remains separately open. See the [detailed evaluation record](evaluation/video-clip-gate.md).
- Physical iOS/Android camera and codec checks remain separate from browser automation.
- Recipient acceptance, case-ready export mapping, and direct HMIS integration are not established; the app does not submit to HMIS.
- No representative study or timed practitioner workflow result is recorded. Time savings and avoided visits are hypotheses.
- Address screening and SAM.gov lookup are proposed ideas with no current implementation.

## Where to verify

- Current CI and review evidence: [review and CI record](REVIEW_AND_CI.md).
- Demo limits: [demo status](DEMO.md).
- Visual screenshots and viewport evidence: [design QA](../design-qa.md).
- Feature requirements and verification: [SDD feature folder](sdd/features/habitability-walkthrough-mvp/).

Historical documents can contain earlier snapshots or superseded claims. Prefer the latest dated evidence in the linked records, and do not erase historical entries to make the project appear more complete.
