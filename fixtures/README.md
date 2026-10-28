# Fixtures

Repository media fixtures manifest

`Demo checklist — not a verified Form 1083 mapping.`

Catalog: `demo-habitability-walkthrough` version `0.2.0-demo.1`
(`src/data/catalog.demo.json`, 11 items: 4 carried verbatim +
7 reserved placeholders `demo-item-05..11` with official wording TBD).
No row claims a verified Form 1083 mapping. Official wording, physical
tests, and sign-offs remain TBD per `docs/integration/FORM_1083_MAPPING.md`
§1.2; missing confirmation never promotes a demo item.

## Provenance

- fixtures/media/dev-ceiling-detector-01.jpg | Source: self-shot (attachment: IMG_8511.jpeg) | Author: user | License: CC0 | Capture date: 2026-10-27 13:57:02 | Notes: dev fixture, EXIF stripped on ingest, normalized to 1200x1600, size: 63132 bytes, SHA256=3358956b6d83c8a0af196b2764f51781d2b9d6c0a4ef1a4014c5d0e8d4cd79a3c, binary committed in commit 728570e. | Set: dev

## Reserved fixture-media slots (rights-cleared only, pending coordinator ingest)

No new binary media is committed in this lane: child-session shell is
denied, so EXIF stripping, byte validation, and SHA-256 measurement cannot
be executed here. The coordinator (native shell) owns ingest with the exact
commands below. Until ingest lands, these rows stay `unmeasured` and no
fixture success is claimed beyond the pre-existing dev image above.

- Scenario A (visual evidence plus human test), 11-item coverage: slot
  `fixtures/media/dev-item-05-faucet-01.jpg` (suggested) | Source: TBD
  self-shot or generated mock-unit photo, no people/addresses/mail/screens
  | License: TBD CC0 | Set: dev | Status: `unmeasured` (binary absent,
  EXIF strip + size/SHA256 pending coordinator ingest).
- Scenario B (poor framing / unknown), 11-item coverage: slot
  `fixtures/media/dev-item-06-framing-01.jpg` (suggested) | Source: TBD
  self-shot or generated mock-unit photo with glare/cropping/obstruction,
  no people/addresses/mail/screens | License: TBD CC0 | Set: dev |
  Status: `unmeasured` (binary absent, EXIF strip + size/SHA256 pending
  coordinator ingest).
- Scenario C (correction and rejection), 11-item coverage: slot
  `fixtures/media/dev-item-07-reject-01.jpg` (suggested) | Source: TBD
  self-shot or generated mock-unit photo, no people/addresses/mail/screens
  | License: TBD CC0 | Set: dev | Status: `unmeasured` (binary absent,
  EXIF strip + size/SHA256 pending coordinator ingest).

Coordinator ingest (exact commands, evidence owner: coordinator):

1. Place each rights-cleared source image under `/tmp/opencode/` (never
   commit the unprocessed source).
2. Strip metadata and normalize: `npx tsx scripts/ingest-fixture.mjs` if
   present, else `exiftool -all= -o <out.jpg> <src> && identify -format
   '%w %h %m' <out.jpg>` (record dimensions), then `sha256sum <out.jpg>`
   and `stat -c %s <out.jpg>`; copy the stripped output to the
   `fixtures/media/` slot above.
3. Verify no EXIF remains (`exiftool <out.jpg>` shows no GPS/serial fields),
   decode stays within REQ-002 limits (≤ 8 MiB, ≤ 20 MP, JPEG/PNG/WebP),
   and update each row above with source / author / license / capture date
   / size / SHA256.
4. Run the evidence checks and record them (never hand-edit evidence):
   `npm run test:unit` and `npm run typecheck` on the stable fingerprint;
   the 11-item catalog intentionally fails the current `validateCatalog`
   3–4-item gate and `tests/unit/domain/catalog.test.ts` 4-item expectation
   until TASK-072 (+ catalog validation owner) lands — report that gap, do
   not weaken assertions.

## Evaluation set

Empty as of 2026-10-28 — no evaluation media committed, manifest rows
remain `unmeasured`. See `fixtures/evaluation/README.md` for the empty-set
record and the exact media needed for scenarios A/B/C. Dev-set inputs above
belong to exactly one set and are never reused for evaluation.
