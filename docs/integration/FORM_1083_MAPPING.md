# Form 1083 workflow and integration boundaries

This guide describes the prototype's modeled LAHSA Habitability Standards Inspection Form 1083, FY 2022–23. The bundled source PDF is the unchanged base for the local export. This does not establish external acceptance, a current form-version determination, or an HMIS integration.

## Walkthrough coverage

| Room | Capture guidance | Candidate visual concepts |
|---|---|---|
| Kitchen | Show the kitchen and fixtures; run the faucet and show drainage. | Faucet, ventilation fan, stove |
| Bathroom | Show sink, bathing fixtures, ventilation, toilet, and door. | Faucet, ventilation fan, toilet, door lock, detector |
| Bedroom/living area | Show both areas, openings, detector, and entry lock. | Door lock, detector, heating equipment, ventilation fan |
| Hallway | Show the walking path, detector, and unit exit. | Exit door, detector, light fixture |

The current capture limits are 30 seconds for kitchen, bathroom, and bedroom/living area, and 15 seconds for hallway. The front door and lock are part of the hallway walkthrough. Candidate concepts and room associations are aids to evidence review, not official form mappings or proof that a visual feature passes an inspection.

The local workflow models 11 areas. Fire Safety is represented by separate evaluator decisions for 11a (unit detectors) and 11b (public/common-area detectors), yielding 12 marks on the form. A still or AI suggestion cannot establish detector operation, water temperature, airflow, electrical function, or other conditions requiring an in-person check.

## Export boundaries

The app prepares local PDFs and JSON after required evaluator decisions and sign-off:

1. A client-file record with evidence and timestamps.
2. A landlord fix-list containing evaluator-confirmed deficiencies.
3. A flattened copy of the bundled Form 1083 with supporting evidence/continuation pages, plus companion JSON.

The staged demo leaves participant/HMIS identity and unit address blank. The JSON is the app's local draft format, not a confirmed HMIS schema. Files require manual handling; the app does not submit to HMIS or a housing authority, deliver files to landlords, or claim recipient acceptance.

## Video analysis flow

1. The browser captures or imports a room clip and saves it locally for review.
2. After an explicit analysis action, the browser sends the clip bytes to the same-origin server route. It does not send a URL for server retrieval.
3. The client normalizes supported MOV files to MP4 using bounded packet-copy remuxing. The server validates uploaded MP4 bytes and media limits before processing.
4. The server sends video to Meta SAM 3.1 for segmentation and derives candidate/context stills from the verified source video. The mapping stage uses a short-lived, identity-bound server lease; the browser sends identity and token, not another copy of the video or frame bytes.
5. Meta Muse Spark drafts observations from the server-derived stills. An optional Baseten Muse Spark Open fallback may be used for eligible mapping failures when configured. Provider keys and raw provider bodies remain server-side.
6. The evaluator reviews each suggestion and source still, completes required checks, records independent decisions, and signs. Replacing or removing media invalidates linked evidence and affected decisions.

AI output is unreviewed draft text. It cannot record a human decision, complete an in-person check, set the overall result, or create an approved deficiency.

## Privacy and evaluation

Use rights-cleared staged/mock-unit footage without people, addresses, personal documents, or case notes. Live analysis transfers selected media to configured providers and may incur charges; review current provider terms and retention practices. Deleting local data does not claim to delete provider files or downloaded exports.

Fixture tests, provider connectivity, video-quality evaluation, physical-device checks, and recipient review are distinct evidence categories. A connectivity result does not demonstrate model quality. See the [evaluation protocol](../evaluation/protocol.md), [architecture](../ARCHITECTURE.md), and [privacy and safety guide](../PRIVACY_AND_SAFETY.md).
