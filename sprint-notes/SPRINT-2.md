# Sprint 2 notes — REQ-E1 + REQ-E2 + REQ-E3 (Workflow outputs)

Base: clean dev HEAD (confirmed `git status` clean before work). Siblings land
separately. Nothing committed; tree left dirty for the integrator. `02-design.md`
and `05-change-log.md` intentionally NOT edited (integrator owns them); verbatim
text for both is provided below.

## Files

New:

- `src/export/lahsa-1083.ts` — REQ-E1 builder `buildLahsa1083Json(input)` plus
  `deriveLahsaDetermination(criteria)`, `ParticipantSignoff` (structural
  placeholder for the Sprint 1 contract), `LAHSA_1083_MAPPING_NOTICE`.
- `src/export/case-note.ts` — REQ-E2 deterministic template
  `buildCaseNoteText(input)`, `CASE_NOTE_DRAFT_LABEL`,
  `CASE_NOTE_REINSPECTION_SENTENCE`.
- `src/server/exports/polish-case-note.ts` — REQ-E2 polish handler
  `handlePolishCaseNoteRequest`, `isTextPolishEnabled`,
  `TEXT_POLISH_TIMEOUT_MS = 30_000`.
- `src/app/api/exports/polish-case-note/route.ts` — `POST` route for the above.
- `tests/unit/export/lahsa-1083.test.ts` (new, 19 tests)
- `tests/unit/export/case-note.test.ts` (new, 6 tests)
- `tests/unit/server/polish-case-note.test.ts` (new, 10 tests)
- `tests/unit/export/fix-list-language.test.ts` (new, 5 tests)

Edited:

- `src/export/move-in-ready-pdf.ts` — `FixListLanguage` (`en` | `es`), one
  `FIX_LIST_STRINGS` table, optional `language` params on
  `buildMoveInReadyPdf` (default `en`, fix-list only) and `exportFilename`
  (adds `-es` suffix for the ES fix list), fix-list plain-language header,
  agency line from `evaluatorAgencyName`, translated per-item labels.
- `src/features/walkthrough/move-in-ready-flow.tsx` — `FlowExportKind`
  (`lahsa-1083-json`, `case-note` kinds), `participantSignoffOf` /
  `participantVisualAlarmsRequiredOf` contract readers, `requestCaseNotePolish`
  client helper, `buildExportFile` / `downloadExport` / `shareExports`
  extensions, LAHSA JSON button, Fix list (EN detail + ES) actions, Case note
  button, participant-gate help text.

## Tests + results

- `npx vitest run` on the 4 new files: 42/42 pass.
- Regression: `tests/unit/export/move-in-ready-pdf.test.ts` (existing):
  all pass, no expectation changes needed.
- Full `npm run test:unit`: 44 files, 523 passed / 3 skipped (base was
  481 / 3; +42 new, zero regressions).
- `npm run typecheck`: clean.
- `npx eslint` on all touched files: 0 errors; the 3
  `react-hooks/exhaustive-deps` warnings in `move-in-ready-flow.tsx` are
  byte-identical to base (verified via `git show HEAD:… | eslint --stdin`).
- Not run per instructions: e2e, build, `test:live`. All new verification is
  fixture/mocked mode; no live provider call was made.

## Missing symbols (siblings not in base)

Sprint 1 (REQ-F1) canonical definitions — referenced by exact contract name,
implemented structurally until Sprint 1 lands:

- `ParticipantSignoff` in `src/domain/move-in-ready.ts` (placeholder type of
  the same name exported from `src/export/lahsa-1083.ts`; integrator: re-point
  imports at the canonical type).
- `PARTICIPANT_ATTESTATION_TEXT` in `src/domain/move-in-ready.ts` (not needed
  by E1/E2 output shapes; listed for completeness).
- `validateParticipantSignoff` in `src/domain/move-in-ready.ts` (mirrored by
  the private `validateParticipantSignoffShape` in `src/export/lahsa-1083.ts`;
  integrator: replace with the canonical validator).
- Record field `participantSignoff` on `MoveInReadyInspection` (read via
  `participantSignoffOf` cast in the flow; integrator: remove the cast).

Sprint 1 (REQ-F2):

- Record field `participantVisualAlarmsRequired` on `MoveInReadyInspection`
  (read via `participantVisualAlarmsRequiredOf` cast; passed explicitly into
  both builders; integrator: remove the cast).

tsc gaps: none failing — `tsc --noEmit` is clean. The structural-typing gaps
are exactly the casts above: `participantSignoffOf`,
`participantVisualAlarmsRequiredOf` (flow), `ParticipantSignoff` /
`validateParticipantSignoffShape` (lahsa-1083 module). Until Sprint 1 lands,
the LAHSA JSON and case-note buttons stay disabled with the honest help text
"LAHSA JSON and case-note exports also need the participant co-signature.",
and their builders throw honest "Participant co-signature is required…"
errors if invoked.

## Risks / integrator attention

1. `additional_standards` source is an interpretation. The prompt derives all
   ten top-level booleans as A → true / D → false but names only nine
   elements outside Access and Fire safety. This sprint maps
   `additional_standards` to the aggregate Fire safety decision (the only
   remaining A/D source; Access is fully captured by
   `fire_safety.emergency_exit`). If the program spec intends another source,
   change `CRITERION_BY_ELEMENT` handling in `src/export/lahsa-1083.ts` only.
2. Null-field key names are an interpretation: `property_address: null`
   (pinned by Sprint 3 REQ-L3, which fills `{ geolocation }`),
   `participant_hmis_id: null`, `staff_hmis_id: null`. Signature sub-keys are
   `{name, signature, timestamp}` per the prompt's "{name, signature text,
   timestamp}" in the file's snake_case style.
3. Existing e2e pins a single button matching `/Landlord fix-list/` that
   downloads `landlord-fix-list.*\.pdf` (move-in-ready.spec.ts:1797, 1880,
   1925) and checks the four existing buttons sit above the bottom nav at
   360px. To keep that green, the EN button keeps its title and carries
   "Fix list (EN)" in its detail line; "Fix list (ES)", "Case note", and
   "LAHSA JSON" were appended after the HMIS block (LAHSA JSON inline, no
   layout shift) so no existing button moved.
4. Case-note download calls same-origin `POST /api/exports/polish-case-note`
   and falls back to the local template on any failure (offline, timeout,
   5xx). With `TEXT_POLISH_ENABLED` unset the route returns the template
   without a provider call. Client timeout is 35 s over the server's 30 s.
5. New env var: `TEXT_POLISH_ENABLED` (server-only, optional, default off;
   only the exact value `1` enables polish). Safe when unset: build, unit
   tests, and all exports behave identically to base.
6. ES fix-list boilerplate is static author-written text in `FIX_LIST_STRINGS`
   (no runtime model text). Signed/recorded content (attestation, names,
   rationales, dates, provenance) renders verbatim English in both languages
   by design — never retranslated.

## Verbatim change-log entry (for 05-change-log.md)

```md
### Sprint 2 — Workflow outputs (REQ-E1, REQ-E2, REQ-E3)

- REQ-E1: new `src/export/lahsa-1083.ts` exporting `buildLahsa1083Json(input)`,
  wired as export kind `lahsa-1083-json` in `buildExportFile` with a
  "LAHSA JSON" button beside the existing JSON button. Emits `inspection_id`,
  `inspection_timestamp`, `checklist_criteria` (ten A → true / D → false
  booleans plus nested `fire_safety` with `emergency_exit`,
  `unit_smoke_detectors`, `common_area_detectors`, `visual_alarms_required`,
  `visual_alarms_approved`), derived `overall_determination`
  (APPROVED/DEFICIENT with an internal consistency assertion),
  `signatures` (participant + staff), null `property_address` /
  `participant_hmis_id` / `staff_hmis_id`, and the rule-7 `mapping_notice`.
  Gates: complete A/D decisions (needs-human-check blocks), both signatures,
  LAHSA funding. `additional_standards` derives from the aggregate Fire
  safety decision (interpretation; see sprint notes).
- REQ-E2: new export kind `case-note` (`text/plain`, in the share packet once
  the participant has signed). Deterministic template from the record (date,
  pseudonym, REQ-E1 determination, one line per element with rationale
  clipped to 200 chars, evaluator + participant names, per-D correction and
  dates with "Re-inspection required before subsidy release."), labeled
  "Case note draft — review before pasting into HMIS." Optional polish via
  `POST /api/exports/polish-case-note` only when server env
  `TEXT_POLISH_ENABLED=1` (default off); any failure returns the template.
- REQ-E3: `landlord-fix-list` PDF gains an `en` | `es` language parameter
  with "Fix list (EN)" / "Fix list (ES)" actions, a plain-language header,
  per-D requirement/deficient-area/correction/dates/stills, agency name from
  `evaluatorAgencyName`, no invented landlord contact fields, and a static
  ES string table. Hostile decision text renders as inert literal PDF text
  (covered by an escaping unit test).
- Cross-sprint: built against the Sprint 1 contracts (`ParticipantSignoff`,
  `validateParticipantSignoff`, record `participantSignoff` and
  `participantVisualAlarmsRequired`) via structural placeholders; new exports
  stay disabled until the participant co-signature exists. No new env vars
  besides server-only `TEXT_POLISH_ENABLED` (safe unset).
- Verification (fixture/mocked only; no live provider calls, no `test:live`):
  42 new unit tests pass; full `test:unit` 523 passed / 3 skipped (base
  481 / 3); `typecheck` clean; `eslint` 0 errors (3 pre-existing warnings
  unchanged). E2e/build left for the integrator.
```

## Verbatim design text (for 02-design.md)

```md
### Sprint 2 — Workflow outputs (REQ-E1, REQ-E2, REQ-E3)

- LAHSA JSON (`src/export/lahsa-1083.ts`): pure builder over
  `{sessionId, fundingType, decisions, signoff, participantSignoff,
  participantVisualAlarmsRequired?, generatedAt?}`. Element map: nine
  elements to their like-named criteria, Access to
  `fire_safety.emergency_exit`, Fire safety 11a/11b to the detector
  subfields, aggregate Fire safety to `additional_standards`. Determination
  is derived from the emitted criteria object by
  `deriveLahsaDetermination` (null `visual_alarms_approved` never blocks)
  and re-derived as an internal assertion before return, making an
  inconsistent export impossible.
- Case note (`src/export/case-note.ts` + `src/server/exports/polish-case-note.ts`):
  the template builder delegates gating and determination to
  `buildLahsa1083Json`, so the note can never disagree with the LAHSA JSON.
  Polish is a same-origin route returning `{text, polished[, model]}`; the
  client (`requestCaseNotePolish`, 35 s timeout) treats every failure as
  "use the template". The route validates input (JSON, single `text` key,
  ≤16_384 chars), honors the Meta base-URL allowlist, and keeps keys and
  provider bodies server-side.
- Bilingual fix list: `FIX_LIST_STRINGS` holds the complete boilerplate per
  language; `buildMoveInReadyPdf(input, kind, language = "en")` applies it
  to `landlord-fix-list` only. ES filenames gain an `-es` suffix. Recorded
  text flows through the existing `cleanText`/`cleanPdf` path unchanged.
```
