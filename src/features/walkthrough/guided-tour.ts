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
  MOVE_IN_READY_ELEMENT_IDS,
  parseRoomId,
  roomLabel,
  type EvaluatorDecision,
  type ModelElementProposal,
  type MoveInReadyElementId,
  type MoveInReadyRoomId,
} from "../../domain/move-in-ready";
import type { MoveInReadyInspection } from "./inspection-store";
import { filmingScriptForRoom } from "./assistant-script";
import { FIX_LIST_TIERS } from "./fix-list";
import { checksForRoom } from "./voice-checks";
import { parseYesNo } from "./voice-parse";

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
  const language = record.tourLanguage === "es" ? "es" : "en";
  const questions = checksForRoom(record, roomId, language);
  if (questions.length === 0) return null;
  const answers = record.voiceChecks[roomId] ?? [];
  const index = questions.findIndex(
    (question) => !answers.some((entry) => entry.question === question),
  );
  return index === -1 ? null : index;
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

  if (!record.evaluatorName.trim()) return { kind: "ask-name" };

  const reviewId = guidedReviewQueue(record, input.skippedElementIds)[0];
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
 * Visible shot checklist for a film-room node: the full filming list as
 * short text cues. Shown on screen so the evaluator can film without
 * waiting for a spoken lecture first.
 */
export function filmRoomShots(roomId: MoveInReadyRoomId, language: "en" | "es" = "en"): readonly string[] {
  const steps = filmingScriptForRoom(roomId, language)
    .map((cue) => cue.replace(/^(Recording|Grabando)\.\s*/i, "").replace(/\.\s*$/, "").trim())
    .filter((step) => step.length > 0);
  if (steps.length > 0) return steps;
  return language === "es"
    ? ["Sostenga su teléfono firme y filme una toma lenta"]
    : ["Hold your phone steady and film one slow take"];
}

/** Display label for a concrete room in the Spanish tour (REQ-R2). */
export function roomLabelEs(roomId: MoveInReadyRoomId): string {
  const parsed = parseRoomId(roomId);
  if (!parsed) return roomId;
  if (parsed.legacy && roomId === "bedroom-living") return "Habitación / sala";
  const base = parsed.type === "kitchen" ? "Cocina"
    : parsed.type === "bathroom" ? "Baño"
      : parsed.type === "bedroom" ? "Habitación"
        : parsed.type === "living-room" ? "Sala"
          : "Pasillo";
  if (parsed.type === "bathroom" || parsed.type === "bedroom") {
    return parsed.index === 1 && !roomId.includes("-") ? base : `${base} ${parsed.index}`;
  }
  return base;
}

/**
 * Short spoken intro for a film-room node: room position plus a pointer
 * to the on-screen shot list. The shots themselves are visible text, so
 * filming starts immediately instead of after a long narration.
 */
export function filmRoomScript(roomId: MoveInReadyRoomId, position: number, total: number, language: "en" | "es" = "en"): string {
  if (language === "es") {
    const label = roomLabelEs(roomId);
    return `Ahora filme ${label}, habitación ${position} de ${total}. Empiece a grabar; su lista de tomas está en pantalla. Le avisaré cuando se guarde.`;
  }
  const label = roomLabel(roomId);
  return `Let's film the ${label}, room ${position} of ${total}. Start recording — your shot list is on screen. I will tell you when it is saved.`;
}

/** Static guided-tour scripts in Spanish (REQ-R2). Pinned against VOICE_CLIP_TEXTS_ES. */
export const TOUR_SCRIPT_ES = {
  welcome: "Le guiaré en esta inspección paso a paso. Usted filma cada habitación, responde algunas preguntas por voz y revisa los borradores de la IA. Unos diez minutos. Toque Comenzar cuando esté listo.",
  consent: "Un consentimiento rápido antes de filmar. Esta demostración inspecciona solo una unidad simulada de prueba, sin inquilinos, rostros ni datos reales. Cada clip que filme se envía a Meta para el análisis de IA. Toque Entiendo, vamos a filmar para continuar.",
  analyze: "Ya filmó todas las habitaciones. Enviando sus clips para el análisis de IA. Esto toma unos minutos. Permanezca en esta pantalla.",
  finishComplete: "Inspección completa. Todos los requisitos están decididos. Vaya a la firma para revisar el resultado y exportar.",
} as const;

/**
 * Spoken question on a review-item card. Static in both languages, so both
 * are pinned by the voice-inventory contract test.
 */
export const REVIEW_VOICE_QUESTION = "Say yes to confirm this draft, or no to edit it.";
export const REVIEW_VOICE_QUESTION_ES = "Diga sí para confirmar este borrador, o no para editarlo.";

/** Spoken read-back after the evaluator answers their name (dynamic: embeds the name). */
export function nameReadbackScript(name: string, language: "en" | "es" = "en"): string {
  return language === "es"
    ? `Escuché ${name}. Diga sí para guardarlo o toque Guardar.`
    : `I heard ${name}. Say yes to save it, or tap Save.`;
}

/**
 * The exact sentence the agent speaks on node entry. Question nodes return
 * "" because the voice prompt speaks the question itself. Element labels
 * and AI observation excerpts stay in English in both languages: the Form
 * 1083 catalog and model output are not translated (REQ-R2 scope is the
 * tour narration).
 */
export function tourScriptForNode(node: GuidedTourNode, context: TourScriptContext, language: "en" | "es" = "en"): string {
  const { record } = context;
  const es = language === "es";
  switch (node.kind) {
    case "welcome":
      return es ? TOUR_SCRIPT_ES.welcome : "I will guide this inspection step by step. You film each room, answer a few questions by voice, and review the A I drafts. About ten minutes. Tap Start when you are ready.";
    case "ask-name":
    case "ask-unit":
    case "ask-baths":
    case "room-check":
      return "";
    case "consent":
      return es ? TOUR_SCRIPT_ES.consent : "Quick consent before we film. This demo inspects a staged mock unit only, with no tenants, faces, or real case data. Each clip you film is sent to Meta for A I analysis. Tap I understand, let's film, to continue.";
    case "film-room": {
      const total = record.roomIds.length;
      const position = record.roomIds.indexOf(node.roomId) + 1;
      return filmRoomScript(node.roomId, position, total, language);
    }
    case "analyze":
      return es ? TOUR_SCRIPT_ES.analyze : "Every room is filmed. Sending your clips for A I analysis now. This takes a few minutes. Stay on this screen.";
    case "review-item": {
      const proposal = record.proposals[node.elementId];
      const label = elementLabel(node.elementId);
      const position = context.reviewPosition;
      if (!proposal) {
        return es
          ? `${position ? `Punto ${position.index} de ${position.total}. ` : ""}${label}. Sin borrador de IA. Evalúelo en la revisión completa.`
          : `${position ? `Item ${position.index} of ${position.total}. ` : ""}${label}. No A I draft. Assess it in the full review.`;
      }
      const excerpt = proposal.observation.length > 220
        ? `${proposal.observation.slice(0, 217).trimEnd()}…`
        : proposal.observation;
      if (es) {
        const suggestion = proposal.modelSuggestion === "A" ? "Aprobado" : "Deficiente";
        return `${position ? `Punto ${position.index} de ${position.total}. ` : ""}${label}. La IA sugiere ${suggestion}, confianza ${proposal.confidence} por ciento. ${excerpt} Diga sí para confirmar, no para corregirlo, o toque Necesita revisión humana.`;
      }
      const prefix = position ? `Item ${position.index} of ${position.total}. ` : "";
      return `${prefix}${label}. The A I suggests ${suggestionWord(proposal)}, confidence ${proposal.confidence} percent. ${excerpt} Say yes to confirm, no to edit it, or tap Needs human check.`;
    }
    case "finish": {
      const decided = MOVE_IN_READY_ELEMENTS.filter(
        (element) => (record.decisions[element.id]?.status ?? "unreviewed") !== "unreviewed",
      ).length;
      const total = MOVE_IN_READY_ELEMENTS.length;
      const missing = total - decided;
      if (missing === 0) {
        return es ? TOUR_SCRIPT_ES.finishComplete : "Inspection complete. Every requirement is decided. Head to sign-off to review the result and export.";
      }
      return es
        ? `Recorrido completo. ${decided} de ${total} requisitos decididos. ${missing} aún ${missing === 1 ? "necesita" : "necesitan"} el formulario detallado en la revisión manual. Vaya a la firma cuando esté listo.`
        : `Tour complete. ${decided} of ${total} requirements decided. ${missing} still need${missing === 1 ? "s" : ""} the detail form in manual review. Head to sign-off when ready.`;
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
  const reviewDone = MOVE_IN_READY_ELEMENTS.filter(
    (element) => (record.decisions[element.id]?.status ?? "unreviewed") !== "unreviewed",
  ).length;
  return [
    { key: "setup", label: "Setup", done: Math.min(setupDone, 3), total: 3 },
    { key: "film", label: "Film", done: Math.min(capturedRoomCount, record.roomIds.length), total: Math.max(record.roomIds.length, 1) },
    { key: "analyze", label: "Analyze", done: analysisSettled ? 1 : 0, total: 1 },
    { key: "review", label: "Review", done: reviewDone, total: MOVE_IN_READY_ELEMENTS.length },
  ];
}

/**
 * Voice answer on a review-item node: yes confirms the draft through the
 * same guarded path as the Confirm tap (same evaluator identity,
 * acknowledgment, and detail-form fallbacks), no opens the detail form
 * for a differing verdict, anything else re-asks.
 */
export function reviewVoiceAction(transcript: string): "confirm" | "edit" | null {
  const parsed = parseYesNo(transcript);
  if (parsed === "yes") return "confirm";
  if (parsed === "no") return "edit";
  return null;
}

/** True when an element was reopened by a re-inspection (REQ-L1). */
function hasPriorDeficiency(decision: EvaluatorDecision | undefined): boolean {
  return decision?.status === "unreviewed" && decision.priorDeficiency !== undefined;
}

/** Ordered undecided proposals for the review-item position readout. */
export function guidedReviewQueue(
  record: MoveInReadyInspection,
  skipped: ReadonlySet<MoveInReadyElementId>,
): MoveInReadyElementId[] {
  // Re-inspection filter (REQ-L1): while any element carries a
  // prior-deficiency snapshot, the tour reviews only those elements.
  // Re-deciding an element drops its snapshot, so the filter releases
  // element by element and turns off when the re-inspection is complete.
  const reinspectionActive = MOVE_IN_READY_ELEMENT_IDS.some((elementId) =>
    hasPriorDeficiency(record.decisions[elementId]),
  );
  return GUIDED_REVIEW_ORDER.filter((elementId) => {
    if (skipped.has(elementId)) return false;
    const decision = record.decisions[elementId];
    // Elements without an AI draft still get their question: the tour card
    // offers the detail form or a human check instead of silently skipping.
    if ((decision?.status ?? "unreviewed") !== "unreviewed") return false;
    if (reinspectionActive && !hasPriorDeficiency(decision)) return false;
    return true;
  });
}
