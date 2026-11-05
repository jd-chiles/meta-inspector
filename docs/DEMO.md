# Demo walkthrough

This guide is for a short portfolio or hackathon demonstration of Walkthrough Kit. Use staged/mock-unit data only.

## Before the demo

1. Use Node.js 22 and install the locked dependencies:
   `npm ci`
2. Copy `.env.example` to `.env.local`.
3. Keep `APP_ANALYSIS_MODE=fixture` for a keyless demo. Fixture responses are synthetic.
4. Start the app with `npm run dev` and open the local URL in a mobile-sized browser viewport.
5. Confirm the staged screenshots in the root README match the current interface. Do not present empty screens as a completed inspection.

Do not add API keys to screenshots, browser-visible variables, recordings, or repository files. Live mode transfers selected media to configured providers and may incur charges; it is not required for this demo.

## Suggested 4-minute walkthrough

### 1. Explain the user and task (30 seconds)

A housing navigator needs to document a staged walkthrough across rooms while keeping observations, physical checks, and evaluator decisions clear.

### 2. Capture room evidence (60 seconds)

Show the guided capture flow and the four modeled spaces. Mention the short per-room duration limits. Use the project's approved mock-unit clips or explain the staged interface without recording personal information.

### 3. Show an AI draft and its evidence (60 seconds)

Run fixture analysis or show the existing review UI. Point out the fixture label, linked source moment, and visible unknowns/manual checks. State clearly that fixture content is synthetic and does not demonstrate live model quality.

If showing a live result, identify it as a live provider request and describe only what was observed in that run. Do not imply that provider connectivity is a quality evaluation.

### 4. Show evaluator control (60 seconds)

Review, correct, or reject a draft. Show that required physical checks and the evaluator's decision remain separate. Explain that replacing or removing source media invalidates dependent evidence and decisions.

### 5. Show sign-off and local export (30 seconds)

Show the local packet flow and explain that it prepares files for manual handling. It does not submit to HMIS, transmit a landlord fix-list, or establish external acceptance.

## Claims to use

- “This prototype organizes a staged walkthrough and links draft observations to source evidence.”
- “AI suggestions remain unreviewed until an evaluator reviews them.”
- “The evaluator remains responsible for required physical checks, decisions, and sign-off.”
- “The exported files are local artifacts for manual handling.”

## Claims to avoid

Do not claim measured staff-time savings, fewer visits, better inspection accuracy, housing outcomes, current-form compliance, HMIS integration, or provider/agency acceptance. Those have not been established by this repository.

## After the demo

Record what was actually shown: app revision, fixture or live mode, device/browser, scenario, and any observed failures. Keep follow-up evaluation aligned with the [evaluation protocol](evaluation/protocol.md).
