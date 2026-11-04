# Hackathon and portfolio narrative

## The story

Receiving housing assistance does not end the search for a suitable home. Households and case managers still coordinate apartment searches and document unit conditions. A visit to an unsuitable unit can consume scarce time, while busy staff must make careful, accountable judgments.

Walkthrough Kit explores a focused support tool for the walkthrough itself. It guides room-by-room video capture, links draft observations to source evidence, and prepares local files for a manual process. The evaluator remains responsible for decisions and sign-off.

## Technical approach

- **Meta SAM 3.1** identifies candidate moments in submitted room video.
- **Meta Muse Spark** drafts observations associated with supported Form 1083 elements using server-derived frames.
- Evidence identity and human review remain part of the workflow; model output does not decide whether a unit passes or fails.

See [architecture](ARCHITECTURE.md) and the [Form 1083 mapping contract](integration/FORM_1083_MAPPING.md) for implementation details.

## Demo guidance

Show the capture, review, and sign-off flow using staged/mock-unit data. Clearly label fixture output and live provider output. Do not imply that empty screenshots show completed inspections. A successful automated check or provider connectivity request is not a quality evaluation.

The repository does not establish measured time savings, avoided visits, inspection accuracy, or external recipient acceptance. Present pre-visit address screening and SAM.gov lookups only as future exploration; they are not part of the implemented app.

## Portfolio presentation

Describe the work in terms of the problem, the human-centered workflow, the evidence boundary, and the technical implementation. Keep impact claims qualitative until there are documented measurements with sample size and method.
