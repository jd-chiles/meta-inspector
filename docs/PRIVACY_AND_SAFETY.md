# Privacy, safety, and limitations

## Human control

AI-generated observations are drafts. A worker must review the evidence, complete required in-person checks, record the decision, and sign. The model does not determine whether a unit passes or fails. Evidence that is missing, stale, or mismatched cannot support a confirmed finding.

The app is not an HQS inspection tool. Housing Authority or voucher paths receive an HQS-required notice. The staged demonstration leaves participant/HMIS identity and unit address blank, and its generated files are not case-ready.

## Media and provider processing

Room clips and inspection records are stored locally in browser storage. A live analysis action sends the selected clip to the server and Meta for SAM processing. Server-derived stills may be sent to Meta Muse Spark; the configured mapping fallback may send them to Baseten. Provider credentials remain server-side. Review current provider terms for retention; deleting local data does not delete provider-side files or downloads.

Use only rights-cleared staged/mock-unit media in demonstrations and evaluations. Do not record tenants, faces, addresses, personal documents, or real case notes. Keep API keys, raw provider responses, and provider file IDs out of browser code, logs, exports, and repository fixtures.

## Export and integration limits

PDFs and JSON are generated locally for manual handling. The app does not submit to HMIS, deliver documents to a landlord, track voucher status, or claim that LAHSA/provider staff accept the output. No provider acceptance or external HMIS schema compatibility is established by the presence of an official form template.

## Proposed pre-visit checks

Address screening and SAM.gov lookup are product ideas only. The current app does not perform them. Before describing or implementing them as screening, define what each source can establish, how addresses and records are matched, how stale or ambiguous results are handled, what user review and appeal are available, and what data may be stored or shared. A lookup result must not be framed as an eligibility or approval decision without authoritative rules and evaluation.

## Evidence limits

Fixture behavior, provider connectivity, staged-video quality, physical-device behavior, and recipient acceptance are separate evidence categories. Passing a check in one category does not establish the others. See the [evaluation protocol](evaluation/protocol.md).
