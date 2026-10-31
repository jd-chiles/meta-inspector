# Item selection — 4-item public-only short list (2026-10-28)

`Demo checklist — not a verified Form 1083 mapping.`

This is a **proposal only**. Nothing here promotes a demo item or claims an
operative Form 1083 mapping. The §1.2 provider-confirmation gate in
`docs/integration/FORM_1083_MAPPING.md` is **unmet**: status `unconfirmed`
(public listing only), `suppliedBy=null`, `verifiedBy=null`,
`verifiedAt=null`.

## Source

- Public LAHSA FY 2022–2023 Form 1083, extracted 2026-10-28 from
  `https://www.lahsa.org/item.ashx?id=6886` (listing published 10/31/2022,
  last updated 1/31/2023; PDF footer `12-19-22 FORM 1083`).
- The "official wording" column below is a **working paraphrase from the
  short-list brief, not a verbatim PDF transcription**. Exact PDF wording,
  field counts, and physical-test requirements must be transcribed and
  checked against the PDF before any confirmed mapping.
- The 2024-version note is unresolved: neither this public FY22–23 PDF nor
  earlier 2024 references establish the operative copy.

## Proposed catalog mapping (all `demo-*`, gated)

| # | Public 1083 ref (working paraphrase — verify vs PDF) | Proposed app `itemId` | Reuse / extend rationale | Draft capture guidance (proposal) | Required manual check (`photoCannotEstablish=true`) |
|---|---|---|---|---|---|
| 4 | Interior air quality — window(s) / fan / A/C | `demo-interior-air` | New ID; extends concepts in `demo-window-lock` + `demo-bathroom-vent` without overloading their fixture-specific tests | Photograph the window, fan, or A/C unit in place, whole fixture visible, no people or identifying views | Operate the window / switch the fan or A/C on and confirm airflow or function by feel/sound. A photograph cannot establish airflow or that the unit runs. (`requiresPhysicalTest=true`, `photoCannotEstablish=true`) |
| 5 | Water supply — faucets, hot water, clear flow | `demo-water-supply` | New ID; generalizes `demo-kitchen-sink` (which is kitchen-specific) to any faucet under test | Stand back 1–2 meters; photograph the faucet/basin in one frame, no people or identifying items | Run the taps, confirm hot water and clear steady flow and drainage. A photograph cannot establish water flow, temperature, or drainage. (`requiresPhysicalTest=true`, `photoCannotEstablish=true`) |
| 8 | Lighting and electricity — natural/artificial light + outlets, fire safety | `demo-lighting-electric` | New ID; no current demo item covers it | Photograph the room's light source(s) and outlet(s) with lights on, fixtures only, no people | Operate switches/lights and confirm outlets power a test lamp; confirm fire-safe condition per PDF wording (verify exact requirement vs PDF before claiming). A photograph cannot establish that lights/outlets work. (`requiresPhysicalTest=true`, `photoCannotEstablish=true`) |
| 11a | Unit smoke + CO detectors — presence + press-to-test | `demo-smoke-co` | New ID; extends `demo-smoke-alarm` (smoke-only, ceiling-photo framing) to smoke + CO | Photograph each detector unit in place from directly below; do not touch or remove the unit for the photo | Press the test button on each unit and confirm the alarm sounds. A photograph cannot establish that an alarm works. (`requiresPhysicalTest=true`, `photoCannotEstablish=true`) |

Notes:

- Every item keeps at least one `manualChecks[]` entry with
  `photoCannotEstablish=true` (REQ-001 rule: each pairs a photo with a
  physical test the camera cannot establish).
- All IDs keep the `demo-` prefix. Non-`demo-*` provider-mapped IDs are
  blocked until the §1.2 gate is fully recorded. Adopting these IDs,
  labels, or guidance wordings into `catalog.demo.json`, fixtures, tests,
  UI copy, or evaluation sheets would be an implementation change and is
  **gated — do not implement** until (a) exact PDF wording is transcribed
  and (b) a provider confirms this copy and these 4 items.
- Current demo catalog (`demo-kitchen-sink`, `demo-window-lock`,
  `demo-smoke-alarm`, `demo-bathroom-vent`) is intentionally left
  untouched by this proposal.

## Owner question

**Which provider confirms that the FY 2022–2023 public copy (footer
12-19-22) is the operative Form 1083, and confirms these 4 items (#4, #5,
#8, #11a) as the walkthrough selection?** Until named with a verification
date, the catalog stays demo-only and no backend/frontend/gtm
implementation follows.
