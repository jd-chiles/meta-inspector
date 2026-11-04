# Walkthrough Kit: project overview

## The problem

Getting housing assistance can take a long time. After a household receives a voucher or other assistance, the search for a qualifying home can still require repeated coordination. A household and case manager may invest time in an apartment visit only to learn later that the unit does not meet the relevant requirements.

The inspection and documentation work adds another burden. Case managers often manage heavy caseloads, and some may have limited experience conducting a habitability walkthrough. The work needs to be consistent and reviewable without treating an AI suggestion as an inspection decision.

These statements describe the product motivation and owner-reported context. The repository does not contain a representative study, measured time savings, or outcome data; do not present them as quantified research findings.

## The approach

Walkthrough Kit is a mobile-first companion for housing navigators and case managers. It guides a staged unit walkthrough across four rooms, organizes timestamped video evidence, and offers draft observations for a worker to review. The worker records the actual inspection decisions, required checks, corrections, and sign-off. The app can then prepare local files for the existing manual workflow.

The intended value is practical support: make the walkthrough easier to follow, reduce avoidable documentation friction, and help less-experienced staff see what still needs human attention. It does not replace a qualified evaluator or automate a housing decision.

## Proposed pre-visit screening direction

The project owner described a potential earlier step: check a candidate unit address and relevant SAM.gov records before arranging a visit, with the goal of identifying issues that could make a unit unsuitable and avoid unnecessary case-manager effort.

This pre-inspection screening is **not implemented in this repository**. The exact address source, SAM.gov records and meaning, decision rules, data quality, privacy requirements, and recourse for incorrect matches still need product and legal review. Until those are defined and evaluated, documentation must call this a concept, not a feature or a proven way to prevent wasted visits.

## Current product boundaries

- The modeled workflow is LAHSA Habitability Standards Inspection Form 1083, FY 2022–23.
- Four-room video evidence and Meta SAM/Muse draft suggestions support the worker's review.
- The overall inspection result comes from the evaluator's decisions and required sign-off.
- Exports are local and intended for manual handling. Participant/HMIS identity and unit address are blank in the staged demo.
- Direct HMIS submission, landlord delivery, voucher tracking, HQS inspection, and the proposed address/SAM.gov pre-check are not implemented.

See the [product brief](PRODUCT_BRIEF.md), [privacy and safety guide](PRIVACY_AND_SAFETY.md), and [current status](STATUS.md) for details and evidence links.
