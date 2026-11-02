import { describe, expect, it } from "vitest";

import {
  MOVE_IN_READY_ELEMENT_IDS,
  type EvaluatorDecision,
  type EvaluatorDecisionSet,
} from "../../../src/domain/move-in-ready";
import { createInitialInspectionRecord } from "../../../src/features/walkthrough/inspection-store";
import { ASSISTANT_FILMING_SCRIPTS, deriveAssistantNode, type AssistantScriptInput } from "../../../src/features/walkthrough/assistant-script";
import { SETUP_VOICE_QUESTIONS, TOUR_REPROMPTS, VOICE_ROOM_CHECKS } from "../../../src/features/walkthrough/voice-checks";
import { tourScriptForNode } from "../../../src/features/walkthrough/guided-tour";
import { VOICE_CLIP_TEXTS, voiceClipId } from "../../../scripts/voice-inventory.mjs";

const CLIPS: readonly string[] = VOICE_CLIP_TEXTS;

describe("voice inventory contract", () => {
  it("covers every in-person room check the voice prompt speaks", () => {
    for (const questions of Object.values(VOICE_ROOM_CHECKS)) {
      for (const question of questions) {
        expect(CLIPS).toContain(question);
      }
    }
  });

  it("covers every filming cue spoken while recording", () => {
    for (const cues of Object.values(ASSISTANT_FILMING_SCRIPTS)) {
      for (const cue of cues) {
        expect(CLIPS).toContain(cue);
      }
    }
  });

  it("covers every spoken setup question", () => {
    for (const question of Object.values(SETUP_VOICE_QUESTIONS)) {
      expect(CLIPS).toContain(question);
    }
  });

  it("covers every spoken reprompt", () => {
    for (const reprompt of Object.values(TOUR_REPROMPTS)) {
      expect(CLIPS).toContain(reprompt);
    }
  });

  it("covers the static assistant guide speeches", () => {
    const base: AssistantScriptInput = {
      fundingType: "lahsa",
      canCapture: true,
      pseudonym: "Demo",
      evaluatorName: "Rae Evaluator",
      roomIds: ["kitchen"],
      filmedRoomIds: ["kitchen"],
      analyzedRoomIds: ["kitchen"],
      analyzedTotal: 1,
      resolvedDecisions: 11,
      nextUndecidedLabel: null,
      nextUndecidedId: null,
      signed: false,
      batchActive: false,
    };
    const speaks = [
      deriveAssistantNode({ ...base, fundingType: "hud" }).speak,
      deriveAssistantNode({ ...base, canCapture: false }).speak,
      deriveAssistantNode({ ...base, resolvedDecisions: 0, batchActive: true }).speak,
      deriveAssistantNode({ ...base, resolvedDecisions: 0, analyzedTotal: 0 }).speak,
      deriveAssistantNode(base).speak,
      deriveAssistantNode({ ...base, signed: true }).speak,
    ];
    expect(new Set(speaks).size).toBe(6);
    for (const speak of speaks) {
      expect(CLIPS).toContain(speak);
    }
  });

  it("covers the static tour scripts, including the all-decided finish", () => {
    const record = createInitialInspectionRecord("voice-inventory-1");
    const context = { record, capturedRoomCount: 0, batchActive: false, reviewPosition: null };
    expect(CLIPS).toContain(tourScriptForNode({ kind: "welcome" }, context));
    expect(CLIPS).toContain(tourScriptForNode({ kind: "consent" }, context));
    expect(CLIPS).toContain(tourScriptForNode({ kind: "analyze" }, context));
    const decidedAt = new Date().toISOString();
    const decided = Object.fromEntries(MOVE_IN_READY_ELEMENT_IDS.map((elementId) => {
      const decision: EvaluatorDecision = {
        status: "A",
        evaluatorName: "Rae Evaluator",
        decidedAt,
        inPersonCheckAcknowledgment: { evaluatorName: "Rae Evaluator", completedAt: decidedAt },
        rationale: "Confirmed in person.",
        evidence: [],
        analysisIdentity: null,
      };
      return [elementId, decision];
    })) as EvaluatorDecisionSet;
    const done = tourScriptForNode(
      { kind: "finish" },
      { ...context, record: { ...record, decisions: decided } },
    );
    expect(done).toContain("Inspection complete");
    expect(CLIPS).toContain(done);
  });

  it("assigns every clip a unique deterministic id", () => {
    expect(CLIPS.length).toBeGreaterThan(20);
    const ids = CLIPS.map((text: string) => voiceClipId(text));
    expect(new Set(ids).size).toBe(ids.length);
    expect(voiceClipId(CLIPS[0] as string)).toBe(voiceClipId(`  ${CLIPS[0] as string}  `));
  });
});
