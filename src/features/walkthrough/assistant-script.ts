/**
 * Pure script model for the voice guide bar: which guidance node the user
 * is on, derived only from saved walkthrough state, plus filming narration
 * tables keyed by room type. Deterministic progress, never model output.
 * Voice text stays short for spoken readout.
 */

import {
  MOVE_IN_READY_ELEMENTS,
  parseRoomId,
  roomLabel,
  type MoveInReadyElementId,
  type MoveInReadyRoomId,
  type MoveInReadyRoomType,
} from "../../domain/move-in-ready";

// One path: the guide bar narrates and never triggers. Flow actions live
// in exactly one place per screen — the tour nodes on the tour step, the
// in-flow screens everywhere else — so there is no second trigger set.

export interface AssistantNode {
  key: string;
  title: string;
  message: string;
  speak: string;
}

export interface AssistantScriptInput {
  fundingType: "lahsa" | "hud" | "unknown";
  /** True once the flow has real evidence (clips, drafts, decisions, sign-off). Setup-form-only does not count: before the flow starts, the guide offers no entry actions — Home's Start button is the single entrance. */
  flowStarted: boolean;
  canCapture: boolean;
  pseudonym: string;
  evaluatorName: string;
  roomIds: readonly MoveInReadyRoomId[];
  filmedRoomIds: readonly MoveInReadyRoomId[];
  analyzedRoomIds: readonly MoveInReadyRoomId[];
  analyzedTotal: number;
  resolvedDecisions: number;
  nextUndecidedLabel: string | null;
  nextUndecidedId: MoveInReadyElementId | null;
  signed: boolean;
  batchActive: boolean;
}

export const ASSISTANT_FILMING_SCRIPTS: Record<MoveInReadyRoomType, readonly string[]> = {
  kitchen: [
    "Recording. First, run the kitchen faucet and show the water flow and drainage.",
    "Now pan across the sink, counters, and outlets.",
    "Finally, show the smoke or carbon monoxide detector and its indicator light.",
  ],
  bathroom: [
    "Recording. First, run the bathroom faucet and show the flow and drainage.",
    "Now show the toilet, sink, and surfaces.",
    "Show the ventilation fan running.",
  ],
  bedroom: [
    "Recording. First, walk the bedroom showing walls and floors.",
    "Now show the windows, locks, and heating or cooling equipment.",
    "Show the light fixtures and outlets.",
    "Finally, show the smoke or carbon monoxide detector.",
  ],
  "living-room": [
    "Recording. First, walk the living room showing walls and floors.",
    "Now show the windows, locks, and heating or cooling equipment.",
    "Show the light fixtures and outlets.",
    "Finally, show the smoke or carbon monoxide detector.",
  ],
  hallway: [
    "Recording. First, walk the full hallway showing the exit path.",
    "Now show the exit door and any secondary exit or fire escape window.",
    "Show the lighting along the path.",
    "Finally, show the smoke or carbon monoxide detector.",
  ],
};

/**
 * Spanish variants of the filming cues (REQ-R2). Same shape and order as
 * the English table: cue N in one language is the same shot as cue N in
 * the other. Pinned by the voice-inventory contract test against
 * VOICE_CLIP_TEXTS_ES.
 */
export const ASSISTANT_FILMING_SCRIPTS_ES: Record<MoveInReadyRoomType, readonly string[]> = {
  kitchen: [
    "Grabando. Primero, abra el grifo de la cocina y muestre el flujo y el desagüe.",
    "Ahora muestre el fregadero, las encimeras y los enchufes.",
    "Por último, muestre el detector de humo o monóxido de carbono y su luz indicadora.",
  ],
  bathroom: [
    "Grabando. Primero, abra el grifo del baño y muestre el flujo y el desagüe.",
    "Ahora muestre el inodoro, el lavabo y las superficies.",
    "Muestre el ventilador funcionando.",
  ],
  bedroom: [
    "Grabando. Primero, recorra la habitación mostrando paredes y pisos.",
    "Ahora muestre las ventanas, las cerraduras y el equipo de calefacción o aire.",
    "Muestre las lámparas y los enchufes.",
    "Por último, muestre el detector de humo o monóxido de carbono.",
  ],
  "living-room": [
    "Grabando. Primero, recorra la sala mostrando paredes y pisos.",
    "Ahora muestre las ventanas, las cerraduras y el equipo de calefacción o aire.",
    "Muestre las lámparas y los enchufes.",
    "Por último, muestre el detector de humo o monóxido de carbono.",
  ],
  hallway: [
    "Grabando. Primero, recorra todo el pasillo mostrando la ruta de salida.",
    "Ahora muestre la puerta de salida y cualquier salida secundaria o ventana de escape.",
    "Muestre la iluminación del pasaje.",
    "Por último, muestre el detector de humo o monóxido de carbono.",
  ],
};

export function deriveAssistantNode(input: AssistantScriptInput): AssistantNode {
  if (input.fundingType === "hud") {
    return {
      key: "hud",
      title: "HQS route",
      message: "This is a HUD-funded unit, so it needs the HQS inspection workflow. I can't run a Form 1083 here.",
      speak: "This unit needs the H Q S workflow. I can't run a Form 1083 here.",
    };
  }
  if (!input.flowStarted) {
    return {
      key: "prestart",
      title: "Start your inspection",
      message: "Tap Start inspection on Home to begin — I'll guide you step by step from there.",
      speak: "Tap Start inspection on Home to begin. I'll guide you from there.",
    };
  }
  if (!input.canCapture) {
    return {
      key: "setup",
      title: "Let's set up this inspection",
      message: "I'm your inspection guide. I'll walk you through filming, run the AI analysis, and review all 11 requirements with you. First: give the unit a nickname and pick its funding type in the setup panel.",
      speak: "Hi! I'm your inspection guide. I'll walk you through the whole thing. First, let's set up the unit.",
    };
  }
  const nextRoomId = input.roomIds.find((roomId) => !input.filmedRoomIds.includes(roomId)) ?? null;
  if (nextRoomId) {
    const filmed = input.filmedRoomIds.length;
    const total = input.roomIds.length;
    const label = roomLabel(nextRoomId);
    return {
      key: `film-${nextRoomId}`,
      title: `Step ${filmed + 1} of ${total}: film the ${label}`,
      message: `One continuous take. I'll narrate exactly what to show while the camera rolls.`,
      speak: `Step ${filmed + 1} of ${total}. Let's film the ${label}. I'll tell you exactly what to show.`,
    };
  }
  if (input.batchActive) {
    return {
      key: "analyzing",
      title: "AI is analyzing your clips",
      message: "I'm running every filmed room through analysis, up to two rooms at a time. Stay here — I'll take you to the checklist when the drafts are ready.",
      speak: "I'm analyzing your clips now. Hang tight.",
    };
  }
  if (input.analyzedTotal < input.filmedRoomIds.length) {
    return {
      key: "analyze",
      title: "All filmed — my turn to work",
      message: `All ${input.roomIds.length} rooms are filmed. I'll analyze every clip and draft all 11 requirements for you. Open the batch analysis panel on this screen to confirm the staged-footage notice and start the run — each clip is sent to Meta for live processing.`,
      speak: `All filmed. Confirm your clips are staged mock footage, and I'll analyze everything now.`,
    };
  }
  if (input.resolvedDecisions < MOVE_IN_READY_ELEMENTS.length) {
    const remaining = MOVE_IN_READY_ELEMENTS.length - input.resolvedDecisions;
    return {
      key: "review",
      title: `${remaining} requirement${remaining === 1 ? "" : "s"} left to decide`,
      message: "The AI drafts are proposed below. Open each requirement, complete your in-person check, and record your own decision. Nothing is decided until you decide it.",
      speak: `${remaining} items left. Review each one and record your decision.`,
    };
  }
  if (!input.signed) {
    return {
      key: "signoff",
      title: "Checklist complete — sign off",
      message: `All 11 requirements are decided. Your result is already computed from your decisions: open Sign-Off below, sign, and export.`,
      speak: "All done. Let's sign off and export.",
    };
  }
  return {
    key: "done",
    title: "Inspection complete",
    message: "Signed and ready. Your export packet is on the sign-off screen whenever you need it.",
    speak: "Inspection complete. Nice work.",
  };
}

/** Filming narration for a concrete room, resolved by room type. */
export function filmingScriptForRoom(roomId: MoveInReadyRoomId, language: "en" | "es" = "en"): readonly string[] {
  const table = language === "es" ? ASSISTANT_FILMING_SCRIPTS_ES : ASSISTANT_FILMING_SCRIPTS;
  const parsed = parseRoomId(roomId);
  if (!parsed) return table.hallway;
  return table[parsed.type];
}
