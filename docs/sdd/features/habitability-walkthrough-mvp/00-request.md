# Habitability Walkthrough MVP

Feature: habitability-walkthrough-mvp · Baseline 1 · October 26, 2026

## Requested outcome

Prepare implementation-ready SDD documents for the user's installed OpenCode v2 SDD Autopilot plugin, plus Codex review guidance and GitHub CI. The later build will let housing navigators select an item, capture a mock-unit image, obtain a neutral Muse Spark draft, review it, record human checks, and export a review-only summary.

This package prepares a later implementation run. No plan approval, independent review verdict, application verification, publication or deployment is prefilled.

## Repository facts

The initial workspace has project notes but no application, manifest, tests, usable Git checkout or remote. Read docs/PRODUCT_BRIEF.md, docs/RESEARCH.md and docs/DECISIONS.md. Application paths below are proposed implementation targets.

The installed plugin resolves to /home/hermes/lab/dsh/reference/opencode-v2-sdd-plugin. Its inspected contracts require eight numbered Markdown artifacts, REQ IDs, TASK checkboxes, executable checks, independent review and plugin-owned state. This package targets that Autopilot interface, not the distinct .opencode-sdd/spec.json interface in jd-chiles/opencode-sdd-v2.

## Scope and boundaries

Core: 3–4 catalog items; capture/upload; real server-side Meta inference; validated neutral drafts; uncertainty; worker review; manual checks; provenance; local recovery and deletion; printable evidence summary; explicit fixtures; accessible mobile flow; CI/review.

Stretch after core acceptance: optional Voice Transcribe narration, then SAM highlighting if useful. Exclude automated pass/fail, certification, eligibility, signatures, HMIS upload, landlord deadlines, scheduling, production identity, tenant data, continuous video and offline sync.

The active provider Form 1083 version remains unresolved. Generic development may use a clearly illustrative demo catalog. Do not invent official wording, numbering or physical-test requirements. Only a documented provider-confirmed catalog may claim a mapping to its form version. A labeled illustrative demo can finish while form-specific claims and real pilots wait for confirmation.

Measure task time, evidence coverage, corrections and rework, with sample sizes and errors. Case-manager conversations remain owner-reported qualitative evidence. Housing placement timelines are outside evaluation.

Publishing, pushing and remote repository settings require a real repository and appropriate access. Preserve the plugin's independent reviews and normal approval gate.
