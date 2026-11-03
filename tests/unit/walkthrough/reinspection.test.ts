import { describe, expect, it } from "vitest";
import {
  createUnreviewedEvaluatorDecisions,
  deriveFinalInspectionResult,
  extractPriorDeficiency,
  hasDeficientDecisions,
  reinspectionElementIds,
  startReinspectionDecisions,
  unreviewedDecisionPreservingSnapshot,
  validateEvaluatorDecision,
  validatePriorDeficiencySnapshot,
  type EvaluatorDecision,
  type EvaluatorDecisionSet,
  type EvidenceReference,
  type MoveInReadyElementId,
} from "../../../src/domain/move-in-ready";
import { createInitialInspectionRecord } from "../../../src/features/walkthrough/inspection-store";
import {
  deriveTourNode,
  GUIDED_REVIEW_ORDER,
  guidedReviewQueue,
} from "../../../src/features/walkthrough/guided-tour";

const NOW = "2026-11-01T00:00:00.000Z";
const EVALUATOR = "Rae Evaluator";

const STILL: EvidenceReference = {
  schemaVersion: 5,
  catalogVersion: "0.3.0-demo.3",
  videoId: "video-kitchen-1",
  videoRevision: 1,
  roomId: "kitchen",
  stillId: "still-kitchen-12s",
  timestampMs: 12_000,
  frameIndex: 240,
  stillHash: "a".repeat(64),
};

function makeADecision(elementId: MoveInReadyElementId): EvaluatorDecision {
  return {
    status: "A",
    evaluatorName: EVALUATOR,
    decidedAt: NOW,
    inPersonCheckAcknowledgment: { evaluatorName: EVALUATOR, completedAt: NOW },
    rationale: "Checked in person.",
    evidence: [],
    analysisIdentity: null,
    ...(elementId === "demo-smoke-co"
      ? { fireSafetyAssessment: { unitDetectors: "A", publicAreaDetectors: "A" } as const }
      : {}),
  };
}

function makeDDecision(): EvaluatorDecision {
  return {
    status: "D",
    evaluatorName: EVALUATOR,
    decidedAt: NOW,
    inPersonCheckAcknowledgment: { evaluatorName: EVALUATOR, completedAt: NOW },
    rationale: "Confirmed deficient in person.",
    evidence: [{ ...STILL }],
    analysisIdentity: null,
    deficiency: {
      issueDescription: "Kitchen faucet leaks.",
      correction: "Replace the faucet washer.",
      completionDate: "2026-11-10",
      reinspectionDate: "2026-11-12",
    },
  };
}

function allADecisions(): EvaluatorDecisionSet {
  const decisions = createUnreviewedEvaluatorDecisions();
  for (const elementId of Object.keys(decisions) as MoveInReadyElementId[]) {
    decisions[elementId] = makeADecision(elementId);
  }
  return decisions;
}

describe("prior deficiency snapshots (REQ-L1)", () => {
  it("snapshots a D decision's plan, still ids, and timestamp", () => {
    const snapshot = extractPriorDeficiency(makeDDecision());
    expect(snapshot).toEqual({
      issueDescription: "Kitchen faucet leaks.",
      correction: "Replace the faucet washer.",
      completionDate: "2026-11-10",
      reinspectionDate: "2026-11-12",
      evidenceStillIds: ["still-kitchen-12s"],
      decidedAt: NOW,
    });
  });

  it("returns null for non-D decisions", () => {
    expect(extractPriorDeficiency(makeADecision("demo-item-05"))).toBeNull();
    expect(extractPriorDeficiency({ status: "unreviewed" })).toBeNull();
    expect(extractPriorDeficiency({ status: "needs-human-check", note: "Check it." })).toBeNull();
  });

  it("resets every D decision to unreviewed with a snapshot and leaves the rest untouched", () => {
    const decisions = allADecisions();
    decisions["demo-water-supply"] = makeDDecision();
    decisions["demo-item-08"] = makeDDecision();
    decisions["demo-item-09"] = { status: "needs-human-check", note: "Cannot reach." };

    const { decisions: next, reinspectionCount } = startReinspectionDecisions(decisions);
    expect(reinspectionCount).toBe(2);
    expect(next["demo-water-supply"]).toMatchObject({
      status: "unreviewed",
      priorDeficiency: { issueDescription: "Kitchen faucet leaks." },
    });
    expect(next["demo-item-08"]?.status).toBe("unreviewed");
    expect(next["demo-item-05"]).toEqual(decisions["demo-item-05"]);
    expect(next["demo-item-09"]).toEqual({ status: "needs-human-check", note: "Cannot reach." });
    // The input set is not mutated.
    expect(decisions["demo-water-supply"]?.status).toBe("D");
  });

  it("lists reopened elements and detects standing deficiencies", () => {
    const decisions = allADecisions();
    decisions["demo-item-10"] = makeDDecision();
    expect(hasDeficientDecisions(decisions)).toBe(true);
    const { decisions: next } = startReinspectionDecisions(decisions);
    expect(reinspectionElementIds(next)).toEqual(["demo-item-10"]);
    expect(hasDeficientDecisions(next)).toBe(false);
    expect(reinspectionElementIds(allADecisions())).toEqual([]);
  });

  it("validates snapshots and keeps them on unreviewed decisions only", () => {
    const snapshot = extractPriorDeficiency(makeDDecision())!;
    expect(validatePriorDeficiencySnapshot(snapshot).ok).toBe(true);
    expect(validatePriorDeficiencySnapshot({ ...snapshot, completionDate: "11/10/2026" }).ok).toBe(false);
    expect(validatePriorDeficiencySnapshot({ ...snapshot, reinspectionDate: "2026-11-01" }).ok).toBe(false);
    expect(validatePriorDeficiencySnapshot({ ...snapshot, evidenceStillIds: ["bad id!"] }).ok).toBe(false);

    const reopened = validateEvaluatorDecision({ status: "unreviewed", priorDeficiency: snapshot }, "demo-water-supply");
    expect(reopened.ok).toBe(true);
    expect(validateEvaluatorDecision({ status: "unreviewed", priorDeficiency: { ...snapshot, correction: "" } }).ok).toBe(false);
    // Unrelated review data on unreviewed is still rejected with the existing message.
    const smuggled = validateEvaluatorDecision({ status: "unreviewed", rationale: "nope" });
    expect(smuggled.ok).toBe(false);
    if (!smuggled.ok) expect(smuggled.errors).toContain("unreviewed decision cannot contain review data");
    // A/D decisions reject the snapshot field: re-deciding drops it.
    const decided = makeDDecision();
    expect(validateEvaluatorDecision({ ...decided, priorDeficiency: snapshot }, "demo-water-supply").ok).toBe(false);
  });
});

describe("re-inspection review queue (REQ-L1)", () => {
  it("queues only snapshotted elements while a re-inspection is active", () => {
    const record = createInitialInspectionRecord("reinspect-1", NOW);
    const decisions = allADecisions();
    decisions["demo-item-10"] = makeDDecision();
    const smokeD = makeDDecision();
    if (smokeD.status === "D") {
      smokeD.fireSafetyAssessment = { unitDetectors: "D", publicAreaDetectors: "A" };
    }
    decisions["demo-smoke-co"] = smokeD;
    const { decisions: next } = startReinspectionDecisions(decisions);
    const reinspecting = { ...record, decisions: next };

    const queue = guidedReviewQueue(reinspecting, new Set());
    expect(queue).toEqual(
      GUIDED_REVIEW_ORDER.filter((id) => id === "demo-item-10" || id === "demo-smoke-co"),
    );
    // Skips still apply inside the filtered queue.
    expect(guidedReviewQueue(reinspecting, new Set(["demo-smoke-co"]))).toEqual(["demo-item-10"]);
  });

  it("releases the filter element by element as items are re-decided", () => {
    const record = createInitialInspectionRecord("reinspect-2", NOW);
    const decisions = allADecisions();
    decisions["demo-item-10"] = makeDDecision();
    decisions["demo-item-11"] = makeDDecision();
    const started = startReinspectionDecisions(decisions).decisions;
    expect(guidedReviewQueue({ ...record, decisions: started }, new Set())).toHaveLength(2);

    const redecided = { ...started, "demo-item-10": makeADecision("demo-item-10") };
    expect(guidedReviewQueue({ ...record, decisions: redecided }, new Set())).toEqual(["demo-item-11"]);

    const finished = { ...redecided, "demo-item-11": makeADecision("demo-item-11") };
    expect(guidedReviewQueue({ ...record, decisions: finished }, new Set())).toEqual([]);
  });

  it("drives the tour review node to re-inspected elements only", () => {
    const record = {
      ...createInitialInspectionRecord("reinspect-3", NOW),
      evaluatorName: EVALUATOR,
      pseudonym: "Demo Unit 04",
      fundingType: "lahsa" as const,
      unitType: "1-bedroom" as const,
      roomIds: [],
    };
    const decisions = allADecisions();
    decisions["demo-item-11"] = makeDDecision();
    const reinspecting = { ...record, decisions: startReinspectionDecisions(decisions).decisions };
    const node = deriveTourNode({
      started: true,
      bathsConfirmed: true,
      analysisSettled: true,
      record: reinspecting,
      capturedRoomIds: [],
      analysisMode: "live",
      online: true,
      batchActive: false,
      skippedElementIds: new Set(),
    });
    expect(node).toEqual({ kind: "review-item", elementId: "demo-item-11" });
  });
});

describe("final result across a re-inspection (REQ-L1)", () => {
  const signoff = {
    evaluatorName: EVALUATOR,
    typedSignature: EVALUATOR,
    attested: true,
    signedAt: NOW,
  };

  it("keeps deriveFinalInspectionResult semantics: D blocks, all-A unblocks after re-deciding", () => {
    const decisions = allADecisions();
    decisions["demo-water-supply"] = makeDDecision();
    const rooms = ["kitchen" as const];
    const blocked = deriveFinalInspectionResult({
      fundingType: "lahsa",
      capturedRoomIds: rooms,
      expectedRoomIds: rooms,
      evaluatorDecisions: decisions,
      signoff,
    });
    expect(blocked).toMatchObject({ status: "complete", result: "not-approved" });

    const { decisions: reopened, reinspectionCount } = startReinspectionDecisions(decisions);
    expect(reinspectionCount).toBe(1);
    const pending = deriveFinalInspectionResult({
      fundingType: "lahsa",
      capturedRoomIds: rooms,
      expectedRoomIds: rooms,
      evaluatorDecisions: reopened,
      signoff,
    });
    expect(pending.status).toBe("review-incomplete");

    const flipped = { ...reopened, "demo-water-supply": makeADecision("demo-water-supply") };
    const approved = deriveFinalInspectionResult({
      fundingType: "lahsa",
      capturedRoomIds: rooms,
      expectedRoomIds: rooms,
      evaluatorDecisions: flipped,
      signoff,
    });
    expect(approved).toMatchObject({ status: "complete", result: "approved" });
  });

  it("keeps the re-inspection snapshot when a save leaves the decision unreviewed", () => {
    const decisions = createUnreviewedEvaluatorDecisions();
    decisions["demo-water-supply"] = makeDDecision();
    const { decisions: reopened } = startReinspectionDecisions(decisions);
    const stored = reopened["demo-water-supply"];
    expect(stored.status).toBe("unreviewed");
    const kept = unreviewedDecisionPreservingSnapshot(stored);
    expect(kept).toEqual(stored);
    expect(validateEvaluatorDecision(kept, "demo-water-supply").ok).toBe(true);
    expect(unreviewedDecisionPreservingSnapshot({ status: "unreviewed" })).toEqual({ status: "unreviewed" });
    expect(unreviewedDecisionPreservingSnapshot(makeADecision("demo-water-supply"))).toEqual({ status: "unreviewed" });
  });
});
