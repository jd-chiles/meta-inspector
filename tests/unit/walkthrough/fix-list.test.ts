import { describe, expect, it } from "vitest";
import type { EvaluatorDecision } from "../../../src/domain/move-in-ready";
import { rankDeficiencies, reinspectionChecklist } from "../../../src/features/walkthrough/fix-list";

function dDecision(): Extract<EvaluatorDecision, { status: "D" }> {
  return {
    status: "D",
    evaluatorName: "Alex Morgan",
    decidedAt: "2026-10-29T09:15:00.000Z",
    inPersonCheckAcknowledgment: { evaluatorName: "Alex Morgan", completedAt: "2026-10-29T09:15:00.000Z" },
    rationale: "Checked in person.",
    evidence: [],
    analysisIdentity: null,
    deficiency: {
      issueDescription: "Staged deficiency.",
      correction: "Fix it.",
      completionDate: "2026-11-10",
      reinspectionDate: "2026-11-12",
    },
  };
}

describe("risk-ranked fix list", () => {
  it("orders D items by risk tier, not form order", () => {
    const ranked = rankDeficiencies({
      "demo-item-11": dDecision(),
      "demo-smoke-co": dDecision(),
      "demo-item-08": dDecision(),
      "demo-water-supply": { status: "unreviewed" },
    });
    expect(ranked.map((item) => item.elementId)).toEqual([
      "demo-smoke-co",
      "demo-item-08",
      "demo-item-11",
    ]);
    expect(ranked[0]!.tier).toBe(1);
    expect(ranked[1]!.tier).toBe(2);
    expect(ranked[2]!.tier).toBe(3);
  });

  it("names a re-film checklist per live element", () => {
    expect(reinspectionChecklist("demo-water-supply")).toContain("re-film the faucet");
    expect(reinspectionChecklist("demo-smoke-co")).toContain("detector test beep");
    expect(reinspectionChecklist("demo-item-11")).toContain("re-check in person");
  });
});
