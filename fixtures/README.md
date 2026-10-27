# Fixtures

All fixtures are mock-unit only. No tenant, health, address, or identifying data.
No fixture output is live inference. No fabricated metrics or provider confirmation.

## Demo catalog mode

- The app runs a clearly illustrative demo catalog until a provider confirms the
  operative Form 1083 copy. Every demo surface carries the label:
  `Demo checklist — not a verified Form 1083 mapping.`
- Demo item IDs use the `demo-*` prefix. They are not official Form 1083 numbers
  or wording. The provider-confirmation gate is defined in
  `docs/integration/FORM_1083_MAPPING.md` §1.2; missing confirmation never
  promotes a demo item.
- The versioned demo catalog itself (`src/data/catalog.demo.json`, 3–4 items,
  at least one photograph-cannot-establish check) is implemented in TASK-003.
  This README records the fixture contract so TASK-002 scaffolding can proceed
  without inventing form fields.

## Rights and provenance

- Mock inputs must be rights-cleared: self-shot mock-unit photos or generated
  instructional artwork, recorded with source, author, license, and capture date
  below. No people, addresses, mail, screens, personal documents, or personal photos.
- Response fixtures (`fixtures/responses/`, TASK-004) are hand-written JSON that
  matches the strict `AnalysisDraft` envelope. They are labeled `mode: "fixture"`
  in UI and export and never silently replace a failed live call.
- Development and evaluation sets are separate. The evaluation protocol, blank
  measurement sheet (unmeasured values stay `unmeasured`), and three required
  scenarios live under `fixtures/evaluation/` and `docs/evaluation/` (TASK-008):
  1. visual evidence plus human test,
  2. poor framing / unknown,
  3. correction and rejection.
  This file claims no results.

### Provenance and license manifest

| File / slot | Source | Author | License | Capture / written date | Notes |
|---|---|---|---|---|---|
| `fixtures/responses/fixture-draft.json` | Hand-written by project for deterministic tests and fixture-mode UI | Project contributor | Same license as repository (no third-party content) | 2026-10-27 | Mock-unit kitchen-sink draft; carries `mode: "fixture"` and a `fixtureNotice` string; never live inference |
| `fixtures/media/` (reserved, currently empty) | Self-shot mock-unit photos or project-generated instructional artwork only | To be recorded per file at capture time | CC0 dedication for self-shot media, or recorded generator + license for generated artwork; no third-party, stock, or web images | `unmeasured` — no media committed yet | This checkout commits no binary media so no unlicensed bytes enter the repo; add files only with a manifest row below |
| `fixtures/evaluation/` (reserved) | Evaluation-only copies, never reused for development tuning | To be recorded per file | Same rights rule as above | `unmeasured` — no evaluation run recorded | See `docs/evaluation/protocol.md` for the separation rule and the three required scenarios |

Adding mock media later requires, per file: filename, source (self-shot mock unit
or generated artwork + tool), author, license (CC0 preferred), capture date,
confirmation that the frame contains no people, addresses, mail, screens, or
personal documents, and whether it belongs to the development or evaluation set.
A file must belong to exactly one set.

### Development / evaluation separation

- **Development set:** `fixtures/responses/` plus any `fixtures/media/dev-*`
  files added later. Used for unit tests, fixture-mode UI, and TASK-009 browser
  checks. Tuning prompts or thresholds against evaluation media is not permitted.
- **Evaluation set:** `fixtures/evaluation/` only. Reserved for the protocol in
  `docs/evaluation/protocol.md`. Evaluation media and response expectations are
  fixed before a measured run; do not copy evaluation files into development
  paths or train prompts on them.
- Both sets are mock-unit only and stay labeled `Demo checklist — not a verified
  Form 1083 mapping.` Neither set is inspection evidence and neither proves live
  inference.

## Credential availability (no values)

- As of 2026-10-27: no Meta API key is provisioned in this checkout. Env names
  only (`META_API_KEY` / official `MODEL_API_KEY` alias, `META_MODEL`,
  `META_API_BASE_URL`, `APP_ANALYSIS_MODE`); values are never committed, logged,
  or pasted into evidence.
- Generic scaffold work may proceed while a live smoke is pending. The live smoke
  (`npm run test:live`, real `muse-spark-1.3` call over `https://api.meta.ai/v1`
  with rights-cleared media) is a separate check: it must fail clearly without
  credentials and record actual provider success separately. Fixture tests never
  prove it.

## Official Meta contract (summary)

Full contract with access dates: `docs/integration/FORM_1083_MAPPING.md` §2.

- Base URL `https://api.meta.ai/v1`; primary endpoint `POST /v1/chat/completions`;
  recommended model `muse-spark-1.3` (Standard mode); Contributor IDs are
  training-opt-in and out of scope for any pilot data.
- One image per analysis; app bounds 8 MiB / 20 MP; server-validated bytes,
  EXIF stripped, 1600px longest edge, SHA-256 digest.
- Strict neutral-draft JSON (`observation`, `visibleEvidence`, `unknowns`,
  `suggestedManualChecks`); no verdict fields; untrusted model text escaped
  in UI/export.
