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
  | { kind: "element-details"; elementId: MoveInReadyElementId }
  | { kind: "fire-safety" }
  | { kind: "agency" }
  | { kind: "landlord-discussion" }
  | { kind: "leadership" }
  | { kind: "participant" }
  | { kind: "signoff" }
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
  /**
   * Element routed to the in-tour deficiency-detail card after a
   * review-item confirm failed for an incomplete D plan. View-held
   * (like bathsConfirmed): a reload falls back to the review item,
   * which re-routes on the next failed confirm.
   */
  detailsElementId: MoveInReadyElementId | null;
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
    case "element-details":
      return `element-details:${node.elementId}`;
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

  // A Deficient confirm that failed for an incomplete correction plan
  // completes its details here instead of leaving the tour. The card
  // saves through the same validators as the detail form. Checked before
  // the review queue so the failed item resumes here, not on its card;
  // saved or skipped elements fall through to the normal chain.
  if (input.detailsElementId && !input.skippedElementIds.has(input.detailsElementId)) {
    const detailsDecision = record.decisions[input.detailsElementId];
    if (!detailsDecision || detailsDecision.status === "unreviewed") {
      return { kind: "element-details", elementId: input.detailsElementId };
    }
  }

  const reviewId = guidedReviewQueue(record, input.skippedElementIds)[0];
  if (reviewId) return { kind: "review-item", elementId: reviewId };

  // Skipped-but-undecided items finish the tour: the evaluator chose
  // manual review for them, and sign-off cannot save until they decide.
  const skippedOpen = [...input.skippedElementIds].some(
    (elementId) => (record.decisions[elementId]?.status ?? "unreviewed") === "unreviewed",
  );
  if (skippedOpen) return { kind: "finish" };

  // Fire Safety 11a/11b are independent marks: an aggregate A/D decision
  // without explicit unit + public-area outcomes gets them here.
  const smoke = record.decisions["demo-smoke-co"];
  if (
    (smoke?.status === "A" || smoke?.status === "D") &&
    !fireAssessmentDecided(smoke.fireSafetyAssessment)
  ) {
    return { kind: "fire-safety" };
  }

  // Administrative inputs in form-blocker order: the participant and
  // evaluator sign-offs cannot save until agency, landlord discussion,
  // and any required leadership fields exist.
  if (!record.evaluatorAgencyName.trim()) return { kind: "agency" };
  if (!record.landlordDiscussion || (record.landlordDiscussion === "yes" && !record.landlordDiscussionDate)) {
    return { kind: "landlord-discussion" };
  }
  if (record.leadershipSignoffRequired && !leadershipComplete(record)) {
    return { kind: "leadership" };
  }
  if (!record.participantSignoff) return { kind: "participant" };
  if (!record.signoff) return { kind: "signoff" };

  return { kind: "finish" };
}

/** True when both 11a unit and 11b public-area clauses carry an A/D mark. */
export function fireAssessmentDecided(
  assessment: { unitDetectors: string; publicAreaDetectors: string } | undefined,
): boolean {
  if (!assessment) return false;
  const decided = (clause: string): boolean => clause === "A" || clause === "D";
  return decided(assessment.unitDetectors) && decided(assessment.publicAreaDetectors);
}

/** True when the required leadership name, signature, and date exist. */
export function leadershipComplete(record: MoveInReadyInspection): boolean {
  return Boolean(
    record.leadershipNameAndTitle.trim() &&
    record.leadershipSignoff.trim() &&
    record.leadershipSignedAt,
  );
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
    return `Ahora filme ${label}, habitación ${position} de ${total}. Empiece a grabar; su lista de tomas está en pantalla. Termine el video cuando haya capturado cada toma.`;
  }
  const label = roomLabel(roomId);
  return `Let's film the ${label}, room ${position} of ${total}. Start recording — your shot list is on screen. End the video when you have captured every shot.`;
}

/**
 * Spoken only, never a shot card: after the last filming cue, the guide
 * closes the section by telling the evaluator to end the video. The intro
 * above sets the same expectation up front — the app never promises a
 * save announcement it cannot make.
 */
export function filmOutroCue(language: "en" | "es" = "en"): string {
  return language === "es"
    ? "Esa es la lista completa de tomas. Termine el video cuando haya capturado cada toma."
    : "That's the full shot list — end the video when you have captured every shot.";
}

/** Static guided-tour scripts in Spanish (REQ-R2). Pinned against VOICE_CLIP_TEXTS_ES. */
export const TOUR_SCRIPT_ES = {
  welcome: "Le guiaré en esta inspección paso a paso. Usted filma cada habitación, responde algunas preguntas por voz y revisa los borradores de la IA. Unos diez minutos. Toque Comenzar cuando esté listo.",
  consent: "Un consentimiento rápido antes de filmar. Esta demostración inspecciona solo una unidad simulada de prueba, sin inquilinos, rostros ni datos reales. Cada clip que filme se envía a Meta para el análisis de IA. Toque Entiendo, vamos a filmar para continuar.",
  analyze: "Ya filmó todas las habitaciones. Enviando sus clips para el análisis de IA. Esto toma unos minutos. Permanezca en esta pantalla.",
  finishComplete: "Inspección completa. Todas las entradas están listas, firmas incluidas. Vaya a la firma para revisar y exportar.",
  elementDetails: "Este requisito es deficiente. Complete el problema, la corrección y ambas fechas, luego guarde.",
  fireSafety: "Seguridad contra incendios tiene dos marcas: detectores de la unidad y de áreas comunes. Marque cada uno, luego guarde.",
  agency: "Escriba el nombre de su agencia para el formulario.",
  landlord: "¿Habló de los resultados con el propietario?",
  leadership: "Dirección de la agencia: nombre en letra de imprenta, firma y fecha.",
  participant: "El participante firma aquí: nombre, firma y la declaración del recorrido.",
  signoff: "Su turno: firma escrita y la declaración del evaluador.",
} as const;

/**
 * Spoken question on a review-item card. Static in both languages, so both
 * are pinned by the voice-inventory contract test.
 */
export const REVIEW_VOICE_QUESTION = "Say yes to confirm this draft, or no to edit it.";
export const REVIEW_VOICE_QUESTION_ES = "Diga sí para confirmar este borrador, o no para editarlo.";

/**
 * Spoken landlord-discussion question. Static in both languages, pinned
 * by the voice-inventory contract test.
 */
export const LANDLORD_VOICE_QUESTION = "Did you discuss the findings with the landlord?";
export const LANDLORD_VOICE_QUESTION_ES = "¿Habló de los resultados con el propietario?";

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
    case "element-details": {
      const label = elementLabel(node.elementId);
      return es
        ? `${label}. ${TOUR_SCRIPT_ES.elementDetails}`
        : `${label}. This one is Deficient. Fill in the issue, the fix, and both dates, then save.`;
    }
    case "fire-safety":
      return es ? TOUR_SCRIPT_ES.fireSafety : "Fire Safety has two marks: unit detectors and public-area detectors. Set each one, then save.";
    case "agency":
      return es ? TOUR_SCRIPT_ES.agency : "Enter your agency name for the form.";
    case "landlord-discussion":
      return "";
    case "leadership":
      return es ? TOUR_SCRIPT_ES.leadership : "Agency leadership: printed name, signature, and date.";
    case "participant":
      return es ? TOUR_SCRIPT_ES.participant : "The participant signs here: name, signature, and the walkthrough statement.";
    case "signoff":
      return es ? TOUR_SCRIPT_ES.signoff : "Your turn: typed signature and the evaluator statement.";
    case "finish": {
      const decided = MOVE_IN_READY_ELEMENTS.filter(
        (element) => (record.decisions[element.id]?.status ?? "unreviewed") !== "unreviewed",
      ).length;
      const total = MOVE_IN_READY_ELEMENTS.length;
      const missing = total - decided;
      if (missing === 0) {
        return es ? TOUR_SCRIPT_ES.finishComplete : "Inspection complete. Every input is done, signatures included. Head to sign-off to review and export.";
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
  const signoffDone =
    (record.evaluatorAgencyName.trim() ? 1 : 0) +
    (record.landlordDiscussion ? 1 : 0) +
    (!record.leadershipSignoffRequired || leadershipComplete(record) ? 1 : 0) +
    (record.participantSignoff ? 1 : 0) +
    (record.signoff ? 1 : 0);
  return [
    { key: "setup", label: "Setup", done: Math.min(setupDone, 3), total: 3 },
    { key: "film", label: "Film", done: Math.min(capturedRoomCount, record.roomIds.length), total: Math.max(record.roomIds.length, 1) },
    { key: "analyze", label: "Analyze", done: analysisSettled ? 1 : 0, total: 1 },
    { key: "review", label: "Review", done: reviewDone, total: MOVE_IN_READY_ELEMENTS.length },
    { key: "signoff", label: "Sign off", done: signoffDone, total: 5 },
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
