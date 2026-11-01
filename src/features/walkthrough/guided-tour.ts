/**
 * Guided voice tour engine (pure, UI-agnostic).
 *
 * The tour position is derived from inspection data, never from a step
 * counter, so reloading mid-tour resumes at the right node and the voice
 * agent always narrates the screen the user actually sees. Each node has
 * one spoken script and one visual; the view mirrors them 1:1.
 */
import {
  MOVE_IN_READY_ELEMENTS,
  parseRoomId,
  roomLabel,
  type ModelElementProposal,
  type MoveInReadyElementId,
  type MoveInReadyRoomId,
} from "../../domain/move-in-ready";
import type { MoveInReadyInspection } from "./inspection-store";
import { ASSISTANT_FILMING_SCRIPTS } from "./assistant-script";
import { FIX_LIST_TIERS } from "./fix-list";
import { LIVE_ELEMENT_SPECS } from "./live-elements";
import { VOICE_ROOM_CHECKS } from "./voice-checks";

export type TourAnalysisMode = "live" | "fixture" | "unconfigured";

export type GuidedTourNode =
  | { kind: "welcome" }
  | { kind: "ask-unit" }
  | { kind: "ask-baths" }
  | { kind: "consent" }
  | { kind: "ask-name" }
  | { kind: "film-room"; roomId: MoveInReadyRoomId }
  | { kind: "room-check"; roomId: MoveInReadyRoomId; index: number }
  | { kind: "analyze" }
  | { kind: "live"; elementId: MoveInReadyElementId }
  | { kind: "review-item"; elementId: MoveInReadyElementId }
  | { kind: "finish" };

export interface GuidedTourInput {
  started: boolean;
  bathsConfirmed: boolean;
  analysisSettled: boolean;
  record: MoveInReadyInspection;
  capturedRoomIds: readonly MoveInReadyRoomId[];
  analysisMode: TourAnalysisMode;
  online: boolean;
  batchActive: boolean;
  skippedElementIds: ReadonlySet<MoveInReadyElementId>;
}

/** Risk-ranked review order: life and safety first, never form order. */
export const GUIDED_REVIEW_ORDER: readonly MoveInReadyElementId[] =
  FIX_LIST_TIERS.flatMap((tier) => [...tier.elementIds]);

export function elementLabel(elementId: MoveInReadyElementId): string {
  return MOVE_IN_READY_ELEMENTS.find((element) => element.id === elementId)?.label ?? elementId;
}

/** Stable key for speech effects: one utterance per node visit. */
export function tourNodeKey(node: GuidedTourNode): string {
  switch (node.kind) {
    case "film-room":
      return `film-room:${node.roomId}`;
    case "room-check":
      return `room-check:${node.roomId}:${node.index}`;
    case "live":
      return `live:${node.elementId}`;
    case "review-item":
      return `review-item:${node.elementId}`;
    default:
      return node.kind;
  }
}

function firstUnansweredCheck(
  record: MoveInReadyInspection,
  roomId: MoveInReadyRoomId,
): number | null {
  const parsed = parseRoomId(roomId);
  if (!parsed) return null;
  const questions = VOICE_ROOM_CHECKS[parsed.type];
  const answers = record.voiceChecks[roomId] ?? [];
  const index = questions.findIndex(
    (question) => !answers.some((entry) => entry.question === question),
  );
  return index === -1 ? null : index;
}

function isLiveElementOpen(
  record: MoveInReadyInspection,
  elementId: MoveInReadyElementId,
  skipped: ReadonlySet<MoveInReadyElementId>,
): boolean {
  if (skipped.has(elementId)) return false;
  if (record.elementClipIdentities[elementId] ?? record.proposals[elementId]) return false;
  return (record.decisions[elementId]?.status ?? "unreviewed") === "unreviewed";
}

export function deriveTourNode(input: GuidedTourInput): GuidedTourNode {
  const { record } = input;
  if (!input.started) return { kind: "welcome" };
  // Bare-minimum setup: unit shape drives the filming list, then consent.
  // The evaluator name is asked just before review, the first moment a
  // decision needs it. The unit nickname auto-fills at consent.
  if (record.unitType === "") return { kind: "ask-unit" };
  if (!input.bathsConfirmed) return { kind: "ask-baths" };
  if (record.fundingType !== "lahsa") return { kind: "consent" };

  // Conversational order: film one room, answer its in-person checks, then
  // move to the next room. Nothing waits until every room is filmed.
  const filmed = new Set(input.capturedRoomIds);
  for (const roomId of record.roomIds) {
    if (!filmed.has(roomId)) return { kind: "film-room", roomId };
    const index = firstUnansweredCheck(record, roomId);
    if (index !== null) return { kind: "room-check", roomId, index };
  }

  if (!input.analysisSettled) return { kind: "analyze" };

  const liveSpec = LIVE_ELEMENT_SPECS.find((spec) =>
    isLiveElementOpen(record, spec.elementId, input.skippedElementIds));
  if (liveSpec) return { kind: "live", elementId: liveSpec.elementId };

  if (!record.evaluatorName.trim()) return { kind: "ask-name" };

  const reviewId = GUIDED_REVIEW_ORDER.find((elementId) => {
    if (input.skippedElementIds.has(elementId)) return false;
    if (!record.proposals[elementId]) return false;
    return (record.decisions[elementId]?.status ?? "unreviewed") === "unreviewed";
  });
  if (reviewId) return { kind: "review-item", elementId: reviewId };

  return { kind: "finish" };
}

export interface TourScriptContext {
  record: MoveInReadyInspection;
  capturedRoomCount: number;
  batchActive: boolean;
  reviewPosition: { index: number; total: number } | null;
}

function suggestionWord(proposal: ModelElementProposal): string {
  return proposal.modelSuggestion === "A" ? "Approved" : "Deficient";
}

/**
 * Conversational filming brief: room position plus every shot on that
 * room's filming list, so the agent talks the evaluator through the full
 * checklist instead of just naming the room. Stays under the 500-char
 * voice prompt cap.
 */
export function filmRoomScript(roomId: MoveInReadyRoomId, position: number, total: number): string {
  const label = roomLabel(roomId);
  const intro = `Let's film the ${label}, room ${position} of ${total}.`;
  const outro = "I will tell you when it is saved.";
  const parsed = parseRoomId(roomId);
  const steps = ASSISTANT_FILMING_SCRIPTS[parsed?.type ?? "hallway"]
    .map((cue) => cue.replace(/^Recording\.\s*/i, "").replace(/\.\s*$/, "").trim())
    .filter((step) => step.length > 0);
  if (steps.length === 0) return `${intro} Hold your phone steady and film one slow take. ${outro}`;
  const last = steps[steps.length - 1]!;
  const listed = steps.length === 1 ? last : `${steps.slice(0, -1).join("; ")}; and finally ${last.charAt(0).toLowerCase() + last.slice(1)}`;
  const first = `${listed.charAt(0).toLowerCase() + listed.slice(1)}`;
  return `${intro} Start recording, then ${first}. ${outro}`;
}

/**
 * The exact sentence the agent speaks on node entry. Question nodes return
 * "" because the voice prompt speaks the question itself.
 */
export function tourScriptForNode(node: GuidedTourNode, context: TourScriptContext): string {
  const { record } = context;
  switch (node.kind) {
    case "welcome":
      return "I will guide this inspection step by step. You film each room, answer a few questions by voice, and review the A I drafts. About ten minutes. Tap Start when you are ready.";
    case "ask-name":
    case "ask-unit":
    case "ask-baths":
    case "room-check":
      return "";
    case "consent":
      return "Quick consent before we film. This demo inspects a staged mock unit only, with no tenants, faces, or real case data. Each clip you film is sent to Meta for A I analysis. Tap I understand, let's film, to continue.";
    case "film-room": {
      const total = record.roomIds.length;
      const position = record.roomIds.indexOf(node.roomId) + 1;
      return filmRoomScript(node.roomId, position, total);
    }
    case "analyze":
      return "Every room is filmed. Sending your clips for A I analysis now. This takes a few minutes. Stay on this screen.";
    case "live": {
      const spec = LIVE_ELEMENT_SPECS.find((item) => item.elementId === node.elementId);
      const label = elementLabel(node.elementId);
      const position = LIVE_ELEMENT_SPECS.findIndex((item) => item.elementId === node.elementId) + 1;
      if (!spec) return `Next proof, ${position} of ${LIVE_ELEMENT_SPECS.length}: ${label}.`;
      return `Next proof, ${position} of ${LIVE_ELEMENT_SPECS.length}: ${label}. ${spec.prompt} Tap Start live proof, then Record.`;
    }
    case "review-item": {
      const proposal = record.proposals[node.elementId];
      const label = elementLabel(node.elementId);
      const position = context.reviewPosition;
      const prefix = position ? `Item ${position.index} of ${position.total}. ` : "";
      if (!proposal) return `${prefix}${label}. No A I draft. Assess it in the full review.`;
      const excerpt = proposal.observation.length > 220
        ? `${proposal.observation.slice(0, 217).trimEnd()}…`
        : proposal.observation;
      return `${prefix}${label}. The A I suggests ${suggestionWord(proposal)}, confidence ${proposal.confidence} percent. ${excerpt} Tap Review draft, or Needs human check.`;
    }
    case "finish": {
      const decided = MOVE_IN_READY_ELEMENTS.filter(
        (element) => (record.decisions[element.id]?.status ?? "unreviewed") !== "unreviewed",
      ).length;
      const total = MOVE_IN_READY_ELEMENTS.length;
      const missing = total - decided;
      if (missing === 0) {
        return "Inspection complete. Every requirement is decided. Head to sign-off to review the result and export.";
      }
      return `Tour complete. ${decided} of ${total} requirements decided. ${missing} still need${missing === 1 ? "s" : ""} the detail form in manual review. Head to sign-off when ready.`;
    }
  }
}

export interface TourSectionProgress {
  key: string;
  label: string;
  done: number;
  total: number;
}

export function tourProgress(
  record: MoveInReadyInspection,
  capturedRoomCount: number,
  analysisSettled: boolean,
): TourSectionProgress[] {
  const setupDone =
    (record.evaluatorName.trim() ? 1 : 0) +
    (record.unitType === "" ? 0 : 1) +
    (record.fundingType === "lahsa" ? 1 : 0);
  const liveDone = LIVE_ELEMENT_SPECS.filter((spec) =>
    Boolean(
      record.elementClipIdentities[spec.elementId] ??
      record.proposals[spec.elementId] ??
      (record.decisions[spec.elementId]?.status !== "unreviewed" ? true : undefined),
    )).length;
  const reviewDone = MOVE_IN_READY_ELEMENTS.filter(
    (element) => (record.decisions[element.id]?.status ?? "unreviewed") !== "unreviewed",
  ).length;
  return [
    { key: "setup", label: "Setup", done: Math.min(setupDone, 3), total: 3 },
    { key: "film", label: "Film", done: Math.min(capturedRoomCount, record.roomIds.length), total: Math.max(record.roomIds.length, 1) },
    { key: "analyze", label: "Analyze", done: analysisSettled ? 1 : 0, total: 1 },
    { key: "proofs", label: "Proofs", done: liveDone, total: LIVE_ELEMENT_SPECS.length },
    { key: "review", label: "Review", done: reviewDone, total: MOVE_IN_READY_ELEMENTS.length },
  ];
}

/** Ordered undecided proposals for the review-item position readout. */
export function guidedReviewQueue(
  record: MoveInReadyInspection,
  skipped: ReadonlySet<MoveInReadyElementId>,
): MoveInReadyElementId[] {
  return GUIDED_REVIEW_ORDER.filter((elementId) => {
    if (skipped.has(elementId)) return false;
    if (!record.proposals[elementId]) return false;
    return (record.decisions[elementId]?.status ?? "unreviewed") === "unreviewed";
  });
}
