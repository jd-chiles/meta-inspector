/**
 * Domain contract for the Move-in Ready video walkthrough flow.
 *
 * Model output is kept in `ModelElementProposal` and has no path into
 * `EvaluatorDecision`. Proposals can help a worker choose what to inspect,
 * but only an explicit evaluator decision can contribute to a final result.
 * This module intentionally contains no reducer that can mark an inspection
 * reviewed or turn model output into a human decision.
 */

import type { ValidationResult } from "./catalog";

/** Version of the persisted Move-in Ready inspection/evidence contract. */
export const MOVE_IN_READY_SCHEMA_VERSION = 5;

export const MOVE_IN_READY_ROOMS = [
  { id: "kitchen", label: "Kitchen" },
  { id: "bathroom", label: "Bathroom" },
  { id: "bedroom-living", label: "Bedroom / living room" },
  { id: "hallway", label: "Hallway" },
] as const;

export type MoveInReadyRoomId = (typeof MOVE_IN_READY_ROOMS)[number]["id"];

/** Stable checklist identities so room prompt completion survives reloads. */
export const MOVE_IN_READY_ROOM_PROMPT_IDS = {
  kitchen: ["kitchen-water-drainage", "kitchen-surfaces-outlets", "kitchen-entry-lock", "kitchen-detector"],
  bathroom: ["bathroom-water-drainage", "bathroom-exhaust-fan", "bathroom-fixtures-lock", "bathroom-detector"],
  "bedroom-living": ["bedroom-living-surfaces-outlets", "bedroom-living-windows", "bedroom-living-detectors-lock"],
  hallway: ["hallway-walking-path", "hallway-detector", "hallway-entry-lock"],
} as const satisfies Record<MoveInReadyRoomId, readonly string[]>;

export type MoveInReadyPromptId =
  (typeof MOVE_IN_READY_ROOM_PROMPT_IDS)[MoveInReadyRoomId][number];

export function isMoveInReadyPromptIdForRoom(
  roomId: MoveInReadyRoomId,
  promptId: string,
): promptId is MoveInReadyPromptId {
  return (MOVE_IN_READY_ROOM_PROMPT_IDS[roomId] as readonly string[]).includes(promptId);
}

export interface MoveInReadyElement {
  id: string;
  label: string;
  roomIds: readonly MoveInReadyRoomId[];
}

/**
 * The labels follow the supplied product brief. The room associations guide
 * capture only; they do not assert a provider-verified mapping.
 */
export const MOVE_IN_READY_ELEMENTS = [
  {
    id: "demo-item-05",
    label: "Structure and materials",
    roomIds: ["kitchen", "bathroom", "bedroom-living", "hallway"],
  },
  {
    id: "demo-item-06",
    label: "Access",
    roomIds: ["hallway"],
  },
  {
    id: "demo-item-07",
    label: "Space and security",
    roomIds: ["bedroom-living", "hallway"],
  },
  {
    id: "demo-interior-air",
    label: "Interior air quality / ventilation",
    roomIds: ["kitchen", "bathroom", "bedroom-living", "hallway"],
  },
  {
    id: "demo-water-supply",
    label: "Water supply",
    roomIds: ["kitchen", "bathroom"],
  },
  {
    id: "demo-item-08",
    label: "Sanitary facilities",
    roomIds: ["bathroom"],
  },
  {
    id: "demo-item-09",
    label: "Thermal environment",
    roomIds: ["kitchen", "bathroom", "bedroom-living", "hallway"],
  },
  {
    id: "demo-lighting-electric",
    label: "Lighting and electricity",
    roomIds: ["kitchen", "bathroom", "bedroom-living", "hallway"],
  },
  {
    id: "demo-item-10",
    label: "Food preparation and refuse disposal",
    roomIds: ["kitchen"],
  },
  {
    id: "demo-item-11",
    label: "Sanitary condition",
    roomIds: ["kitchen", "bathroom", "bedroom-living", "hallway"],
  },
  {
    id: "demo-smoke-co",
    label: "Fire safety",
    roomIds: ["kitchen", "bathroom", "bedroom-living", "hallway"],
  },
] as const satisfies readonly MoveInReadyElement[];

export type MoveInReadyElementId =
  (typeof MOVE_IN_READY_ELEMENTS)[number]["id"];

export const MOVE_IN_READY_ELEMENT_IDS: readonly MoveInReadyElementId[] =
  MOVE_IN_READY_ELEMENTS.map((element) => element.id);

export type FundingType = "lahsa" | "hud" | "unknown";
export type SuggestedOutcome = "A" | "D";

/**
 * Trusted identity for one user-requested SAM/Muse analysis of one exact clip.
 * This is persisted with proposals so they cannot outlive the clip or catalog
 * version from which they were produced.
 */
export interface VideoAnalysisIdentity {
  sessionId: string;
  roomId: MoveInReadyRoomId;
  schemaVersion: number;
  videoId: string;
  videoRevision: number;
  expectedSourceHash: string;
  analysisId: string;
  attempt: number;
  catalogVersion: string;
}

/** Trusted app-generated identity for an actual still extracted from video. */
export interface EvidenceReference {
  schemaVersion: number;
  catalogVersion: string;
  videoId: string;
  videoRevision: number;
  roomId: MoveInReadyRoomId;
  stillId: string;
  /** Offset in the exact source video, in milliseconds. */
  timestampMs: number;
  /**
   * SAM source-frame index when this still is associated with a segmented
   * moment; null means it is only a locally captured still.
   */
  frameIndex: number | null;
  /** SHA-256 of the actual extracted still bytes, lowercase hex. */
  stillHash: string;
}

export type ProposalState = "draft-proposal" | "needs-human-check";
export interface ModelDeficiencySuggestion {
  /** Room, fixture, or other area the model thinks needs attention. */
  deficientArea: string;
  correction: string;
  completionDate: string;
  reinspectionDate: string;
}

interface ModelElementProposalBase {
  elementId: MoveInReadyElementId;
  state: ProposalState;
  observation: string;
  confidence: number;
  evidence: EvidenceReference[];
  analysisIdentity: VideoAnalysisIdentity;
}

/**
 * Unreviewed, non-authoritative AI proposal for one element. The suggestion
 * remains explicitly named as a model suggestion and is never a result.
 * With no resolvable evidence, `state` is forced to `needs-human-check`.
 */
export type ModelElementProposal = ModelElementProposalBase & (
  | { modelSuggestion: "A"; deficiencySuggestion?: never }
  | { modelSuggestion: "D"; deficiencySuggestion?: ModelDeficiencySuggestion }
);

export type ModelProposalSet = Record<MoveInReadyElementId, ModelElementProposal>;

/** Evaluator acknowledgment that the item was checked in person. */
export interface InPersonCheckAcknowledgment {
  evaluatorName: string;
  completedAt: string;
}

export type FireSafetyClauseOutcome = "A" | "D" | "needs-human-check";

/** The form has separate unit (11a) and public/common-area (11b) marks. */
export interface FireSafetyAssessment {
  unitDetectors: FireSafetyClauseOutcome;
  publicAreaDetectors: FireSafetyClauseOutcome;
}

export type EvaluatorDecision =
  | { status: "unreviewed" }
  | { status: "needs-human-check"; note: string; fireSafetyAssessment?: FireSafetyAssessment }
  | {
      status: "A";
      evaluatorName: string;
      decidedAt: string;
      inPersonCheckAcknowledgment: InPersonCheckAcknowledgment;
      rationale: string;
      evidence: EvidenceReference[];
      /** Null explicitly records a manual-only decision. */
      analysisIdentity: VideoAnalysisIdentity | null;
      fireSafetyAssessment?: FireSafetyAssessment;
    }
  | {
      status: "D";
      evaluatorName: string;
      decidedAt: string;
      inPersonCheckAcknowledgment: InPersonCheckAcknowledgment;
      rationale: string;
      evidence: EvidenceReference[];
      /** Null explicitly records a manual-only decision. */
      analysisIdentity: VideoAnalysisIdentity | null;
      fireSafetyAssessment?: FireSafetyAssessment;
      deficiency: {
        issueDescription: string;
        correction: string;
        /** Target date for the corrective work to be completed. */
        completionDate: string;
        /** Follow-up inspection date; cannot precede completion. */
        reinspectionDate: string;
      };
    };

export type EvaluatorDecisionSet = Record<
  MoveInReadyElementId,
  EvaluatorDecision
>;

/** Sign-off records typed name and a separate, explicit attestation. */
export interface EvaluatorSignoff {
  evaluatorName: string;
  typedSignature: string;
  attested: boolean;
  signedAt: string;
}

export const EVALUATOR_ATTESTATION_TEXT =
  "I understand that I am not a HUD-certified inspector. I evaluated this unit to the best of my ability and completed and reviewed this inspection based on my own assessment. AI suggestions are not my decisions.";

const ROOM_ID_SET = new Set<string>(
  MOVE_IN_READY_ROOMS.map((room) => room.id),
);
const ELEMENT_BY_ID = new Map<string, (typeof MOVE_IN_READY_ELEMENTS)[number]>(
  MOVE_IN_READY_ELEMENTS.map((element) => [element.id, element]),
);
const ELEMENT_ID_SET = new Set<string>(MOVE_IN_READY_ELEMENT_IDS);
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Must stay in sync with the server-side validated video sample cap. */
const MAX_VIDEO_FRAME_INDEX = 14_999;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

const MODEL_SET_KEYS = new Set(["proposals"]);
const MODEL_PROPOSAL_KEYS = new Set([
  "elementId",
  "suggestion",
  "observation",
  "confidence",
  "evidenceStillIds",
  "deficiencySuggestion",
]);
const SIGNOFF_KEYS = new Set([
  "evaluatorName",
  "typedSignature",
  "attested",
  "signedAt",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFireSafetyAssessment(
  value: unknown,
  allowNeedsHumanCheck: boolean,
): FireSafetyAssessment | null {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(value, "unitDetectors") ||
      !Object.prototype.hasOwnProperty.call(value, "publicAreaDetectors")) return null;
  const allowed = allowNeedsHumanCheck ? ["A", "D", "needs-human-check"] : ["A", "D"];
  if (!allowed.includes(value.unitDetectors as string) || !allowed.includes(value.publicAreaDetectors as string)) {
    return null;
  }
  return {
    unitDetectors: value.unitDetectors as FireSafetyClauseOutcome,
    publicAreaDetectors: value.publicAreaDetectors as FireSafetyClauseOutcome,
  };
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_DATE_TIME_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

/** Validate model-authored deficiency plan text without treating it as a decision. */
export function validateModelDeficiencySuggestion(
  value: unknown,
): ValidationResult<ModelDeficiencySuggestion> {
  if (!isRecord(value)) {
    return { ok: false, errors: ["deficiency suggestion must be an object"] };
  }
  const errors: string[] = [];
  const fields = new Set([
    "deficientArea",
    "correction",
    "completionDate",
    "reinspectionDate",
  ]);
  if (!hasOnlyKeys(value, fields)) {
    errors.push("deficiency suggestion has unknown fields");
  }
  if (!isNonEmptyString(value.deficientArea, 300)) {
    errors.push("deficiency suggestion deficientArea must be 1–300 characters");
  }
  if (!isNonEmptyString(value.correction, 600)) {
    errors.push("deficiency suggestion correction must be 1–600 characters");
  }
  if (!isValidCalendarDate(value.completionDate)) {
    errors.push("deficiency suggestion completionDate must be a valid YYYY-MM-DD date");
  }
  if (!isValidCalendarDate(value.reinspectionDate)) {
    errors.push("deficiency suggestion reinspectionDate must be a valid YYYY-MM-DD date");
  } else if (
    isValidCalendarDate(value.completionDate) &&
    value.reinspectionDate < value.completionDate
  ) {
    errors.push("deficiency suggestion reinspectionDate cannot precede completionDate");
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      deficientArea: value.deficientArea as string,
      correction: value.correction as string,
      completionDate: value.completionDate as string,
      reinspectionDate: value.reinspectionDate as string,
    },
  };
}

function normalizedName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function isMoveInReadyRoomId(value: unknown): value is MoveInReadyRoomId {
  return typeof value === "string" && ROOM_ID_SET.has(value);
}

export function isMoveInReadyElementId(
  value: unknown,
): value is MoveInReadyElementId {
  return typeof value === "string" && ELEMENT_ID_SET.has(value);
}

/** Validates a complete, JSON-serializable analysis provenance identity. */
export function validateVideoAnalysisIdentity(
  value: unknown,
): ValidationResult<VideoAnalysisIdentity> {
  if (!isRecord(value)) {
    return { ok: false, errors: ["video analysis identity must be an object"] };
  }
  const fields = new Set([
    "sessionId",
    "roomId",
    "schemaVersion",
    "videoId",
    "videoRevision",
    "expectedSourceHash",
    "analysisId",
    "attempt",
    "catalogVersion",
  ]);
  const errors: string[] = [];
  if (!hasOnlyKeys(value, fields)) errors.push("video analysis identity has unknown fields");
  if (typeof value.sessionId !== "string" || !IDENTIFIER_PATTERN.test(value.sessionId)) {
    errors.push("sessionId must be a stable identifier");
  }
  if (!isMoveInReadyRoomId(value.roomId)) errors.push("roomId is not a supported room");
  if (typeof value.schemaVersion !== "number" || !Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 1) {
    errors.push("schemaVersion must be a positive integer");
  }
  if (typeof value.videoId !== "string" || !IDENTIFIER_PATTERN.test(value.videoId)) {
    errors.push("videoId must be a stable identifier");
  }
  if (typeof value.videoRevision !== "number" || !Number.isSafeInteger(value.videoRevision) || value.videoRevision < 1) {
    errors.push("videoRevision must be a positive integer");
  }
  if (typeof value.expectedSourceHash !== "string" || !HASH_PATTERN.test(value.expectedSourceHash)) {
    errors.push("expectedSourceHash must be a lowercase SHA-256 digest");
  }
  if (typeof value.analysisId !== "string" || !IDENTIFIER_PATTERN.test(value.analysisId)) {
    errors.push("analysisId must be a stable identifier");
  }
  if (typeof value.attempt !== "number" || !Number.isSafeInteger(value.attempt) || value.attempt < 1) {
    errors.push("attempt must be a positive integer");
  }
  if (typeof value.catalogVersion !== "string" || !IDENTIFIER_PATTERN.test(value.catalogVersion)) {
    errors.push("catalogVersion must be a stable version identifier");
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      sessionId: value.sessionId as string,
      roomId: value.roomId as MoveInReadyRoomId,
      schemaVersion: value.schemaVersion as number,
      videoId: value.videoId as string,
      videoRevision: value.videoRevision as number,
      expectedSourceHash: value.expectedSourceHash as string,
      analysisId: value.analysisId as string,
      attempt: value.attempt as number,
      catalogVersion: value.catalogVersion as string,
    },
  };
}

/** Validates an app-created evidence identity before it can enter a record. */
export function validateEvidenceReference(
  value: unknown,
): ValidationResult<EvidenceReference> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["evidence reference must be an object"] };
  }
  const allowed = new Set([
    "schemaVersion",
    "catalogVersion",
    "videoId",
    "videoRevision",
    "roomId",
    "stillId",
    "timestampMs",
    "frameIndex",
    "stillHash",
  ]);
  if (!hasOnlyKeys(value, allowed)) errors.push("evidence reference has unknown fields");
  if (typeof value.schemaVersion !== "number" || !Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 1) {
    errors.push("schemaVersion must be a positive integer");
  }
  if (typeof value.catalogVersion !== "string" || !IDENTIFIER_PATTERN.test(value.catalogVersion)) {
    errors.push("catalogVersion must be a stable version identifier");
  }
  if (typeof value.videoId !== "string" || !IDENTIFIER_PATTERN.test(value.videoId)) {
    errors.push("videoId must be a stable identifier");
  }
  if (
    typeof value.videoRevision !== "number" ||
    !Number.isSafeInteger(value.videoRevision) ||
    value.videoRevision < 1
  ) {
    errors.push("videoRevision must be a positive integer");
  }
  if (!isMoveInReadyRoomId(value.roomId)) errors.push("roomId is not a supported room");
  if (typeof value.stillId !== "string" || !IDENTIFIER_PATTERN.test(value.stillId)) {
    errors.push("stillId must be a stable identifier");
  }
  if (
    typeof value.timestampMs !== "number" ||
    !Number.isSafeInteger(value.timestampMs) ||
    value.timestampMs < 0
  ) {
    errors.push("timestampMs must be a non-negative integer");
  }
  if (value.frameIndex !== null && (
    typeof value.frameIndex !== "number" ||
    !Number.isSafeInteger(value.frameIndex) ||
    value.frameIndex < 0 ||
    value.frameIndex > MAX_VIDEO_FRAME_INDEX
  )) {
    errors.push(`frameIndex must be null for a local still or an integer from 0 to ${MAX_VIDEO_FRAME_INDEX}`);
  }
  if (typeof value.stillHash !== "string" || !HASH_PATTERN.test(value.stillHash)) {
    errors.push("stillHash must be a lowercase SHA-256 digest");
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: value.schemaVersion as number,
      catalogVersion: value.catalogVersion as string,
      videoId: value.videoId as string,
      videoRevision: value.videoRevision as number,
      roomId: value.roomId as MoveInReadyRoomId,
      stillId: value.stillId as string,
      timestampMs: value.timestampMs as number,
      frameIndex: value.frameIndex as number | null,
      stillHash: value.stillHash as string,
    },
  };
}

/**
 * Strictly validates an untrusted model response and resolves its still IDs
 * against trusted app-generated identities. It requires exactly one proposal
 * for each of the 11 elements. Unknown fields, unsupported IDs, invented
 * stills, duplicates, and verdict-like extras fail closed.
 */
export function validateModelProposalSet(
  value: unknown,
  availableEvidence: readonly EvidenceReference[],
  analysisIdentity: VideoAnalysisIdentity,
): ValidationResult<ModelProposalSet> {
  const errors: string[] = [];
  const parsedAnalysisIdentity = validateVideoAnalysisIdentity(analysisIdentity);
  if (!parsedAnalysisIdentity.ok) {
    errors.push(...parsedAnalysisIdentity.errors.map((error) => `analysisIdentity: ${error}`));
  }
  if (!isRecord(value)) {
    return { ok: false, errors: ["model proposal set must be an object"] };
  }
  if (!hasOnlyKeys(value, MODEL_SET_KEYS)) {
    errors.push("model proposal set has unknown or verdict-like fields");
  }
  if (!Array.isArray(value.proposals)) {
    return { ok: false, errors: [...errors, "proposals must be an array"] };
  }
  if (value.proposals.length !== MOVE_IN_READY_ELEMENTS.length) {
    errors.push(`proposals must contain exactly ${MOVE_IN_READY_ELEMENTS.length} elements`);
  }

  const evidenceByStillId = new Map<string, EvidenceReference>();
  for (const [index, evidence] of availableEvidence.entries()) {
    const parsed = validateEvidenceReference(evidence);
    if (!parsed.ok) {
      errors.push(`availableEvidence[${index}] is invalid: ${parsed.errors.join("; ")}`);
      continue;
    }
    if (evidenceByStillId.has(parsed.value.stillId)) {
      errors.push(`availableEvidence contains duplicate stillId "${parsed.value.stillId}"`);
      continue;
    }
    evidenceByStillId.set(parsed.value.stillId, parsed.value);
  }

  const proposals = new Map<MoveInReadyElementId, ModelElementProposal>();
  value.proposals.forEach((rawProposal: unknown, index: number) => {
    const path = `proposals[${index}]`;
    if (!isRecord(rawProposal)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (!hasOnlyKeys(rawProposal, MODEL_PROPOSAL_KEYS)) {
      errors.push(`${path} has unknown or verdict-like fields`);
    }
    const {
      elementId,
      suggestion,
      observation,
      confidence,
      evidenceStillIds,
      deficiencySuggestion: rawDeficiencySuggestion,
    } = rawProposal;
    if (!isMoveInReadyElementId(elementId)) {
      errors.push(`${path}.elementId is not one of the 11 supported elements`);
      return;
    }
    if (proposals.has(elementId)) {
      errors.push(`${path} duplicates elementId "${elementId}"`);
      return;
    }
    if (suggestion !== "A" && suggestion !== "D") {
      errors.push(`${path}.suggestion must be a draft "A" or "D" suggestion`);
    }
    let deficiencySuggestion: ModelDeficiencySuggestion | undefined;
    if (suggestion === "D") {
      const parsedSuggestion = validateModelDeficiencySuggestion(rawDeficiencySuggestion);
      if (!parsedSuggestion.ok) {
        errors.push(...parsedSuggestion.errors.map((error) => `${path}.deficiencySuggestion: ${error}`));
      } else {
        deficiencySuggestion = parsedSuggestion.value;
      }
    } else if (rawDeficiencySuggestion !== undefined) {
      errors.push(`${path}.deficiencySuggestion is only allowed for a D suggestion`);
    }
    if (!isNonEmptyString(observation, 600)) {
      errors.push(`${path}.observation must be 1–600 characters`);
    }
    if (
      typeof confidence !== "number" ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 100
    ) {
      errors.push(`${path}.confidence must be a number from 0 to 100`);
    }
    if (!Array.isArray(evidenceStillIds) || evidenceStillIds.length > 5) {
      errors.push(`${path}.evidenceStillIds must contain 0–5 still IDs`);
      return;
    }
    const resolvedEvidence: EvidenceReference[] = [];
    const usedStillIds = new Set<string>();
    for (const stillId of evidenceStillIds) {
      if (typeof stillId !== "string" || !IDENTIFIER_PATTERN.test(stillId)) {
        errors.push(`${path}.evidenceStillIds contains an invalid still ID`);
        continue;
      }
      if (usedStillIds.has(stillId)) {
        errors.push(`${path}.evidenceStillIds contains duplicate still ID "${stillId}"`);
        continue;
      }
      usedStillIds.add(stillId);
      const evidence = evidenceByStillId.get(stillId);
      if (!evidence) {
        errors.push(`${path} references unknown still ID "${stillId}"`);
        continue;
      }
      if (parsedAnalysisIdentity.ok && (
        evidence.schemaVersion !== parsedAnalysisIdentity.value.schemaVersion ||
        evidence.catalogVersion !== parsedAnalysisIdentity.value.catalogVersion
      )) {
        errors.push(`${path} references evidence from a different schema or catalog version`);
        continue;
      }
      const element = ELEMENT_BY_ID.get(elementId);
      if (!element?.roomIds.some((roomId) => roomId === evidence.roomId)) {
        errors.push(`${path} references a still from an unrelated room`);
        continue;
      }
      // Copy the trusted, app-created reference; never trust model timestamps,
      // video IDs, room labels, or hashes.
      resolvedEvidence.push({ ...evidence });
    }

    if (
      (suggestion === "A" || suggestion === "D") &&
      isNonEmptyString(observation, 600) &&
      typeof confidence === "number" &&
      Number.isFinite(confidence) &&
      confidence >= 0 &&
      confidence <= 100
    ) {
      if (suggestion === "D" && deficiencySuggestion) {
        proposals.set(elementId, {
          elementId,
          state: resolvedEvidence.length > 0 ? "draft-proposal" : "needs-human-check",
          modelSuggestion: suggestion,
          deficiencySuggestion,
          observation,
          confidence,
          evidence: resolvedEvidence,
          analysisIdentity: parsedAnalysisIdentity.ok ? parsedAnalysisIdentity.value : analysisIdentity,
        });
      } else if (suggestion === "A") {
        proposals.set(elementId, {
          elementId,
          state: resolvedEvidence.length > 0 ? "draft-proposal" : "needs-human-check",
          modelSuggestion: suggestion,
          observation,
          confidence,
          evidence: resolvedEvidence,
          analysisIdentity: parsedAnalysisIdentity.ok ? parsedAnalysisIdentity.value : analysisIdentity,
        });
      }
    }
  });

  for (const elementId of MOVE_IN_READY_ELEMENT_IDS) {
    if (!proposals.has(elementId)) {
      errors.push(`model proposal set is missing element "${elementId}"`);
    }
  }
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: Object.fromEntries(
      MOVE_IN_READY_ELEMENT_IDS.map((elementId) => [elementId, proposals.get(elementId)!]),
    ) as ModelProposalSet,
  };
}

/** Start every element with no human decision, regardless of AI proposals. */
export function createUnreviewedEvaluatorDecisions(): EvaluatorDecisionSet {
  return Object.fromEntries(
    MOVE_IN_READY_ELEMENT_IDS.map((elementId) => [elementId, { status: "unreviewed" }]),
  ) as EvaluatorDecisionSet;
}

/**
 * Validates a worker-entered decision. This accepts only the evaluator
 * contract; model proposal fields are neither accepted nor copied.
 */
export function validateEvaluatorDecision(
  value: unknown,
  elementId?: MoveInReadyElementId,
): ValidationResult<EvaluatorDecision> {
  if (!isRecord(value) || typeof value.status !== "string") {
    return { ok: false, errors: ["evaluator decision must be an object with a status"] };
  }
  const errors: string[] = [];
  if (value.status === "unreviewed") {
    if (Object.keys(value).length !== 1) {
      errors.push("unreviewed decision cannot contain review data");
    }
    return errors.length
      ? { ok: false, errors }
      : { ok: true, value: { status: "unreviewed" } };
  }
  if (value.status === "needs-human-check") {
    if (!hasOnlyKeys(value, new Set(["status", "note", "fireSafetyAssessment"]))) {
      errors.push("needs-human-check decision has unknown fields");
    }
    if (!isNonEmptyString(value.note, 1000)) {
      errors.push("needs-human-check decision requires a note");
    }
    const fireSafetyAssessment = parseFireSafetyAssessment(value.fireSafetyAssessment, true);
    if (value.fireSafetyAssessment !== undefined && !fireSafetyAssessment) {
      errors.push("fireSafetyAssessment must contain valid section 11a and 11b outcomes");
    }
    if (elementId !== undefined && elementId !== "demo-smoke-co" && value.fireSafetyAssessment !== undefined) {
      errors.push("fireSafetyAssessment is only valid for Fire safety");
    }
    if (errors.length) return { ok: false, errors };
    return {
      ok: true,
      value: {
        status: "needs-human-check",
        note: value.note as string,
        ...(fireSafetyAssessment ? { fireSafetyAssessment } : {}),
      },
    };
  }
  if (value.status !== "A" && value.status !== "D") {
    return { ok: false, errors: ["status must be unreviewed, needs-human-check, A, or D"] };
  }

  const baseKeys = [
    "status",
    "evaluatorName",
    "decidedAt",
    "inPersonCheckAcknowledgment",
    "rationale",
    "evidence",
    "analysisIdentity",
  ];
  const expectedKeys = new Set(
    value.status === "D" ? [...baseKeys, "deficiency", "fireSafetyAssessment"] : [...baseKeys, "fireSafetyAssessment"],
  );
  if (!hasOnlyKeys(value, expectedKeys)) errors.push("evaluator decision has unknown fields");
  if (!isNonEmptyString(value.evaluatorName, 120)) {
    errors.push("evaluatorName must be 1–120 characters");
  }
  if (!isValidDateTime(value.decidedAt)) errors.push("decidedAt must be an ISO date-time");
  const acknowledgment = validateInPersonCheckAcknowledgment(
    value.inPersonCheckAcknowledgment,
    value.evaluatorName,
    value.decidedAt,
  );
  if (!acknowledgment.ok) errors.push(...acknowledgment.errors);
  if (!isNonEmptyString(value.rationale, 1000)) {
    errors.push("rationale must be 1–1000 characters");
  }
  let analysisIdentity: VideoAnalysisIdentity | null = null;
  if (value.analysisIdentity !== null) {
    const parsedIdentity = validateVideoAnalysisIdentity(value.analysisIdentity);
    if (!parsedIdentity.ok) {
      errors.push(...parsedIdentity.errors.map((error) => `analysisIdentity: ${error}`));
    } else {
      analysisIdentity = parsedIdentity.value;
    }
  }
  const evidence: EvidenceReference[] = [];
  if (!Array.isArray(value.evidence) || value.evidence.length > 5) {
    errors.push("evidence must contain 0–5 evidence references");
  } else {
    const seenStillIds = new Set<string>();
    value.evidence.forEach((rawEvidence: unknown, index: number) => {
      const parsed = validateEvidenceReference(rawEvidence);
      if (!parsed.ok) {
        errors.push(`evidence[${index}] is invalid: ${parsed.errors.join("; ")}`);
        return;
      }
      if (seenStillIds.has(parsed.value.stillId)) {
        errors.push(`evidence contains duplicate still ID "${parsed.value.stillId}"`);
      } else {
        seenStillIds.add(parsed.value.stillId);
      }
      evidence.push(parsed.value);
    });
  }
  if (analysisIdentity && evidence.some((reference) =>
    reference.schemaVersion !== analysisIdentity!.schemaVersion ||
    reference.catalogVersion !== analysisIdentity!.catalogVersion
  )) {
    errors.push("evidence schemaVersion and catalogVersion must match analysisIdentity");
  }

  const fireSafetyAssessment = parseFireSafetyAssessment(value.fireSafetyAssessment, false);
  if (value.fireSafetyAssessment !== undefined && !fireSafetyAssessment) {
    errors.push("fireSafetyAssessment must contain A or D for both section 11a and 11b");
  }
  if (elementId === "demo-smoke-co" && !fireSafetyAssessment) {
    errors.push("Fire safety decision requires separate section 11a and 11b outcomes");
  }
  if (elementId !== undefined && elementId !== "demo-smoke-co" && value.fireSafetyAssessment !== undefined) {
    errors.push("fireSafetyAssessment is only valid for Fire safety");
  }
  if (fireSafetyAssessment) {
    const expectedStatus = fireSafetyAssessment.unitDetectors === "D" || fireSafetyAssessment.publicAreaDetectors === "D" ? "D" : "A";
    if (value.status !== expectedStatus) {
      errors.push("Fire safety decision must match its section 11a and 11b outcomes");
    }
  }

  if (value.status === "D") {
    if (evidence.length === 0) errors.push("D decision requires at least one evidence still");
    if (!isRecord(value.deficiency)) {
      errors.push("D decision requires a deficiency correction plan");
    } else {
      const deficiencyKeys = new Set([
        "issueDescription",
        "correction",
        "completionDate",
        "reinspectionDate",
      ]);
      if (!hasOnlyKeys(value.deficiency, deficiencyKeys)) {
        errors.push("deficiency correction plan has unknown fields");
      }
      if (!isNonEmptyString(value.deficiency.issueDescription, 1000)) {
        errors.push("deficiency issueDescription must be 1–1000 characters");
      }
      if (!isNonEmptyString(value.deficiency.correction, 1000)) {
        errors.push("D decision requires a 1–1000 character correction");
      }
      if (!isValidCalendarDate(value.deficiency.completionDate)) {
        errors.push("D decision requires a valid completionDate in YYYY-MM-DD format");
      }
      if (!isValidCalendarDate(value.deficiency.reinspectionDate)) {
        errors.push("D decision requires a valid reinspectionDate in YYYY-MM-DD format");
      } else if (
        isValidCalendarDate(value.deficiency.completionDate) &&
        value.deficiency.reinspectionDate < value.deficiency.completionDate
      ) {
        errors.push("reinspectionDate cannot precede completionDate");
      }
    }
  }

  if (errors.length) return { ok: false, errors };
  if (!acknowledgment.ok) return acknowledgment;
  if (value.status === "A") {
    return {
      ok: true,
      value: {
        status: "A",
        evaluatorName: value.evaluatorName as string,
        decidedAt: value.decidedAt as string,
        inPersonCheckAcknowledgment: acknowledgment.value,
        rationale: value.rationale as string,
        evidence,
        analysisIdentity,
        ...(fireSafetyAssessment ? { fireSafetyAssessment } : {}),
      },
    };
  }
  const deficiency = value.deficiency as Record<string, unknown>;
  return {
    ok: true,
    value: {
      status: "D",
      evaluatorName: value.evaluatorName as string,
      decidedAt: value.decidedAt as string,
      inPersonCheckAcknowledgment: acknowledgment.value,
      rationale: value.rationale as string,
      evidence,
      analysisIdentity,
      ...(fireSafetyAssessment ? { fireSafetyAssessment } : {}),
      deficiency: {
        issueDescription: deficiency.issueDescription as string,
        correction: deficiency.correction as string,
        completionDate: deficiency.completionDate as string,
        reinspectionDate: deficiency.reinspectionDate as string,
      },
    },
  };
}

function validateInPersonCheckAcknowledgment(
  value: unknown,
  evaluatorName: unknown,
  decidedAt: unknown,
): ValidationResult<InPersonCheckAcknowledgment> {
  if (!isRecord(value)) {
    return { ok: false, errors: ["inPersonCheckAcknowledgment is required"] };
  }
  const errors: string[] = [];
  if (!hasOnlyKeys(value, new Set(["evaluatorName", "completedAt"]))) {
    errors.push("inPersonCheckAcknowledgment has unknown fields");
  }
  if (!isNonEmptyString(value.evaluatorName, 120)) {
    errors.push("inPersonCheckAcknowledgment evaluatorName must be 1–120 characters");
  } else if (
    isNonEmptyString(evaluatorName, 120) &&
    normalizedName(value.evaluatorName) !== normalizedName(evaluatorName)
  ) {
    errors.push("inPersonCheckAcknowledgment belongs to a different evaluator");
  }
  if (!isValidDateTime(value.completedAt)) {
    errors.push("inPersonCheckAcknowledgment completedAt must be an ISO date-time");
  } else if (
    isValidDateTime(decidedAt) &&
    Date.parse(value.completedAt) > Date.parse(decidedAt)
  ) {
    errors.push("inPersonCheckAcknowledgment cannot be later than decidedAt");
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      evaluatorName: value.evaluatorName as string,
      completedAt: value.completedAt as string,
    },
  };
}

export function validateEvaluatorSignoff(
  value: unknown,
): ValidationResult<EvaluatorSignoff> {
  if (!isRecord(value)) {
    return { ok: false, errors: ["sign-off must be an object"] };
  }
  const errors: string[] = [];
  if (!hasOnlyKeys(value, SIGNOFF_KEYS)) errors.push("sign-off has unknown fields");
  if (!isNonEmptyString(value.evaluatorName, 120)) {
    errors.push("evaluatorName must be 1–120 characters");
  }
  if (!isNonEmptyString(value.typedSignature, 120)) {
    errors.push("typedSignature must be 1–120 characters");
  }
  if (
    typeof value.evaluatorName === "string" &&
    typeof value.typedSignature === "string" &&
    normalizedName(value.evaluatorName) !== normalizedName(value.typedSignature)
  ) {
    errors.push("typedSignature must match the evaluator name");
  }
  if (value.attested !== true) errors.push("evaluator attestation is required");
  if (!isValidDateTime(value.signedAt)) errors.push("signedAt must be an ISO date-time");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      evaluatorName: value.evaluatorName as string,
      typedSignature: value.typedSignature as string,
      attested: true,
      signedAt: value.signedAt as string,
    },
  };
}

export type FinalizationStatus =
  | "funding-required"
  | "hqs-branch-required"
  | "capture-incomplete"
  | "review-incomplete"
  | "signoff-required"
  | "complete";

export type InspectionResult = "approved" | "not-approved";

export interface FinalizationSummary {
  status: FinalizationStatus;
  /** Null until required room clips, human decisions, funding, and sign-off are valid. */
  result: InspectionResult | null;
  blockers: string[];
}

export interface FinalizationInput {
  fundingType: FundingType;
  /** Room videos that are currently present and verified in local storage. */
  capturedRoomIds: readonly MoveInReadyRoomId[];
  evaluatorDecisions: Partial<Record<MoveInReadyElementId, unknown>>;
  signoff: unknown | null;
}

/**
 * Derives completion exclusively from required room clips, explicit human
 * decisions, funding track, and typed sign-off. Model proposal data is not
 * accepted by this API.
 */
export function deriveFinalInspectionResult(
  input: FinalizationInput,
): FinalizationSummary {
  if (input.fundingType === "unknown") {
    return {
      status: "funding-required",
      result: null,
      blockers: ["Select the funding type before completing this workflow."],
    };
  }
  if (input.fundingType === "hud") {
    return {
      status: "hqs-branch-required",
      result: null,
      blockers: ["HUD-funded units require the separate HQS workflow."],
    };
  }
  if (input.fundingType !== "lahsa") {
    return {
      status: "funding-required",
      result: null,
      blockers: ["Select the funding type before completing this workflow."],
    };
  }

  const capturedRoomIds = new Set<unknown>(
    Array.isArray(input.capturedRoomIds) ? input.capturedRoomIds : [],
  );
  const missingRooms = MOVE_IN_READY_ROOMS.filter((room) => !capturedRoomIds.has(room.id));
  if (missingRooms.length) {
    return {
      status: "capture-incomplete",
      result: null,
      blockers: missingRooms.map((room) => `${room.label}: a room video is required before sign-off.`),
    };
  }

  const blockers: string[] = [];
  const decisionEvaluators: Array<{ label: string; evaluatorName: string }> = [];
  let hasDeficiency = false;
  for (const element of MOVE_IN_READY_ELEMENTS) {
    const rawDecision = input.evaluatorDecisions[element.id];
    const parsed = validateEvaluatorDecision(rawDecision, element.id);
    if (!parsed.ok || parsed.value.status === "unreviewed") {
      blockers.push(`${element.label}: evaluator decision is required.`);
      continue;
    }
    if (parsed.value.status === "needs-human-check") {
      blockers.push(`${element.label}: human check is still required.`);
      continue;
    }
    decisionEvaluators.push({
      label: element.label,
      evaluatorName: parsed.value.evaluatorName,
    });
    if (parsed.value.status === "D") hasDeficiency = true;
  }
  for (const key of Object.keys(input.evaluatorDecisions)) {
    if (!isMoveInReadyElementId(key)) {
      blockers.push("An unsupported evaluator decision was found.");
    }
  }
  if (blockers.length) {
    return { status: "review-incomplete", result: null, blockers };
  }

  const signoff = validateEvaluatorSignoff(input.signoff);
  if (!signoff.ok) {
    return {
      status: "signoff-required",
      result: null,
      blockers: signoff.errors,
    };
  }
  const mismatchedEvaluator = decisionEvaluators.find(
    (decision) => normalizedName(decision.evaluatorName) !== normalizedName(signoff.value.evaluatorName),
  );
  if (mismatchedEvaluator) {
    return {
      status: "signoff-required",
      result: null,
      blockers: [
        `Evaluator sign-off must match the evaluator recorded for every decision; ${mismatchedEvaluator.label} has a different evaluator.`,
      ],
    };
  }
  return {
    status: "complete",
    result: hasDeficiency ? "not-approved" : "approved",
    blockers: [],
  };
}
