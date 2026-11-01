import { describe, expect, it } from "vitest";
import {
  parseRoomId,
  type EvaluatorDecision,
  type ModelElementProposal,
} from "../../../src/domain/move-in-ready";
import {
  createInitialInspectionRecord,
  type MoveInReadyInspection,
} from "../../../src/features/walkthrough/inspection-store";
import { VOICE_ROOM_CHECKS } from "../../../src/features/walkthrough/voice-checks";
import {
  deriveTourNode,
  guidedReviewQueue,
  tourNodeKey,
  tourProgress,
  tourScriptForNode,
  type GuidedTourInput,
} from "../../../src/features/walkthrough/guided-tour";

function baseInput(overrides: Partial<GuidedTourInput> = {}): GuidedTourInput {
  return {
    started: true,
    bathsConfirmed: true,
    analysisSettled: true,
    record: createInitialInspectionRecord("tour-session-1"),
    capturedRoomIds: [],
    analysisMode: "live",
    online: true,
    batchActive: false,
    skippedElementIds: new Set(),
    ...overrides,
  };
}

function withSetup(record: MoveInReadyInspection): MoveInReadyInspection {
  return {
    ...record,
    evaluatorName: "Rae Evaluator",
    pseudonym: "Demo Unit 04",
    fundingType: "lahsa",
    unitType: "1-bedroom",
  };
}

describe("deriveTourNode", () => {
  it("opens on welcome before the user starts", () => {
    expect(deriveTourNode(baseInput({ started: false }))).toEqual({ kind: "welcome" });
  });

  it("asks unit type first, then baths, then consent — no name or nickname up front", () => {
    const fresh = createInitialInspectionRecord("tour-session-2");
    expect(deriveTourNode(baseInput({ record: fresh }))).toEqual({ kind: "ask-unit" });
    const withUnit = { ...fresh, unitType: "studio" as const };
    expect(deriveTourNode(baseInput({ record: withUnit, bathsConfirmed: false }))).toEqual({ kind: "ask-baths" });
    expect(deriveTourNode(baseInput({ record: withUnit }))).toEqual({ kind: "consent" });
  });

  it("films each room in unit order", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-3"));
    const first = deriveTourNode(baseInput({ record }));
    expect(first.kind).toBe("film-room");
    const firstRoom = (first as { roomId: string }).roomId;
    expect(firstRoom).toBe(record.roomIds[0]);
    const filmedFirst = deriveTourNode(baseInput({ record, capturedRoomIds: [record.roomIds[0]!] }));
    expect(filmedFirst).toEqual({ kind: "film-room", roomId: record.roomIds[1] });
  });

  it("asks in-person checks after each room is filmed", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-4"));
    const node = deriveTourNode(baseInput({ record, capturedRoomIds: [...record.roomIds] }));
    expect(node).toEqual({ kind: "room-check", roomId: record.roomIds[0], index: 0 });
  });

  it("holds on analyze until the batch settles", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-5"));
    const answered: MoveInReadyInspection["voiceChecks"] = {};
    for (const roomId of record.roomIds) {
      const parsed = parseRoomId(roomId);
      answered[roomId] = parsed
        ? VOICE_ROOM_CHECKS[parsed.type].map((question) => ({
          question,
          answer: "yes" as const,
          recordedAt: "2026-11-01T00:00:00.000Z",
        }))
        : [];
    }
    const filmed = { ...record, voiceChecks: answered };
    expect(deriveTourNode(baseInput({
      record: filmed,
      capturedRoomIds: [...record.roomIds],
      analysisSettled: false,
    }))).toEqual({ kind: "analyze" });
    expect(deriveTourNode(baseInput({
      record: filmed,
      capturedRoomIds: [...record.roomIds],
      analysisSettled: true,
    }))).toEqual({ kind: "live", elementId: "demo-water-supply" });
  });

  it("defers ask-name until review and skips it when already known", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-7"));
    const noRooms = { ...record, roomIds: [] as MoveInReadyInspection["roomIds"] };
    const skippedAllLive = new Set([
      "demo-water-supply",
      "demo-interior-air",
      "demo-item-07",
      "demo-smoke-co",
    ] as const);
    expect(deriveTourNode(baseInput({ record: noRooms, skippedElementIds: new Set(skippedAllLive) })).kind)
      .toBe("finish");
    const unnamed = { ...noRooms, evaluatorName: "" };
    expect(deriveTourNode(baseInput({ record: unnamed, skippedElementIds: new Set(skippedAllLive) })))
      .toEqual({ kind: "ask-name" });
  });

  it("reviews proposals in risk order and finishes when decided", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-8"));
    const noRooms = { ...record, roomIds: [] as MoveInReadyInspection["roomIds"] };
    const skippedOtherLive = new Set([
      "demo-water-supply",
      "demo-interior-air",
      "demo-item-07",
    ] as const);
    const proposal: ModelElementProposal = {
      elementId: "demo-smoke-co",
      state: "draft-proposal",
      modelSuggestion: "D",
      observation: "Detector missing.",
      confidence: 70,
      evidence: [],
      analysisIdentity: {
        sessionId: "tour-session-8",
        roomId: "kitchen",
        schemaVersion: record.schemaVersion,
        videoId: "video-1",
        videoRevision: 1,
        expectedSourceHash: "h",
        analysisId: "analysis-1",
        attempt: 1,
        catalogVersion: record.catalogVersion,
      },
    };
    const withProposal: MoveInReadyInspection = {
      ...noRooms,
      proposals: { "demo-smoke-co": proposal },
    };
    expect(deriveTourNode(baseInput({ record: withProposal, skippedElementIds: new Set(skippedOtherLive) })))
      .toEqual({ kind: "review-item", elementId: "demo-smoke-co" });
    expect(guidedReviewQueue(withProposal, new Set(skippedOtherLive))).toEqual(["demo-smoke-co"]);
    const smokeDecision: EvaluatorDecision = {
      status: "D",
      evaluatorName: "Rae Evaluator",
      decidedAt: "2026-11-01T00:00:00.000Z",
      inPersonCheckAcknowledgment: { evaluatorName: "Rae Evaluator", completedAt: "2026-11-01T00:00:00.000Z" },
      rationale: "Confirmed missing.",
      evidence: [],
      analysisIdentity: null,
      deficiency: {
        issueDescription: "Detector missing.",
        correction: "Install a detector.",
        completionDate: "2026-11-10",
        reinspectionDate: "2026-11-12",
      },
    };
    const decided: MoveInReadyInspection = {
      ...withProposal,
      decisions: { ...withProposal.decisions, "demo-smoke-co": smokeDecision },
    };
    expect(deriveTourNode(baseInput({ record: decided, skippedElementIds: new Set(skippedOtherLive) })).kind)
      .toBe("finish");
  });

  it("produces stable node keys and non-empty scripts for spoken nodes", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-9"));
    const context = { record, capturedRoomCount: 0, batchActive: false, reviewPosition: null };
    expect(tourNodeKey({ kind: "film-room", roomId: "kitchen" })).toBe("film-room:kitchen");
    expect(tourScriptForNode({ kind: "welcome" }, context).length).toBeGreaterThan(0);
    expect(tourScriptForNode({ kind: "ask-unit" }, context)).toBe("");
    expect(tourScriptForNode({ kind: "film-room", roomId: "kitchen" }, context)).toContain("Kitchen");
    expect(tourScriptForNode({ kind: "finish" }, context).length).toBeGreaterThan(0);
  });

  it("tracks section progress from inspection data", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-10"));
    const sections = tourProgress(record, 2, false);
    expect(sections.find((section) => section.key === "setup")).toMatchObject({ done: 3, total: 3 });
    expect(sections.find((section) => section.key === "film")).toMatchObject({ done: 2 });
    expect(sections.find((section) => section.key === "analyze")).toMatchObject({ done: 0, total: 1 });
  });
});
