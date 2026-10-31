# Mobile workflow plan and design QA

## Product flow plan

The app follows the supplied three-screen workflow:

1. **Video Capture:** open here by default. Keep one selected room, its saved-clip count, preview, and record/upload actions in the foreground. On phones, choose a different room through a closed-by-default “Change room” picker; desktop keeps all room shortcuts visible. Show the current prompt plus two nearby steps, with the rest behind “View all prompts.” Completion controls stay unavailable until a clip is recording or saved. Review, Sign-Off, and Profile remain in the safe-area-aware bottom navigation.
2. **Draft Review:** open to a compact four-item summary. “View all 11 elements” follows the rows directly; selecting an element replaces the list with one focused assessment, evidence, in-person checks, and a bottom save/pager bar. Returning restores the summary.
3. **Sign-Off & Export:** show the derived evaluator result, sign-off gate, and local export options on a dedicated screen. No HMIS or LAHSA submission is implied.

Profile remains a separate guided setup flow. HUD-funded and unknown-funding records now route to a dedicated notice screen without Form 1083 decision, signature, result, or export controls. Save, sign-off, and export actions also reject non-LAHSA funding in their handlers.

## Visual source and normalized evidence

- Source truth: attached `2-Photo-2.jpg`, full path `/tmp/codex-remote-attachments/01a1863c-be4d-79c1-8778-8ac4dcab8271/6873ACB2-57C6-4FB1-86FC-51FA12D13B9B/2-Photo-2.jpg` (1280 × 853 px). It contains three phone screens with device status/home chrome.
- Latest phone screenshots from the browser suite: first-run Capture at 360 × 800 CSS px, device scale factor 1 ([first-run Capture](artifacts/design-qa/capture-first-run-360.png)); configured Capture at the 360 × 640 and 390 × 844 fit sizes ([360 × 640 Capture](artifacts/design-qa/capture-fit-360x640.png), [390 × 844 Capture](artifacts/design-qa/capture-fit-390x844.png)); Draft Review and Sign-Off at 360 px ([Draft Review](artifacts/design-qa/review-360.png), [Sign-Off & Export](artifacts/design-qa/signoff-360.png)). The exact Capture measurements are recorded in [360 × 640 layout data](artifacts/design-qa/capture-fit-360x640-layout.json) and [390 × 844 layout data](artifacts/design-qa/capture-fit-390x844-layout.json). The live [Tailscale preview](https://vps-27b87dbf-1.taile8712d.ts.net:3100/) was inspected at 390 × 844.
- Visual comparison: Capture uses the same camera-first hierarchy as the reference, with a selected-room header, preview/actions, active prompt and two nearby rows, and bottom tabs. Draft Review keeps the compact four-row overview and an explicit full-list transition. Sign-Off & Export puts result, evaluator sign-off, and local export options in that order. The prior `artifacts/ui-audit/comparison-*.png` files predate the collapsed room picker and are historical captures.
- State differs by design: the reference shows a clip recording, completed AI suggestions, evaluator decisions, and a signed result. The preview shows an empty staged unit until a worker supplies evidence and records decisions. It does not invent footage, confidence, approvals, deficiencies, signatures, or submission. Comparisons therefore judge screen hierarchy and layout, not those differing data values.
- Focused region comparisons were not needed: headings, prompt rows, review summaries, status cards, actions, and bottom navigation remain legible in the normalized full-screen comparisons. The text in the original raster is already upscaled and soft, so finer font-shape comparisons would be misleading.

## Fidelity review

- **Typography:** both use a compact bold sans-serif hierarchy with strong step titles and readable item labels. The app uses the system UI font stack; remaining antialiasing differences come from comparing a browser render to a photographed mockup.
- **Spacing and layout:** Capture follows the reference order: step title, selected-room summary, video region, recording controls, prompts, and bottom tabs. Room shortcuts are collapsed on phones and remain visible on desktop. At 360 px there is no horizontal overflow; the shell keeps a single scrolling main pane above the safe-area tabs. Review uses compact rows with adjacent note/sign-off actions. Sign-Off stacks result, evaluator, and export sections in the reference order.
- **Colors and tokens:** white and pale-gray surfaces, dark blue text, blue primary actions, and restrained green/red decision colors follow the reference. Additional staged-data and provider-status labels communicate product state.
- **Images and icons:** no staged room clip was supplied. Capture shows an explicit empty video state instead of implying that a room has been recorded. Standard Lucide controls are used; no fake footage or approval thumbnails appear.
- **Copy:** worker choices remain distinct from AI drafts. HUD is routed to HQS. Export copy says local/manual and does not claim direct submission.

## Findings and comparison history

- **P1 — Filming had no active prompt.** The initial rows all appeared as a flat checklist. Added a single highlighted and accessibly identified current prompt, with the next prompt taking focus after completion. The phone-width E2E test checks exactly one current prompt and verifies advancement.
- **P1 — The last prompt could sit behind the fixed tabs at 360 px.** The first highlighted row label was too tall for the narrow layout. Shortened its visible state label and tightened the highlight spacing. The 360 px test now verifies the last prompt remains above navigation with no horizontal overflow.
- **P1 — HUD users could still see LAHSA evaluator controls.** Replaced the warning-over-form with a dedicated HQS route screen and removed Form 1083 sign-off/export controls for HUD and unknown funding. Added handler guards and E2E checks for absent decision, result, signature, and export controls.
- **P1 — A clean first launch showed only the setup form and left the Capture area empty.** The unknown/LAHSA route now shows the real empty room-video state and its filming prompts below setup. Record/upload controls stay disabled until a pseudonym and LAHSA funding are selected. The HUD route continues to hide the Form 1083 capture path.
- **P1 — The preview could still show an older long-page build.** Kept the Tailscale preview on port 3100 and refreshed the active page after rebuilding. The older local workspace on port 3200 still serves the legacy linear UI; it is not the current preview.
- **P1 — The phone capture header still spent a full row on four room buttons.** Replaced the mobile chip strip with a selected-room header and an explicit collapsed room picker, so the video and prompt progression lead the screen. Desktop retains direct room shortcuts.
- **P1 — The Tailscale server served an older build after the E2E build replaced `.next`.** The open page requested CSS and JavaScript assets that returned 400. Restarted the :3100 Next server after the final build; the mobile page now hydrates and all 11 document/CSS/JavaScript requests return 200 with no console errors.
- **P1 — Review actions were pushed far below the four summary rows and the status badge wrapped on narrow phones.** Changed the summary to use natural row height and adjacent actions, kept the connection badge on one line, and added phone geometry assertions.
- The updated captures were checked against all three supplied screens. Their sequence and hierarchy now align. Remaining content differences are intentional: the supplied image shows recorded video, model suggestions, evidence stills, and completed evaluator decisions; the app must not invent those for the empty staged unit.

## Verification

- `node scripts/verify-sdd.mjs`: passed; 15 requirements, 11 active acyclic tasks, 7 named checks.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `FFMPEG_PATH=/home/hermes/.local/ffmpeg-9.0.2/bin/ffmpeg npm run test:unit`: 380 passed across 22 files; 3 optional FFmpeg integration tests skipped.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/hermes/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome npm run test:e2e`: 27/27 passed. This command also ran `next build` successfully. Coverage includes clean first-run setup with locked Capture controls, 360 px/640 px phone fit, prompt progression, HUD routing, mobile review focus, offline recovery, export gates, async evidence identity, MOV normalization, and desktop layout.
- `npm run build`: passed separately.
- Refreshed Tailscale preview at 390 × 844 has a 390 px document/main width and no horizontal overflow; document, CSS, JS, manifest, and app icon assets return 200. The browser console has no errors after serving the root favicon. The single informational install-banner message is expected when the browser has not requested installation.

## Remaining product and release gates

- A consented, rights-cleared staged kitchen/bathroom video is still needed to evaluate live SAM/Muse tracking, element mapping, timestamps, and still quality. The 2026-10-29 synthetic-video smoke reached SAM but returned zero candidates, so Muse mapping and video quality were not tested. A separate historical still-image smoke does not validate the video workflow. The preview correctly says `Meta live · untested` for this video workflow.
- Verify camera capture, codecs, safe areas, and recording on physical iOS Safari and Android devices.
- Confirm exact Form 1083 field mapping and recipient acceptance. Exports remain local/manual; direct HMIS submission is not implemented.
- Native SDD review/evidence has not been recorded for this worktree. No approval is inferred from local checks or screenshots.

## Result

The specified phone-size, screen-flow, and local-check acceptance passed for this build. Product release is still **Not ready** while the external video evaluation, device, recipient/form acceptance, and native SDD evidence gates remain open.
