import { describe, expect, it } from "vitest";

import type {
  EvidenceReference,
  ModelElementProposal,
  VideoAnalysisIdentity,
} from "../../../src/domain/move-in-ready";
import { buildConfirmDraft } from "../../../src/features/walkthrough/decision-draft";

const IDENTITY: VideoAnalysisIdentity = {
  sessionId: "session-confirm-1",
  roomId: "kitchen",
  schemaVersion: 1,
  videoId: "video-1",
  videoRevision: 1,
  expectedSourceHash: "a".repeat(64),
  analysisId: "analysis-1",
  attempt: 1,
  catalogVersion: "demo",
};

const STILL: EvidenceReference = {
  schemaVersion: 1,
  catalogVersion: "demo",
  videoId: "video-1",
  videoRevision: 1,
  roomId: "kitchen",
  stillId: "still-1",
  timestampMs: 1000,
  frameIndex: 1,
  stillHash: "b".repeat(64),
};

function approvedProposal(overrides: Partial<ModelElementProposal> = {}): ModelElementProposal {
  return {
    elementId: "demo-water-supply",
    state: "draft-proposal",
    observation: "The faucet runs clear with steady pressure.",
    confidence: 92,
    evidence: [STILL],
    analysisIdentity: IDENTITY,
    modelSuggestion: "A",
    ...overrides,
  } as ModelElementProposal;
}

describe("buildConfirmDraft", () => {
  it("confirms an Approved draft with the tap as the in-person acknowledgment", () => {
    const result = buildConfirmDraft("demo-water-supply", approvedProposal(), null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.choice).toBe("A");
    expect(result.draft.rationale).toBe("The faucet runs clear with steady pressure.");
    expect(result.draft.evidenceStillIds).toEqual(["still-1"]);
  });

  it("quotes the voice answers in the confirmed rationale", () => {
    const result = buildConfirmDraft(
      "demo-water-supply",
      approvedProposal(),
      'kitchen: "Is hot water running clear?" — yes',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.rationale).toContain("The faucet runs clear");
    expect(result.draft.rationale).toContain("Is hot water running clear?");
    expect(result.draft.rationale.length).toBeLessThanOrEqual(1000);
  });

  it("confirms a Deficient draft with the suggested correction plan", () => {
    const result = buildConfirmDraft(
      "demo-water-supply",
      approvedProposal({
        modelSuggestion: "D",
        deficiencySuggestion: {
          deficientArea: "Kitchen faucet",
          correction: "Replace the faucet cartridge.",
          completionDate: "2026-11-15",
          reinspectionDate: "2026-11-20",
        },
      }),
      null,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.choice).toBe("D");
    expect(result.draft.issueDescription).toBe("Kitchen faucet");
    expect(result.draft.correction).toBe("Replace the faucet cartridge.");
    expect(result.draft.planSuggestionReviewed).toBe(true);
  });

  it("sends a Deficient draft without a correction plan to the detail form", () => {
    const result = buildConfirmDraft(
      "demo-water-supply",
      approvedProposal({ modelSuggestion: "D" }),
      null,
    );
    expect(result.ok).toBe(false);
  });

  it("sends a Deficient draft with an incomplete plan to the detail form", () => {
    const result = buildConfirmDraft(
      "demo-water-supply",
      approvedProposal({
        modelSuggestion: "D",
        deficiencySuggestion: {
          deficientArea: "Kitchen faucet",
          correction: "",
          completionDate: "2026-11-15",
          reinspectionDate: "2026-11-20",
        },
      }),
      null,
    );
    expect(result.ok).toBe(false);
  });

  it("marks both fire-safety sections from the confirmed suggestion", () => {
    const result = buildConfirmDraft("demo-smoke-co", approvedProposal({ elementId: "demo-smoke-co" }), null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.fireSafetyUnitDetectors).toBe("A");
    expect(result.draft.fireSafetyPublicAreaDetectors).toBe("A");
  });

  it("sends an empty draft to the detail form instead of saving silence", () => {
    const result = buildConfirmDraft("demo-water-supply", approvedProposal({ observation: "  " }), null);
    expect(result.ok).toBe(false);
  });
});
