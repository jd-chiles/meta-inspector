import { describe, expect, it } from "vitest";

import {
  createUnreviewedEvaluatorDecisions,
  MOVE_IN_READY_ELEMENTS,
  MOVE_IN_READY_ELEMENT_IDS,
  MOVE_IN_READY_SCHEMA_VERSION,
  type EvaluatorDecisionSet,
  type EvidenceReference,
  type MoveInReadyElementId,
} from "../../../src/domain/move-in-ready";
import {
  buildCaseNoteText,
  CASE_NOTE_DRAFT_LABEL,
  CASE_NOTE_REINSPECTION_SENTENCE,
  type CaseNoteInput,
} from "../../../src/export/case-note";
import {
  buildLahsa1083Json,
  type ParticipantSignoff,
} from "../../../src/export/lahsa-1083";

const SIGNED_AT = "2026-10-29T09:15:00.000Z";

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

function inputFor(overrides: Partial<CaseNoteInput> = {}): CaseNoteInput {
  return {
    fundingType: "lahsa",
    pseudonym: "Sample Unit 12",
    decisions: approvedDecisions(),
    signoff: {
      evaluatorName: "Demo Evaluator",
      typedSignature: "Demo Evaluator",
      attested: true,
      signedAt: SIGNED_AT,
    },
    participantSignoff: { ...PARTICIPANT_SIGNOFF },
    generatedAt: SIGNED_AT,
    ...overrides,
  };
}

function withWaterDeficiency(): CaseNoteInput {
  const input = inputFor();
  input.decisions["demo-water-supply"] = {
    status: "D",
    evaluatorName: "Demo Evaluator",
    decidedAt: SIGNED_AT,
    inPersonCheckAcknowledgment: {
      evaluatorName: "Demo Evaluator",
      completedAt: SIGNED_AT,
    },
    rationale: "The faucet continues to drip after it is closed.",
    evidence: [{ ...EVIDENCE }],
    analysisIdentity: null,
    deficiency: {
      issueDescription: "Kitchen faucet drips when closed.",
      correction: "Repair the faucet cartridge and verify that it shuts off.",
      completionDate: "2026-11-02",
      reinspectionDate: "2026-11-05",
    },
  };
  return input;
}

describe("HMIS case-note draft", () => {
  it("renders the all-approved template with one line per element", () => {
    const text = buildCaseNoteText(inputFor());
    expect(text).toContain(CASE_NOTE_DRAFT_LABEL);
    expect(text).toContain("Date: 2026-10-29");
    expect(text).toContain("Unit: Sample Unit 12");
    expect(text).toContain("Determination: APPROVED");
    for (const element of MOVE_IN_READY_ELEMENTS) {
      expect(text).toContain(`- ${element.label}: A — Checked in person in the staged unit.`);
    }
    expect(text).toContain("Evaluator: Demo Evaluator");
    expect(text).toContain("Participant: Demo Participant");
    expect(text).not.toContain("Deficiencies:");
    expect(text).not.toContain(CASE_NOTE_REINSPECTION_SENTENCE);
  });

  it("renders deficiencies with correction, dates, and the re-inspection sentence", () => {
    const text = buildCaseNoteText(withWaterDeficiency());
    expect(text).toContain("Determination: NOT APPROVED");
    expect(text).toContain("- Water supply: D — The faucet continues to drip after it is closed.");
    expect(text).toContain("Deficiencies:");
    expect(text).toContain(
      "- Water supply: Repair the faucet cartridge and verify that it shuts off.; complete by 2026-11-02; reinspect 2026-11-05.",
    );
    expect(text).toContain(CASE_NOTE_REINSPECTION_SENTENCE);
    expect(CASE_NOTE_REINSPECTION_SENTENCE).toBe("Re-inspection required before subsidy release.");
  });

  it("clips long rationales to one 200-character line", () => {
    const input = inputFor();
    const water = input.decisions["demo-water-supply"];
    if (water.status !== "A") throw new Error("Test setup requires an A decision.");
    water.rationale = `First line.\nSecond line with\ttabs. ${"Detail recorded at the walkthrough. ".repeat(12)}`;
    const text = buildCaseNoteText(input);
    const line = text.split("\n").find((candidate) => candidate.startsWith("- Water supply: A — "));
    expect(line).toBeDefined();
    const rationale = line!.replace("- Water supply: A — ", "");
    expect(rationale.length).toBe(200);
    expect(rationale.startsWith("First line. Second line with tabs. Detail recorded")).toBe(true);
    expect(rationale).not.toMatch(/[\n\t]/);
  });

  it("uses the same determination derivation as the LAHSA JSON", () => {
    for (const input of [inputFor(), withWaterDeficiency()]) {
      const expected = buildLahsa1083Json({
        sessionId: "case-note",
        fundingType: input.fundingType,
        decisions: input.decisions,
        signoff: input.signoff,
        participantSignoff: input.participantSignoff,
        generatedAt: input.generatedAt,
      }).overall_determination;
      expect(buildCaseNoteText(input)).toContain(`Determination: ${expected}`);
    }
    const elementIds: MoveInReadyElementId[] = [...MOVE_IN_READY_ELEMENT_IDS];
    for (const elementId of elementIds) {
      const input = inputFor();
      const decisions = approvedDecisions();
      const base = decisions[elementId];
      if (base.status !== "A") throw new Error("Test setup requires an A decision.");
      decisions[elementId] = {
        ...base,
        status: "D",
        evidence: [{ ...EVIDENCE }],
        ...(elementId === "demo-smoke-co"
          ? { fireSafetyAssessment: { unitDetectors: "D" as const, publicAreaDetectors: "A" as const } }
          : {}),
        deficiency: {
          issueDescription: "Staged issue.",
          correction: "Correct the staged issue.",
          completionDate: "2026-11-02",
          reinspectionDate: "2026-11-05",
        },
      };
      input.decisions = decisions;
      expect(buildCaseNoteText(input)).toContain("Determination: NOT APPROVED");
    }
  });

  it("blocks until decisions and both signatures are complete", () => {
    const needsCheck = inputFor();
    needsCheck.decisions["demo-item-11"] = { status: "needs-human-check", note: "Needs an in-person check." };
    expect(() => buildCaseNoteText(needsCheck)).toThrow();

    const unattested = inputFor({
      participantSignoff: { ...PARTICIPANT_SIGNOFF, attested: false },
    });
    expect(() => buildCaseNoteText(unattested)).toThrow(/co-signature/i);

    const noPseudonym = inputFor({ pseudonym: "   " });
    expect(() => buildCaseNoteText(noPseudonym)).toThrow(/pseudonym/i);
  });
});
