/**
 * HMIS case-note draft export (REQ-E2).
 *
 * Deterministic plain-text template built only from the evaluator's
 * recorded decisions and both signatures. The determination reuses
 * REQ-E1's derivation exactly (via `buildLahsa1083Json`), so the case
 * note can never disagree with the LAHSA JSON. Optional AI wording
 * polish happens server-side behind `TEXT_POLISH_ENABLED=1` (see
 * `src/server/exports/polish-case-note.ts`); this template is always
 * the fallback and is labeled as a draft.
 */

import {
  MOVE_IN_READY_ELEMENTS,
  type EvaluatorDecisionSet,
  type EvaluatorSignoff,
  type FundingType,
} from "../domain/move-in-ready";
import {
  buildLahsa1083Json,
  type ParticipantSignoff,
} from "./lahsa-1083";

export interface CaseNoteInput {
  fundingType: FundingType;
  pseudonym: string;
  decisions: EvaluatorDecisionSet;
  /** Staff signature: the evaluator sign-off. */
  signoff: EvaluatorSignoff;
  /** REQ-F1 participant co-signature (record field `participantSignoff`). */
  participantSignoff: ParticipantSignoff;
  /** REQ-F2 flag (record field `participantVisualAlarmsRequired`). */
  participantVisualAlarmsRequired?: boolean;
  /** Case-note date override (ISO); defaults to the current time. */
  generatedAt?: string;
}

export const CASE_NOTE_DRAFT_LABEL = "Case note draft — review before pasting into HMIS.";

export const CASE_NOTE_REINSPECTION_SENTENCE = "Re-inspection required before subsidy release.";

const RATIONALE_CLIP_LENGTH = 200;

function cleanLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value: string, maxLength: number): string {
  return cleanLine(value).slice(0, maxLength);
}

/**
 * Build the deterministic case-note text. Gates mirror REQ-E1: LAHSA
 * funding, a completed A/D decision for every element, and both
 * signatures. Throws with honest copy otherwise.
 */
export function buildCaseNoteText(input: CaseNoteInput): string {
  // The LAHSA builder enforces every gate and derives the determination;
  // reusing it keeps the two exports consistent by construction.
  const lahsa = buildLahsa1083Json({
    sessionId: "case-note",
    fundingType: input.fundingType,
    decisions: input.decisions,
    signoff: input.signoff,
    participantSignoff: input.participantSignoff,
    participantVisualAlarmsRequired: input.participantVisualAlarmsRequired,
    generatedAt: input.generatedAt,
  });
  if (!input.pseudonym.trim()) {
    throw new Error("A unit pseudonym is required before the case-note export.");
  }

  const lines: string[] = [
    CASE_NOTE_DRAFT_LABEL,
    `Date: ${lahsa.inspection_timestamp.slice(0, 10)}`,
    `Unit: ${clip(input.pseudonym, 80)}`,
    `Determination: ${lahsa.overall_determination}`,
    "",
    "Elements:",
  ];
  for (const element of MOVE_IN_READY_ELEMENTS) {
    const decision = input.decisions[element.id];
    // Gate-checked above: every decision is A or D with a rationale.
    if (decision.status !== "A" && decision.status !== "D") {
      throw new Error("Every element must have a completed evaluator decision before the case-note export.");
    }
    lines.push(`- ${element.label}: ${decision.status} — ${clip(decision.rationale, RATIONALE_CLIP_LENGTH)}`);
  }

  lines.push(
    "",
    `Evaluator: ${clip(input.signoff.evaluatorName, 120)}`,
    `Participant: ${clip(input.participantSignoff.participantName, 120)}`,
  );

  const deficient = MOVE_IN_READY_ELEMENTS.filter(
    (element) => input.decisions[element.id].status === "D",
  );
  if (deficient.length > 0) {
    lines.push("", "Deficiencies:");
    for (const element of deficient) {
      const decision = input.decisions[element.id];
      if (decision.status !== "D") continue;
      lines.push(
        `- ${element.label}: ${cleanLine(decision.deficiency.correction)}; ` +
          `complete by ${decision.deficiency.completionDate}; reinspect ${decision.deficiency.reinspectionDate}.`,
      );
    }
    lines.push(CASE_NOTE_REINSPECTION_SENTENCE);
  }

  return `${lines.join("\n")}\n`;
}
