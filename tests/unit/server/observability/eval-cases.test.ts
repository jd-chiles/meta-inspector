import { describe, expect, it } from "vitest";

import {
  buildEvalCaseItem,
  EVAL_DATASET_NAME,
  EVAL_DIMENSIONS,
  seedEvalCases,
} from "../../../../src/server/observability/eval-cases";

const SHA = "a".repeat(64);

describe("eval dataset builders (REQ-O2)", () => {
  it("builds a validated dataset item", () => {
    const item = buildEvalCaseItem({
      caseId: "kitchen-faucet-flow-01",
      dimension: "water-flow-accuracy",
      roomId: "kitchen",
      sourceVideoSha256: SHA,
      task: "Decide whether flow is visible.",
      expected: "Claims flow only when frames show it.",
    });
    expect(item).toEqual({
      id: "kitchen-faucet-flow-01",
      dimension: "water-flow-accuracy",
      input: { roomId: "kitchen", sourceVideoSha256: SHA, task: "Decide whether flow is visible." },
      expectedOutput: "Claims flow only when frames show it.",
    });
  });

  it("rejects malformed cases with honest errors", () => {
    const base = {
      caseId: "ok-01",
      dimension: "evidence-grounding",
      roomId: "bathroom",
      sourceVideoSha256: SHA,
      task: "task",
      expected: "expected",
    } as const;
    expect(() => buildEvalCaseItem({ ...base, caseId: "bad id!" })).toThrow(/case id/i);
    expect(() => buildEvalCaseItem({ ...base, dimension: "accuracy" as never })).toThrow(/dimension/i);
    expect(() => buildEvalCaseItem({ ...base, sourceVideoSha256: "zz" })).toThrow(/SHA-256/);
    expect(() => buildEvalCaseItem({ ...base, task: "" })).toThrow(/task/i);
    expect(() => buildEvalCaseItem({ ...base, expected: "x".repeat(2001) })).toThrow(/expected/i);
  });

  it("seeds one case per benchmark dimension", () => {
    expect(EVAL_DATASET_NAME).toBe("meta-inspect-walkthrough-v1");
    expect(EVAL_DIMENSIONS).toHaveLength(5);
    const items = seedEvalCases({ kitchen: SHA, bathroom: "b".repeat(64) });
    expect(items).toHaveLength(5);
    expect(new Set(items.map((item) => item.dimension))).toEqual(new Set(EVAL_DIMENSIONS));
    expect(new Set(items.map((item) => item.id)).size).toBe(5);
  });
});
