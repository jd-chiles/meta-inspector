# Evaluation protocol

This protocol separates software checks from evidence about provider output and real-world use. No fixture or CI result should be presented as a live model-quality finding.

## Evaluation principles

- Use rights-cleared staged/mock-unit video with no tenant or personal information.
- Keep development fixtures separate from evaluation inputs.
- Label every result as fixture, live provider, device check, or practitioner evaluation.
- Record only observed results. Include date, model/configuration, sample size, method, limitations, and failures.
- Do not infer time savings, reduced visits, or housing outcomes from a technical demo.
- Keep human decisions and required physical checks distinct from AI suggestions.

## Suggested scenarios

1. **Visible evidence with a required physical check:** verify that the linked still supports only the visual observation and that the human check remains outstanding until performed and recorded.
2. **Unclear evidence:** use obstruction, glare, poor framing, or blur; verify the system leaves the item for human review rather than asserting a pass or failure.
3. **Correction or replacement:** edit/reject a draft or replace the source clip; verify old evidence and decisions cannot be treated as current.
4. **Room coverage:** score whether the intended cue appears, whether the returned still is relevant, whether its timestamp matches the source, and whether the observation maps to the right modeled area.

## Report format

For each run, record:

- Date, app revision, mode, provider/model, and input provenance.
- Scenario, number of sessions/items/workers, and the steps performed.
- Observed processing time, evidence coverage, retakes, edits, rejections, unresolved checks, and recovery behavior where applicable.
- Failures, missing evidence, and limitations.

Mark unobserved fields as `unmeasured`. A single session is a sample of one and does not establish a general rate. Provider connectivity alone does not establish quality; physical-device checks and recipient acceptance are separate evidence categories.
