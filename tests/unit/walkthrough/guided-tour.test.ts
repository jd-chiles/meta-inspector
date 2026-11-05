import { describe, expect, it } from "vitest";
import {
  MOVE_IN_READY_ELEMENT_IDS,
  parseRoomId,
  type EvaluatorDecision,
  type ModelElementProposal,
} from "../../../src/domain/move-in-ready";
import {
  createInitialInspectionRecord,
  type MoveInReadyInspection,
} from "../../../src/features/walkthrough/inspection-store";
import { VOICE_ROOM_CHECKS, VOICE_ROOM_CHECKS_ES } from "../../../src/features/walkthrough/voice-checks";
import {
  deriveTourNode,
  fireAssessmentDecided,
  guidedReviewQueue,
  filmOutroCue,
  filmRoomScript,
  leadershipComplete,
  nameReadbackScript,
  reviewVoiceAction,
  roomLabelEs,
  tourNodeKey,
  filmRoomShots,
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
    detailsElementId: null,
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
  });

  it("asks each room's checks right after it is filmed, before the next room", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-4"));
    const roomId = record.roomIds[0]!;
    const parsed = parseRoomId(roomId)!;
    const afterFilm = deriveTourNode(baseInput({ record, capturedRoomIds: [roomId] }));
    expect(afterFilm).toEqual({ kind: "room-check", roomId, index: 0 });
    const answered = {
      ...record,
      voiceChecks: {
        [roomId]: VOICE_ROOM_CHECKS[parsed.type].map((question) => ({
          question,
          answer: "yes" as const,
          recordedAt: "2026-11-01T00:00:00.000Z",
        })),
      },
    };
    expect(deriveTourNode(baseInput({ record: answered, capturedRoomIds: [roomId] })))
      .toEqual({ kind: "film-room", roomId: record.roomIds[1] });
  });

  it("asks the strobe question in bedroom only when visual alarms are required", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-strobe"));
    const answered: MoveInReadyInspection["voiceChecks"] = {};
    for (const roomId of ["kitchen", "bathroom", "bedroom"] as const) {
      const parsed = parseRoomId(roomId);
      answered[roomId] = (parsed ? VOICE_ROOM_CHECKS[parsed.type] : []).map((question) => ({
        question,
        answer: "yes" as const,
        recordedAt: "2026-11-01T00:00:00.000Z",
      }));
    }
    const captured = ["kitchen", "bathroom", "bedroom"] as MoveInReadyInspection["roomIds"];
    const flagged = { ...record, voiceChecks: answered, participantVisualAlarmsRequired: true };
    expect(deriveTourNode(baseInput({ record: flagged, capturedRoomIds: captured })))
      .toEqual({ kind: "room-check", roomId: "bedroom", index: 2 });
    const unflagged = { ...flagged, participantVisualAlarmsRequired: false };
    expect(deriveTourNode(baseInput({ record: unflagged, capturedRoomIds: captured })))
      .toEqual({ kind: "film-room", roomId: "living-room" });
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
    // Live-proof stops are removed: review drafts come from room footage,
    // and undecided elements without drafts finish to manual review.
    expect(deriveTourNode(baseInput({
      record: filmed,
      capturedRoomIds: [...record.roomIds],
      analysisSettled: true,
    }))).toEqual({ kind: "review-item", elementId: "demo-smoke-co" });
  });

  it("defers ask-name until review and skips it when already known", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-7"));
    const noRooms = { ...record, roomIds: [] as MoveInReadyInspection["roomIds"] };
    expect(deriveTourNode(baseInput({ record: noRooms })))
      .toEqual({ kind: "review-item", elementId: "demo-smoke-co" });
    const unnamed = { ...noRooms, evaluatorName: "" };
    expect(deriveTourNode(baseInput({ record: unnamed })))
      .toEqual({ kind: "ask-name" });
  });

  it("reviews proposals in risk order and finishes when decided", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-8"));
    const noRooms = { ...record, roomIds: [] as MoveInReadyInspection["roomIds"] };
    const skippedOthers = new Set([
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
    expect(deriveTourNode(baseInput({ record: withProposal, skippedElementIds: new Set(skippedOthers) })))
      .toEqual({ kind: "review-item", elementId: "demo-smoke-co" });
    // Draft-less elements still get their question in risk order.
    expect(guidedReviewQueue(withProposal, new Set(skippedOthers))).toEqual([
      "demo-smoke-co",
      "demo-item-06",
      "demo-item-08",
      "demo-item-09",
      "demo-lighting-electric",
      "demo-item-05",
      "demo-item-10",
      "demo-item-11",
    ]);
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
    expect(deriveTourNode(baseInput({ record: decided, skippedElementIds: new Set(skippedOthers) })))
      .toEqual({ kind: "review-item", elementId: "demo-item-06" });
    expect(deriveTourNode(baseInput({ record: decided, skippedElementIds: new Set(MOVE_IN_READY_ELEMENT_IDS) })).kind)
      .toBe("finish");
  });

  it("produces stable node keys and non-empty scripts for spoken nodes", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-9"));
    const context = { record, capturedRoomCount: 0, batchActive: false, reviewPosition: null };
    expect(tourNodeKey({ kind: "film-room", roomId: "kitchen" })).toBe("film-room:kitchen");
    expect(tourScriptForNode({ kind: "welcome" }, context).length).toBeGreaterThan(0);
    expect(tourScriptForNode({ kind: "ask-unit" }, context)).toBe("");
    const filmScript = tourScriptForNode({ kind: "film-room", roomId: "kitchen" }, context);
    expect(filmScript).toContain("Kitchen");
    expect(filmScript.length).toBeLessThanOrEqual(500);
    expect(tourScriptForNode({ kind: "finish" }, context).length).toBeGreaterThan(0);
  });

  it("keeps the film-room intro short: shots live on screen, not in speech", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-11"));
    const context = { record, capturedRoomCount: 0, batchActive: false, reviewPosition: null };
    const kitchen = tourScriptForNode({ kind: "film-room", roomId: "kitchen" }, context);
    expect(kitchen).toMatch(/room 1 of \d+/);
    expect(kitchen.length).toBeLessThan(200);
    const bathroom = tourScriptForNode({ kind: "film-room", roomId: "bathroom" }, context);
    expect(bathroom.length).toBeLessThan(200);
  });

  it("lists every shot on the room's filming list for the visible checklist", () => {
    const kitchenShots = filmRoomShots("kitchen").join(" ").toLowerCase();
    for (const shot of ["faucet", "sink", "detector"]) {
      expect(kitchenShots).toContain(shot);
    }
    // Owner direction: the entry-door shot belongs to the hallway, not the kitchen.
    expect(kitchenShots).not.toContain("lock");
    const bathroomShots = filmRoomShots("bathroom").join(" ").toLowerCase();
    for (const shot of ["faucet", "toilet", "fan"]) {
      expect(bathroomShots).toContain(shot);
    }
    expect(bathroomShots).not.toContain("detector");
  });

  it("tracks section progress from inspection data", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-10"));
    const sections = tourProgress(record, 2, false);
    expect(sections.find((section) => section.key === "setup")).toMatchObject({ done: 3, total: 3 });
    expect(sections.find((section) => section.key === "film")).toMatchObject({ done: 2 });
    expect(sections.find((section) => section.key === "analyze")).toMatchObject({ done: 0, total: 1 });
  });

  it("maps review voice answers to confirm, edit, or re-ask", () => {
    expect(reviewVoiceAction("Yes, confirmed")).toBe("confirm");
    expect(reviewVoiceAction("I agree with approved")).toBe("confirm");
    expect(reviewVoiceAction("No, that's wrong")).toBe("edit");
    expect(reviewVoiceAction("I disagree")).toBe("edit");
    expect(reviewVoiceAction("Hmm, maybe")).toBeNull();
    expect(reviewVoiceAction("")).toBeNull();
  });

  it("narrates the Spanish tour when the record opts into Spanish", () => {
    const record = { ...withSetup(createInitialInspectionRecord("tour-session-es-1")), tourLanguage: "es" as const };
    const context = { record, capturedRoomCount: 0, batchActive: false, reviewPosition: null };
    expect(tourScriptForNode({ kind: "welcome" }, context, "es")).toContain("Toque Comenzar");
    expect(tourScriptForNode({ kind: "consent" }, context, "es")).toContain("unidad simulada");
    expect(tourScriptForNode({ kind: "analyze" }, context, "es")).toContain("Enviando sus clips");
    expect(tourScriptForNode({ kind: "finish" }, context, "es")).toContain("Vaya a la firma");
    expect(tourScriptForNode({ kind: "ask-unit" }, context, "es")).toBe("");
    expect(filmRoomScript("kitchen", 1, 4, "es")).toContain("Cocina");
    expect(filmRoomScript("kitchen", 1, 4, "es").length).toBeLessThan(200);
    expect(roomLabelEs("bedroom-2")).toBe("Habitación 2");
    expect(roomLabelEs("bathroom")).toBe("Baño");
    expect(nameReadbackScript("Rae", "es")).toContain("Diga sí");
    const shots = filmRoomShots("kitchen", "es").join(" ").toLowerCase();
    expect(shots).toContain("grifo");
    // English defaults are untouched by the language parameter.
    expect(tourScriptForNode({ kind: "welcome" }, context)).toContain("Tap Start");
    expect(filmRoomScript("kitchen", 1, 4)).toContain("Kitchen");
  });

  it("film intros set honest expectations and the outro closes each section", () => {
    const intro = filmRoomScript("bathroom", 2, 4);
    expect(intro).toContain("End the video when you have captured every shot.");
    expect(intro).not.toContain("tell you when it is saved");
    expect(filmRoomScript("kitchen", 1, 4, "es")).toContain("Termine el video cuando haya capturado cada toma.");
    expect(filmOutroCue()).toContain("end the video");
    expect(filmOutroCue("es")).toContain("Termine el video");
  });

  it("tracks Spanish room-check answers against the Spanish questions", () => {
    const record = { ...withSetup(createInitialInspectionRecord("tour-session-es-2")), tourLanguage: "es" as const };
    const roomId = record.roomIds[0]!;
    const parsed = parseRoomId(roomId)!;
    expect(deriveTourNode(baseInput({ record, capturedRoomIds: [roomId] })))
      .toEqual({ kind: "room-check", roomId, index: 0 });
    const answered = {
      ...record,
      voiceChecks: {
        [roomId]: VOICE_ROOM_CHECKS_ES[parsed.type].map((question) => ({
          question,
          answer: "yes" as const,
          recordedAt: "2026-11-01T00:00:00.000Z",
        })),
      },
    };
    expect(deriveTourNode(baseInput({ record: answered, capturedRoomIds: [roomId] })))
      .toEqual({ kind: "film-room", roomId: record.roomIds[1] });
  });

  it("tells the evaluator to answer review items by voice", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-11"));
    record.proposals["demo-water-supply"] = {
      elementId: "demo-water-supply",
      modelSuggestion: "A",
      confidence: 85,
      observation: "Sink and faucet look intact.",
      state: "draft-proposal",
      evidence: [],
      analysisIdentity: {
        sessionId: "tour-session-11",
        roomId: "kitchen",
        schemaVersion: 5,
        videoId: "video-1",
        videoRevision: 1,
        expectedSourceHash: "a".repeat(64),
        analysisId: "analysis-1",
        attempt: 1,
        catalogVersion: "0.3.0-demo.3",
      },
    };
    const script = tourScriptForNode(
      { kind: "review-item", elementId: "demo-water-supply" },
      { record, capturedRoomCount: 4, batchActive: false, reviewPosition: { index: 1, total: 3 } },
    );
    expect(script).toContain("Say yes to confirm");
  });

  it("routes incomplete D plans to the in-tour detail card until saved", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-details"));
    const noRooms = { ...record, roomIds: [] as MoveInReadyInspection["roomIds"] };
    const decidedRest = { ...noRooms.decisions };
    for (const elementId of MOVE_IN_READY_ELEMENT_IDS) {
      if (elementId === "demo-water-supply") continue;
      decidedRest[elementId] = {
        status: "A",
        evaluatorName: "Rae Evaluator",
        decidedAt: "2026-11-01T00:00:00.000Z",
        inPersonCheckAcknowledgment: { evaluatorName: "Rae Evaluator", completedAt: "2026-11-01T00:00:00.000Z" },
        rationale: "Checked.",
        evidence: [],
        analysisIdentity: null,
      };
    }
    const open: MoveInReadyInspection = { ...noRooms, decisions: decidedRest };
    // Review item first; the detail card only opens after a failed confirm.
    expect(deriveTourNode(baseInput({ record: open })))
      .toEqual({ kind: "review-item", elementId: "demo-water-supply" });
    expect(deriveTourNode(baseInput({ record: open, detailsElementId: "demo-water-supply" })))
      .toEqual({ kind: "element-details", elementId: "demo-water-supply" });
    expect(tourNodeKey({ kind: "element-details", elementId: "demo-water-supply" }))
      .toBe("element-details:demo-water-supply");
    const saved: EvaluatorDecision = {
      ...(decidedRest["demo-item-05"] as Extract<EvaluatorDecision, { status: "A" }>),
      status: "D",
      deficiency: {
        issueDescription: "Leak.",
        correction: "Fix.",
        completionDate: "2026-11-10",
        reinspectionDate: "2026-11-12",
      },
    };
    const done: MoveInReadyInspection = {
      ...open,
      decisions: { ...decidedRest, "demo-water-supply": saved },
    };
    // Saved decisions leave the detail card even with a stale element id.
    expect(deriveTourNode(baseInput({ record: done, detailsElementId: "demo-water-supply" })).kind)
      .not.toBe("element-details");
  });

  it("asks Fire Safety 11a/11b only when the aggregate lacks explicit marks", () => {
    expect(fireAssessmentDecided(undefined)).toBe(false);
    expect(fireAssessmentDecided({ unitDetectors: "A", publicAreaDetectors: "needs-human-check" })).toBe(false);
    expect(fireAssessmentDecided({ unitDetectors: "A", publicAreaDetectors: "D" })).toBe(true);
    const record = withSetup(createInitialInspectionRecord("tour-session-fire"));
    const noRooms = { ...record, roomIds: [] as MoveInReadyInspection["roomIds"] };
    const decided = {} as MoveInReadyInspection["decisions"];
    for (const elementId of MOVE_IN_READY_ELEMENT_IDS) {
      decided[elementId] = {
        status: "A",
        evaluatorName: "Rae Evaluator",
        decidedAt: "2026-11-01T00:00:00.000Z",
        inPersonCheckAcknowledgment: { evaluatorName: "Rae Evaluator", completedAt: "2026-11-01T00:00:00.000Z" },
        rationale: "Checked.",
        evidence: [],
        analysisIdentity: null,
      };
    }
    const allDecided: MoveInReadyInspection = { ...noRooms, decisions: decided };
    // Aggregate A with no assessment: the fire node collects both marks.
    expect(deriveTourNode(baseInput({ record: allDecided })).kind).toBe("fire-safety");
    const assessed: MoveInReadyInspection = {
      ...allDecided,
      decisions: {
        ...decided,
        "demo-smoke-co": {
          status: "A",
          evaluatorName: "Rae Evaluator",
          decidedAt: "2026-11-01T00:00:00.000Z",
          inPersonCheckAcknowledgment: { evaluatorName: "Rae Evaluator", completedAt: "2026-11-01T00:00:00.000Z" },
          rationale: "Checked.",
          evidence: [],
          analysisIdentity: null,
          fireSafetyAssessment: { unitDetectors: "A", publicAreaDetectors: "A" },
        },
      },
    };
    // Explicit marks skip the node; agency is next.
    expect(deriveTourNode(baseInput({ record: assessed })).kind).toBe("agency");
    const needsCheck: MoveInReadyInspection = {
      ...allDecided,
      decisions: {
        ...decided,
        "demo-smoke-co": { status: "needs-human-check", note: "Check later." },
      },
    };
    expect(deriveTourNode(baseInput({ record: needsCheck })).kind).toBe("agency");
  });

  it("walks agency, landlord, leadership, participant, and signoff in blocker order", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-admin"));
    const noRooms = { ...record, roomIds: [] as MoveInReadyInspection["roomIds"] };
    const decided = {} as MoveInReadyInspection["decisions"];
    for (const elementId of MOVE_IN_READY_ELEMENT_IDS) {
      decided[elementId] = {
        status: "A",
        evaluatorName: "Rae Evaluator",
        decidedAt: "2026-11-01T00:00:00.000Z",
        inPersonCheckAcknowledgment: { evaluatorName: "Rae Evaluator", completedAt: "2026-11-01T00:00:00.000Z" },
        rationale: "Checked.",
        evidence: [],
        analysisIdentity: null,
        ...(elementId === "demo-smoke-co"
          ? { fireSafetyAssessment: { unitDetectors: "A" as const, publicAreaDetectors: "A" as const } }
          : {}),
      };
    }
    let current: MoveInReadyInspection = { ...noRooms, decisions: decided };
    expect(deriveTourNode(baseInput({ record: current })).kind).toBe("agency");
    current = { ...current, evaluatorAgencyName: "LAHSA Demo" };
    expect(deriveTourNode(baseInput({ record: current })).kind).toBe("landlord-discussion");
    current = { ...current, landlordDiscussion: "yes", landlordDiscussionDate: "2026-11-02" };
    // A yes without its date holds the node.
    expect(deriveTourNode(baseInput({ record: { ...current, landlordDiscussionDate: "" } })).kind)
      .toBe("landlord-discussion");
    // Leadership stays skipped until agency policy requires it.
    expect(deriveTourNode(baseInput({ record: current })).kind).toBe("participant");
    expect(leadershipComplete(current)).toBe(false);
    const required: MoveInReadyInspection = { ...current, leadershipSignoffRequired: true };
    expect(deriveTourNode(baseInput({ record: required })).kind).toBe("leadership");
    expect(leadershipComplete({
      ...required,
      leadershipNameAndTitle: "Lee Lead",
      leadershipSignoff: "Lee Lead",
      leadershipSignedAt: "2026-11-02",
    })).toBe(true);
    current = {
      ...current,
      participantSignoff: {
        participantName: "Pat Participant",
        typedSignature: "Pat Participant",
        attested: true,
        signedAt: "2026-11-02T00:00:00.000Z",
      },
    };
    expect(deriveTourNode(baseInput({ record: current })).kind).toBe("signoff");
    current = {
      ...current,
      signoff: {
        evaluatorName: "Rae Evaluator",
        typedSignature: "Rae Evaluator",
        attested: true,
        signedAt: "2026-11-02T00:00:00.000Z",
      },
    };
    expect(deriveTourNode(baseInput({ record: current }))).toEqual({ kind: "finish" });
  });

  it("finishes when skipped items are left for manual review", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-skip"));
    const noRooms = { ...record, roomIds: [] as MoveInReadyInspection["roomIds"] };
    expect(deriveTourNode(baseInput({
      record: noRooms,
      skippedElementIds: new Set(MOVE_IN_READY_ELEMENT_IDS),
    }))).toEqual({ kind: "finish" });
  });

  it("narrates the signoff nodes in both languages", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-scripts"));
    const context = { record, capturedRoomCount: 0, batchActive: false, reviewPosition: null };
    for (const kind of ["fire-safety", "agency", "leadership", "participant", "signoff"] as const) {
      const script = tourScriptForNode({ kind }, context);
      expect(script.length).toBeGreaterThan(10);
      expect(script.length).toBeLessThan(200);
      expect(tourScriptForNode({ kind }, context, "es").length).toBeGreaterThan(10);
    }
    expect(tourScriptForNode({ kind: "landlord-discussion" }, context)).toBe("");
    const details = tourScriptForNode({ kind: "element-details", elementId: "demo-water-supply" }, context);
    expect(details).toContain("Deficient");
    const sections = tourProgress(record, 0, true);
    expect(sections.find((section) => section.key === "signoff")).toMatchObject({ done: 1, total: 5 });
  });

  it("narrates review items in Spanish when the tour language is Spanish", () => {
    const record = withSetup(createInitialInspectionRecord("tour-session-12"));
    record.proposals["demo-water-supply"] = {
      elementId: "demo-water-supply",
      modelSuggestion: "A",
      confidence: 85,
      observation: "Sink and faucet look intact.",
      state: "draft-proposal",
      evidence: [],
      analysisIdentity: {
        sessionId: "tour-session-12",
        roomId: "kitchen",
        schemaVersion: 5,
        videoId: "video-1",
        videoRevision: 1,
        expectedSourceHash: "a".repeat(64),
        analysisId: "analysis-1",
        attempt: 1,
        catalogVersion: "0.3.0-demo.3",
      },
    };
    const script = tourScriptForNode(
      { kind: "review-item", elementId: "demo-water-supply" },
      { record, capturedRoomCount: 4, batchActive: false, reviewPosition: { index: 1, total: 3 } },
      "es",
    );
    expect(script).toContain("Punto 1 de 3");
    expect(script).toContain("La IA sugiere Aprobado");
    expect(script).toContain("Diga sí para confirmar");
  });
});
