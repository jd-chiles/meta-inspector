/** Pure walkthrough-guide model: which step the user is on and what comes next.
 * Derived only from saved walkthrough state — deterministic progress, never
 * model output. The HUD/HQS route has no walkthrough here, so it gets none.
 */

export type GuideStepState = "done" | "current" | "locked";
export type GuideStepId = "setup" | "film" | "review" | "signoff" | "export";

export type GuideAction =
  | { type: "setup" }
  | { type: "room"; roomId: string }
  | { type: "step"; step: "capture" | "review" | "signoff" | "profile" }
  | { type: "none" };

export interface GuideRoomState {
  id: string;
  label: string;
  captured: boolean;
}

export interface GuideStep {
  id: GuideStepId;
  title: string;
  detail: string;
  state: GuideStepState;
  action: GuideAction;
}

export interface GuideInput {
  fundingType: "lahsa" | "hud" | "unknown";
  canCapture: boolean;
  pseudonym: string;
  rooms: GuideRoomState[];
  resolvedDecisions: number;
  totalElements: number;
  signed: boolean;
}

export interface GuideModel {
  steps: GuideStep[];
  currentIndex: number;
  nextLabel: string;
  nextAction: GuideAction;
}

export function deriveGuideModel(input: GuideInput): GuideModel | null {
  if (input.fundingType === "hud") return null;
  const capturedCount = input.rooms.filter((room) => room.captured).length;
  const allRooms = input.rooms.length > 0 && capturedCount === input.rooms.length;
  const allDecided =
    input.totalElements > 0 && input.resolvedDecisions >= input.totalElements;
  const nextRoom = input.rooms.find((room) => !room.captured) ?? null;

  const setup: GuideStep = {
    id: "setup",
    title: "Set up this unit",
    detail: input.canCapture ? input.pseudonym : "Unit pseudonym + LAHSA funding",
    state: input.canCapture ? "done" : "current",
    action: input.canCapture ? { type: "step", step: "capture" } : { type: "setup" },
  };
  const film: GuideStep = {
    id: "film",
    title: "Film 4 rooms",
    detail: `${capturedCount} of ${input.rooms.length} clips saved`,
    state: !input.canCapture ? "locked" : allRooms ? "done" : "current",
    action:
      !input.canCapture || !nextRoom
        ? { type: "none" }
        : { type: "room", roomId: nextRoom.id },
  };
  const review: GuideStep = {
    id: "review",
    title: `Review ${input.totalElements} elements`,
    detail: `${Math.min(input.resolvedDecisions, input.totalElements)} of ${input.totalElements} decided in person`,
    state: !input.canCapture ? "locked" : allDecided ? "done" : "current",
    action: !input.canCapture ? { type: "none" } : { type: "step", step: "review" },
  };
  const signoff: GuideStep = {
    id: "signoff",
    title: "Sign off",
    detail: input.signed ? "Evaluator sign-off recorded" : "Sign-off + attestation",
    state: !input.canCapture ? "locked" : input.signed ? "done" : allDecided ? "current" : "locked",
    action: !input.canCapture ? { type: "none" } : { type: "step", step: "signoff" },
  };
  const exportStep: GuideStep = {
    id: "export",
    title: "Export packet",
    detail: "PDF + JSON from Sign-off",
    state: !input.canCapture || !input.signed ? "locked" : "current",
    action: !input.canCapture || !input.signed ? { type: "none" } : { type: "step", step: "signoff" },
  };
  const steps = [setup, film, review, signoff, exportStep];
  const currentIndex = steps.findIndex((step) => step.state === "current");
  const safeIndex = currentIndex >= 0 ? currentIndex : steps.length - 1;
  const current = steps[safeIndex];
  let nextLabel = "Walkthrough complete";
  if (current.id === "setup") nextLabel = "Set up this unit";
  else if (current.id === "film" && nextRoom) {
    nextLabel = `Film the ${nextRoom.label} (${capturedCount + 1} of ${input.rooms.length})`;
  } else if (current.id === "film") nextLabel = "Film rooms";
  else if (current.id === "review") nextLabel = `Review decisions (${input.resolvedDecisions} of ${input.totalElements})`;
  else if (current.id === "signoff") nextLabel = "Sign off this walkthrough";
  else if (current.id === "export") nextLabel = "Export the packet";
  return { steps, currentIndex: safeIndex, nextLabel, nextAction: current.action };
}
