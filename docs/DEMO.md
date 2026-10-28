# Demo and submission plan

> Evidence classes used in this demo (say explicitly on camera):
>
> - **Qualitative feedback** — owner-reported case-manager conversations about
>   caseloads, paperwork, and time burden. Exploratory only; no sample size,
>   dates, quotations, or measured times are on record (`docs/RESEARCH.md`).
>   Never present as measured research.
> - **Fixture output** — deterministic hand-written drafts labeled
>   `mode: "fixture"` (for example `fixtures/responses/fixture-draft.json`).
>   Used when no key is configured or for a stable backup take. On-screen label
>   and export banner always say fixture, never live.
> - **Actual live inference** — a real `muse-spark-1.3` call over
>   `https://api.meta.ai/v1` with rights-cleared mock-unit media, run via the
>   server-only adapter with `APP_ANALYSIS_MODE=live`. Recorded separately with
>   model, mode, request ID, and latency. As of 2026-10-27 no key is
>   provisioned, so no live result exists; fixture success never counts as live.
>
> Every checklist surface in the demo carries:
> `Demo checklist — not a verified Form 1083 mapping.`

## Epoch-3 scope (November 4 rescope — claims bounded to executed evidence)

- Catalog: 11 demo items (`demo-habitability-walkthrough` version
  `0.2.0-demo.1`): 4 carried illustrative items plus 7 reserved
  placeholders (`demo-item-05`–`demo-item-11`) whose official wording,
  physical tests, and sign-offs are TBD. Every surface keeps
  `Demo checklist — not a verified Form 1083 mapping.` No operative
  Form 1083 mapping is claimed (REQ-001; TASK-069, TASK-071).
- PWA shell + offline pending queue + PDF parity are implemented
  (TASK-070; TASK-072 test expansion) but the epoch-3 executable checks
  (`docs`/`lint`/`typecheck`/`unit`/`browser`/`build`) have not been
  re-run on the epoch-3 fingerprint — execution is coordinator-owned via
  `sdd_verify`. The demo shows fixture behavior only; anything not yet
  check-verified is narrated as pending, never as passed.
- Live inference: no labeled live take exists in this lane. The only
  recorded live evidence is the historical coordinator-side single smoke
  call cited in `06-release.md` (a server check, not a demo take, and not
  re-run here); the current `live-smoke` ledger outcome on this
  fingerprint is failed (no key). Fixture success never counts as live.
- Deferred (owner-executed, external to this repo pass): Kanban board and
  worker task-prompt updates.

## Frozen demo route (frontend-announced 2026-10-28)

- URL: http://127.0.0.1:3100/
- Mode: fixture (mock output, not live inference; `APP_ANALYSIS_MODE=fixture`, no Meta key)
- Catalog: `demo-habitability-walkthrough` version `0.2.0-demo.1` (demo mode, `DEMO_NOTICE` on every surface): 11 stable demo IDs — 4 carried illustrative items + 7 reserved placeholders (`demo-item-05`–`demo-item-11`, official wording/tests/sign-offs TBD)
- Take for this recording: **fixture take**. Mode line, read verbatim:
  "This draft is fixture output — not live inference. The screen shows mode fixture."
- Do not read the live-take line: no labeled live take of this route exists in
  this lane. (A coordinator-side live smoke is recorded in
  `docs/sdd/features/habitability-walkthrough-mvp/06-release.md`; it is a
  server check, not a labeled demo take, and is cited here as a pointer only.)

## Three-minute demo story

1. **Problem and user (0:00–0:25):** A navigator has a time-consuming evidence and tracking task. Explain the owner-reported case-manager feedback as qualitative, not measured research.
2. **Capture (0:25–1:10):** Select a demo checklist item (not a verified form item) and take a self-shot mock-unit photo. Show the item-linked evidence, the demo-checklist label, and the current analysis mode (`fixture` or `live`). Name the mode aloud.
3. **Reasoning boundary (1:10–1:55):** Display the neutral draft observation, what is visible, what remains unknown, and any manual check. Include an uncertainty case; never show an automated pass/fail verdict. State whether the draft on screen is fixture output or actual live inference.
4. **Human review (1:55–2:30):** Navigator edits or rejects the draft, records a manual check, and reviews the evidence card.
5. **Impact and limitations (2:30–3:00):** State what is measured (staff time, evidence coverage, corrections/rework), sample size, and known limits. All unmeasured values stay `unmeasured` per `docs/evaluation/protocol.md`. Explicitly say placement timing is outside the project’s claim, the catalog is illustrative until a provider confirms the operative Form 1083 copy, and live inference is pending credentials unless a live call is shown and labeled.

Use a stable prerecorded backup if the live API is unreliable. Label the backup
on screen and in narration as recorded fixture output (`mode: "fixture"`), never
as a live call. The submission should still show a working project and the model’s essential role.

### Mode script (read the applicable line)

- Fixture take: "This draft is fixture output — not live inference. The screen
  shows mode fixture."
- Live take: "This draft is actual live inference from Muse Spark over the Meta
  API. The screen shows mode live with its request ID." Then show the separately
  recorded model, mode, request ID, and latency — no keys or provider bodies.

## Rubric alignment

- **Impact (30%):** Focus on task-level administrative friction, the specific user, and measured time/completeness/rework. User conversations are qualitative evidence only.
- **Meta tooling (25%):** Make Muse Spark central to image-to-draft. Show a real model call and output. Add Transcribe or SAM only if implemented and visibly useful. If no key is available, show fixture output and state plainly that live inference is pending — do not imply a fixture take is a model call.
- **Technical depth (20%):** Show source provenance, explicitly-unmapped demo-item status, uncertainty, structured-output validation, correction history, and manual-check boundary.
- **Demo (25%):** One complete and reliable capture-to-review flow with a visible uncertainty case and human decision.

## Submission checklist from participant guide

- [ ] Confirm current event rules, eligibility, selected-participant status, and submission portal details.
- [ ] Make the repository public and ensure setup instructions work.
- [ ] Clearly identify code, assets, and functionality built during the hackathon; disclose what was reused or pre-existing.
- [ ] Use Meta models in the working project and explain their actual contribution.
- [ ] Record an accessible three-minute demo focused on event-built work.
- [ ] List all contributors and appoint the submitting representative if applicable.
- [ ] Verify repository and video links are publicly accessible.
- [ ] Keep the impact claim limited to measured walkthrough task outcomes.
- [ ] Use only synthetic or self-shot fixtures with no identifying information.

## Schedule from the supplied participant guide

All listed times are Eastern Time. Reconfirm in the participant portal.

- Building period: October 27–November 4, 2026.
- Submission deadline: November 4, 2026, 9:00 PM ET.
- Judging: November 5–8; closing ceremony November 9; community vote winner November 16.
- Meta API credit claim deadline in the guide: November 4, 9:00 PM ET. Each participant claims individually; guide says a valid payment method is needed for API calls and a temporary authorization may appear. Set a spend limit alert if using a card.
- Office hours: weekdays 10:00–11:00 AM ET; the guide names live sessions October 27, 28, and 30 at noon ET.
