/**
 * Langfuse evaluation dataset definitions for the walkthrough pipeline
 * (Sprint 5 REQ-O2). Pure builders only — no network, no keys.
 *
 * The benchmark pins five accuracy dimensions against staged/mock-unit
 * clips. Cases carry references (room, clip hash, frame ids), never
 * media bytes or resident-identifying content. The owner pushes items
 * with scripts/langfuse-eval-push.mjs (keys required, never in CI);
 * scoring runs in Langfuse against recorded traces.
 */

export const EVAL_DATASET_NAME = "meta-inspect-walkthrough-v1";

export const EVAL_DIMENSIONS = [
  "water-flow-accuracy",
  "object-classification",
  "evidence-grounding",
  "uncertainty-abstention",
  "false-positives",
] as const;

export type EvalDimension = (typeof EVAL_DIMENSIONS)[number];

export interface EvalCaseInput {
  /** Stable case id, e.g. "kitchen-faucet-flow-01". */
  caseId: string;
  dimension: EvalDimension;
  /** Room whose staged clip the case runs against. */
  roomId: string;
  /** SHA-256 of the staged source clip (reference, never bytes). */
  sourceVideoSha256: string;
  /** What the run must establish, in plain terms. */
  task: string;
  /** Expected behavior the scorer checks. */
  expected: string;
}

export interface EvalCaseItem {
  id: string;
  dimension: EvalDimension;
  input: {
    roomId: string;
    sourceVideoSha256: string;
    task: string;
  };
  expectedOutput: string;
}

const CASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isEvalDimension(value: unknown): value is EvalDimension {
  return (
    typeof value === "string" &&
    (EVAL_DIMENSIONS as readonly string[]).includes(value)
  );
}

/**
 * Build one validated dataset item. Throws with honest copy on any
 * malformed field; rejects oversized text and non-reference payloads.
 */
export function buildEvalCaseItem(input: EvalCaseInput): EvalCaseItem {
  if (typeof input.caseId !== "string" || !CASE_ID_PATTERN.test(input.caseId)) {
    throw new Error("Eval case id must be 1-80 ASCII letters, digits, '-' or '_'.");
  }
  if (!isEvalDimension(input.dimension)) {
    throw new Error(`Eval dimension must be one of: ${EVAL_DIMENSIONS.join(", ")}.`);
  }
  if (typeof input.roomId !== "string" || input.roomId.trim().length === 0 || input.roomId.length > 64) {
    throw new Error("Eval case roomId must be a non-empty label of at most 64 characters.");
  }
  if (typeof input.sourceVideoSha256 !== "string" || !SHA256_PATTERN.test(input.sourceVideoSha256)) {
    throw new Error("Eval case sourceVideoSha256 must be a lowercase hex SHA-256.");
  }
  if (typeof input.task !== "string" || input.task.trim().length === 0 || input.task.length > 2000) {
    throw new Error("Eval case task must be non-empty text of at most 2000 characters.");
  }
  if (typeof input.expected !== "string" || input.expected.trim().length === 0 || input.expected.length > 2000) {
    throw new Error("Eval case expected behavior must be non-empty text of at most 2000 characters.");
  }
  return {
    id: input.caseId,
    dimension: input.dimension,
    input: {
      roomId: input.roomId.trim(),
      sourceVideoSha256: input.sourceVideoSha256,
      task: input.task.trim(),
    },
    expectedOutput: input.expected.trim(),
  };
}

/**
 * Seed cases for the five benchmark dimensions, written against the
 * staged kitchen/bathroom clips. Clip hashes are filled by the owner
 * from the staged fixtures before pushing (never invent them).
 */
export function seedEvalCases(sourceVideoSha256ByRoom: Record<string, string>): EvalCaseItem[] {
  const kitchen = sourceVideoSha256ByRoom.kitchen ?? "";
  const bathroom = sourceVideoSha256ByRoom.bathroom ?? "";
  return [
    buildEvalCaseItem({
      caseId: "kitchen-faucet-flow-01",
      dimension: "water-flow-accuracy",
      roomId: "kitchen",
      sourceVideoSha256: kitchen,
      task: "Watch the faucet segment. Report whether running water is visibly observable, or only the faucet fixture itself.",
      expected: "Distinguishes a visible faucet from observable running water; claims flow only when frames show it.",
    }),
    buildEvalCaseItem({
      caseId: "kitchen-undersink-01",
      dimension: "object-classification",
      roomId: "kitchen",
      sourceVideoSha256: kitchen,
      task: "Identify the under-sink cabinet area and the faucet as separate concepts.",
      expected: "Never labels the under-sink cabinet as a faucet; each concept maps to its own evidence.",
    }),
    buildEvalCaseItem({
      caseId: "bathroom-evidence-01",
      dimension: "evidence-grounding",
      roomId: "bathroom",
      sourceVideoSha256: bathroom,
      task: "Produce one observation per visible fixture with a supporting frame reference.",
      expected: "Every observation cites a specific frame id + timestamp from the submitted clip.",
    }),
    buildEvalCaseItem({
      caseId: "bathroom-dark-corner-01",
      dimension: "uncertainty-abstention",
      roomId: "bathroom",
      sourceVideoSha256: bathroom,
      task: "Assess the area behind the door, which the footage does not clearly show.",
      expected: "Abstains with needs-human-check instead of asserting an unobserved condition.",
    }),
    buildEvalCaseItem({
      caseId: "kitchen-no-fixture-01",
      dimension: "false-positives",
      roomId: "kitchen",
      sourceVideoSha256: kitchen,
      task: "List only fixtures and conditions actually visible in the clip.",
      expected: "No invented fixtures or conditions; every claim is frame-supported.",
    }),
  ];
}
