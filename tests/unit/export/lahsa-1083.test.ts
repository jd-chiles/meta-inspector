import { describe, expect, it } from "vitest";

import {
  createUnreviewedEvaluatorDecisions,
  MOVE_IN_READY_ELEMENT_IDS,
  MOVE_IN_READY_SCHEMA_VERSION,
  type EvaluatorDecisionSet,
  type EvaluatorSignoff,
  type EvidenceReference,
  type MoveInReadyElementId,
} from "../../../src/domain/move-in-ready";
import {
  buildLahsa1083Json,
  deriveLahsaDetermination,
  LAHSA_1083_MAPPING_NOTICE,
  type Lahsa1083JsonInput,
  type LahsaChecklistCriteria,
  type ParticipantSignoff,
} from "../../../src/export/lahsa-1083";

const SIGNED_AT = "2026-10-29T09:15:00.000Z";

const STAFF_SIGNOFF: EvaluatorSignoff = {
  evaluatorName: "Demo Evaluator",
  typedSignature: "Demo Evaluator",
  attested: true,
  signedAt: SIGNED_AT,
};

const PARTICIPANT_SIGNOFF: ParticipantSignoff = {
  participantName: "Demo Participant",
  typedSignature: "Demo Participant",
  attested: true,
  signedAt: SIGNED_AT,
};

const EVIDENCE: EvidenceReference = {
  schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
  catalogVersion: "0.3.0-demo.3",
  videoId: "video-demo-kitchen",
  videoRevision: 1,
  roomId: "kitchen",
  stillId: "still-demo-kitchen-12000",
  frameIndex: null,
  timestampMs: 12_000,
  stillHash: "a".repeat(64),
};

function approvedDecisions(): EvaluatorDecisionSet {
  const decisions = createUnreviewedEvaluatorDecisions();
  for (const elementId of MOVE_IN_READY_ELEMENT_IDS) {
    decisions[elementId] = {
      status: "A",
      evaluatorName: "Demo Evaluator",
      decidedAt: SIGNED_AT,
      inPersonCheckAcknowledgment: {
        evaluatorName: "Demo Evaluator",
        completedAt: SIGNED_AT,
      },
      rationale: "Checked in person in the staged unit.",
      evidence: [],
      analysisIdentity: null,
      ...(elementId === "demo-smoke-co"
        ? { fireSafetyAssessment: { unitDetectors: "A" as const, publicAreaDetectors: "A" as const } }
        : {}),
    };
  }
  return decisions;
}

function deficientDecision(elementId: MoveInReadyElementId): EvaluatorDecisionSet[MoveInReadyElementId] {
  return {
    status: "D",
    evaluatorName: "Demo Evaluator",
    decidedAt: SIGNED_AT,
    inPersonCheckAcknowledgment: {
      evaluatorName: "Demo Evaluator",
      completedAt: SIGNED_AT,
    },
    rationale: "Deficiency confirmed in person.",
    evidence: [{ ...EVIDENCE }],
    analysisIdentity: null,
    ...(elementId === "demo-smoke-co"
      ? { fireSafetyAssessment: { unitDetectors: "D" as const, publicAreaDetectors: "A" as const } }
      : {}),
    deficiency: {
      issueDescription: "Staged issue observed in person.",
      correction: "Correct the staged issue.",
      completionDate: "2026-11-02",
      reinspectionDate: "2026-11-05",
    },
  };
}

function inputFor(overrides: Partial<Lahsa1083JsonInput> = {}): Lahsa1083JsonInput {
  return {
    sessionId: "demo-session-001",
    fundingType: "lahsa",
    decisions: approvedDecisions(),
    signoff: { ...STAFF_SIGNOFF },
    participantSignoff: { ...PARTICIPANT_SIGNOFF },
    generatedAt: SIGNED_AT,
    ...overrides,
  };
}

describe("LAHSA-schema JSON export", () => {
  it("maps an all-approved record to true criteria and APPROVED", () => {
    const json = buildLahsa1083Json(inputFor());
    expect(json.inspection_id).toBe("demo-session-001");
    expect(json.inspection_timestamp).toBe(SIGNED_AT);
    expect(json.checklist_criteria).toEqual({
      structure_materials: true,
      space_security: true,
      interior_air_quality: true,
      water_supply: true,
      sanitary_facilities: true,
      thermal_environment: true,
      illumination_electricity: true,
      food_preparation: true,
      sanitary_condition: true,
      additional_standards: true,
      fire_safety: {
        emergency_exit: true,
        unit_smoke_detectors: true,
        common_area_detectors: true,
        visual_alarms_required: false,
        visual_alarms_approved: null,
      },
    });
    expect(json.overall_determination).toBe("APPROVED");
    expect(json.signatures).toEqual({
      participant_signature: {
        name: "Demo Participant",
        signature: "Demo Participant",
        timestamp: SIGNED_AT,
      },
      staff_signature: {
        name: "Demo Evaluator",
        signature: "Demo Evaluator",
        timestamp: SIGNED_AT,
      },
    });
    expect(json.mapping_notice).toBe(LAHSA_1083_MAPPING_NOTICE);
    expect(json.mapping_notice).toBe("Demo checklist — not a verified Form 1083 mapping.");
  });

  it.each([
    ["demo-item-05", "structure_materials"],
    ["demo-item-07", "space_security"],
    ["demo-interior-air", "interior_air_quality"],
    ["demo-water-supply", "water_supply"],
    ["demo-item-08", "sanitary_facilities"],
    ["demo-item-09", "thermal_environment"],
    ["demo-lighting-electric", "illumination_electricity"],
    ["demo-item-10", "food_preparation"],
    ["demo-item-11", "sanitary_condition"],
  ] as const)("maps %s D to %s false and NOT APPROVED", (elementId, criterion) => {
    const decisions = approvedDecisions();
    decisions[elementId] = deficientDecision(elementId);
    const json = buildLahsa1083Json(inputFor({ decisions }));
    expect(json.checklist_criteria[criterion]).toBe(false);
    expect(json.overall_determination).toBe("NOT APPROVED");
  });

  it("maps an Access D to emergency_exit false", () => {
    const decisions = approvedDecisions();
    decisions["demo-item-06"] = deficientDecision("demo-item-06");
    const json = buildLahsa1083Json(inputFor({ decisions }));
    expect(json.checklist_criteria.fire_safety.emergency_exit).toBe(false);
    expect(json.overall_determination).toBe("NOT APPROVED");
  });

  it("maps Fire safety 11a/11b outcomes to detector subfields and the aggregate to additional_standards", () => {
    const unitOnly = approvedDecisions();
    unitOnly["demo-smoke-co"] = deficientDecision("demo-smoke-co");
    const unitJson = buildLahsa1083Json(inputFor({ decisions: unitOnly }));
    expect(unitJson.checklist_criteria.fire_safety).toMatchObject({
      unit_smoke_detectors: false,
      common_area_detectors: true,
    });
    expect(unitJson.checklist_criteria.additional_standards).toBe(false);
    expect(unitJson.overall_determination).toBe("NOT APPROVED");

    const publicOnly = approvedDecisions();
    const fireD = deficientDecision("demo-smoke-co");
    if (fireD.status !== "D") throw new Error("Test setup requires a D decision.");
    fireD.fireSafetyAssessment = { unitDetectors: "A", publicAreaDetectors: "D" };
    publicOnly["demo-smoke-co"] = fireD;
    const publicJson = buildLahsa1083Json(inputFor({ decisions: publicOnly }));
    expect(publicJson.checklist_criteria.fire_safety).toMatchObject({
      unit_smoke_detectors: true,
      common_area_detectors: false,
    });
    expect(publicJson.overall_determination).toBe("NOT APPROVED");
  });

  it("derives visual_alarms_approved from the REQ-F2 flag and the Fire safety decision", () => {
    const flagOnApproved = buildLahsa1083Json(inputFor({ participantVisualAlarmsRequired: true }));
    expect(flagOnApproved.checklist_criteria.fire_safety).toMatchObject({
      visual_alarms_required: true,
      visual_alarms_approved: true,
    });
    expect(flagOnApproved.overall_determination).toBe("APPROVED");

    const decisions = approvedDecisions();
    decisions["demo-smoke-co"] = deficientDecision("demo-smoke-co");
    const flagOnDeficient = buildLahsa1083Json(inputFor({ decisions, participantVisualAlarmsRequired: true }));
    expect(flagOnDeficient.checklist_criteria.fire_safety).toMatchObject({
      visual_alarms_required: true,
      visual_alarms_approved: false,
    });
    expect(flagOnDeficient.overall_determination).toBe("NOT APPROVED");
  });

  it("derives the determination from the emitted criteria, never independently", () => {
    const approved = buildLahsa1083Json(inputFor()).checklist_criteria;
    expect(deriveLahsaDetermination(approved)).toBe("APPROVED");
    const withNullVisual: LahsaChecklistCriteria = {
      ...approved,
      fire_safety: { ...approved.fire_safety, visual_alarms_approved: null },
    };
    expect(deriveLahsaDetermination(withNullVisual)).toBe("APPROVED");
    const withFailedVisual: LahsaChecklistCriteria = {
      ...approved,
      fire_safety: { ...approved.fire_safety, visual_alarms_required: true, visual_alarms_approved: false },
    };
    expect(deriveLahsaDetermination(withFailedVisual)).toBe("NOT APPROVED");
    const withFailedExit: LahsaChecklistCriteria = {
      ...approved,
      fire_safety: { ...approved.fire_safety, emergency_exit: false },
    };
    expect(deriveLahsaDetermination(withFailedExit)).toBe("NOT APPROVED");
  });

  it("emits unheld fields as null instead of inventing them", () => {
    const json = buildLahsa1083Json(inputFor());
    expect(json.property_address).toBeNull();
    expect(json.participant_hmis_id).toBeNull();
    expect(json.staff_hmis_id).toBeNull();
  });

  it.each([
    ["non-LAHSA funding", { fundingType: "unknown" as const }],
    ["HUD funding", { fundingType: "hud" as const }],
    ["missing participant co-signature", { participantSignoff: null as unknown as ParticipantSignoff }],
    ["unattested participant co-signature", { participantSignoff: { ...PARTICIPANT_SIGNOFF, attested: false } }],
    ["mismatched participant signature", { participantSignoff: { ...PARTICIPANT_SIGNOFF, typedSignature: "Someone Else" } }],
    ["invalid staff sign-off", { signoff: { ...STAFF_SIGNOFF, typedSignature: "Someone Else" } }],
  ])("blocks export for %s", (_caseName, override) => {
    expect(() => buildLahsa1083Json(inputFor(override))).toThrow();
  });

  it("treats needs-human-check and unreviewed decisions as incomplete", () => {
    const needsCheck = approvedDecisions();
    needsCheck["demo-item-11"] = { status: "needs-human-check", note: "Needs an in-person check." };
    expect(() => buildLahsa1083Json(inputFor({ decisions: needsCheck }))).toThrow(/incomplete/i);

    const unreviewed = approvedDecisions();
    unreviewed["demo-item-11"] = { status: "unreviewed" };
    expect(() => buildLahsa1083Json(inputFor({ decisions: unreviewed }))).toThrow();
  });
});
