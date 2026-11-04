# Walkthrough Kit: project overview

## The problem

People may wait a long time for housing assistance, then face a time-sensitive search for a home that meets program requirements. An unsuitable-unit visit can consume time for the household and case manager. The walkthrough and documentation add work for staff who may have heavy caseloads or limited inspection experience.

This is the product's motivation, based on early practitioner context. The repository contains no representative study or outcome data, so it does not establish prevalence, avoided visits, or time savings.

## The approach

Walkthrough Kit is a mobile-first companion for housing navigators and case managers. It guides a staged unit walkthrough across four rooms, organizes video evidence, and offers draft observations linked to source moments. The evaluator records the inspection decisions, required checks, corrections, and sign-off. The app can prepare local files for a manual workflow.

The goal is to make evidence capture and review easier to follow. AI output is an observation for a person to review; it is not an inspection verdict or a substitute for a qualified evaluator.

## Current scope

- The modeled form is LAHSA Habitability Standards Inspection Form 1083, FY 2022–23.
- The walkthrough covers kitchen, bathroom, bedroom/living area, and hallway. The front door and lock are covered in the hallway.
- Video limits are 30 seconds for kitchen, bathroom, and bedroom/living area, and 15 seconds for hallway.
- Exports are generated locally for manual handling. The staged demonstration leaves participant/HMIS identity and unit address blank.
- The app does not conduct an HQS inspection, submit to HMIS, deliver files to a landlord, track vouchers, or make eligibility decisions.

## Future exploration

Pre-visit address screening and SAM.gov lookups have been discussed as a possible way to surface questions before arranging a visit. These checks are not implemented. Their sources, matching rules, interpretation, privacy requirements, and handling of ambiguous results need to be defined before they can be presented as product capabilities.

See [architecture](ARCHITECTURE.md), [development setup](DEVELOPMENT.md), and [privacy and safety](PRIVACY_AND_SAFETY.md) for technical and data boundaries.
