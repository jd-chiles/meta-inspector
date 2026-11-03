/** Versioned local storage for Move-in Ready decisions and clip identities. */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import catalogJson from "../../data/catalog.demo.json";

import {
  LEGACY_DEFAULT_ROOM_IDS,
  MOVE_IN_READY_ELEMENTS,
  MOVE_IN_READY_SCHEMA_VERSION,
  MOVE_IN_READY_UNIT_TYPES,
  createUnreviewedEvaluatorDecisions,
  isMoveInReadyElementId,
  isMoveInReadyPromptIdForRoom,
  isMoveInReadyRoomId,
  roomContributesToElement,
  roomsForUnit,
  validateEvaluatorDecision,
  validateModelDeficiencySuggestion,
  validateEvaluatorSignoff,
  validateParticipantSignoff,
  validateEvidenceReference,
  validateInspectionLocation,
  validateVideoAnalysisIdentity,
  type EvaluatorDecisionSet,
  type EvaluatorSignoff,
  type ParticipantSignoff,
  type EvidenceReference,
  type FundingType,
  type InspectionLocation,
  type ModelElementProposal,
  type MoveInReadyElementId,
  type MoveInReadyPromptId,
  type MoveInReadyRoomId,
  type MoveInReadyUnitType,
  type ProposalState,
  type VideoAnalysisIdentity,
  normalizeFundingType,
} from "../../domain/move-in-ready";

export const INSPECTION_SCHEMA_VERSION = MOVE_IN_READY_SCHEMA_VERSION;
const LEGACY_INSPECTION_SCHEMA_VERSION = 1;
const ACKNOWLEDGMENT_INSPECTION_SCHEMA_VERSION = 2;
const PREVIOUS_INSPECTION_SCHEMA_VERSION = 3;
const PREVIOUS_SCHEMA_VERSION_WITHOUT_IDENTITY_VERSIONS = 4;
const CURRENT_CATALOG_VERSION = catalogJson.version;
export const INSPECTION_DATABASE_NAME = "move-in-ready-inspections";
export const INSPECTION_MEMORY_ONLY_WARNING =
  "This walkthrough is held in memory only. Export it before leaving or reloading; this browser session cannot save it locally.";

const MEMORY_MAX_INSPECTIONS = 20;
const MEMORY_MAX_RECORD_BYTES = 512 * 1024;
const MEMORY_MAX_TOTAL_BYTES = 2 * 1024 * 1024;

/** A queued, user-requested intent only; the store never executes it. */
export interface PendingAnalysisIntent {
  roomId: MoveInReadyRoomId;
  schemaVersion: number;
  videoId: string;
  videoRevision: number;
  videoHash: string;
  catalogVersion: string;
  requestedAt: string;
}

export interface StoredRoomClipIdentity {
  roomId: MoveInReadyRoomId;
  schemaVersion: number;
  catalogVersion: string;
  videoId: string;
  videoRevision: number;
  videoHash: string;
  capturedAt: string;
  durationSeconds: number;
  sizeBytes: number;
  evidence: EvidenceReference[];
}

/**
 * What the 1fps live tracking loop saw while an element proof clip was
 * filmed. Counts come from /api/video/track responses; the excerpt is the
 * inspector's last heard narration. Drafts built from a proof must still be
 * confirmed by the evaluator.
 */
export interface LiveProofMetadata {
  /** Frames where SAM tracked the element's concept. */
  trackedFrames: number;
  /** Total 1fps tracking samples attempted while recording. */
  totalFrames: number;
  /** Inspector narration heard while filming, or null when silent. */
  transcriptExcerpt: string | null;
  /** ISO timestamp when the proof clip finished recording. */
  recordedAt: string;
}

export interface VoiceCheckAnswer {
  question: string;
  answer: "yes" | "no" | "skipped";
  recordedAt: string;
}

/** Guided-tour narration language (REQ-R2). "en" default; "es" needs FISH_VOICE_ID_ES. */
export type TourLanguage = "en" | "es";

export interface MoveInReadyInspection {
  schemaVersion: typeof INSPECTION_SCHEMA_VERSION;
  catalogVersion: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  fundingType: FundingType;
  pseudonym: string;
  evaluatorName: string;
  /** Voice/tap answers to the in-person room checks, keyed by room id. */
  voiceChecks: Partial<Record<MoveInReadyRoomId, VoiceCheckAnswer[]>>;
  /** Evaluator-described unit; "" for records saved before per-unit rooms. */
  unitType: "" | MoveInReadyUnitType;
  bathCount: number;
  /** Concrete rooms this inspection covers, from the unit description. */
  roomIds: MoveInReadyRoomId[];
  selectedRoomId: MoveInReadyRoomId;
  completedPromptIdsByRoom: Partial<Record<MoveInReadyRoomId, MoveInReadyPromptId[]>>;
  clipIdentities: Partial<Record<MoveInReadyRoomId, StoredRoomClipIdentity>>;
  /** v2 per-element live clip identities, keyed by element id. */
  elementClipIdentities: Partial<Record<MoveInReadyElementId, StoredRoomClipIdentity>>;
  /** v2 live tracking proof metadata, keyed by element id. */
  liveProofs: Partial<Record<MoveInReadyElementId, LiveProofMetadata>>;
  proposals: Partial<Record<string, ModelElementProposal>>;
  decisions: EvaluatorDecisionSet;
  pendingAnalysisIntent: PendingAnalysisIntent | null;
  /** Persisted offline analysis queue (REQ-L2): room ids awaiting analysis, in enqueue order. */
  analysisQueue: MoveInReadyRoomId[];
  /** Optional GPS attestation captured at sign-off (REQ-L3); never blocks signing. */
  inspectionLocation: InspectionLocation | null;
  signoff: EvaluatorSignoff | null;
  /** REQ-F1 dual attestation: participant co-signature; name + typed signature only. */
  participantSignoff: ParticipantSignoff | null;
  /** REQ-F2: the participant needs visual (strobe) alarms; adds room checks + Fire Safety criteria. */
  participantVisualAlarmsRequired: boolean;
  evaluatorAgencyName: string;
  landlordDiscussion: "" | "yes" | "no";
  landlordDiscussionDate: string;
  leadershipSignoffRequired: boolean;
  leadershipNameAndTitle: string;
  leadershipSignoff: string;
  leadershipSignedAt: string;
  inspectionNote: string;
  /** Spoken + question language for the guided tour only; review/export stay English. */
  tourLanguage: TourLanguage;
}

interface InspectionDatabase extends DBSchema {
  inspections: {
    key: string;
    value: MoveInReadyInspection;
    indexes: { "by-updated": string };
  };
}

export type InspectionStoreErrorCode =
  | "UNAVAILABLE"
  | "QUOTA_EXCEEDED"
  | "SCHEMA_MISMATCH"
  | "IO";

export class InspectionStoreError extends Error {
  readonly code: InspectionStoreErrorCode;

  constructor(code: InspectionStoreErrorCode, message: string) {
    super(message);
    this.name = "InspectionStoreError";
    this.code = code;
  }
}

export interface InspectionStore {
  get(sessionId: string): Promise<MoveInReadyInspection | null>;
  put(record: MoveInReadyInspection): Promise<void>;
  delete(sessionId: string): Promise<void>;
  /** Every saved inspection, newest first. Rows that fail validation are skipped, never returned. */
  list(): Promise<MoveInReadyInspection[]>;
  isMemoryOnly(): boolean;
  close(): void;
}

export function createInspectionStore(): InspectionStore {
  let databasePromise: Promise<IDBPDatabase<InspectionDatabase>> | null = null;
  let memoryOnly = typeof indexedDB === "undefined";
  let persistentDatabaseWasOpened = false;
  let memoryFallbackError: InspectionStoreError | null = null;
  const memoryRecords = new Map<string, { record: MoveInReadyInspection; sizeBytes: number }>();
  let memoryBytes = 0;

  function activateMemoryFallback(error: unknown): boolean {
    const normalized = normalizeStorageError(error);
    if (normalized.code !== "UNAVAILABLE" && normalized.code !== "QUOTA_EXCEEDED") return false;
    memoryOnly = true;
    memoryFallbackError = normalized;
    return true;
  }

  function memoryGet(sessionId: string): MoveInReadyInspection | null {
    const stored = memoryRecords.get(sessionId);
    if (!stored) return null;
    const validated = validateInspectionRecord(stored.record, sessionId);
    if (!validated.ok) throw new InspectionStoreError("SCHEMA_MISMATCH", validated.message);
    return JSON.parse(JSON.stringify(validated.record)) as MoveInReadyInspection;
  }

  function memoryPut(record: MoveInReadyInspection): void {
    const serialized = JSON.stringify(record);
    const sizeBytes = new TextEncoder().encode(serialized).byteLength;
    if (sizeBytes > MEMORY_MAX_RECORD_BYTES) {
      throw new InspectionStoreError(
        "QUOTA_EXCEEDED",
        "This walkthrough is memory only, but this inspection exceeds the temporary memory limit. Export a copy and remove older evidence before continuing.",
      );
    }
    const existing = memoryRecords.get(record.sessionId);
    const nextCount = memoryRecords.size + (existing ? 0 : 1);
    const nextBytes = memoryBytes - (existing?.sizeBytes ?? 0) + sizeBytes;
    if (nextCount > MEMORY_MAX_INSPECTIONS || nextBytes > MEMORY_MAX_TOTAL_BYTES) {
      throw new InspectionStoreError(
        "QUOTA_EXCEEDED",
        "This walkthrough is memory only and temporary inspection memory is full. Export a copy or remove another inspection before continuing.",
      );
    }
    const copy = JSON.parse(serialized) as MoveInReadyInspection;
    memoryRecords.set(record.sessionId, { record: copy, sizeBytes });
    memoryBytes = nextBytes;
  }

  function memoryDelete(sessionId: string): void {
    const existing = memoryRecords.get(sessionId);
    if (!existing) return;
    memoryRecords.delete(sessionId);
    memoryBytes -= existing.sizeBytes;
  }

  function database(): Promise<IDBPDatabase<InspectionDatabase>> {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new InspectionStoreError(
        "UNAVAILABLE",
        "This browser cannot save inspection decisions locally. Use a browser with site storage enabled.",
      ));
    }
    if (!databasePromise) {
      databasePromise = openDB<InspectionDatabase>(
        INSPECTION_DATABASE_NAME,
        INSPECTION_SCHEMA_VERSION,
        {
          upgrade(db, oldVersion, _newVersion, transaction) {
            if (!db.objectStoreNames.contains("inspections")) {
              const store = db.createObjectStore("inspections", { keyPath: "sessionId" });
              store.createIndex("by-updated", "updatedAt");
            } else if (oldVersion < INSPECTION_SCHEMA_VERSION) {
              const store = transaction.objectStore("inspections");
              void (async () => {
                let cursor = await store.openCursor();
                while (cursor) {
                  const migrated = migrateLegacyInspectionRecord(cursor.value, String(cursor.primaryKey));
                  if (migrated) {
                    const validated = validateInspectionRecord(migrated, migrated.sessionId);
                    if (validated.ok) cursor.update(validated.record);
                  }
                  cursor = await cursor.continue();
                }
              })();
            }
          },
          blocked() {
            databasePromise = null;
          },
          terminated() {
            databasePromise = null;
          },
        },
      ).then((db) => {
        persistentDatabaseWasOpened = true;
        return db;
      }).catch((error: unknown) => {
        databasePromise = null;
        throw normalizeStorageError(error);
      });
    }
    return databasePromise;
  }

  return {
    async get(sessionId) {
      if (memoryOnly) return memoryGet(sessionId);
      try {
        const value = await (await database()).get("inspections", sessionId);
        if (value === undefined) return null;
        const validated = validateInspectionRecord(value, sessionId);
        if (!validated.ok) {
          throw new InspectionStoreError("SCHEMA_MISMATCH", validated.message);
        }
        return validated.record;
      } catch (error) {
        if (activateMemoryFallback(error)) return memoryGet(sessionId);
        throw normalizeStorageError(error);
      }
    },
    async put(record) {
      const validated = validateInspectionRecord(record, record.sessionId);
      if (!validated.ok) {
        throw new InspectionStoreError("SCHEMA_MISMATCH", validated.message);
      }
      if (memoryOnly) {
        memoryPut(validated.record);
        return;
      }
      try {
        await (await database()).put("inspections", validated.record);
      } catch (error) {
        if (activateMemoryFallback(error)) {
          memoryPut(validated.record);
          return;
        }
        throw normalizeStorageError(error);
      }
    },
    async delete(sessionId) {
      if (memoryOnly && !persistentDatabaseWasOpened) {
        if (typeof indexedDB === "undefined") {
          // No IndexedDB API exists in this runtime, so this store could not
          // have persisted an inspection here.
          memoryDelete(sessionId);
          return;
        }
        // Opening storage failed before this store could establish whether a
        // saved row exists. Keep reset fail-closed instead of saying local
        // data was removed when a previous persistent row may still remain.
        const code = memoryFallbackError?.code ?? "UNAVAILABLE";
        throw new InspectionStoreError(
          code,
          code === "QUOTA_EXCEEDED"
            ? "Local storage is full, so removal from this device could not be confirmed. Free storage and try again."
            : "Browser storage could not be accessed, so removal from this device could not be confirmed. Restore storage access and try again.",
        );
      }
      try {
        await (await database()).delete("inspections", sessionId);
        memoryDelete(sessionId);
      } catch (error) {
        activateMemoryFallback(error);
        // Do not claim the persistent row was deleted when IndexedDB rejects
        // removal. Keep the memory copy too, so the active page still has the
        // user's data while it reports that reset did not complete.
        throw normalizeStorageError(error);
      }
    },
    async list() {
      if (memoryOnly) {
        const records: MoveInReadyInspection[] = [];
        for (const stored of memoryRecords.values()) {
          const validated = validateInspectionRecord(stored.record, stored.record.sessionId);
          if (validated.ok) records.push(validated.record);
        }
        records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return records;
      }
      try {
        const rows = await (await database()).getAllFromIndex("inspections", "by-updated");
        const records: MoveInReadyInspection[] = [];
        for (const row of rows) {
          const validated = validateInspectionRecord(row, String((row as MoveInReadyInspection).sessionId ?? ""));
          if (validated.ok) records.push(validated.record);
        }
        records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return records;
      } catch (error) {
        if (activateMemoryFallback(error)) {
          const records: MoveInReadyInspection[] = [];
          for (const stored of memoryRecords.values()) {
            const validated = validateInspectionRecord(stored.record, stored.record.sessionId);
            if (validated.ok) records.push(validated.record);
          }
          records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          return records;
        }
        throw normalizeStorageError(error);
      }
    },
    isMemoryOnly() {
      return memoryOnly;
    },
    close() {
      memoryRecords.clear();
      memoryBytes = 0;
      if (databasePromise) {
        void databasePromise.then((db) => db.close()).catch(() => undefined);
      }
      databasePromise = null;
    },
  };
}

export function createInitialInspectionRecord(
  sessionId: string,
  now = new Date().toISOString(),
): MoveInReadyInspection {
  return {
    schemaVersion: INSPECTION_SCHEMA_VERSION,
    catalogVersion: CURRENT_CATALOG_VERSION,
    sessionId,
    createdAt: now,
    updatedAt: now,
    fundingType: "unknown",
    pseudonym: "",
    evaluatorName: "",
    voiceChecks: {},
    unitType: "",
    bathCount: 1,
    roomIds: roomsForUnit("1-bedroom", 1),
    selectedRoomId: "kitchen",
    completedPromptIdsByRoom: {},
    clipIdentities: {},
    elementClipIdentities: {},
    liveProofs: {},
    proposals: {},
    decisions: createUnreviewedEvaluatorDecisions(),
    pendingAnalysisIntent: null,
    analysisQueue: [],
    inspectionLocation: null,
    signoff: null,
    participantSignoff: null,
    participantVisualAlarmsRequired: false,
    evaluatorAgencyName: "",
    landlordDiscussion: "",
    landlordDiscussionDate: "",
    leadershipSignoffRequired: false,
    leadershipNameAndTitle: "",
    leadershipSignoff: "",
    leadershipSignedAt: "",
    inspectionNote: "",
    tourLanguage: "en",
  };
}

interface NormalizedRoomFields {
  unitType: "" | MoveInReadyUnitType;
  bathCount: number;
  roomIds: MoveInReadyRoomId[];
}

/**
 * Per-unit rooms, defaulted for records saved before the evaluator described
 * the unit. Legacy records keep the four legacy room ids so their clips and
 * decisions stay valid.
 */
function normalizeVoiceChecks(value: Record<string, unknown>): MoveInReadyInspection["voiceChecks"] | null {
  const raw = value.voiceChecks;
  if (raw === undefined) return {};
  if (!isRecord(raw)) return null;
  const checks: MoveInReadyInspection["voiceChecks"] = {};
  for (const [roomId, answers] of Object.entries(raw)) {
    if (!isMoveInReadyRoomId(roomId) || !Array.isArray(answers) || answers.length > 8) return null;
    const normalized: VoiceCheckAnswer[] = [];
    for (const answer of answers) {
      if (!isRecord(answer) || typeof answer.question !== "string" || answer.question.length === 0 ||
          answer.question.length > 300 || (answer.answer !== "yes" && answer.answer !== "no" && answer.answer !== "skipped") ||
          typeof answer.recordedAt !== "string" || !Number.isFinite(Date.parse(answer.recordedAt))) {
        return null;
      }
      normalized.push({ question: answer.question, answer: answer.answer, recordedAt: answer.recordedAt });
    }
    checks[roomId as MoveInReadyRoomId] = normalized;
  }
  return checks;
}

/**
 * Normalize the persisted offline analysis queue (REQ-L2). Records saved
 * before Sprint 3 have no queue and default to empty; entries dedupe in
 * enqueue order. Non-room entries fail closed.
 */
function normalizeAnalysisQueue(value: unknown): MoveInReadyRoomId[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 12) return null;
  const seen = new Set<string>();
  const normalized: MoveInReadyRoomId[] = [];
  for (const entry of value) {
    if (!isMoveInReadyRoomId(entry)) return null;
    if (seen.has(entry)) continue;
    seen.add(entry);
    normalized.push(entry);
  }
  return normalized;
}

function normalizeRoomFields(value: Record<string, unknown>): NormalizedRoomFields | null {
  const unitType = value.unitType;
  if (unitType !== undefined && unitType !== "" &&
      !(MOVE_IN_READY_UNIT_TYPES as readonly string[]).includes(unitType as string)) {
    return null;
  }
  const bathCount = value.bathCount;
  if (bathCount !== undefined &&
      (typeof bathCount !== "number" || !Number.isSafeInteger(bathCount) || bathCount < 1 || bathCount > 8)) {
    return null;
  }
  const roomIds = value.roomIds;
  if (roomIds !== undefined) {
    if (!Array.isArray(roomIds) || roomIds.length === 0 || roomIds.length > 12) return null;
    const seen = new Set<string>();
    for (const roomId of roomIds) {
      if (!isMoveInReadyRoomId(roomId) || seen.has(roomId as string)) return null;
      seen.add(roomId as string);
    }
    return {
      unitType: (unitType ?? "") as "" | MoveInReadyUnitType,
      bathCount: (bathCount ?? 1) as number,
      roomIds: [...roomIds] as MoveInReadyRoomId[],
    };
  }
  return { unitType: "", bathCount: 1, roomIds: [...LEGACY_DEFAULT_ROOM_IDS] };
}

/**
 * Shared field + evidence validation for one stored clip identity. Room-map
 * keys bind the identity's roomId to the key; element-map keys (v2) carry the
 * filming room inside the identity because the key is the element id.
 */
function validateStoredClipIdentityEntry(
  mapKey: string,
  rawIdentity: Record<string, unknown>,
  kind: "room" | "element",
): { ok: true } | { ok: false; message: string } {
  if (kind === "room") {
    if (rawIdentity.roomId !== mapKey) {
      return { ok: false, message: "The saved inspection has an invalid clip identity." };
    }
  } else if (!isMoveInReadyRoomId(rawIdentity.roomId)) {
    return { ok: false, message: "The saved inspection has an invalid element clip identity." };
  }
  if (
    typeof rawIdentity.schemaVersion !== "number" || !Number.isSafeInteger(rawIdentity.schemaVersion) || rawIdentity.schemaVersion < 1 ||
    typeof rawIdentity.catalogVersion !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(rawIdentity.catalogVersion) ||
    typeof rawIdentity.videoId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(rawIdentity.videoId) ||
    !Number.isSafeInteger(rawIdentity.videoRevision) ||
    (rawIdentity.videoRevision as number) < 1 ||
    typeof rawIdentity.videoHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(rawIdentity.videoHash) ||
    typeof rawIdentity.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(rawIdentity.capturedAt)) ||
    typeof rawIdentity.durationSeconds !== "number" ||
    !Number.isFinite(rawIdentity.durationSeconds) ||
    rawIdentity.durationSeconds <= 0 ||
    rawIdentity.durationSeconds > 30 ||
    typeof rawIdentity.sizeBytes !== "number" ||
    !Number.isSafeInteger(rawIdentity.sizeBytes) ||
    rawIdentity.sizeBytes <= 0 ||
    rawIdentity.sizeBytes > 60 * 1024 * 1024 ||
    !Array.isArray(rawIdentity.evidence) ||
    rawIdentity.evidence.length > 30
  ) {
    return { ok: false, message: "The saved inspection has an invalid clip identity." };
  }
  const identityEvidence = new Set<string>();
  const identityStillIds = new Set<string>();
  for (const evidence of rawIdentity.evidence) {
    const parsedEvidence = validateEvidenceReference(evidence);
    if (!parsedEvidence.ok ||
        parsedEvidence.value.frameIndex !== null ||
        parsedEvidence.value.videoId !== rawIdentity.videoId ||
        parsedEvidence.value.videoRevision !== rawIdentity.videoRevision ||
        parsedEvidence.value.roomId !== rawIdentity.roomId ||
        parsedEvidence.value.schemaVersion !== rawIdentity.schemaVersion ||
        parsedEvidence.value.catalogVersion !== rawIdentity.catalogVersion ||
        parsedEvidence.value.timestampMs >= (rawIdentity.durationSeconds as number) * 1000) {
      return { ok: false, message: "The saved inspection contains invalid still evidence." };
    }
    const evidenceKey = evidenceReferenceKey(parsedEvidence.value);
    if (identityEvidence.has(evidenceKey)) {
      return { ok: false, message: "The saved inspection contains duplicate still identities." };
    }
    if (identityStillIds.has(parsedEvidence.value.stillId)) {
      return { ok: false, message: "The saved inspection contains duplicate still IDs." };
    }
    identityEvidence.add(evidenceKey);
    identityStillIds.add(parsedEvidence.value.stillId);
  }
  return { ok: true };
}

export function validateInspectionRecord(
  value: unknown,
  expectedSessionId: string,
): { ok: true; record: MoveInReadyInspection } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: "The saved inspection is not a valid record." };
  if (
    value.schemaVersion === LEGACY_INSPECTION_SCHEMA_VERSION ||
    value.schemaVersion === ACKNOWLEDGMENT_INSPECTION_SCHEMA_VERSION ||
    value.schemaVersion === PREVIOUS_INSPECTION_SCHEMA_VERSION ||
    value.schemaVersion === PREVIOUS_SCHEMA_VERSION_WITHOUT_IDENTITY_VERSIONS
  ) {
    const migrated = migrateLegacyInspectionRecord(value, expectedSessionId);
    if (!migrated) return { ok: false, message: "The saved inspection could not be safely migrated." };
    return validateInspectionRecord(migrated, expectedSessionId);
  }
  if (value.schemaVersion !== INSPECTION_SCHEMA_VERSION) {
    return { ok: false, message: "The saved inspection uses an unsupported version." };
  }
  if (value.sessionId !== expectedSessionId) {
    return { ok: false, message: "The saved inspection belongs to a different session." };
  }
  if (
  typeof value.catalogVersion !== "string" ||
  !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.catalogVersion) ||
  typeof value.createdAt !== "string" ||
  !Number.isFinite(Date.parse(value.createdAt)) ||
  typeof value.updatedAt !== "string" ||
  !Number.isFinite(Date.parse(value.updatedAt)) ||
  // Accept legacy and strict fundingType values; unknown, lahsa, hud are
  // the canonical members. Any other value is treated as unknown so that
  // older saved records or renamed option values do not fail validation.
  (value.fundingType !== "unknown" && value.fundingType !== "lahsa" && value.fundingType !== "hud") ||
    typeof value.pseudonym !== "string" ||
    value.pseudonym.length > 80 ||
    (value.evaluatorName !== undefined && (typeof value.evaluatorName !== "string" || value.evaluatorName.length > 120)) ||
    !isMoveInReadyRoomId(value.selectedRoomId) ||
    (value.completedPromptIdsByRoom !== undefined && !isRecord(value.completedPromptIdsByRoom)) ||
    !isRecord(value.clipIdentities) ||
    (value.elementClipIdentities !== undefined && !isRecord(value.elementClipIdentities)) ||
    (value.liveProofs !== undefined && !isRecord(value.liveProofs)) ||
    !isRecord(value.proposals) ||
    !isRecord(value.decisions) ||
    !(value.pendingAnalysisIntent === null || isRecord(value.pendingAnalysisIntent)) ||
    (value.analysisQueue !== undefined && !Array.isArray(value.analysisQueue)) ||
    (value.inspectionLocation !== undefined && value.inspectionLocation !== null && !isRecord(value.inspectionLocation)) ||
    (value.signoff !== null && !validateEvaluatorSignoff(value.signoff).ok) ||
    (value.participantSignoff !== undefined && value.participantSignoff !== null && !validateParticipantSignoff(value.participantSignoff).ok) ||
    (value.participantVisualAlarmsRequired !== undefined && typeof value.participantVisualAlarmsRequired !== "boolean") ||
    typeof value.evaluatorAgencyName !== "string" ||
    value.evaluatorAgencyName.length > 120 ||
    (value.landlordDiscussion !== "" && value.landlordDiscussion !== "yes" && value.landlordDiscussion !== "no") ||
    typeof value.landlordDiscussionDate !== "string" ||
    !isValidOptionalDate(value.landlordDiscussionDate) ||
    typeof value.leadershipSignoffRequired !== "boolean" ||
    typeof value.leadershipNameAndTitle !== "string" ||
    value.leadershipNameAndTitle.length > 120 ||
    typeof value.leadershipSignoff !== "string" ||
    value.leadershipSignoff.length > 120 ||
    typeof value.leadershipSignedAt !== "string" ||
    !isValidOptionalDate(value.leadershipSignedAt) ||
    (value.inspectionNote !== undefined && (typeof value.inspectionNote !== "string" || value.inspectionNote.length > 2000)) ||
    (value.tourLanguage !== undefined && value.tourLanguage !== "en" && value.tourLanguage !== "es")
  ) {
    return { ok: false, message: "The saved inspection fields are incomplete or invalid." };
  }

  const completedPromptIdsByRoom: MoveInReadyInspection["completedPromptIdsByRoom"] = {};
  if (value.completedPromptIdsByRoom !== undefined) {
    for (const [roomKey, rawPromptIds] of Object.entries(value.completedPromptIdsByRoom as Record<string, unknown>)) {
      if (!isMoveInReadyRoomId(roomKey) || !Array.isArray(rawPromptIds) || rawPromptIds.length > 1) {
        return { ok: false, message: "The saved inspection contains invalid room prompt completion." };
      }
      const seen = new Set<string>();
      for (const promptId of rawPromptIds) {
        if (typeof promptId !== "string" || !isMoveInReadyPromptIdForRoom(roomKey, promptId) || seen.has(promptId)) {
          return { ok: false, message: "The saved inspection contains invalid room prompt completion." };
        }
        seen.add(promptId);
      }
      completedPromptIdsByRoom[roomKey] = [...rawPromptIds] as MoveInReadyPromptId[];
    }
  }

  for (const [roomKey, rawIdentity] of Object.entries(value.clipIdentities)) {
    if (!isMoveInReadyRoomId(roomKey) || !isRecord(rawIdentity)) {
      return { ok: false, message: "The saved inspection contains an invalid room clip identity." };
    }
    const entry = validateStoredClipIdentityEntry(roomKey, rawIdentity, "room");
    if (!entry.ok) return entry;
  }
  if (value.elementClipIdentities !== undefined) {
    for (const [elementKey, rawIdentity] of Object.entries(value.elementClipIdentities)) {
      if (!isMoveInReadyElementId(elementKey) || !isRecord(rawIdentity)) {
        return { ok: false, message: "The saved inspection contains an invalid element clip identity." };
      }
      const entry = validateStoredClipIdentityEntry(elementKey, rawIdentity, "element");
      if (!entry.ok) return entry;
    }
  }

  if (value.liveProofs !== undefined) {
    for (const [elementKey, rawProof] of Object.entries(value.liveProofs)) {
      if (!isMoveInReadyElementId(elementKey) || !isRecord(rawProof) ||
          !Number.isSafeInteger(rawProof.trackedFrames) || (rawProof.trackedFrames as number) < 0 ||
          !Number.isSafeInteger(rawProof.totalFrames) || (rawProof.totalFrames as number) < 0 ||
          (rawProof.trackedFrames as number) > (rawProof.totalFrames as number) ||
          (rawProof.transcriptExcerpt !== null &&
            (typeof rawProof.transcriptExcerpt !== "string" || rawProof.transcriptExcerpt.length > 300)) ||
          typeof rawProof.recordedAt !== "string" ||
          !Number.isFinite(Date.parse(rawProof.recordedAt))) {
        return { ok: false, message: "The saved inspection contains an invalid live proof." };
      }
    }
  }

  const hasStaleVersions = value.catalogVersion !== CURRENT_CATALOG_VERSION ||
    Object.values(value.clipIdentities).some((rawIdentity) =>
      isRecord(rawIdentity) && (rawIdentity.schemaVersion !== value.schemaVersion || rawIdentity.catalogVersion !== value.catalogVersion),
    ) ||
    (isRecord(value.elementClipIdentities) && Object.values(value.elementClipIdentities).some((rawIdentity) =>
      isRecord(rawIdentity) && (rawIdentity.schemaVersion !== value.schemaVersion || rawIdentity.catalogVersion !== value.catalogVersion),
    )) ||
    Object.values(value.proposals).some((rawProposal) => {
      const identity = isRecord(rawProposal) ? rawProposal.analysisIdentity : null;
      return !isRecord(identity) || identity.schemaVersion !== value.schemaVersion || identity.catalogVersion !== value.catalogVersion;
    }) ||
    Object.values(value.decisions).some((rawDecision) => {
      if (!isRecord(rawDecision) || (rawDecision.status !== "A" && rawDecision.status !== "D")) return false;
      const identity = rawDecision.analysisIdentity;
      if (identity !== null && (!isRecord(identity) || identity.schemaVersion !== value.schemaVersion || identity.catalogVersion !== value.catalogVersion)) return true;
      return Array.isArray(rawDecision.evidence) && rawDecision.evidence.some((rawEvidence) =>
        !isRecord(rawEvidence) || rawEvidence.schemaVersion !== value.schemaVersion || rawEvidence.catalogVersion !== value.catalogVersion,
      );
    }) ||
    (value.pendingAnalysisIntent !== null && (!isRecord(value.pendingAnalysisIntent) ||
      value.pendingAnalysisIntent.schemaVersion !== value.schemaVersion || value.pendingAnalysisIntent.catalogVersion !== value.catalogVersion));

  const roomFields = normalizeRoomFields(value);
  if (!roomFields) {
    return { ok: false, message: "The saved inspection contains invalid unit rooms." };
  }
  const voiceChecks = normalizeVoiceChecks(value);
  if (!voiceChecks) {
    return { ok: false, message: "The saved inspection contains invalid voice check answers." };
  }
  const analysisQueue = normalizeAnalysisQueue(value.analysisQueue);
  if (!analysisQueue) {
    return { ok: false, message: "The saved inspection contains an invalid analysis queue." };
  }
  let inspectionLocation: InspectionLocation | null = null;
  if (value.inspectionLocation !== undefined && value.inspectionLocation !== null) {
    const parsedLocation = validateInspectionLocation(value.inspectionLocation);
    if (!parsedLocation.ok) {
      return { ok: false, message: "The saved inspection contains an invalid inspection location." };
    }
    inspectionLocation = parsedLocation.value;
  }

  if (hasStaleVersions) {
    return {
      ok: true,
      record: {
        schemaVersion: INSPECTION_SCHEMA_VERSION,
        catalogVersion: CURRENT_CATALOG_VERSION,
        sessionId: expectedSessionId,
        createdAt: value.createdAt,
        updatedAt: new Date().toISOString(),
        fundingType: normalizeFundingType(value.fundingType),
        pseudonym: value.pseudonym,
        evaluatorName: typeof value.evaluatorName === "string" ? value.evaluatorName : "",
        voiceChecks,
        unitType: roomFields.unitType,
        bathCount: roomFields.bathCount,
        roomIds: roomFields.roomIds,
        selectedRoomId: value.selectedRoomId as MoveInReadyRoomId,
        completedPromptIdsByRoom,
        clipIdentities: value.clipIdentities as MoveInReadyInspection["clipIdentities"],
        elementClipIdentities: (value.elementClipIdentities ?? {}) as MoveInReadyInspection["elementClipIdentities"],
        liveProofs: (value.liveProofs ?? {}) as MoveInReadyInspection["liveProofs"],
        proposals: {},
        decisions: createUnreviewedEvaluatorDecisions(),
        pendingAnalysisIntent: null,
        analysisQueue: [],
        inspectionLocation: null,
        signoff: null,
        participantSignoff: null,
        participantVisualAlarmsRequired: value.participantVisualAlarmsRequired === true,
        evaluatorAgencyName: value.evaluatorAgencyName,
        landlordDiscussion: value.landlordDiscussion as MoveInReadyInspection["landlordDiscussion"],
        landlordDiscussionDate: value.landlordDiscussionDate,
        leadershipSignoffRequired: value.leadershipSignoffRequired,
        leadershipNameAndTitle: value.leadershipNameAndTitle,
        leadershipSignoff: value.leadershipSignoff,
        leadershipSignedAt: value.leadershipSignedAt,
        inspectionNote: typeof value.inspectionNote === "string" ? value.inspectionNote : "",
        tourLanguage: value.tourLanguage === "es" ? "es" : "en",
      },
    };
  }

  const parsedPendingAnalysisIntent = validatePendingAnalysisIntent(
    value.pendingAnalysisIntent,
    value.clipIdentities,
    value.schemaVersion as number,
    value.catalogVersion,
  );
  if (!parsedPendingAnalysisIntent.ok) {
    return { ok: false, message: parsedPendingAnalysisIntent.message };
  }

  const decisions = createUnreviewedEvaluatorDecisions();
  for (const [elementId, rawDecision] of Object.entries(value.decisions)) {
    if (!(elementId in decisions)) {
      return { ok: false, message: "The saved inspection contains an unknown element decision." };
    }
    const parsed = validateEvaluatorDecision(rawDecision, elementId as MoveInReadyElementId);
    if (!parsed.ok) {
      return { ok: false, message: "The saved inspection contains an invalid evaluator decision." };
    }
    if ((parsed.value.status === "A" || parsed.value.status === "D") &&
        parsed.value.evaluatorName.trim() !== (typeof value.evaluatorName === "string" ? value.evaluatorName.trim() : "")) {
      return { ok: false, message: "The saved evaluator decision belongs to a different evaluator." };
    }
    if (parsed.value.status === "A" || parsed.value.status === "D") {
      if (parsed.value.analysisIdentity !== null &&
          !isAnalysisIdentityCurrentInStoredRecord(parsed.value.analysisIdentity, value.sessionId as string, value.clipIdentities, value.schemaVersion as number, value.catalogVersion, isRecord(value.elementClipIdentities) ? value.elementClipIdentities : {})) {
        return { ok: false, message: "The saved evaluator decision refers to a stale video analysis." };
      }
      for (const evidence of parsed.value.evidence) {
        if (!isEvidenceCurrentInStoredRecord(evidence, value.clipIdentities, value.schemaVersion as number, value.catalogVersion, isRecord(value.elementClipIdentities) ? value.elementClipIdentities : {})) {
          return { ok: false, message: "The saved evaluator decision refers to a stale room clip." };
        }
      }
    }
    decisions[elementId as keyof EvaluatorDecisionSet] = parsed.value;
  }

  const proposals: MoveInReadyInspection["proposals"] = {};
  for (const [elementId, rawProposal] of Object.entries(value.proposals)) {
    if (!isMoveInReadyElementId(elementId) || !isRecord(rawProposal) ||
        Object.keys(rawProposal).some((key) => !["elementId", "state", "modelSuggestion", "observation", "confidence", "evidence", "analysisIdentity", "deficiencySuggestion"].includes(key)) ||
        rawProposal.elementId !== elementId ||
        (rawProposal.state !== "draft-proposal" && rawProposal.state !== "needs-human-check") ||
        (rawProposal.modelSuggestion !== "A" && rawProposal.modelSuggestion !== "D") ||
        typeof rawProposal.observation !== "string" || rawProposal.observation.length < 1 || rawProposal.observation.length > 600 ||
        typeof rawProposal.confidence !== "number" || !Number.isFinite(rawProposal.confidence) || rawProposal.confidence < 0 || rawProposal.confidence > 100 ||
        !Array.isArray(rawProposal.evidence) || rawProposal.evidence.length > 5 ||
        (rawProposal.evidence.length === 0 && rawProposal.state !== "needs-human-check")) {
      return { ok: false, message: "The saved inspection contains an invalid model proposal." };
    }
    const parsedAnalysisIdentity = validateVideoAnalysisIdentity(rawProposal.analysisIdentity);
    if (!parsedAnalysisIdentity.ok ||
        !isAnalysisIdentityCurrentInStoredRecord(parsedAnalysisIdentity.value, value.sessionId as string, value.clipIdentities, value.schemaVersion as number, value.catalogVersion, isRecord(value.elementClipIdentities) ? value.elementClipIdentities : {})) {
      return { ok: false, message: "The saved model proposal refers to a stale or invalid video analysis." };
    }
    let deficiencySuggestion: ModelElementProposal["deficiencySuggestion"];
    if (rawProposal.modelSuggestion === "D" && rawProposal.deficiencySuggestion !== undefined) {
      const parsedSuggestion = validateModelDeficiencySuggestion(rawProposal.deficiencySuggestion);
      if (!parsedSuggestion.ok) {
        return { ok: false, message: "The saved model proposal contains an invalid correction plan suggestion." };
      }
      deficiencySuggestion = parsedSuggestion.value;
    } else if (rawProposal.modelSuggestion === "A" && rawProposal.deficiencySuggestion !== undefined) {
      return { ok: false, message: "The saved model proposal contains a correction plan for a non-D suggestion." };
    }
    const normalizedEvidence: EvidenceReference[] = [];
    for (const evidence of rawProposal.evidence) {
      const parsedEvidence = validateEvidenceReference(evidence);
      if (!parsedEvidence.ok || parsedEvidence.value.frameIndex === null ||
          !isEvidenceCurrentInStoredRecord(parsedEvidence.value, value.clipIdentities, value.schemaVersion as number, value.catalogVersion, isRecord(value.elementClipIdentities) ? value.elementClipIdentities : {})) {
        return { ok: false, message: "The saved model proposal has invalid still evidence." };
      }
      normalizedEvidence.push(parsedEvidence.value);
    }
    const base = {
      elementId,
      state: rawProposal.state as ProposalState,
      observation: rawProposal.observation,
      confidence: rawProposal.confidence,
      evidence: normalizedEvidence,
      analysisIdentity: parsedAnalysisIdentity.value,
    };
    const sourceElement = MOVE_IN_READY_ELEMENTS.find((element) => element.id === elementId);
    if (!sourceElement || !roomContributesToElement(parsedAnalysisIdentity.value.roomId, sourceElement)) {
      return { ok: false, message: "The saved model proposal refers to an unrelated room." };
    }
    proposals[elementId] = rawProposal.modelSuggestion === "D"
      ? { ...base, modelSuggestion: "D", ...(deficiencySuggestion ? { deficiencySuggestion } : {}) }
      : { ...base, modelSuggestion: "A" };
  }

  for (const [elementId, decision] of Object.entries(decisions)) {
    if ((decision.status === "A" || decision.status === "D") && decision.analysisIdentity !== null) {
      const proposal = proposals[elementId as keyof typeof decisions];
      if (!proposal || !sameAnalysisIdentity(decision.analysisIdentity, proposal.analysisIdentity)) {
        return { ok: false, message: "The saved evaluator decision refers to a different model proposal." };
      }
    }
  }

  const evaluatorName = typeof value.evaluatorName === "string" ? value.evaluatorName : "";
  if (value.signoff !== null && isRecord(value.signoff) && value.signoff.evaluatorName !== evaluatorName.trim()) {
    return { ok: false, message: "The saved evaluator sign-off belongs to a different evaluator." };
  }

  return {
    ok: true,
    record: {
      schemaVersion: INSPECTION_SCHEMA_VERSION,
      catalogVersion: value.catalogVersion,
      sessionId: expectedSessionId,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      fundingType: normalizeFundingType(value.fundingType),
      pseudonym: value.pseudonym,
      evaluatorName,
      voiceChecks,
      unitType: roomFields.unitType,
      bathCount: roomFields.bathCount,
      roomIds: roomFields.roomIds,
      selectedRoomId: value.selectedRoomId as MoveInReadyRoomId,
      completedPromptIdsByRoom,
      clipIdentities: value.clipIdentities as MoveInReadyInspection["clipIdentities"],
      elementClipIdentities: (value.elementClipIdentities ?? {}) as MoveInReadyInspection["elementClipIdentities"],
      liveProofs: (value.liveProofs ?? {}) as MoveInReadyInspection["liveProofs"],
      proposals,
      decisions,
      pendingAnalysisIntent: parsedPendingAnalysisIntent.value,
      analysisQueue,
      inspectionLocation,
      signoff: value.signoff as EvaluatorSignoff | null,
      participantSignoff: (value.participantSignoff ?? null) as ParticipantSignoff | null,
      participantVisualAlarmsRequired: value.participantVisualAlarmsRequired === true,
      evaluatorAgencyName: value.evaluatorAgencyName,
      landlordDiscussion: value.landlordDiscussion as MoveInReadyInspection["landlordDiscussion"],
      landlordDiscussionDate: value.landlordDiscussionDate,
      leadershipSignoffRequired: value.leadershipSignoffRequired,
      leadershipNameAndTitle: value.leadershipNameAndTitle,
      leadershipSignoff: value.leadershipSignoff,
      leadershipSignedAt: value.leadershipSignedAt,
      inspectionNote: typeof value.inspectionNote === "string" ? value.inspectionNote : "",
      tourLanguage: value.tourLanguage === "es" ? "es" : "en",
    },
  };
}

/**
 * Conservatively migrate the prior inspection formats. Schema 1 did not keep
 * enough analysis provenance to retain review state, so it keeps intake,
 * prompts, and source clip/still identities only. Schema 2 already had that
 * provenance; it keeps proposals and clips while resetting any A/D decision
 * that lacks a valid in-person acknowledgment.
 */
export function migrateLegacyInspectionRecord(
  value: unknown,
  expectedSessionId: string,
): MoveInReadyInspection | null {
  if (!isRecord(value) || value.sessionId !== expectedSessionId || !isRecord(value.clipIdentities)) {
    return null;
  }
  if (value.schemaVersion === PREVIOUS_SCHEMA_VERSION_WITHOUT_IDENTITY_VERSIONS) {
    return stampLegacyVersions({
      ...(value as unknown as MoveInReadyInspection),
      schemaVersion: INSPECTION_SCHEMA_VERSION,
      sessionId: expectedSessionId,
      participantSignoff: null,
      participantVisualAlarmsRequired: false,
    }, PREVIOUS_SCHEMA_VERSION_WITHOUT_IDENTITY_VERSIONS);
  }
  if (value.schemaVersion === PREVIOUS_INSPECTION_SCHEMA_VERSION) {
    if (!isRecord(value.decisions)) return null;
    const decisions = { ...value.decisions };
    let resetFireSafety = false;
    const fireDecision = decisions["demo-smoke-co"];
    if (isRecord(fireDecision) && (fireDecision.status === "A" || fireDecision.status === "D") &&
        !hasValidFireSafetyAssessment(fireDecision)) {
      decisions["demo-smoke-co"] = { status: "unreviewed" };
      resetFireSafety = true;
    }
    return stampLegacyVersions({
      ...(value as unknown as MoveInReadyInspection),
      schemaVersion: INSPECTION_SCHEMA_VERSION,
      sessionId: expectedSessionId,
      decisions: decisions as EvaluatorDecisionSet,
      signoff: resetFireSafety ? null : value.signoff as EvaluatorSignoff | null,
      participantSignoff: null,
      participantVisualAlarmsRequired: false,
      evaluatorAgencyName: typeof value.evaluatorAgencyName === "string" ? value.evaluatorAgencyName : "",
      landlordDiscussion: value.landlordDiscussion === "yes" || value.landlordDiscussion === "no" ? value.landlordDiscussion : "",
      landlordDiscussionDate: typeof value.landlordDiscussionDate === "string" ? value.landlordDiscussionDate : "",
      leadershipNameAndTitle: typeof value.leadershipNameAndTitle === "string" ? value.leadershipNameAndTitle : "",
      leadershipSignedAt: typeof value.leadershipSignedAt === "string" ? value.leadershipSignedAt : "",
      inspectionNote: typeof value.inspectionNote === "string" ? value.inspectionNote.slice(0, 2000) : "",
    }, PREVIOUS_INSPECTION_SCHEMA_VERSION);
  }
  if (value.schemaVersion === ACKNOWLEDGMENT_INSPECTION_SCHEMA_VERSION) {
    const migrated = migrateAcknowledgmentInspectionRecord(value, expectedSessionId);
    if (!migrated) return null;
    return stampLegacyVersions({
      ...migrated,
      evaluatorAgencyName: "",
      landlordDiscussion: "",
      landlordDiscussionDate: "",
      leadershipNameAndTitle: "",
      leadershipSignedAt: "",
      inspectionNote: typeof value.inspectionNote === "string" ? value.inspectionNote.slice(0, 2000) : "",
      participantSignoff: null,
      participantVisualAlarmsRequired: false,
    }, ACKNOWLEDGMENT_INSPECTION_SCHEMA_VERSION);
  }
  if (value.schemaVersion !== LEGACY_INSPECTION_SCHEMA_VERSION) return null;

  const clipIdentities: Record<string, unknown> = {};
  for (const [roomId, rawIdentity] of Object.entries(value.clipIdentities)) {
    if (!isRecord(rawIdentity) || !Array.isArray(rawIdentity.evidence)) return null;
    clipIdentities[roomId] = {
      ...rawIdentity,
      evidence: rawIdentity.evidence.map((rawEvidence) => {
        if (!isRecord(rawEvidence)) return rawEvidence;
        return { ...rawEvidence, frameIndex: null };
      }),
    };
  }
  return stampLegacyVersions({
    schemaVersion: INSPECTION_SCHEMA_VERSION,
    catalogVersion: "legacy-unversioned",
    sessionId: expectedSessionId,
    createdAt: value.createdAt as string,
    updatedAt: value.updatedAt as string,
    fundingType: normalizeFundingType(value.fundingType),
    pseudonym: value.pseudonym as string,
    evaluatorName: typeof value.evaluatorName === "string" ? value.evaluatorName : "",
    selectedRoomId: value.selectedRoomId as MoveInReadyRoomId,
    completedPromptIdsByRoom: (value.completedPromptIdsByRoom ?? {}) as MoveInReadyInspection["completedPromptIdsByRoom"],
    clipIdentities: clipIdentities as MoveInReadyInspection["clipIdentities"],
    elementClipIdentities: {},
    liveProofs: {},
    proposals: {},
    decisions: createUnreviewedEvaluatorDecisions(),
    pendingAnalysisIntent: null,
    signoff: null,
    participantSignoff: null,
    participantVisualAlarmsRequired: false,
    evaluatorAgencyName: "",
    landlordDiscussion: "",
    landlordDiscussionDate: "",
    leadershipSignoffRequired: value.leadershipSignoffRequired as boolean,
    leadershipNameAndTitle: "",
    leadershipSignoff: value.leadershipSignoff as string,
    leadershipSignedAt: "",
    inspectionNote: typeof value.inspectionNote === "string" ? value.inspectionNote.slice(0, 2000) : "",
  } as MoveInReadyInspection, LEGACY_INSPECTION_SCHEMA_VERSION);
}

/** Preserve old provenance tags so migrations never silently rebind evidence. */
function stampLegacyVersions(
  record: MoveInReadyInspection,
  legacySchemaVersion: number,
): MoveInReadyInspection {
  const rawRecord = record as unknown as Record<string, unknown>;
  const proposals = isRecord(rawRecord.proposals) ? rawRecord.proposals : {};
  const legacyCatalogs = Object.values(proposals).flatMap((proposal) => {
    const identity = isRecord(proposal) && isRecord(proposal.analysisIdentity)
      ? proposal.analysisIdentity
      : null;
    return identity && typeof identity.catalogVersion === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(identity.catalogVersion)
      ? [identity.catalogVersion]
      : [];
  });
  const existingCatalog = typeof rawRecord.catalogVersion === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(rawRecord.catalogVersion)
    ? rawRecord.catalogVersion
    : null;
  const legacyCatalogVersion = existingCatalog ??
    (new Set(legacyCatalogs).size === 1 ? legacyCatalogs[0]! : "legacy-unversioned");
  const clipIdentities: Record<string, unknown> = {};
  for (const [roomId, rawIdentity] of Object.entries(record.clipIdentities)) {
    if (!isRecord(rawIdentity) || !Array.isArray(rawIdentity.evidence)) {
      clipIdentities[roomId] = rawIdentity;
      continue;
    }
    const roomProposal = Object.values(proposals).find((proposal) =>
      isRecord(proposal) && isRecord(proposal.analysisIdentity) &&
      proposal.analysisIdentity.roomId === roomId,
    );
    const roomAnalysis = isRecord(roomProposal) && isRecord(roomProposal.analysisIdentity)
      ? roomProposal.analysisIdentity
      : null;
    const catalogVersion = typeof rawIdentity.catalogVersion === "string"
      ? rawIdentity.catalogVersion
      : roomAnalysis && typeof roomAnalysis.catalogVersion === "string"
        ? roomAnalysis.catalogVersion
        : legacyCatalogVersion;
    const schemaVersion = typeof rawIdentity.schemaVersion === "number"
      ? rawIdentity.schemaVersion
      : legacySchemaVersion;
    clipIdentities[roomId] = {
      ...rawIdentity,
      schemaVersion,
      catalogVersion,
      evidence: rawIdentity.evidence.map((rawEvidence) => isRecord(rawEvidence)
        ? { ...rawEvidence, schemaVersion, catalogVersion }
        : rawEvidence),
    };
  }
  return {
    ...record,
    catalogVersion: legacyCatalogVersion,
    clipIdentities: clipIdentities as MoveInReadyInspection["clipIdentities"],
    elementClipIdentities: (record.elementClipIdentities ?? {}) as MoveInReadyInspection["elementClipIdentities"],
    liveProofs: (record.liveProofs ?? {}) as MoveInReadyInspection["liveProofs"],
  };
}

function isValidOptionalDate(value: string): boolean {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function migrateAcknowledgmentInspectionRecord(
  value: Record<string, unknown>,
  expectedSessionId: string,
): MoveInReadyInspection | null {
  if (!isRecord(value.decisions)) return null;
  const decisions: Record<string, unknown> = { ...value.decisions };
  let resetReview = false;
  for (const [elementId, decision] of Object.entries(decisions)) {
    if (!isRecord(decision) || (decision.status !== "A" && decision.status !== "D")) continue;
    if (!hasCurrentInPersonAcknowledgment(decision, value.evaluatorName) ||
        (elementId === "demo-smoke-co" && !hasValidFireSafetyAssessment(decision))) {
      decisions[elementId] = { status: "unreviewed" };
      resetReview = true;
    }
  }

  return {
    ...(value as unknown as MoveInReadyInspection),
    schemaVersion: INSPECTION_SCHEMA_VERSION,
    sessionId: expectedSessionId,
    decisions: decisions as EvaluatorDecisionSet,
    signoff: resetReview ? null : value.signoff as EvaluatorSignoff | null,
    participantSignoff: null,
    participantVisualAlarmsRequired: false,
  };
}

function hasValidFireSafetyAssessment(decision: Record<string, unknown>): boolean {
  const assessment = decision.fireSafetyAssessment;
  if (!isRecord(assessment) || Object.keys(assessment).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(assessment, "unitDetectors") ||
      !Object.prototype.hasOwnProperty.call(assessment, "publicAreaDetectors")) return false;
  const unit = assessment.unitDetectors;
  const publicArea = assessment.publicAreaDetectors;
  if ((unit !== "A" && unit !== "D") || (publicArea !== "A" && publicArea !== "D")) return false;
  const expectedStatus = unit === "D" || publicArea === "D" ? "D" : "A";
  return decision.status === expectedStatus;
}

function hasCurrentInPersonAcknowledgment(
  decision: Record<string, unknown>,
  recordEvaluatorName: unknown,
): boolean {
  const acknowledgment = decision.inPersonCheckAcknowledgment;
  if (!isRecord(acknowledgment) || Object.keys(acknowledgment).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(acknowledgment, "evaluatorName") ||
      !Object.prototype.hasOwnProperty.call(acknowledgment, "completedAt")) {
    return false;
  }
  const decisionName = decision.evaluatorName;
  const acknowledgedName = acknowledgment.evaluatorName;
  const completedAt = acknowledgment.completedAt;
  const decidedAt = decision.decidedAt;
  if (typeof decisionName !== "string" || decisionName.trim().length === 0 || decisionName.length > 120 ||
      typeof acknowledgedName !== "string" || acknowledgedName.trim().length === 0 || acknowledgedName.length > 120 ||
      typeof recordEvaluatorName !== "string" || recordEvaluatorName.trim().length === 0 || recordEvaluatorName.length > 120 ||
      normalizeEvaluatorIdentity(decisionName) !== normalizeEvaluatorIdentity(acknowledgedName) ||
      normalizeEvaluatorIdentity(decisionName) !== normalizeEvaluatorIdentity(recordEvaluatorName) ||
      !isIsoDateTime(completedAt) || !isIsoDateTime(decidedAt) ||
      Date.parse(completedAt) > Date.parse(decidedAt)) {
    return false;
  }
  return true;
}

function normalizeEvaluatorIdentity(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function validatePendingAnalysisIntent(
  value: unknown,
  clipIdentities: Record<string, unknown>,
  schemaVersion: number,
  catalogVersion: string,
): { ok: true; value: PendingAnalysisIntent | null } | { ok: false; message: string } {
  if (value === null) return { ok: true, value: null };
  if (!isRecord(value) || Object.keys(value).some((key) => ![
    "roomId", "schemaVersion", "videoId", "videoRevision", "videoHash", "catalogVersion", "requestedAt",
  ].includes(key))) {
    return { ok: false, message: "The saved pending analysis intent is invalid." };
  }
  if (!isMoveInReadyRoomId(value.roomId) ||
      typeof value.schemaVersion !== "number" || !Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 1 ||
      typeof value.videoId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.videoId) ||
      typeof value.videoRevision !== "number" || !Number.isSafeInteger(value.videoRevision) || value.videoRevision < 1 ||
      typeof value.videoHash !== "string" || !/^[0-9a-f]{64}$/.test(value.videoHash) ||
      typeof value.catalogVersion !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.catalogVersion) ||
      typeof value.requestedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.requestedAt) ||
      !Number.isFinite(Date.parse(value.requestedAt))) {
    return { ok: false, message: "The saved pending analysis intent has invalid fields." };
  }
  const clip = clipIdentities[value.roomId];
  if (!isRecord(clip) || clip.roomId !== value.roomId || clip.videoId !== value.videoId ||
      clip.videoRevision !== value.videoRevision || clip.videoHash !== value.videoHash ||
      value.schemaVersion !== schemaVersion || value.catalogVersion !== catalogVersion ||
      clip.schemaVersion !== value.schemaVersion || clip.catalogVersion !== value.catalogVersion) {
    return { ok: false, message: "The saved pending analysis intent does not match the current room clip." };
  }
  return {
    ok: true,
    value: {
      roomId: value.roomId,
      schemaVersion: value.schemaVersion,
      videoId: value.videoId,
      videoRevision: value.videoRevision,
      videoHash: value.videoHash,
      catalogVersion: value.catalogVersion,
      requestedAt: value.requestedAt,
    },
  };
}

function isAnalysisIdentityCurrentInStoredRecord(
  identity: VideoAnalysisIdentity,
  sessionId: string,
  clipIdentities: Record<string, unknown>,
  schemaVersion: number,
  catalogVersion: string,
  elementClipIdentities: Record<string, unknown> = {},
): boolean {
  const parsed = validateVideoAnalysisIdentity(identity);
  if (!parsed.ok || parsed.value.sessionId !== sessionId ||
      parsed.value.schemaVersion !== schemaVersion || parsed.value.catalogVersion !== catalogVersion) return false;
  const roomClip = clipIdentities[parsed.value.roomId];
  const clip = isRecord(roomClip) && roomClip.videoId === parsed.value.videoId
    ? roomClip
    : Object.values(elementClipIdentities).find((candidate) =>
        isRecord(candidate) && candidate.roomId === parsed.value.roomId && candidate.videoId === parsed.value.videoId);
  return isRecord(clip) &&
    clip.roomId === parsed.value.roomId &&
    clip.schemaVersion === parsed.value.schemaVersion &&
    clip.catalogVersion === parsed.value.catalogVersion &&
    clip.videoId === parsed.value.videoId &&
    clip.videoRevision === parsed.value.videoRevision &&
    clip.videoHash === parsed.value.expectedSourceHash;
}

function sameAnalysisIdentity(left: VideoAnalysisIdentity, right: VideoAnalysisIdentity): boolean {
  return left.sessionId === right.sessionId &&
    left.roomId === right.roomId &&
    left.schemaVersion === right.schemaVersion &&
    left.videoId === right.videoId &&
    left.videoRevision === right.videoRevision &&
    left.expectedSourceHash === right.expectedSourceHash &&
    left.analysisId === right.analysisId &&
    left.attempt === right.attempt &&
    left.catalogVersion === right.catalogVersion;
}

/**
 * Resolve the stored clip identity a still evidence reference belongs to:
 * the room clip when its videoId matches, otherwise the v2 element clip
 * with the same filming room + videoId. Returns undefined when neither
 * matches, which callers treat as stale evidence.
 */
export function identityForEvidenceReference(
  record: Pick<MoveInReadyInspection, "clipIdentities" | "elementClipIdentities">,
  reference: EvidenceReference,
): StoredRoomClipIdentity | undefined {
  const roomIdentity = record.clipIdentities[reference.roomId];
  if (roomIdentity && roomIdentity.videoId === reference.videoId) return roomIdentity;
  return Object.values(record.elementClipIdentities ?? {}).find((candidate) =>
    candidate !== undefined && candidate.roomId === reference.roomId && candidate.videoId === reference.videoId);
}

function isEvidenceCurrentInStoredRecord(
  evidence: EvidenceReference,
  clipIdentities: Record<string, unknown>,
  schemaVersion: number,
  catalogVersion: string,
  elementClipIdentities: Record<string, unknown> = {},
): boolean {
  const roomIdentity = clipIdentities[evidence.roomId];
  const identity = isRecord(roomIdentity) && roomIdentity.videoId === evidence.videoId
    ? roomIdentity
    : Object.values(elementClipIdentities).find((candidate) =>
        isRecord(candidate) && candidate.roomId === evidence.roomId && candidate.videoId === evidence.videoId);
  if (!isRecord(identity) || !Array.isArray(identity.evidence) ||
      identity.videoRevision !== evidence.videoRevision || identity.schemaVersion !== schemaVersion ||
      identity.catalogVersion !== catalogVersion || evidence.schemaVersion !== schemaVersion ||
      evidence.catalogVersion !== catalogVersion) return false;
  return identity.evidence.some((candidate) => {
    const parsed = validateEvidenceReference(candidate);
    if (!parsed.ok || evidenceReferenceBaseKey(parsed.value) !== evidenceReferenceBaseKey(evidence)) return false;
    return parsed.value.frameIndex === null || parsed.value.frameIndex === evidence.frameIndex;
  });
}

function evidenceReferenceKey(evidence: EvidenceReference): string {
  return `${evidenceReferenceBaseKey(evidence)}\u0000${evidence.frameIndex === null ? "local" : evidence.frameIndex}`;
}

function evidenceReferenceBaseKey(evidence: EvidenceReference): string {
  return `${evidence.schemaVersion}\u0000${evidence.catalogVersion}\u0000${evidence.videoId}\u0000${evidence.videoRevision}\u0000${evidence.roomId}\u0000${evidence.stillId}\u0000${evidence.timestampMs}\u0000${evidence.stillHash}`;
}

function normalizeStorageError(error: unknown): InspectionStoreError {
  if (error instanceof InspectionStoreError) return error;
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "SecurityError" || name === "InvalidStateError" || name === "NotSupportedError") {
    return new InspectionStoreError(
      "UNAVAILABLE",
      "This browser does not allow local inspection storage. The inspection is available only in this page's memory.",
    );
  }
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return new InspectionStoreError(
      "QUOTA_EXCEEDED",
      "Local storage is full. This walkthrough is now memory only, so reloading will lose unsaved changes. Export a copy before leaving.",
    );
  }
  if (name === "VersionError" || name === "DataError") {
    return new InspectionStoreError("SCHEMA_MISMATCH", "Saved inspection data cannot be read by this app version.");
  }
  return new InspectionStoreError("IO", "The local inspection could not be saved. Keep this page open and retry.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
