import { describe, expect, it } from "vitest";

import {
  createUnreviewedEvaluatorDecisions,
  type EvaluatorDecisionSet,
  type ModelElementProposal,
} from "../../../src/domain/move-in-ready";
import { selectIssueElements } from "../../../src/features/walkthrough/move-in-ready-flow";

function proposal(overrides: Partial<ModelElementProposal> & { elementId: ModelElementProposal["elementId"] }): ModelElementProposal {
  return {
    state: "draft-proposal",
    observation: "Mock observation.",
    confidence: 90,
    evidence: [],
    analysisIdentity: {
      sessionId: "session-1",
      roomId: "kitchen",
      schemaVersion: 5,
      videoId: "video-1",
      videoRevision: 1,
      expectedSourceHash: "a".repeat(64),
      analysisId: "analysis-1",
      attempt: 1,
      catalogVersion: "test",
    },
    modelSuggestion: "A",
    ...overrides,
  } as ModelElementProposal;
}

describe("selectIssueElements", () => {
  it("lists deficient and evidence-less drafts, skipping clean drafts and decided elements", () => {
    const decisions: EvaluatorDecisionSet = createUnreviewedEvaluatorDecisions();
    decisions["demo-item-05"] = { status: "A", evaluatorName: "E", decidedAt: "2026-01-01T00:00:00.000Z", inPersonCheckAcknowledgment: { evaluatorName: "E", completedAt: "2026-01-01T00:00:00.000Z" }, rationale: "ok", evidence: [], analysisIdentity: null };
    const issues = selectIssueElements(
      {
        "demo-water-supply": proposal({ elementId: "demo-water-supply", modelSuggestion: "D", deficiencySuggestion: { deficientArea: "faucet", correction: "fix", completionDate: "2026-02-01", reinspectionDate: "2026-02-08" } }),
        "demo-item-08": proposal({ elementId: "demo-item-08", state: "needs-human-check" }),
        "demo-item-10": proposal({ elementId: "demo-item-10", modelSuggestion: "A" }),
        "demo-item-05": proposal({ elementId: "demo-item-05", modelSuggestion: "D", deficiencySuggestion: { deficientArea: "x", correction: "y", completionDate: "2026-02-01", reinspectionDate: "2026-02-08" } }),
      },
      decisions,
    );
    expect(issues).toEqual(["demo-water-supply", "demo-item-08"]);
  });

  it("returns nothing without proposals", () => {
    expect(selectIssueElements({}, createUnreviewedEvaluatorDecisions())).toEqual([]);
  });
});
