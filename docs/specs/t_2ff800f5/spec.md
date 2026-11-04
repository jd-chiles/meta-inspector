# SPEC: Fold verified Form 1083 source findings into Walkthrough Kit (HQS exception, VSP destination, inspection occasion)

Short goal

- Update the Walkthrough Kit (Form 1083) workflow so it reflects the verified, owner-confirmed official form (public/forms/lahsa-form-1083-fy-2022-2023.pdf) rather than the external attachment. Close the four verified gaps (HQS exception copy, recorded destination, inspection occasion, landlord-fix consequence sentence) without changing the bundled official PDF's bytes or adding new AcroForm widgets.

Background / context

- The owner ingested an external research paper and reconciled it against the official Form 1083 in-repo. The attachment is contradicted by the official PDF; the app must not adopt the attachment's checklist, nor add a required participant signature.
- Verified gaps are documented in the task body and in docs/integration/FORM_1083_MAPPING.md. The official PDF SHA-256 is authoritative.

Scope

- Code: change copy, JSON schema, JSON builder, appended local-record render, PDF appendices and validation checks. Files touched will include src/export/move-in-ready-pdf.ts, src/features/walkthrough/move-in-ready-flow.tsx, tests/unit/export/move-in-ready-pdf.test.ts, tests/unit/… additions, and docs/DECISIONS.md, docs/PRODUCT_BRIEF.md, docs/integration/FORM_1083_MAPPING.md.
- Do NOT modify public/forms/lahsa-form-1083-fy-2022-2023.pdf or change its bytes.
- Do NOT add new AcroForm fields to the official PDF; all additions must be in the appended local supporting record and companion JSON only.

Decisions / constraints / guardrails

- Keep the internal fundingType key "lahsa" for this route; change user-facing copy and intake selector options so "Housing Authority / voucher (HQS required)" is the HQS-excluded route. The previous HUD-funded wording must be removed from UI copy where it incorrectly implied HQS.
- The recorded destination must be optional with values: "HMIS" or "Victim Services Provider comparable database". Store it in HmisReadyJson.form1083 as `recordedDestination?: "HMIS" | "VSP" | null` and print it only on the appended local record (appendOfficialForm1083Supplement). The official AcroForm must not be modified to include this field.
- Add inspection occasion to the JSON and appendix: `inspectionOccasion?: { kind: "initial-occupancy" | "annual-coc" | "post-deficiency-reinspection"; date: string } | null`. Print it in the appended supporting record and include in the exported JSON. Do not write any new AcroForm widget for this value.
- Landlord fix list appendix must include the verbatim sentence: "The changes must be completed before any funds can be given to the landlord, and before the participant can move into the unit." Quoted and attributed (Form 1083). Render on landlord-fix-list PDF (appendix or top of fix-list) only.
- Tests must verify JSON round-trip, appended-record contains the two new fields when provided, and that no AcroForm widget was created for them (unit test asserts buildOfficialHmisReadyPdf still only writes existing named fields and that loadOfficialForm1083Bytes integrity check remains).

Acceptance criteria (concrete)

1. UI / copy
   - Unit tests assert that the intake funding selector and all copy that previously read "HUD-funded / HQS" now read either: a) "Housing Authority or voucher (HQS required)" for the HQS route, and b) "HUD-funded (CoC/ESG)" or equivalent for routes where Form 1083 still applies. No test asserts the old HUD-funded block.
   - A LAHSA/CoC selection continues to reach Review and export flows.

2. JSON and schema
   - HmisReadyJson is extended with optional `form1083.recordedDestination` and `inspectionOccasion` fields as described above.
   - Unit tests (new/updated) confirm buildHmisReadyJson returns the new keys when input includes them, and that serializing/deserializing the output preserves the values (round-trip).

3. Appended local record tests
   - The appended supporting record (appendOfficialForm1083Supplement) includes printed lines for: evaluator attestation (existing), the new recorded destination (or "Not recorded"), and the inspection occasion and date (or "Not recorded"). Tests assert those strings appear in the rendered appendix text blocks.
   - The landlord-fix-list PDF includes the exact quoted sentence attributed to the form.

4. Official Form 1083
   - The exporter continues to load the bundled official PDF and validate its SHA-256. Tests assert loadOfficialForm1083Bytes remains unchanged and that no new AcroForm fields are written. Unit tests should confirm that fields.count and expected set of widgets are unchanged.

5. Tests and CI
   - Unit tests added/updated; `npm run test:unit` passes locally. Lint and typecheck pass.

Files to change (minimum)

- src/export/move-in-ready-pdf.ts
  - Extend HmisReadyJson type to include recordedDestination and inspectionOccasion.
  - Modify buildHmisReadyJson to accept and carry these new inputs (update MoveInReadyExportInput signature with optional ui-collected values), and to include them under form1083.
  - Modify appendOfficialForm1083Supplement to render the recorded destination and inspection occasion text lines.
  - Add unit-tests around export JSON and appendix rendering.

- src/features/walkthrough/move-in-ready-flow.tsx
  - Update the funding selector copy and any logic that previously blocked Form 1083 on a generic HUD-funded choice to only block on Housing Authority / voucher selection.
  - Ensure deriveFinalInspectionResult.hqs branching still uses the internal key if desired; change UI labels and error strings locations indicated by the original task body.

- docs/DECISIONS.md, docs/PRODUCT_BRIEF.md, docs/integration/FORM_1083_MAPPING.md
  - Replace wording that says "HUD-funded / HQS" blocks Form 1083 with the new wording: "Housing Authority/voucher (HQS required)" and clarify that LAHSA/CoC/ESG HUD money does not imply HQS.

- tests/unit/export/move-in-ready-pdf.test.ts
  - Add tests covering JSON round-trip, appendix render containing the recordedDestination and inspectionOccasion, and landlord-fix-list contains the quoted sentence.

Implementation notes / low-risk assumptions

- The Profile UI will surface the recorded destination and inspection occasion in the unit panel; for this task we will wire the Walkthrough export input so tests can set these values programmatically (no UI changes needed for testability). The owner prefers optional fields to avoid blocking exports.
- Preserve internal fundingType keys and finalization logic where possible to limit churn. The UI copy changes do not require renaming internal enums (but document the decision in docs/DECISIONS.md).

Risks and blocking items

- If new tests require changes to e2e flows that depend on other in-flight tasks (e.g., guided-tour flow edits), coordinate to avoid test collisions. This spec will only add unit tests and small render assertions to avoid broad e2e coupling.
- If CI's live tests expect HUD wording, those workflows must be updated in the same PR. The acceptance criterion requires no test to assert old HUD block; we will run unit tests locally before marking done.

Validation steps (what the implementation run must execute and show)

- Run node scripts/verify-sdd.mjs (unchanged pass)
- npm run lint
- npm run typecheck
- npm run test:unit (should pass all existing + new tests)
- Run any updated unit tests that assert the new wording and JSON keys

Handoff

- After implementing, create a small follow-up QA card for e2e/manual check of the intake selector on a device; do not implement here.

