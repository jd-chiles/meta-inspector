/**
 * LAHSA-schema JSON export (REQ-E1).
 *
 * Builds the program-data-specification JSON for a completed walkthrough:
 * per-criterion booleans, a nested fire-safety block, a derived overall
 * determination, and both signatures. Fields this app does not hold
 * (address, HMIS ids) are emitted as null — never invented.
 *
 * Cross-sprint contracts (Sprint 1 owns the canonical definitions):
 * - `ParticipantSignoff` / `validateParticipantSignoff` are imported from
 *   `src/domain/move-in-ready.ts` (REQ-F1).
 * - `participantVisualAlarmsRequired` is the REQ-F2 record flag; callers
 *   pass it explicitly (default false).
 * - `property_address` carries Sprint 3's (REQ-L3) recorded
 *   `{ geolocation }`, or null when no location was captured.
 */

import {
  MOVE_IN_READY_ELEMENT_IDS,
  validateEvaluatorDecision,
  validateEvaluatorSignoff,
  validateInspectionLocation,
  validateParticipantSignoff,
  type EvaluatorDecisionSet,
  type EvaluatorSignoff,
  type FundingType,
  type InspectionLocation,
  type MoveInReadyElementId,
  type ParticipantSignoff,
} from "../domain/move-in-ready";

/** REQ-F1 canonical participant co-signature (Sprint 1). */
export type { ParticipantSignoff } from "../domain/move-in-ready";

export interface Lahsa1083JsonInput {
  sessionId: string;
  fundingType: FundingType;
  decisions: EvaluatorDecisionSet;
  /** Staff signature: the evaluator sign-off. */
  signoff: EvaluatorSignoff;
  /** REQ-F1 participant co-signature (record field `participantSignoff`). */
  participantSignoff: ParticipantSignoff;
  /** REQ-F2 flag (record field `participantVisualAlarmsRequired`). */
  participantVisualAlarmsRequired?: boolean;
  /** REQ-L3 recorded location (record field `inspectionLocation`); null when uncaptured. */
  inspectionLocation?: InspectionLocation | null;
  /** `inspection_timestamp` override; defaults to the current time. */
  generatedAt?: string;
}

export type LahsaCriterionKey =
  | "structure_materials"
  | "space_security"
  | "interior_air_quality"
  | "water_supply"
  | "sanitary_facilities"
  | "thermal_environment"
  | "illumination_electricity"
  | "food_preparation"
  | "sanitary_condition"
  | "additional_standards";

export type LahsaDetermination = "APPROVED" | "NOT APPROVED";

export interface LahsaFireSafety {
  emergency_exit: boolean;
  unit_smoke_detectors: boolean;
  common_area_detectors: boolean;
  visual_alarms_required: boolean;
  visual_alarms_approved: boolean | null;
}

export type LahsaChecklistCriteria = Record<LahsaCriterionKey, boolean> & {
  fire_safety: LahsaFireSafety;
};

export interface Lahsa1083Json {
  inspection_id: string;
  inspection_timestamp: string;
  /** Recorded GPS attestation (REQ-L3); null when no location was captured. */
  property_address: { geolocation: InspectionLocation } | null;
  participant_hmis_id: null;
  staff_hmis_id: null;
  checklist_criteria: LahsaChecklistCriteria;
  overall_determination: LahsaDetermination;
  signatures: {
    participant_signature: { name: string; signature: string; timestamp: string };
    staff_signature: { name: string; signature: string; timestamp: string };
  };
  mapping_notice: string;
}

export const LAHSA_1083_MAPPING_NOTICE =
  "Demo checklist — not a verified Form 1083 mapping.";

/**
 * Element-to-criterion mapping. Access feeds `fire_safety.emergency_exit`
 * and Fire safety feeds the detector subfields; `additional_standards`
 * carries the aggregate Fire safety decision so every boolean key stays a
 * direct A → true / D → false derivation with no invented source.
 */
const CRITERION_BY_ELEMENT: Record<MoveInReadyElementId, LahsaCriterionKey | "fire_safety_nest" | "access_nest"> = {
  "demo-item-05": "structure_materials",
  "demo-item-06": "access_nest",
  "demo-item-07": "space_security",
  "demo-interior-air": "interior_air_quality",
  "demo-water-supply": "water_supply",
  "demo-item-08": "sanitary_facilities",
  "demo-item-09": "thermal_environment",
  "demo-lighting-electric": "illumination_electricity",
  "demo-item-10": "food_preparation",
  "demo-item-11": "sanitary_condition",
  "demo-smoke-co": "fire_safety_nest",
};

/** APPROVED only when every emitted criterion boolean is true. */
export function deriveLahsaDetermination(criteria: LahsaChecklistCriteria): LahsaDetermination {
  const topLevel: LahsaCriterionKey[] = [
    "structure_materials",
    "space_security",
    "interior_air_quality",
    "water_supply",
    "sanitary_facilities",
    "thermal_environment",
    "illumination_electricity",
    "food_preparation",
    "sanitary_condition",
    "additional_standards",
  ];
  const fire = criteria.fire_safety;
  const fireOk =
    fire.emergency_exit === true &&
    fire.unit_smoke_detectors === true &&
    fire.common_area_detectors === true &&
    (fire.visual_alarms_approved === null || fire.visual_alarms_approved === true);
  const allOk = topLevel.every((key) => criteria[key] === true) && fireOk;
  return allOk ? "APPROVED" : "NOT APPROVED";
}

function cleanText(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 80) || "inspection";
}

function isValidDateTime(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

/**
 * Build the LAHSA-schema JSON. Gates: LAHSA funding, a completed A/D
 * decision for every element (needs-human-check and unreviewed block),
 * and both signatures. Throws with honest copy otherwise.
 */
export function buildLahsa1083Json(input: Lahsa1083JsonInput): Lahsa1083Json {
  if (input.fundingType !== "lahsa") {
    throw new Error("Only the LAHSA workflow can create the LAHSA JSON export.");
  }
  const staffSignoff = validateEvaluatorSignoff(input.signoff);
  if (!staffSignoff.ok) {
    throw new Error("Evaluator sign-off is required before the LAHSA JSON export.");
  }
  if (!validateParticipantSignoff(input.participantSignoff).ok) {
    throw new Error("Participant co-signature is required before the LAHSA JSON export.");
  }
  let propertyAddress: Lahsa1083Json["property_address"] = null;
  if (input.inspectionLocation !== undefined && input.inspectionLocation !== null) {
    const parsedLocation = validateInspectionLocation(input.inspectionLocation);
    if (!parsedLocation.ok) {
      throw new Error("The recorded inspection location is invalid; re-capture it before the LAHSA JSON export.");
    }
    propertyAddress = { geolocation: parsedLocation.value };
  }
  const timestamp = input.generatedAt ?? new Date().toISOString();
  if (!isValidDateTime(timestamp)) {
    throw new Error("The LAHSA JSON export requires a valid inspection timestamp.");
  }

  const criteria = {} as Record<LahsaCriterionKey, boolean>;
  let accessApproved: boolean | null = null;
  let fireApproved: boolean | null = null;
  let unitDetectors: boolean | null = null;
  let publicAreaDetectors: boolean | null = null;

  for (const elementId of MOVE_IN_READY_ELEMENT_IDS) {
    const parsed = validateEvaluatorDecision(input.decisions[elementId], elementId);
    if (!parsed.ok || (parsed.value.status !== "A" && parsed.value.status !== "D")) {
      throw new Error(
        "Every element must have a completed evaluator decision before the LAHSA JSON export; needs-human-check counts as incomplete.",
      );
    }
    const approved = parsed.value.status === "A";
    const slot = CRITERION_BY_ELEMENT[elementId];
    if (slot === "access_nest") {
      accessApproved = approved;
    } else if (slot === "fire_safety_nest") {
      fireApproved = approved;
      const assessment = parsed.value.status === "A" || parsed.value.status === "D"
        ? parsed.value.fireSafetyAssessment
        : undefined;
      if (!assessment) {
        throw new Error("Fire safety requires separate section 11a and 11b outcomes before export.");
      }
      unitDetectors = assessment.unitDetectors === "A";
      publicAreaDetectors = assessment.publicAreaDetectors === "A";
    } else {
      criteria[slot] = approved;
    }
  }
  if (accessApproved === null || fireApproved === null || unitDetectors === null || publicAreaDetectors === null) {
    throw new Error("Every element must have a completed evaluator decision before the LAHSA JSON export.");
  }
  criteria.additional_standards = fireApproved;

  const visualAlarmsRequired = input.participantVisualAlarmsRequired === true;
  const checklist_criteria: LahsaChecklistCriteria = {
    ...criteria,
    fire_safety: {
      emergency_exit: accessApproved,
      unit_smoke_detectors: unitDetectors,
      common_area_detectors: publicAreaDetectors,
      visual_alarms_required: visualAlarmsRequired,
      visual_alarms_approved: visualAlarmsRequired ? fireApproved : null,
    },
  };

  const overall_determination = deriveLahsaDetermination(checklist_criteria);

  const json: Lahsa1083Json = {
    inspection_id: safeIdentifier(input.sessionId),
    inspection_timestamp: timestamp,
    property_address: propertyAddress,
    participant_hmis_id: null,
    staff_hmis_id: null,
    checklist_criteria,
    overall_determination,
    signatures: {
      participant_signature: {
        name: cleanText(input.participantSignoff.participantName, 120),
        signature: cleanText(input.participantSignoff.typedSignature, 120),
        timestamp: input.participantSignoff.signedAt,
      },
      staff_signature: {
        name: cleanText(staffSignoff.value.evaluatorName, 120),
        signature: cleanText(staffSignoff.value.typedSignature, 120),
        timestamp: staffSignoff.value.signedAt,
      },
    },
    mapping_notice: LAHSA_1083_MAPPING_NOTICE,
  };

  // Internal assertion: the emitted determination must match a fresh
  // derivation from the emitted criteria, so an inconsistent export is
  // impossible even if this builder is edited later.
  if (deriveLahsaDetermination(json.checklist_criteria) !== json.overall_determination) {
    throw new Error("The LAHSA JSON determination does not match its checklist criteria.");
  }
  return json;
}
