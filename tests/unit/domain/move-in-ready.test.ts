import { describe, expect, it } from "vitest";

import {
  createUnreviewedEvaluatorDecisions,
  deriveFinalInspectionResult,
  EVALUATOR_ATTESTATION_TEXT,
  MOVE_IN_READY_ELEMENTS,
  MOVE_IN_READY_ELEMENT_IDS,
  MOVE_IN_READY_ROOMS,
  MOVE_IN_READY_SCHEMA_VERSION,
  validateEvidenceReference,
  validateEvaluatorDecision,
  validateEvaluatorSignoff,
  validateVideoAnalysisIdentity,
  validateModelProposalSet,
  type EvidenceReference,
  type EvaluatorDecisionSet,
  type VideoAnalysisIdentity,
} from "../../../src/domain/move-in-ready";

const EVIDENCE: EvidenceReference = {
  schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
  catalogVersion: "0.3.0-demo.3",
  videoId: "video-kitchen-1",
  videoRevision: 1,
  roomId: "kitchen",
  stillId: "still-kitchen-12s",
  timestampMs: 12_000,
  frameIndex: 240,
  stillHash: "a".repeat(64),
};

const ANALYSIS_IDENTITY: VideoAnalysisIdentity = {
  sessionId: "session-1",
  roomId: "kitchen",
  schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
  videoId: EVIDENCE.videoId,
  videoRevision: EVIDENCE.videoRevision,
  expectedSourceHash: "b".repeat(64),
  analysisId: "analysis-1",
  attempt: 1,
  catalogVersion: "0.3.0-demo.3",
};

const TIMESTAMP = "2026-10-29T09:15:00.000Z";
const IN_PERSON_ACKNOWLEDGMENT = {
  evaluatorName: "Alex Morgan",
  completedAt: TIMESTAMP,
};

function modelResponse(
  overrides: Partial<Record<string, Record<string, unknown>>> = {},
) {
  return {
    proposals: MOVE_IN_READY_ELEMENTS.map((element, index) => ({
      elementId: element.id,
      suggestion: index === 0 ? "D" : "A",
      observation: `Draft observation ${index + 1}`,
      confidence: 87,
      ...(index === 0 ? {
        deficiencySuggestion: {
          deficientArea: "Kitchen sink",
          correction: "Repair the drain and verify water flows freely.",
          completionDate: "2026-11-12",
          reinspectionDate: "2026-11-15",
        },
      } : {}),
      evidenceStillIds: element.id === "demo-water-supply" ? [EVIDENCE.stillId] : [],
      ...overrides[element.id],
    })),
  };
}

function allHumanApproved(): EvaluatorDecisionSet {
  const decisions = createUnreviewedEvaluatorDecisions();
  for (const elementId of MOVE_IN_READY_ELEMENT_IDS) {
    decisions[elementId] = {
      status: "A",
      evaluatorName: "Alex Morgan",
      decidedAt: TIMESTAMP,
      inPersonCheckAcknowledgment: IN_PERSON_ACKNOWLEDGMENT,
      rationale: "I checked this item in person.",
      evidence: [],
      analysisIdentity: null,
      ...(elementId === "demo-smoke-co"
        ? { fireSafetyAssessment: { unitDetectors: "A" as const, publicAreaDetectors: "A" as const } }
        : {}),
    };
  }
  return decisions;
}

const SIGNOFF = {
  evaluatorName: "Alex Morgan",
  typedSignature: "Alex Morgan",
  attested: true,
  signedAt: TIMESTAMP,
};
const CAPTURED_ROOM_IDS = MOVE_IN_READY_ROOMS.map((room) => room.id);

describe("Move-in Ready inspection domain", () => {
  it("defines four capture rooms and the eleven owner-attested elements", () => {
    expect(MOVE_IN_READY_ROOMS).toHaveLength(4);
    expect(MOVE_IN_READY_ROOMS.map((room) => room.id)).toEqual([
      "kitchen",
      "bathroom",
      "bedroom-living",
      "hallway",
    ]);
    expect(MOVE_IN_READY_ELEMENTS).toHaveLength(11);
    expect(new Set(MOVE_IN_READY_ELEMENT_IDS).size).toBe(11);
    expect(MOVE_IN_READY_ELEMENTS.map((element) => element.label)).toEqual([
      "Structure and materials",
      "Access",
      "Space and security",
      "Interior air quality / ventilation",
      "Water supply",
      "Sanitary facilities",
      "Thermal environment",
      "Lighting and electricity",
      "Food preparation and refuse disposal",
      "Sanitary condition",
      "Fire safety",
    ]);
  });

  it("starts with independent, unreviewed human decisions for all elements", () => {
    const decisions = createUnreviewedEvaluatorDecisions();
    expect(Object.keys(decisions)).toEqual(MOVE_IN_READY_ELEMENT_IDS);
    expect(Object.values(decisions).every((item) => item.status === "unreviewed")).toBe(true);
  });

  it("allows unresolved and unreviewed states without an in-person acknowledgment", () => {
    expect(validateEvaluatorDecision({ status: "unreviewed" }).ok).toBe(true);
    expect(validateEvaluatorDecision({
      status: "needs-human-check",
      note: "The faucet was not shown clearly.",
    }).ok).toBe(true);
  });

  it("parses draft suggestions while resolving timestamps and still identity from trusted evidence", () => {
    const result = validateModelProposalSet(modelResponse(), [EVIDENCE], ANALYSIS_IDENTITY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const deficientSuggestion = result.value["demo-item-05"];
    expect(deficientSuggestion.modelSuggestion).toBe("D");
    if (deficientSuggestion.modelSuggestion !== "D") return;
    expect(deficientSuggestion.deficiencySuggestion).toEqual({
      deficientArea: "Kitchen sink",
      correction: "Repair the drain and verify water flows freely.",
      completionDate: "2026-11-12",
      reinspectionDate: "2026-11-15",
    });
    expect(deficientSuggestion.state).toBe("needs-human-check");
    expect(deficientSuggestion.evidence).toEqual([]);

    const water = result.value["demo-water-supply"];
    expect(water.state).toBe("draft-proposal");
    expect(water.evidence).toEqual([EVIDENCE]);
    expect(water.evidence[0].timestampMs).toBe(12_000);
    expect(water.evidence[0].stillId).toBe("still-kitchen-12s");
    expect(water.analysisIdentity).toEqual(ANALYSIS_IDENTITY);

    // Parsing model output creates no human decision and provides no API that
    // can mark the evaluator's review complete.
    expect(createUnreviewedEvaluatorDecisions()["demo-item-05"].status).toBe("unreviewed");
  });

  it("validates bounded SAM frame provenance and explicitly marks local stills", () => {
    expect(validateEvidenceReference({ ...EVIDENCE, frameIndex: null }).ok).toBe(true);
    expect(validateEvidenceReference({ ...EVIDENCE, frameIndex: 14_999 }).ok).toBe(true);
    expect(validateEvidenceReference({ ...EVIDENCE, frameIndex: 15_000 }).ok).toBe(false);
    expect(validateEvidenceReference({ ...EVIDENCE, frameIndex: undefined }).ok).toBe(false);
    expect(validateEvidenceReference({ ...EVIDENCE, schemaVersion: undefined }).ok).toBe(false);
    expect(validateEvidenceReference({ ...EVIDENCE, catalogVersion: undefined }).ok).toBe(false);
  });

  it("requires a complete stable analysis identity before proposals can be persisted", () => {
    expect(validateVideoAnalysisIdentity(ANALYSIS_IDENTITY)).toEqual({
      ok: true,
      value: ANALYSIS_IDENTITY,
    });
    expect(validateVideoAnalysisIdentity({ ...ANALYSIS_IDENTITY, attempt: 0 }).ok).toBe(false);
    expect(validateVideoAnalysisIdentity({ ...ANALYSIS_IDENTITY, unexpected: true }).ok).toBe(false);
    expect(validateVideoAnalysisIdentity({ ...ANALYSIS_IDENTITY, schemaVersion: undefined }).ok).toBe(false);
    expect(validateVideoAnalysisIdentity({ ...ANALYSIS_IDENTITY, catalogVersion: undefined }).ok).toBe(false);
    expect(validateModelProposalSet(modelResponse(), [EVIDENCE], {
      ...ANALYSIS_IDENTITY,
      expectedSourceHash: "not-a-digest",
    }).ok).toBe(false);
    expect(validateModelProposalSet(modelResponse(), [EVIDENCE], {
      ...ANALYSIS_IDENTITY,
      schemaVersion: MOVE_IN_READY_SCHEMA_VERSION - 1,
    }).ok).toBe(false);
    expect(validateModelProposalSet(modelResponse(), [EVIDENCE], {
      ...ANALYSIS_IDENTITY,
      catalogVersion: "older-catalog",
    }).ok).toBe(false);
  });

  it("forces any proposal without evidence to needs-human-check, including an A suggestion", () => {
    const result = validateModelProposalSet(modelResponse(), [EVIDENCE], ANALYSIS_IDENTITY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const proposal of Object.values(result.value)) {
      if (proposal.evidence.length === 0) {
        expect(proposal.state).toBe("needs-human-check");
      }
    }
  });

  it("rejects invented still IDs instead of accepting model-supplied timestamps", () => {
    const result = validateModelProposalSet(
      modelResponse({
        "demo-water-supply": {
          evidenceStillIds: ["model-invented-still"],
        },
      }),
      [EVIDENCE],
      ANALYSIS_IDENTITY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.includes("unknown still ID"))).toBe(true);
    }
  });

  it("rejects malformed, partial, duplicate, or verdict-bearing model responses", () => {
    const partial = validateModelProposalSet(
      { proposals: modelResponse().proposals.slice(0, 10) },
      [EVIDENCE],
      ANALYSIS_IDENTITY,
    );
    expect(partial.ok).toBe(false);

    const duplicateProposals = modelResponse();
    duplicateProposals.proposals[1] = { ...duplicateProposals.proposals[0] };
    expect(validateModelProposalSet(duplicateProposals, [EVIDENCE], ANALYSIS_IDENTITY).ok).toBe(false);

    expect(
      validateModelProposalSet(
        { ...modelResponse(), inspectionResult: "approved" },
        [EVIDENCE],
        ANALYSIS_IDENTITY,
      ).ok,
    ).toBe(false);

    expect(
      validateModelProposalSet(
        modelResponse({ "demo-item-05": { approved: true } }),
        [EVIDENCE],
        ANALYSIS_IDENTITY,
      ).ok,
    ).toBe(false);
  });

  it("requires complete and valid suggested correction dates for a model D proposal", () => {
    const missing = modelResponse();
    delete (missing.proposals[0] as Record<string, unknown>).deficiencySuggestion;
    expect(validateModelProposalSet(missing, [EVIDENCE], ANALYSIS_IDENTITY).ok).toBe(false);

    const reversed = validateModelProposalSet(
      modelResponse({ "demo-item-05": {
        deficiencySuggestion: {
          deficientArea: "Kitchen sink",
          correction: "Repair the drain.",
          completionDate: "2026-11-15",
          reinspectionDate: "2026-11-12",
        },
      } }),
      [EVIDENCE],
      ANALYSIS_IDENTITY,
    );
    expect(reversed.ok).toBe(false);
    if (!reversed.ok) expect(reversed.errors.join(" ")).toContain("cannot precede");

    const verdictLike = validateModelProposalSet(
      modelResponse({ "demo-item-05": {
        deficiencySuggestion: {
          deficientArea: "Kitchen sink",
          correction: "Repair the drain.",
          completionDate: "2026-11-12",
          reinspectionDate: "2026-11-15",
          approved: true,
        },
      } }),
      [EVIDENCE],
      ANALYSIS_IDENTITY,
    );
    expect(verdictLike.ok).toBe(false);
  });

  it("rejects evidence from a room that is not relevant to the element", () => {
    const bathroomStill: EvidenceReference = {
      ...EVIDENCE,
      roomId: "bathroom",
      stillId: "still-bathroom-12s",
    };
    const result = validateModelProposalSet(
      modelResponse({ "demo-item-10": { evidenceStillIds: [bathroomStill.stillId] } }),
      [EVIDENCE, bathroomStill],
      ANALYSIS_IDENTITY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.includes("unrelated room"))).toBe(true);
    }
  });

  it("requires a D decision to include evidence, a correction, and a real due date", () => {
    const incomplete = validateEvaluatorDecision({
      status: "D",
      evaluatorName: "Alex Morgan",
      decidedAt: TIMESTAMP,
      inPersonCheckAcknowledgment: IN_PERSON_ACKNOWLEDGMENT,
      rationale: "The sink does not drain.",
      evidence: [],
      analysisIdentity: null,
      deficiency: {
        issueDescription: "Sink does not drain.",
        correction: "",
        completionDate: "2026-02-31",
        reinspectionDate: "2026-02-31",
      },
    });
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) {
      expect(incomplete.errors.join(" ")).toContain("evidence still");
      expect(incomplete.errors.join(" ")).toContain("correction");
      expect(incomplete.errors.join(" ")).toContain("completionDate");
      expect(incomplete.errors.join(" ")).toContain("reinspectionDate");
    }

    const valid = validateEvaluatorDecision({
      status: "D",
      evaluatorName: "Alex Morgan",
      decidedAt: TIMESTAMP,
      inPersonCheckAcknowledgment: IN_PERSON_ACKNOWLEDGMENT,
      rationale: "The sink does not drain.",
      evidence: [EVIDENCE],
      analysisIdentity: null,
      deficiency: {
        issueDescription: "Sink does not drain.",
        correction: "Repair the drain and confirm water flows freely.",
        completionDate: "2026-11-12",
        reinspectionDate: "2026-11-15",
      },
    });
    expect(valid.ok).toBe(true);
  });

  it("requires reinspection to be scheduled on or after completion", () => {
    const result = validateEvaluatorDecision({
      status: "D",
      evaluatorName: "Alex Morgan",
      decidedAt: TIMESTAMP,
      inPersonCheckAcknowledgment: IN_PERSON_ACKNOWLEDGMENT,
      rationale: "The sink does not drain.",
      evidence: [EVIDENCE],
      analysisIdentity: null,
      deficiency: {
        issueDescription: "Sink does not drain.",
        correction: "Repair and retest the drain.",
        completionDate: "2026-11-12",
        reinspectionDate: "2026-11-11",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("cannot precede completionDate");
    }
  });

  it("requires a current in-person acknowledgment for A and D decisions", () => {
    const approved = {
      status: "A",
      evaluatorName: "Alex Morgan",
      decidedAt: TIMESTAMP,
      rationale: "I checked this item in person.",
      evidence: [],
      analysisIdentity: null,
    };
    expect(validateEvaluatorDecision(approved).ok).toBe(false);

    const acknowledged = validateEvaluatorDecision({
      ...approved,
      inPersonCheckAcknowledgment: IN_PERSON_ACKNOWLEDGMENT,
    });
    expect(acknowledged).toEqual({
      ok: true,
      value: {
        ...approved,
        inPersonCheckAcknowledgment: IN_PERSON_ACKNOWLEDGMENT,
      },
    });

    const deficient = {
      status: "D",
      evaluatorName: "Alex Morgan",
      decidedAt: TIMESTAMP,
      rationale: "The sink does not drain.",
      evidence: [EVIDENCE],
      analysisIdentity: null,
      deficiency: {
        issueDescription: "Sink does not drain.",
        correction: "Repair and retest the drain.",
        completionDate: "2026-11-12",
        reinspectionDate: "2026-11-15",
      },
    };
    expect(validateEvaluatorDecision(deficient).ok).toBe(false);
  });

  it("requires independent section 11a and 11b evaluator outcomes for Fire Safety", () => {
    const fireSafetyDecision = {
      status: "A",
      evaluatorName: "Alex Morgan",
      decidedAt: TIMESTAMP,
      inPersonCheckAcknowledgment: IN_PERSON_ACKNOWLEDGMENT,
      rationale: "I checked both Fire Safety clauses in person.",
      evidence: [],
      analysisIdentity: null,
    };
    expect(validateEvaluatorDecision(fireSafetyDecision, "demo-smoke-co").ok).toBe(false);

    const bothPass = validateEvaluatorDecision({
      ...fireSafetyDecision,
      fireSafetyAssessment: { unitDetectors: "A", publicAreaDetectors: "A" },
    }, "demo-smoke-co");
    expect(bothPass.ok).toBe(true);
    if (bothPass.ok && bothPass.value.status === "A") {
      expect(bothPass.value.fireSafetyAssessment).toEqual({
        unitDetectors: "A",
        publicAreaDetectors: "A",
      });
      const decisions = allHumanApproved();
      decisions["demo-smoke-co"] = bothPass.value;
      expect(deriveFinalInspectionResult({
        fundingType: "lahsa",
        capturedRoomIds: CAPTURED_ROOM_IDS,
        evaluatorDecisions: decisions,
        signoff: null,
      }).status).toBe("signoff-required");
    }

    const conflictingAggregate = validateEvaluatorDecision({
      ...fireSafetyDecision,
      fireSafetyAssessment: { unitDetectors: "D", publicAreaDetectors: "A" },
    }, "demo-smoke-co");
    expect(conflictingAggregate.ok).toBe(false);

    const unknownClause = validateEvaluatorDecision({
      status: "needs-human-check",
      note: "The public area needs an in-person check.",
      fireSafetyAssessment: { unitDetectors: "A", publicAreaDetectors: "needs-human-check" },
    }, "demo-smoke-co");
    expect(unknownClause.ok).toBe(true);
  });

  it("accepts a Fire Safety D when either clause is deficient and derives not-approved", () => {
    const fireDeficient = validateEvaluatorDecision({
      status: "D",
      evaluatorName: "Alex Morgan",
      decidedAt: TIMESTAMP,
      inPersonCheckAcknowledgment: IN_PERSON_ACKNOWLEDGMENT,
      rationale: "The unit detector is missing; I checked in person.",
      evidence: [EVIDENCE],
      analysisIdentity: null,
      deficiency: {
        issueDescription: "Unit smoke detector is missing.",
        correction: "Install a working smoke detector and verify it sounds.",
        completionDate: "2026-11-12",
        reinspectionDate: "2026-11-15",
      },
      fireSafetyAssessment: { unitDetectors: "D", publicAreaDetectors: "A" },
    }, "demo-smoke-co");
    expect(fireDeficient.ok).toBe(true);
    if (!fireDeficient.ok) return;
    expect(fireDeficient.value.status).toBe("D");
    if (fireDeficient.value.status !== "D") return;
    expect(fireDeficient.value.fireSafetyAssessment).toEqual({
      unitDetectors: "D",
      publicAreaDetectors: "A",
    });
    const decisions = allHumanApproved();
    decisions["demo-smoke-co"] = fireDeficient.value;
    const derived = deriveFinalInspectionResult({
      fundingType: "lahsa",
      capturedRoomIds: CAPTURED_ROOM_IDS,
      evaluatorDecisions: decisions,
      signoff: SIGNOFF,
    });
    expect(derived.status).toBe("complete");
    expect(derived.result).toBe("not-approved");
  });

  it("rejects acknowledgments from another evaluator or after the decision", () => {
    const decision = {
      status: "A",
      evaluatorName: "Alex Morgan",
      decidedAt: TIMESTAMP,
      inPersonCheckAcknowledgment: IN_PERSON_ACKNOWLEDGMENT,
      rationale: "I checked this item in person.",
      evidence: [],
      analysisIdentity: null,
    };
    expect(validateEvaluatorDecision({
      ...decision,
      inPersonCheckAcknowledgment: { ...IN_PERSON_ACKNOWLEDGMENT, evaluatorName: "Jordan Lee" },
    }).ok).toBe(false);
    expect(validateEvaluatorDecision({
      ...decision,
      inPersonCheckAcknowledgment: { ...IN_PERSON_ACKNOWLEDGMENT, completedAt: "not a timestamp" },
    }).ok).toBe(false);
    const futureAcknowledgment = validateEvaluatorDecision({
      ...decision,
      inPersonCheckAcknowledgment: {
        ...IN_PERSON_ACKNOWLEDGMENT,
        completedAt: "2026-10-29T09:16:00.000Z",
      },
    });
    expect(futureAcknowledgment.ok).toBe(false);
    if (!futureAcknowledgment.ok) {
      expect(futureAcknowledgment.errors.join(" ")).toContain("later than decidedAt");
    }
  });

  it("rejects an AI-like evaluator decision with an extra model suggestion field", () => {
    const result = validateEvaluatorDecision({
      status: "A",
      evaluatorName: "Alex Morgan",
      decidedAt: TIMESTAMP,
      inPersonCheckAcknowledgment: IN_PERSON_ACKNOWLEDGMENT,
      rationale: "I checked this item in person.",
      evidence: [],
      analysisIdentity: null,
      modelSuggestion: "A",
    });
    expect(result.ok).toBe(false);
  });

  it("requires a typed signature that matches the evaluator and explicit attestation", () => {
    expect(EVALUATOR_ATTESTATION_TEXT).toContain("AI suggestions are not my decisions");
    expect(EVALUATOR_ATTESTATION_TEXT).toContain("to the best of my ability");
    expect(validateEvaluatorSignoff(SIGNOFF).ok).toBe(true);
    expect(
      validateEvaluatorSignoff({ ...SIGNOFF, typedSignature: "Someone Else" }).ok,
    ).toBe(false);
    expect(validateEvaluatorSignoff({ ...SIGNOFF, attested: false }).ok).toBe(false);
    expect(validateEvaluatorSignoff({ ...SIGNOFF, signedAt: "yesterday" }).ok).toBe(false);
  });

  it("does not derive an inspection outcome from model proposals or unreviewed elements", () => {
    const result = deriveFinalInspectionResult({
      fundingType: "lahsa",
      capturedRoomIds: CAPTURED_ROOM_IDS,
      evaluatorDecisions: createUnreviewedEvaluatorDecisions(),
      signoff: SIGNOFF,
    });
    expect(result.status).toBe("review-incomplete");
    expect(result.result).toBeNull();
    expect(result.blockers[0]).toBe(
      "Structure and materials: evaluator decision is required.",
    );
  });

  it("derives Approved only after every evaluator marks A and signs", () => {
    const result = deriveFinalInspectionResult({
      fundingType: "lahsa",
      capturedRoomIds: CAPTURED_ROOM_IDS,
      evaluatorDecisions: allHumanApproved(),
      signoff: SIGNOFF,
    });
    expect(result).toEqual({ status: "complete", result: "approved", blockers: [] });
  });

  it("requires a saved video for every required room before completion", () => {
    const capturedRoomIds = CAPTURED_ROOM_IDS.filter((roomId) => roomId !== "hallway");
    const result = deriveFinalInspectionResult({
      fundingType: "lahsa",
      capturedRoomIds,
      evaluatorDecisions: allHumanApproved(),
      signoff: SIGNOFF,
    });

    expect(result.status).toBe("capture-incomplete");
    expect(result.result).toBeNull();
    expect(result.blockers).toEqual([
      "Hallway: a room video is required before sign-off.",
    ]);
  });

  it("requires sign-off identity to match the evaluator recorded on every decision", () => {
    const result = deriveFinalInspectionResult({
      fundingType: "lahsa",
      capturedRoomIds: CAPTURED_ROOM_IDS,
      evaluatorDecisions: allHumanApproved(),
      signoff: {
        ...SIGNOFF,
        evaluatorName: "Jordan Lee",
        typedSignature: "Jordan Lee",
      },
    });

    expect(result.status).toBe("signoff-required");
    expect(result.result).toBeNull();
    expect(result.blockers[0]).toContain("sign-off must match the evaluator recorded");
  });

  it("derives Not Approved only from an evaluator D decision after sign-off", () => {
    const decisions = allHumanApproved();
    decisions["demo-water-supply"] = {
      status: "D",
      evaluatorName: "Alex Morgan",
      decidedAt: TIMESTAMP,
      inPersonCheckAcknowledgment: IN_PERSON_ACKNOWLEDGMENT,
      rationale: "The sink does not drain.",
      evidence: [EVIDENCE],
      analysisIdentity: null,
      deficiency: {
        issueDescription: "Sink does not drain.",
        correction: "Repair and retest the drain.",
        completionDate: "2026-11-12",
        reinspectionDate: "2026-11-15",
      },
    };
    const result = deriveFinalInspectionResult({
      fundingType: "lahsa",
      capturedRoomIds: CAPTURED_ROOM_IDS,
      evaluatorDecisions: decisions,
      signoff: SIGNOFF,
    });
    expect(result.result).toBe("not-approved");
    expect(result.status).toBe("complete");
  });

  it("requires all human decisions and sign-off before a result is final", () => {
    const decisions = allHumanApproved();
    decisions["demo-water-supply"] = {
      status: "needs-human-check",
      note: "The faucet was not shown clearly.",
    };
    const unresolved = deriveFinalInspectionResult({
      fundingType: "lahsa",
      capturedRoomIds: CAPTURED_ROOM_IDS,
      evaluatorDecisions: decisions,
      signoff: SIGNOFF,
    });
    expect(unresolved.status).toBe("review-incomplete");
    expect(unresolved.result).toBeNull();
    expect(unresolved.blockers).toContain(
      "Water supply: human check is still required.",
    );

    const unsigned = deriveFinalInspectionResult({
      fundingType: "lahsa",
      capturedRoomIds: CAPTURED_ROOM_IDS,
      evaluatorDecisions: allHumanApproved(),
      signoff: null,
    });
    expect(unsigned.status).toBe("signoff-required");
    expect(unsigned.result).toBeNull();
  });

  it("blocks unknown funding and HUD funding from LAHSA completion", () => {
    const decisions = allHumanApproved();
    expect(
      deriveFinalInspectionResult({
        fundingType: "unknown",
        capturedRoomIds: CAPTURED_ROOM_IDS,
        evaluatorDecisions: decisions,
        signoff: SIGNOFF,
      }).status,
    ).toBe("funding-required");

    const hud = deriveFinalInspectionResult({
      fundingType: "hud",
      capturedRoomIds: CAPTURED_ROOM_IDS,
      evaluatorDecisions: decisions,
      signoff: SIGNOFF,
    });
    expect(hud.status).toBe("hqs-branch-required");
    expect(hud.result).toBeNull();
    expect(hud.blockers[0]).toContain("HQS");
  });
});
