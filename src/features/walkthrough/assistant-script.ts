/**
 * Pure script model for the AI inspection guide: which guidance node the user
 * is on, derived only from saved walkthrough state. Deterministic progress,
 * never model output. Voice text stays short for spoken readout.
 */

import {
  MOVE_IN_READY_ELEMENTS,
  parseRoomId,
  roomLabel,
  type MoveInReadyElementId,
  type MoveInReadyRoomId,
  type MoveInReadyRoomType,
} from "../../domain/move-in-ready";

export type AssistantActionId =
  | "setup"
  | "film-room"
  | "analyze-all"
  | "open-requirement"
  | "signoff"
  | "dismiss";

export interface AssistantAction {
  id: AssistantActionId;
  label: string;
  primary: boolean;
  roomId?: MoveInReadyRoomId;
  elementId?: MoveInReadyElementId;
}

export interface AssistantNode {
  key: string;
  title: string;
  message: string;
  speak: string;
  actions: AssistantAction[];
}

export interface AssistantScriptInput {
  fundingType: "lahsa" | "hud" | "unknown";
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
    "Now pan slowly across the sink, counters, and outlets.",
    "Show the kitchen ventilation fan running and hold the camera steady on it.",
    "Finally, show the smoke or carbon monoxide detector and its indicator light.",
  ],
  bathroom: [
    "Recording. First, run the bathroom faucet and show the flow and drainage.",
    "Now show the toilet, sink, and surfaces.",
    "Show the ventilation fan running.",
    "Finally, show the smoke or carbon monoxide detector.",
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
    "Now show the front door and demonstrate how its lock works.",
    "Show the secondary exit or fire escape window and the lighting along the path.",
    "Finally, show the smoke or carbon monoxide detector.",
  ],
};

export function deriveAssistantNode(input: AssistantScriptInput): AssistantNode {
  if (input.fundingType === "hud") {
    return {
      key: "hud",
      title: "HQS route",
      message: "This is a HUD-funded unit, so it needs the HQS inspection workflow. I can't run a Form 1083 here.",
      speak: "This unit needs the H Q S workflow. I can't run a Form 1083 here.",
      actions: [{ id: "dismiss", label: "Got it", primary: true }],
    };
  }
  if (!input.canCapture) {
    return {
      key: "setup",
      title: "Let's set up this inspection",
      message: "I'm your inspection guide. I'll walk you through filming, run the AI analysis, and review all 11 requirements with you. First: give the unit a nickname and pick its funding type.",
      speak: "Hi! I'm your inspection guide. I'll walk you through the whole thing. First, let's set up the unit.",
      actions: [{ id: "setup", label: "Set up the unit", primary: true }],
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
      message: `One continuous take. I'll narrate exactly what to show while the camera rolls. Tap below and I'll open the camera for the ${label}.`,
      speak: `Step ${filmed + 1} of ${total}. Let's film the ${label}. I'll tell you exactly what to show.`,
      actions: [{ id: "film-room", label: `Film the ${label}`, primary: true, roomId: nextRoomId }],
    };
  }
  if (input.batchActive) {
    return {
      key: "analyzing",
      title: "AI is analyzing your clips",
      message: "I'm running every filmed room through analysis, one at a time. Stay here — I'll take you to the checklist when the drafts are ready.",
      speak: "I'm analyzing your clips now. Hang tight.",
      actions: [],
    };
  }
  if (input.analyzedTotal < input.filmedRoomIds.length) {
    const remaining = input.filmedRoomIds.length - input.analyzedTotal;
    return {
      key: "analyze",
      title: "All filmed — my turn to work",
      message: `All ${input.roomIds.length} rooms are filmed. I'll analyze every clip and draft all 11 requirements for you. Tapping below confirms the clips are staged mock-unit footage with no tenants, faces, addresses, or case notes, and that each clip will be sent to Meta for live processing.`,
      speak: `All filmed. Confirm your clips are staged mock footage, and I'll analyze everything now.`,
      actions: [{ id: "analyze-all", label: `Confirm & analyze ${remaining} room${remaining === 1 ? "" : "s"}`, primary: true }],
    };
  }
  if (input.resolvedDecisions < MOVE_IN_READY_ELEMENTS.length) {
    const remaining = MOVE_IN_READY_ELEMENTS.length - input.resolvedDecisions;
    const actions: AssistantAction[] = [];
    if (input.nextUndecidedId) {
      actions.push({ id: "open-requirement", label: `Review: ${input.nextUndecidedLabel ?? "requirement"}`, primary: true, elementId: input.nextUndecidedId });
    }
    return {
      key: "review",
      title: `${remaining} requirement${remaining === 1 ? "" : "s"} left to decide`,
      message: "The AI drafts are proposed below. Open each requirement, complete your in-person check, and record your own decision. Nothing is decided until you decide it.",
      speak: `${remaining} items left. Review each one and record your decision.`,
      actions,
    };
  }
  if (!input.signed) {
    return {
      key: "signoff",
      title: "Checklist complete — sign off",
      message: `All 11 requirements are decided. I'll take you to sign-off: your result is already computed from your decisions, so just sign and export.`,
      speak: "All done. Let's sign off and export.",
      actions: [{ id: "signoff", label: "Go to sign-off", primary: true }],
    };
  }
  return {
    key: "done",
    title: "Inspection complete",
    message: "Signed and ready. Your export packet is on the sign-off screen whenever you need it.",
    speak: "Inspection complete. Nice work.",
    actions: [{ id: "signoff", label: "Open exports", primary: true }],
  };
}

/** Filming narration for a concrete room, resolved by room type. */
export function filmingScriptForRoom(roomId: MoveInReadyRoomId): readonly string[] {
  const parsed = parseRoomId(roomId);
  if (!parsed) return ASSISTANT_FILMING_SCRIPTS.hallway;
  return ASSISTANT_FILMING_SCRIPTS[parsed.type];
}
