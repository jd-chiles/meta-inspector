/**
 * Evidence contracts and session state reducer (REQ-004, REQ-005, REQ-006).
 *
 * Identity and async-correctness rules enforced here:
 *
 * 1. Evidence identity survives async work. Every commit carries the exact
 *    session/item/media/attempt it was issued for; a delayed response for an
 *    older attempt, replaced media, a changed item, a cancelled analysis, or
 *    a deleted record is ignored and never overwrites newer evidence, never
 *    attaches to another item/version, and never restores deleted state.
 * 2. AI output is an unreviewed observation. Accepting text cannot complete a
 *    manual check, remove required unknowns, produce an inspection verdict,
 *    or include pending/rejected draft text as approved export content.
 * 3. Local deletion only removes local records; it never claims provider
 *    deletion. Deleted records stay deleted (no resurrection by late writes).
 *
 * The reducer is pure and synchronous: given the same state and action it
 * always returns the same result, and ignored stale actions return the input
 * state reference unchanged so callers can tell "ignored" from "applied".
 */

import type { ValidationResult } from "./catalog";

export const EVIDENCE_SCHEMA_VERSION = 1;

export const ANALYSIS_MODES = ["live", "fixture"] as const;
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];

/** Strict neutral draft authored by the model. No verdict fields, ever. */
export interface AnalysisDraft {
  /** What the image appears to show, 1–600 characters. */
  observation: string;
  /** Concrete visible details, 0–5 strings of ≤200 chars each. */
  visibleEvidence: string[];
  /** What cannot be told from the image, 0–5 strings of ≤200 chars each. */
  unknowns: string[];
  /** Model-suggested follow-ups, 0–5 strings of ≤200 chars each. Required
   * catalog checks are merged at display time and can never be cleared here. */
  suggestedManualChecks: string[];
}

/**
 * Application-generated envelope. IDs, timing, and provenance are assigned
 * by the app — model text is never trusted for IDs (design § Contracts).
 */
export interface AnalysisEnvelope {
  analysisId: string;
  sessionId: string;
  itemId: string;
  catalogVersion: string;
  mediaId: string;
  /** SHA-256 digest (64 lowercase hex chars) of the normalized bytes. */
  mediaHash: string;
  model: string;
  mode: AnalysisMode;
  requestId: string;
  /** Server-observed round-trip latency in milliseconds. */
  latencyMs: number;
  draft: AnalysisDraft;
}

export type ReviewDisposition =
  | "unreviewed"
  | "accepted"
  | "accepted-edited"
  | "rejected";

export type ItemStatus =
  | "empty"
  | "captured"
  | "analyzing"
  | "draft"
  | "reviewed"
  | "rejected"
  | "error";

export type ManualOutcome = "performed" | "not-performed";

export interface ManualCheckResponse {
  checkId: string;
  outcome: ManualOutcome;
  /** Worker note is required for both performed and not-performed (REQ-005). */
  note: string;
  recordedAt: string;
}

export interface AnalysisError {
  code: string;
  message: string;
}

/** Per-item evidence record. The session owns one per catalog item. */
export interface ItemRecord {
  itemId: string;
  catalogVersion: string;
  status: ItemStatus;
  mediaId: string | null;
  mediaHash: string | null;
  capturedAt: string | null;
  /** Media generation counter. Replacement/reanalysis bump it; every async
   * commit must present the attempt it was issued for. */
  attempt: number;
  /** Inflight analysis ID while status is "analyzing", else null. */
  analysisId: string | null;
  /** Original model draft. Worker edits live in workerRevision; the model
   * draft itself is never mutated, so rejection/edit history stays honest. */
  draft: AnalysisDraft | null;
  workerRevision: string | null;
  disposition: ReviewDisposition;
  dispositionAt: string | null;
  /** Incremented on every applied evidence change (capture, commit, review,
   * manual-check, reanalysis) so async writers can detect races. */
  revision: number;
  manualChecks: ManualCheckResponse[];
  error: AnalysisError | null;
  deleted: boolean;
}

export interface SessionState {
  sessionId: string;
  schemaVersion: number;
  catalogId: string;
  catalogVersion: string;
  currentItemId: string | null;
  items: Record<string, ItemRecord>;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SessionAction =
  | { type: "select-item"; itemId: string }
  | {
      type: "capture-media";
      itemId: string;
      mediaId: string;
      mediaHash: string;
      capturedAt: string;
    }
  | { type: "begin-analysis"; itemId: string; analysisId: string; attempt: number }
  | {
      type: "commit-draft";
      itemId: string;
      analysisId: string;
      attempt: number;
      mediaId: string;
      mediaHash: string;
      envelope: unknown;
    }
  | {
      type: "fail-analysis";
      itemId: string;
      attempt: number;
      code: string;
      message: string;
    }
  | { type: "cancel-analysis"; itemId: string; attempt: number }
  | { type: "reanalyze"; itemId: string }
  | { type: "accept"; itemId: string; note?: string }
  | { type: "accept-edited"; itemId: string; revisedText: string }
  | { type: "reject"; itemId: string; reason: string }
  | {
      type: "record-manual-check";
      itemId: string;
      checkId: string;
      outcome: ManualOutcome;
      note: string;
      recordedAt: string;
      requiredCheckIds: string[];
    }
  | { type: "delete-item-evidence"; itemId: string }
  | { type: "delete-session" };

const DRAFT_KEYS = new Set([
  "observation",
  "visibleEvidence",
  "unknowns",
  "suggestedManualChecks",
]);

const ENVELOPE_KEYS = new Set([
  "analysisId",
  "sessionId",
  "itemId",
  "catalogVersion",
  "mediaId",
  "mediaHash",
  "model",
  "mode",
  "requestId",
  "latencyMs",
  "draft",
]);

/**
 * Verdict-like fields rejected on AI output (REQ-004). Accepting text must
 * never produce an authoritative Approved/Deficient or habitability verdict,
 * so any payload carrying these is invalid model output — never a draft.
 */
const DRAFT_FORBIDDEN_KEYS = new Set([
  "verdict",
  "confidence",
  "approved",
  "deficient",
  "deficiency",
  "pass",
  "fail",
  "habitability",
  "habitable",
  "compliant",
  "nonCompliant",
  "score",
  "rating",
  "decision",
  "certification",
  "formVerdict",
]);

const MEDIA_HASH_PATTERN = /^[0-9a-f]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const MAX_OBSERVATION_LENGTH = 600;
const MAX_LIST_ITEMS = 5;
const MAX_LIST_ITEM_LENGTH = 200;
const MAX_REVISION_LENGTH = 2000;
const MAX_NOTE_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateStringList(
  errors: string[],
  where: string,
  value: unknown,
): string[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${where}: must be an array of 0–${MAX_LIST_ITEMS} strings`);
    return null;
  }
  if (value.length > MAX_LIST_ITEMS) {
    errors.push(
      `${where}: must hold at most ${MAX_LIST_ITEMS} entries (found ${value.length})`,
    );
    return null;
  }
  const cleaned: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "string") {
      errors.push(`${where}[${index}]: must be a string`);
      return;
    }
    if (entry.length > MAX_LIST_ITEM_LENGTH) {
      errors.push(
        `${where}[${index}]: must be at most ${MAX_LIST_ITEM_LENGTH} characters`,
      );
      return;
    }
    cleaned.push(entry);
  });
  return cleaned;
}

/** Strictly validate untrusted model JSON as a neutral draft (REQ-004). */
export function validateAnalysisDraft(
  value: unknown,
): ValidationResult<AnalysisDraft> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["draft: must be an object"] };
  }
  for (const key of Object.keys(value)) {
    if (DRAFT_FORBIDDEN_KEYS.has(key)) {
      errors.push(
        `draft: forbidden field "${key}" (AI output must never carry a verdict)`,
      );
    } else if (!DRAFT_KEYS.has(key)) {
      errors.push(`draft: unexpected field "${key}"`);
    }
  }
  const { observation, visibleEvidence, unknowns, suggestedManualChecks } =
    value;
  let parsedObservation: string | null = null;
  if (typeof observation !== "string" || observation.trim().length === 0) {
    errors.push(`draft: "observation" must be 1–${MAX_OBSERVATION_LENGTH} characters`);
  } else if (observation.length > MAX_OBSERVATION_LENGTH) {
    errors.push(
      `draft: "observation" must be at most ${MAX_OBSERVATION_LENGTH} characters`,
    );
  } else {
    parsedObservation = observation;
  }
  const parsedVisible = validateStringList(
    errors,
    `draft: "visibleEvidence"`,
    visibleEvidence,
  );
  const parsedUnknowns = validateStringList(
    errors,
    `draft: "unknowns"`,
    unknowns,
  );
  const parsedSuggested = validateStringList(
    errors,
    `draft: "suggestedManualChecks"`,
    suggestedManualChecks,
  );
  if (
    errors.length === 0 &&
    parsedVisible !== null &&
    parsedUnknowns !== null &&
    parsedSuggested !== null &&
    parsedVisible.length === 0 &&
    parsedUnknowns.length === 0 &&
    parsedSuggested.length === 0
  ) {
    errors.push(
      `draft: unusable empty output (at least one of visibleEvidence, unknowns, or suggestedManualChecks must be non-empty)`,
    );
  }
  if (
    errors.length > 0 ||
    parsedObservation === null ||
    parsedVisible === null ||
    parsedUnknowns === null ||
    parsedSuggested === null
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      observation: parsedObservation,
      visibleEvidence: parsedVisible,
      unknowns: parsedUnknowns,
      suggestedManualChecks: parsedSuggested,
    },
  };
}

/** Strictly validate an application-generated analysis envelope. */
export function validateEnvelope(
  value: unknown,
): ValidationResult<AnalysisEnvelope> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["envelope: must be an object"] };
  }
  for (const key of Object.keys(value)) {
    if (!ENVELOPE_KEYS.has(key)) {
      errors.push(`envelope: unexpected field "${key}"`);
    }
    if (DRAFT_FORBIDDEN_KEYS.has(key)) {
      errors.push(
        `envelope: forbidden field "${key}" (no verdict at the envelope level either)`,
      );
    }
  }
  const {
    analysisId,
    sessionId,
    itemId,
    catalogVersion,
    mediaId,
    mediaHash,
    model,
    mode,
    requestId,
    latencyMs,
    draft,
  } = value;
  for (const [key, val] of [
    ["analysisId", analysisId],
    ["sessionId", sessionId],
    ["itemId", itemId],
    ["mediaId", mediaId],
    ["model", model],
    ["requestId", requestId],
  ] as const) {
    if (!isNonEmptyString(val)) {
      errors.push(`envelope: "${key}" must be a non-empty string`);
    }
  }
  if (
    typeof catalogVersion !== "string" ||
    !VERSION_PATTERN.test(catalogVersion)
  ) {
    errors.push(`envelope: "catalogVersion" must look like "1.2.3"`);
  }
  if (
    typeof mediaHash !== "string" ||
    !MEDIA_HASH_PATTERN.test(mediaHash)
  ) {
    errors.push(
      `envelope: "mediaHash" must be a SHA-256 hex digest (64 hex characters)`,
    );
  }
  if (mode !== "live" && mode !== "fixture") {
    errors.push(`envelope: "mode" must be "live" or "fixture"`);
  }
  if (
    typeof latencyMs !== "number" ||
    !Number.isFinite(latencyMs) ||
    latencyMs < 0
  ) {
    errors.push(`envelope: "latencyMs" must be a finite number >= 0`);
  }
  const draftResult = validateAnalysisDraft(draft);
  if (!draftResult.ok) {
    for (const err of draftResult.errors) errors.push(`envelope.${err}`);
  }
  if (errors.length > 0 || !draftResult.ok) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      analysisId: analysisId as string,
      sessionId: sessionId as string,
      itemId: itemId as string,
      catalogVersion: catalogVersion as string,
      mediaId: mediaId as string,
      mediaHash: (mediaHash as string).toLowerCase(),
      model: model as string,
      mode: mode as AnalysisMode,
      requestId: requestId as string,
      latencyMs: latencyMs as number,
      draft: draftResult.value,
    },
  };
}

/** Validate a worker-recorded manual-check response (REQ-005). */
export function validateManualCheckResponse(
  value: unknown,
  requiredCheckIds: string[],
): ValidationResult<ManualCheckResponse> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["manual-check: must be an object"] };
  }
  const { checkId, outcome, note, recordedAt } = value;
  if (!isNonEmptyString(checkId)) {
    errors.push(`manual-check: "checkId" must be a non-empty string`);
  } else if (
    requiredCheckIds.length > 0 &&
    !requiredCheckIds.includes(checkId)
  ) {
    errors.push(
      `manual-check: unknown check "${checkId}" for this item (responses attach only to catalog checks)`,
    );
  }
  if (outcome !== "performed" && outcome !== "not-performed") {
    errors.push(
      `manual-check: "outcome" must be "performed" or "not-performed"`,
    );
  }
  if (typeof note !== "string" || note.trim().length === 0) {
    errors.push(
      `manual-check: "note" is required (a check without a worker note stays pending)`,
    );
  } else if (note.length > MAX_NOTE_LENGTH) {
    errors.push(
      `manual-check: "note" must be at most ${MAX_NOTE_LENGTH} characters`,
    );
  }
  if (typeof recordedAt !== "string" || Number.isNaN(Date.parse(recordedAt))) {
    errors.push(`manual-check: "recordedAt" must be a parseable date`);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      checkId: checkId as string,
      outcome: outcome as ManualOutcome,
      note: note as string,
      recordedAt: recordedAt as string,
    },
  };
}

/** A check counts as resolved only when the worker recorded it performed
 * with a note. "not-performed" stays unresolved by design (REQ-005): a
 * declined physical test is an open item, not a completed one. */
export function isCheckResolved(
  responses: ManualCheckResponse[],
  checkId: string,
): boolean {
  return responses.some(
    (response) =>
      response.checkId === checkId &&
      response.outcome === "performed" &&
      response.note.trim().length > 0,
  );
}

/** Required check IDs with no resolving "performed" response. */
export function unresolvedRequiredChecks(
  requiredCheckIds: string[],
  responses: ManualCheckResponse[],
): string[] {
  return requiredCheckIds.filter(
    (checkId) => !isCheckResolved(responses, checkId),
  );
}

/** Create a fresh session bound to a catalog snapshot (REQ-006). */
export function createSession(
  sessionId: string,
  snapshot: { catalogId: string; catalogVersion: string; itemIds: string[] },
  createdAt: string = new Date().toISOString(),
): SessionState {
  const items: Record<string, ItemRecord> = {};
  for (const itemId of snapshot.itemIds) {
    items[itemId] = createItemRecord(itemId, snapshot.catalogVersion);
  }
  return {
    sessionId,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    catalogId: snapshot.catalogId,
    catalogVersion: snapshot.catalogVersion,
    currentItemId: snapshot.itemIds[0] ?? null,
    items,
    deleted: false,
    createdAt,
    updatedAt: createdAt,
  };
}

export function createItemRecord(
  itemId: string,
  catalogVersion: string,
): ItemRecord {
  return {
    itemId,
    catalogVersion,
    status: "empty",
    mediaId: null,
    mediaHash: null,
    capturedAt: null,
    attempt: 0,
    analysisId: null,
    draft: null,
    workerRevision: null,
    disposition: "unreviewed",
    dispositionAt: null,
    revision: 0,
    manualChecks: [],
    error: null,
    deleted: false,
  };
}

function touch(state: SessionState, updatedAt: string): SessionState {
  return { ...state, updatedAt };
}

function withItem(
  state: SessionState,
  itemId: string,
  next: ItemRecord,
  updatedAt: string,
): SessionState {
  return touch(
    { ...state, items: { ...state.items, [itemId]: next } },
    updatedAt,
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Pure session reducer. Stale, mismatched, or post-deletion actions return
 * the input state unchanged — callers MUST treat reference equality as
 * "ignored" and never apply the payload elsewhere.
 */
export function reduceSession(
  state: SessionState,
  action: SessionAction,
  at: string = nowIso(),
): SessionState {
  if (state.deleted && action.type !== "delete-session") {
    return state;
  }
  switch (action.type) {
    case "delete-session": {
      if (state.deleted) return state;
      return { ...state, deleted: true, updatedAt: at };
    }
    case "select-item": {
      if (!(action.itemId in state.items)) return state;
      if (state.currentItemId === action.itemId) return state;
      return touch({ ...state, currentItemId: action.itemId }, at);
    }
    case "capture-media": {
      const item = state.items[action.itemId];
      if (!item || item.deleted) return state;
      if (!isNonEmptyString(action.mediaId)) return state;
      if (
        typeof action.mediaHash !== "string" ||
        !MEDIA_HASH_PATTERN.test(action.mediaHash)
      ) {
        return state;
      }
      if (
        typeof action.capturedAt !== "string" ||
        Number.isNaN(Date.parse(action.capturedAt))
      ) {
        return state;
      }
      // Replacement invalidates review and associated manual-check evidence
      // (REQ-005/REQ-006): new media means the old draft no longer describes
      // current evidence.
      return withItem(
        state,
        action.itemId,
        {
          ...item,
          status: "captured",
          mediaId: action.mediaId,
          mediaHash: action.mediaHash.toLowerCase(),
          capturedAt: action.capturedAt,
          attempt: item.attempt + 1,
          analysisId: null,
          draft: null,
          workerRevision: null,
          disposition: "unreviewed",
          dispositionAt: null,
          revision: item.revision + 1,
          manualChecks: [],
          error: null,
          catalogVersion: state.catalogVersion,
        },
        at,
      );
    }
    case "begin-analysis": {
      const item = state.items[action.itemId];
      if (!item || item.deleted) return state;
      // Only the current attempt may start analysis; stale retries wait.
      if (action.attempt !== item.attempt) return state;
      if (item.status !== "captured" && item.status !== "error") return state;
      if (!isNonEmptyString(action.analysisId)) return state;
      return withItem(
        state,
        action.itemId,
        { ...item, status: "analyzing", analysisId: action.analysisId, error: null },
        at,
      );
    }
    case "commit-draft": {
      const item = state.items[action.itemId];
      if (!item || item.deleted) return state;
      // Identity gate: late responses for an older attempt, replaced media,
      // a cancelled analysis, or a changed item are discarded (REQ-006).
      if (action.attempt !== item.attempt) return state;
      if (item.status !== "analyzing") return state;
      if (item.analysisId !== action.analysisId) return state;
      if (item.mediaId !== action.mediaId) return state;
      if (
        typeof item.mediaHash !== "string" ||
        item.mediaHash.toLowerCase() !== action.mediaHash.toLowerCase()
      ) {
        return state;
      }
      const parsed = validateEnvelope(action.envelope);
      if (!parsed.ok) {
        // Invalid model output is rejected, never persisted as a draft.
        // The photo is retained so the worker can retry (REQ-002/REQ-004).
        return withItem(
          state,
          action.itemId,
          {
            ...item,
            status: "error",
            analysisId: null,
            error: {
              code: "INVALID_MODEL_OUTPUT",
              message: `Strict output validation failed: ${parsed.errors.join("; ")}`,
            },
          },
          at,
        );
      }
      const envelope = parsed.value;
      // Envelope provenance must describe this exact evidence: cross-item or
      // cross-media envelopes are discarded, never re-attached (REQ-006).
      if (
        envelope.sessionId !== state.sessionId ||
        envelope.itemId !== action.itemId ||
        envelope.analysisId !== action.analysisId ||
        envelope.mediaId !== action.mediaId ||
        envelope.mediaHash.toLowerCase() !== action.mediaHash.toLowerCase() ||
        envelope.catalogVersion !== item.catalogVersion
      ) {
        return state;
      }
      return withItem(
        state,
        action.itemId,
        {
          ...item,
          status: "draft",
          draft: envelope.draft,
          workerRevision: null,
          disposition: "unreviewed",
          dispositionAt: null,
          revision: item.revision + 1,
          analysisId: null,
          error: null,
        },
        at,
      );
    }
    case "fail-analysis": {
      const item = state.items[action.itemId];
      if (!item || item.deleted) return state;
      if (action.attempt !== item.attempt) return state;
      if (item.status !== "analyzing") return state;
      if (!isNonEmptyString(action.code)) return state;
      return withItem(
        state,
        action.itemId,
        {
          ...item,
          status: "error",
          analysisId: null,
          error: {
            code: action.code,
            message:
              typeof action.message === "string" && action.message.length > 0
                ? action.message.slice(0, 300)
                : "Analysis failed.",
          },
        },
        at,
      );
    }
    case "cancel-analysis": {
      const item = state.items[action.itemId];
      if (!item || item.deleted) return state;
      if (action.attempt !== item.attempt) return state;
      if (item.status !== "analyzing") return state;
      // Cancellation alone cannot prevent late writes: the attempt stays
      // valid for matching, but without analysisId any late commit that
      // presents the old ID is discarded by the identity gate above.
      return withItem(
        state,
        action.itemId,
        { ...item, status: "captured", analysisId: null },
        at,
      );
    }
    case "reanalyze": {
      const item = state.items[action.itemId];
      if (!item || item.deleted) return state;
      if (item.mediaId === null) return state;
      // Reanalysis invalidates previous review and manual-check evidence.
      return withItem(
        state,
        action.itemId,
        {
          ...item,
          status: "captured",
          attempt: item.attempt + 1,
          analysisId: null,
          draft: null,
          workerRevision: null,
          disposition: "unreviewed",
          dispositionAt: null,
          revision: item.revision + 1,
          manualChecks: [],
          error: null,
        },
        at,
      );
    }
    case "accept": {
      const item = state.items[action.itemId];
      if (!item || item.deleted) return state;
      if (item.status !== "draft" || item.draft === null) return state;
      // Accepting text never marks a physical test performed: manual-check
      // responses are left untouched (REQ-005).
      return withItem(
        state,
        action.itemId,
        {
          ...item,
          status: "reviewed",
          disposition: "accepted",
          dispositionAt: at,
          revision: item.revision + 1,
        },
        at,
      );
    }
    case "accept-edited": {
      const item = state.items[action.itemId];
      if (!item || item.deleted) return state;
      if (item.status !== "draft" || item.draft === null) return state;
      if (
        typeof action.revisedText !== "string" ||
        action.revisedText.trim().length === 0 ||
        action.revisedText.length > MAX_REVISION_LENGTH
      ) {
        return state;
      }
      return withItem(
        state,
        action.itemId,
        {
          ...item,
          status: "reviewed",
          disposition: "accepted-edited",
          dispositionAt: at,
          workerRevision: action.revisedText,
          revision: item.revision + 1,
        },
        at,
      );
    }
    case "reject": {
      const item = state.items[action.itemId];
      if (!item || item.deleted) return state;
      if (item.status !== "draft" || item.draft === null) return state;
      if (!isNonEmptyString(action.reason)) return state;
      // Rejection is not acceptance: the original draft is preserved for
      // audit, but the item leaves the draft state (REQ-005).
      return withItem(
        state,
        action.itemId,
        {
          ...item,
          status: "rejected",
          disposition: "rejected",
          dispositionAt: at,
          workerRevision: action.reason.slice(0, MAX_REVISION_LENGTH),
          revision: item.revision + 1,
        },
        at,
      );
    }
    case "record-manual-check": {
      const item = state.items[action.itemId];
      if (!item || item.deleted) return state;
      if (item.status === "empty" || item.status === "analyzing") return state;
      const parsed = validateManualCheckResponse(
        {
          checkId: action.checkId,
          outcome: action.outcome,
          note: action.note,
          recordedAt: action.recordedAt,
        },
        action.requiredCheckIds,
      );
      if (!parsed.ok) return state;
      const remaining = item.manualChecks.filter(
        (response) => response.checkId !== action.checkId,
      );
      return withItem(
        state,
        action.itemId,
        {
          ...item,
          manualChecks: [...remaining, parsed.value],
          revision: item.revision + 1,
        },
        at,
      );
    }
    case "delete-item-evidence": {
      const item = state.items[action.itemId];
      if (!item || item.deleted) return state;
      // Deletion cancels inflight work: the attempt is retired and the
      // deleted flag makes every late commit a no-op (REQ-006/REQ-007).
      return withItem(
        state,
        action.itemId,
        {
          ...item,
          status: "empty",
          mediaId: null,
          mediaHash: null,
          capturedAt: null,
          attempt: item.attempt + 1,
          analysisId: null,
          draft: null,
          workerRevision: null,
          disposition: "unreviewed",
          dispositionAt: null,
          revision: item.revision + 1,
          manualChecks: [],
          error: null,
          deleted: true,
        },
        at,
      );
    }
    default: {
      return state;
    }
  }
}

/**
 * Test and caller convenience: build a well-formed commit-draft action whose
 * envelope provenance already matches the presented evidence identity.
 * Callers testing mismatch paths override fields after construction.
 */
export function commitDraftPayload(
  itemId: string,
  analysisId: string,
  attempt: number,
  mediaId: string,
  mediaHash: string,
  overrides: {
    sessionId?: string;
    catalogVersion?: string;
    model?: string;
    mode?: AnalysisMode;
    draft?: AnalysisDraft;
  } = {},
): SessionAction {
  const draft: AnalysisDraft = overrides.draft ?? {
    observation: "The sink basin looks intact with a single faucet.",
    visibleEvidence: ["basin without visible cracks"],
    unknowns: ["water flow cannot be told from the photo"],
    suggestedManualChecks: ["Run the taps and watch drainage."],
  };
  const envelope: AnalysisEnvelope = {
    analysisId,
    sessionId: overrides.sessionId ?? "session-1",
    itemId,
    catalogVersion: overrides.catalogVersion ?? "0.2.0-demo.1",
    mediaId,
    mediaHash,
    model: overrides.model ?? "muse-spark-1.3",
    mode: overrides.mode ?? "fixture",
    requestId: `req-${analysisId}`,
    latencyMs: 12,
    draft,
  };
  return {
    type: "commit-draft",
    itemId,
    analysisId,
    attempt,
    mediaId,
    mediaHash,
    envelope,
  };
}

/**
 * Export gate (REQ-008): an item may appear as completed only when a worker
 * reviewed it and every required check is resolved. Everything else —
 * pending, rejected, failed — exports as unresolved without draft text.
 */
export function exportBlockers(
  state: SessionState,
  requiredByItem: Record<string, string[]>,
): Array<{ itemId: string; reason: string }> {
  const blockers: Array<{ itemId: string; reason: string }> = [];
  if (state.deleted) {
    return [{ itemId: "*", reason: "session deleted" }];
  }
  for (const itemId of Object.keys(state.items)) {
    const item = state.items[itemId];
    if (item.deleted) continue;
    if (item.status !== "reviewed") {
      blockers.push({
        itemId,
        reason: `status "${item.status}" is not reviewed`,
      });
      continue;
    }
    const unresolved = unresolvedRequiredChecks(
      requiredByItem[itemId] ?? [],
      item.manualChecks,
    );
    if (unresolved.length > 0) {
      blockers.push({
        itemId,
        reason: `unresolved manual checks: ${unresolved.join(", ")}`,
      });
    }
  }
  return blockers;
}
