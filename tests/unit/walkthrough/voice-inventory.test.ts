import { describe, expect, it } from "vitest";

import {
  MOVE_IN_READY_ELEMENT_IDS,
  type EvaluatorDecision,
  type EvaluatorDecisionSet,
} from "../../../src/domain/move-in-ready";
import { createInitialInspectionRecord } from "../../../src/features/walkthrough/inspection-store";
import { ASSISTANT_FILMING_SCRIPTS, ASSISTANT_FILMING_SCRIPTS_ES } from "../../../src/features/walkthrough/assistant-script";
import { SETUP_VOICE_QUESTIONS, SETUP_VOICE_QUESTIONS_ES, TOUR_REPROMPTS, TOUR_REPROMPTS_ES, VOICE_ROOM_CHECKS, VOICE_ROOM_CHECKS_ES } from "../../../src/features/walkthrough/voice-checks";
import { LANDLORD_VOICE_QUESTION, LANDLORD_VOICE_QUESTION_ES, REVIEW_VOICE_QUESTION, REVIEW_VOICE_QUESTION_ES, tourScriptForNode } from "../../../src/features/walkthrough/guided-tour";
import { DETECTOR_TEST_PROMPT, DETECTOR_TEST_PROMPT_ES } from "../../../src/features/walkthrough/detector-test";
import { VOICE_CLIP_TEXTS, VOICE_CLIP_TEXTS_ES, voiceClipId } from "../../../scripts/voice-inventory.mjs";

const CLIPS: readonly string[] = VOICE_CLIP_TEXTS;
const CLIPS_ES: readonly string[] = VOICE_CLIP_TEXTS_ES;

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

  it("covers the static tour scripts, including the all-decided finish", () => {
    const record = createInitialInspectionRecord("voice-inventory-1");
    const context = { record, capturedRoomCount: 0, batchActive: false, reviewPosition: null };
    expect(CLIPS).toContain(tourScriptForNode({ kind: "welcome" }, context));
    expect(CLIPS).toContain(tourScriptForNode({ kind: "consent" }, context));
    expect(CLIPS).toContain(tourScriptForNode({ kind: "analyze" }, context));
    for (const kind of ["fire-safety", "agency", "leadership", "participant", "signoff"] as const) {
      expect(CLIPS).toContain(tourScriptForNode({ kind }, context));
    }
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

  it("covers the static review voice question and detector prompt", () => {
    expect(CLIPS).toContain(REVIEW_VOICE_QUESTION);
    expect(CLIPS).toContain(LANDLORD_VOICE_QUESTION);
    expect(CLIPS).toContain(DETECTOR_TEST_PROMPT);
  });

  it("covers every Spanish room check, filming cue, setup question, and reprompt", () => {
    for (const questions of Object.values(VOICE_ROOM_CHECKS_ES)) {
      for (const question of questions) {
        expect(CLIPS_ES).toContain(question);
      }
    }
    for (const cues of Object.values(ASSISTANT_FILMING_SCRIPTS_ES)) {
      for (const cue of cues) {
        expect(CLIPS_ES).toContain(cue);
      }
    }
    for (const question of Object.values(SETUP_VOICE_QUESTIONS_ES)) {
      expect(CLIPS_ES).toContain(question);
    }
    for (const reprompt of Object.values(TOUR_REPROMPTS_ES)) {
      expect(CLIPS_ES).toContain(reprompt);
    }
    expect(CLIPS_ES).toContain(REVIEW_VOICE_QUESTION_ES);
    expect(CLIPS_ES).toContain(LANDLORD_VOICE_QUESTION_ES);
    expect(CLIPS_ES).toContain(DETECTOR_TEST_PROMPT_ES);
  });

  it("covers the static Spanish tour scripts, including the all-decided finish", () => {
    const record = createInitialInspectionRecord("voice-inventory-es-1");
    const context = { record, capturedRoomCount: 0, batchActive: false, reviewPosition: null };
    expect(CLIPS_ES).toContain(tourScriptForNode({ kind: "welcome" }, context, "es"));
    expect(CLIPS_ES).toContain(tourScriptForNode({ kind: "consent" }, context, "es"));
    expect(CLIPS_ES).toContain(tourScriptForNode({ kind: "analyze" }, context, "es"));
    for (const kind of ["fire-safety", "agency", "leadership", "participant", "signoff"] as const) {
      expect(CLIPS_ES).toContain(tourScriptForNode({ kind }, context, "es"));
    }
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
      "es",
    );
    expect(done).toContain("Inspección completa");
    expect(CLIPS_ES).toContain(done);
  });

  it("assigns every Spanish clip a unique deterministic id", () => {
    expect(CLIPS_ES.length).toBeGreaterThan(20);
    const ids = CLIPS_ES.map((text: string) => voiceClipId(text));
    expect(new Set(ids).size).toBe(ids.length);
    for (const text of CLIPS_ES) {
      expect(CLIPS).not.toContain(text);
    }
  });
});
