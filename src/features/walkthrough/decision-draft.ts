/**
 * Pure evaluator-decision draft model for the 11-requirement review.
 * Prefill copies an AI draft into editable fields; one-tap confirm builds a
 * complete draft where the tap itself is the in-person acknowledgment. The
 * tap never invents deficiency details: a D draft without a complete
 * suggested plan is sent to the detail form instead of being saved.
 */
import type {
  EvaluatorDecision,
  FireSafetyAssessment,
  FireSafetyClauseOutcome,
  ModelElementProposal,
  MoveInReadyElementId,
} from "../../domain/move-in-ready";

export type DecisionChoice = "unreviewed" | "needs-human-check" | "A" | "D";
export type FireSafetyDraftOutcome = "" | FireSafetyClauseOutcome;

export interface DecisionDraft {
  choice: DecisionChoice;
  rationale: string;
  issueDescription: string;
  correction: string;
  completionDate: string;
  reinspectionDate: string;
  fireSafetyUnitDetectors: FireSafetyDraftOutcome;
  fireSafetyPublicAreaDetectors: FireSafetyDraftOutcome;
  planSuggestionReviewed: boolean;
  evidenceStillIds: string[];
  note: string;
}

export function fireSafetyAssessmentFromDraft(draft: DecisionDraft): FireSafetyAssessment {
  return {
    unitDetectors: draft.fireSafetyUnitDetectors || "needs-human-check",
    publicAreaDetectors: draft.fireSafetyPublicAreaDetectors || "needs-human-check",
  };
}

export function fireSafetyChoiceFromDraft(draft: DecisionDraft): DecisionChoice {
  const assessment = fireSafetyAssessmentFromDraft(draft);
  if (assessment.unitDetectors !== "A" && assessment.unitDetectors !== "D") return "needs-human-check";
  if (assessment.publicAreaDetectors !== "A" && assessment.publicAreaDetectors !== "D") return "needs-human-check";
  return assessment.unitDetectors === "D" || assessment.publicAreaDetectors === "D" ? "D" : "A";
}

export function completeFireSafetyAssessmentFromDraft(
  draft: DecisionDraft,
): { unitDetectors: "A" | "D"; publicAreaDetectors: "A" | "D" } | null {
  const unitDetectors = draft.fireSafetyUnitDetectors;
  const publicAreaDetectors = draft.fireSafetyPublicAreaDetectors;
  if ((unitDetectors !== "A" && unitDetectors !== "D") ||
      (publicAreaDetectors !== "A" && publicAreaDetectors !== "D")) return null;
  return { unitDetectors, publicAreaDetectors };
}

export function createDecisionDraft(decision: EvaluatorDecision): DecisionDraft {
  const fireSafetyAssessment = "fireSafetyAssessment" in decision ? decision.fireSafetyAssessment : undefined;
  if (decision.status === "A" || decision.status === "D") return {
    choice: decision.status,
    rationale: decision.rationale,
    issueDescription: decision.status === "D" ? decision.deficiency.issueDescription : "",
    correction: decision.status === "D" ? decision.deficiency.correction : "",
    completionDate: decision.status === "D" ? decision.deficiency.completionDate : "",
    reinspectionDate: decision.status === "D" ? decision.deficiency.reinspectionDate : "",
    fireSafetyUnitDetectors: fireSafetyAssessment?.unitDetectors ?? "",
    fireSafetyPublicAreaDetectors: fireSafetyAssessment?.publicAreaDetectors ?? "",
    planSuggestionReviewed: decision.status === "D",
    evidenceStillIds: decision.evidence.map((reference) => reference.stillId),
    note: "",
  };
  if (decision.status === "needs-human-check") return { choice: decision.status, rationale: "", issueDescription: "", correction: "", completionDate: "", reinspectionDate: "", fireSafetyUnitDetectors: fireSafetyAssessment?.unitDetectors ?? "", fireSafetyPublicAreaDetectors: fireSafetyAssessment?.publicAreaDetectors ?? "", planSuggestionReviewed: false, evidenceStillIds: [], note: decision.note };
  return { choice: "unreviewed", rationale: "", issueDescription: "", correction: "", completionDate: "", reinspectionDate: "", fireSafetyUnitDetectors: "", fireSafetyPublicAreaDetectors: "", planSuggestionReviewed: false, evidenceStillIds: [], note: "" };
}

/**
 * Copy an unreviewed AI draft into editable draft fields. Never clears the
 * plan-review confirmation, which the evaluator still performs explicitly.
 * Saving the decision records the in-person acknowledgment.
 */
export function prefillDraftFromProposal(draft: DecisionDraft, proposal: ModelElementProposal): DecisionDraft {
  return {
    ...draft,
    choice: proposal.modelSuggestion,
    rationale: draft.rationale.trim() ? draft.rationale : proposal.observation,
    evidenceStillIds: proposal.evidence.length > 0 ? proposal.evidence.map((reference) => reference.stillId) : draft.evidenceStillIds,
    ...(proposal.modelSuggestion === "D" && proposal.deficiencySuggestion ? {
      issueDescription: draft.issueDescription.trim() ? draft.issueDescription : proposal.deficiencySuggestion.deficientArea,
      correction: draft.correction.trim() ? draft.correction : proposal.deficiencySuggestion.correction,
      completionDate: draft.completionDate || proposal.deficiencySuggestion.completionDate,
      reinspectionDate: draft.reinspectionDate || proposal.deficiencySuggestion.reinspectionDate,
    } : {}),
  };
}

export type ConfirmDraftResult =
  | { ok: true; draft: DecisionDraft }
  | { ok: false; reason: string };

/** Deficiency-detail fields the evaluator completes for a D decision. */
export interface ElementDetailsInput {
  issueDescription: string;
  correction: string;
  completionDate: string;
  reinspectionDate: string;
}

/**
 * True when a one-tap confirm would fail for an incomplete D correction
 * plan. The guided tour routes those elements to its in-tour detail
 * card instead of leaving for the review detail form; every other
 * confirm failure (no draft, stale clip, empty observation, missing
 * stills) still needs the full review UI.
 */
export function confirmNeedsDetails(proposal: ModelElementProposal | undefined): boolean {
  if (!proposal || proposal.modelSuggestion !== "D") return false;
  const suggestion = proposal.deficiencySuggestion;
  return !(
    suggestion &&
    suggestion.deficientArea.trim() &&
    suggestion.correction.trim() &&
    suggestion.completionDate.trim() &&
    suggestion.reinspectionDate.trim()
  );
}

/**
 * Build a complete decision draft for one-tap confirm. The confirm tap is
 * the evaluator's in-person acknowledgment and plan review, so the caller
 * must show the suggestion (and the D plan) next to the button. Returns a
 * blocker instead of a draft when the tap cannot honestly decide: an empty
 * observation, a D without a complete suggested plan, or a D with no still
 * evidence. Fire safety confirms both sections 11a and 11b together.
 */
export function buildConfirmDraft(
  elementId: MoveInReadyElementId,
  proposal: ModelElementProposal,
  voiceNote: string | null,
): ConfirmDraftResult {
  const prefilled = prefillDraftFromProposal(createDecisionDraft({ status: "unreviewed" }), proposal);
  const rationale = voiceNote && !prefilled.rationale.includes(voiceNote)
    ? `${prefilled.rationale}\n${voiceNote}`.slice(0, 1000)
    : prefilled.rationale.slice(0, 1000);
  if (!rationale.trim()) {
    return { ok: false, reason: "The AI draft has no observation text. Assess it in the detail form." };
  }
  if (proposal.modelSuggestion === "D") {
    const suggestion = proposal.deficiencySuggestion;
    const complete = Boolean(suggestion) &&
      Boolean(suggestion!.deficientArea.trim()) &&
      Boolean(suggestion!.correction.trim()) &&
      Boolean(suggestion!.completionDate.trim()) &&
      Boolean(suggestion!.reinspectionDate.trim());
    if (!complete) {
      return { ok: false, reason: "This Deficient draft needs issue details. Complete them in the detail form." };
    }
    if (proposal.evidence.length === 0) {
      return { ok: false, reason: "This Deficient draft has no still evidence. Attach a still in the detail form." };
    }
  }
  return {
    ok: true,
    draft: {
      ...prefilled,
      rationale,
      planSuggestionReviewed: true,
      ...(elementId === "demo-smoke-co" ? {
        fireSafetyUnitDetectors: proposal.modelSuggestion,
        fireSafetyPublicAreaDetectors: proposal.modelSuggestion,
      } : {}),
    },
  };
}
