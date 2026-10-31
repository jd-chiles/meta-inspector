/**
 * Pure script model for the AI inspection guide: which guidance node the user
 * is on, derived only from saved walkthrough state. Deterministic progress,
 * never model output. Voice text stays short for spoken readout.
 */

import {
  MOVE_IN_READY_ELEMENTS,
  MOVE_IN_READY_ROOMS,
  type MoveInReadyElementId,
  type MoveInReadyRoomId,
} from "../../domain/move-in-ready";

export type AssistantActionId =
  | "setup"
  | "film-room"
  | "analyze-all"
  | "open-requirement"
  | "prefill-all"
  | "save-all"
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
  filmedRoomIds: readonly MoveInReadyRoomId[];
  analyzedRoomIds: readonly MoveInReadyRoomId[];
  analyzedTotal: number;
  resolvedDecisions: number;
  prefilledDecisions: number;
  acknowledgedDecisions: number;
  nextUndecidedLabel: string | null;
  nextUndecidedId: MoveInReadyElementId | null;
  signed: boolean;
  batchActive: boolean;
}

export const ASSISTANT_FILMING_SCRIPTS: Record<MoveInReadyRoomId, readonly string[]> = {
  kitchen: [
    "Recording. First, run the kitchen faucet and show the water flow and drainage.",
    "Now pan across the sink, counters, and outlets.",
    "Open the entry door and test its lock.",
    "Finally, show the smoke or carbon monoxide detector and its indicator light.",
  ],
  bathroom: [
    "Recording. First, run the bathroom faucet and show the flow and drainage.",
    "Now show the toilet, sink, and surfaces.",
    "Show the ventilation fan running.",
    "Finally, show the smoke or carbon monoxide detector.",
  ],
  "bedroom-living": [
    "Recording. First, walk the bedroom and living areas showing walls and floors.",
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
      message: "I'm your inspection guide. I'll walk you through filming, run the AI analysis, and confirm all 11 requirements with you. First: give the unit a nickname and pick its funding type.",
      speak: "Hi! I'm your inspection guide. I'll walk you through the whole thing. First, let's set up the unit.",
      actions: [{ id: "setup", label: "Set up the unit", primary: true }],
    };
  }
  const nextRoom = MOVE_IN_READY_ROOMS.find((room) => !input.filmedRoomIds.includes(room.id)) ?? null;
  if (nextRoom) {
    const filmed = input.filmedRoomIds.length;
    return {
      key: `film-${nextRoom.id}`,
      title: `Step ${filmed + 1} of 4: film the ${nextRoom.label}`,
      message: `One continuous take. I'll narrate exactly what to show while the camera rolls. Tap below and I'll open the camera for the ${nextRoom.label}.`,
      speak: `Step ${filmed + 1} of 4. Let's film the ${nextRoom.label}. I'll tell you exactly what to show.`,
      actions: [{ id: "film-room", label: `Film the ${nextRoom.label}`, primary: true, roomId: nextRoom.id }],
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
      message: `All 4 rooms are filmed. I'll analyze every clip and draft all 11 requirements for you. Tapping below confirms the clips are staged mock-unit footage with no tenants, faces, addresses, or case notes, and that each clip will be sent to Meta for live processing.`,
      speak: `All filmed. Confirm your clips are staged mock footage, and I'll analyze everything now.`,
      actions: [{ id: "analyze-all", label: `Confirm & analyze ${remaining} room${remaining === 1 ? "" : "s"}`, primary: true }],
    };
  }
  if (input.resolvedDecisions < MOVE_IN_READY_ELEMENTS.length) {
    if (input.prefilledDecisions === 0 && input.nextUndecidedId) {
      return {
        key: "prefill",
        title: "Drafts are ready — quick review",
        message: "The AI drafted every requirement from your clips. I'll fill them all in below; you just confirm each one in person with a single checkbox, then save everything at once.",
        speak: "Drafts are ready. I'll fill in the whole checklist. You just confirm each item.",
        actions: [{ id: "open-requirement", label: `Start: ${input.nextUndecidedLabel ?? "checklist"}`, primary: true, elementId: input.nextUndecidedId }],
      };
    }
    const remaining = MOVE_IN_READY_ELEMENTS.length - input.resolvedDecisions;
    return {
      key: "confirm",
      title: `${remaining} requirement${remaining === 1 ? "" : "s"} left to confirm`,
      message: "For each item: read the AI draft, do the quick in-person check, tick the confirmation, and move on. Nothing is decided until you confirm it.",
      speak: `${remaining} items left. Check each one in person and confirm.`,
      actions: input.nextUndecidedId
        ? [{ id: "open-requirement", label: `Next: ${input.nextUndecidedLabel ?? "requirement"}`, primary: true, elementId: input.nextUndecidedId }]
        : [{ id: "save-all", label: "Save all confirmed", primary: true }],
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
