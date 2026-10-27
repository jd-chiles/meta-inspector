# Product brief

Updated October 26, 2026. This brief consolidates the day’s project discussions and the two Drive research documents. Where early brainstorming conflicts with later feasibility review, the more cautious, source-audited position is current.

## Concept

An image-first mobile companion helps housing navigators capture evidence for selected habitability walkthrough items, prepare a reviewable draft, and flag what still needs a manual check.

## User and job

**Primary user:** Housing navigator or TLS/RRH case manager completing a unit habitability walkthrough and preparing its record.

**Job:** Move through selected form items without losing required evidence; distinguish what a camera can show from what a person must check; leave a clear draft for worker review.

## Problem evidence

The project owner reports informal conversations with case managers who described high caseloads, competing responsibilities, added paperwork and tracking, limited walkthrough experience, and time burden. This is qualitative, user-reported support for administrative friction. It is not a measured baseline, representative study, or evidence of a product outcome.

The exact current Form 1083 copy used by providers remains unknown. The public LAHSA listing reviewed in the feasibility report points to an FY 2022–2023 form, while earlier project notes refer to a 2024 version. Resolve this before claiming the field map is current.

## Proposed flow

1. Navigator selects a confirmed item from the provider’s current form.
2. App guides a still photo; a short spoken note is optional. A brief clip is only a later option when motion matters.
3. Muse Spark drafts a short, neutral observation in context of the selected item and identifies uncertainty or a needed human check.
4. The observation is linked to its image and item. The navigator edits, accepts, or rejects it and records manual checks.
5. App prepares a review-only evidence card or draft packet for the existing staff process.

## AI boundaries

- **Muse Spark:** Core model call. Draft an editable observation for a selected item. Never produce an authoritative pass/fail or habitability judgment.
- **Muse Voice Transcribe:** Stretch after the image flow works; transcribe a short worker narration and attach it to the selected item. Start with one-shot transcription.
- **SAM 3.1:** Optional stretch only if a visual highlight measurably improves review. A mask locates pixels; it does not prove condition, function, or safety.
- Keep the first workflow deterministic. A generated image is instructional artwork only and never inspection evidence. Coding-agent use alone is not runtime Meta model integration.

## Hackathon scope

**In scope:** Mobile-friendly flow for three or four items from a confirmed current form; guided photo capture; item-linked notes; explicit “visual clue,” “manual check,” and “unknown” states; worker review; review-only evidence output; fictional or self-shot mock-unit material.

**Out of scope:** Automated inspection decisions, pass/fail ratings, certification, eligibility decisions, HMIS upload, scheduling, rent reasonableness, landlord portal, production deployment, real tenant records, and HMIS/EHR integration. Do not imply that an export is an accepted HMIS packet until a provider confirms the format.

## Impact hypothesis and measures

**Hypothesis:** Guided evidence-linked capture can reduce time and tracking effort for this walkthrough step and make omissions or required manual checks easier to see.

Measure staff minutes for selected items under current and assisted workflows; required fields with usable evidence; missing evidence, corrections, retakes, and repeated documentation; manual checks flagged; and worker acceptance, edits, or rejection of model suggestions. Report sample size and observed errors. Keep any placement timeline outside the product goal and evaluation.

## Privacy and human control

- Use a self-shot mock unit. Keep people, addresses, mail, screens, personal documents, and personal photos out of the demo.
- No real tenant or health information in hackathon model calls.
- Make recording state clear; audio is off unless useful and consented to. Let the worker pause, review, retake, and delete.
- Model text is a draft observation. The navigator owns the final record and sign-off.
- Meta Standard mode is not a zero-retention guarantee. Confirm endpoint data handling before any real pilot.

## Portfolio one-liner

“I built an image-first assistant that helps housing navigators prepare evidence-linked drafts for selected habitability walkthrough items, flags where human checks are still needed, and measures task time and rework.”
