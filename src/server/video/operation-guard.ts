import { createHash, timingSafeEqual } from "node:crypto";
import { VideoSegmentError } from "./errors";

const SESSION_DEDUPE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_TRACKED_SESSIONS = 5_000;
const MAX_ATTEMPTS_PER_SESSION = 64;
const MAX_CONCURRENT_VIDEO_OPERATIONS = 2;
const MAX_PENDING_MAPPING_STILLS_BYTES = 64 * 1024 * 1024;
const MAX_SINGLE_MAPPING_STILLS_BYTES = 16 * 1024 * 1024;

export interface PendingMappingStill {
  candidateId?: string;
  frameIndex: number;
  timestampMs: number;
  bytes: Uint8Array;
}

export interface PendingMappingStills {
  candidates: PendingMappingStill[];
  samples: PendingMappingStill[];
  byteLength: number;
}

export interface VideoOperationIdentity {
  sessionId: string;
  schemaVersion: number;
  videoId: string;
  videoRevision: number;
  analysisId: string;
  attempt: number;
  catalogVersion: string;
  expectedVideoSha256: string;
}

type OperationPhase = "segmenting" | "awaiting-map" | "mapping";

interface ActiveOperation {
  key: string;
  phase: OperationPhase;
  candidateTokenDigest?: string;
  mappingExpiresAt?: number;
  pendingStills?: PendingMappingStills;
  pendingStillsBytes?: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

interface SessionOperations {
  expiresAt: number;
  seenAnalysisAttempts: Set<string>;
  active?: ActiveOperation;
}

export interface VideoOperationLease {
  pendingStills?: PendingMappingStills;
  awaitingMap(candidateToken: string, expiresAt: number, pendingStills?: PendingMappingStills): void;
  complete(): void;
}

const operationsBySession = new Map<string, SessionOperations>();
let pendingMappingStillsBytes = 0;
let activeVideoOperations = 0;

export interface VideoProcessingLease {
  release(): void;
}

/**
 * Admit at most two process-wide segment or map requests at a time. Call this
 * before reading multipart bodies so concurrent clients cannot retain an
 * unbounded number of large uploads while the provider is busy.
 */
export function claimVideoProcessing(): VideoProcessingLease {
  if (activeVideoOperations >= MAX_CONCURRENT_VIDEO_OPERATIONS) {
    throw new VideoSegmentError(429, "PROCESSING_BUSY", "Video processing is busy. Wait briefly and try again.");
  }
  activeVideoOperations += 1;
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      activeVideoOperations = Math.max(0, activeVideoOperations - 1);
    },
  };
}

function clearActive(session: SessionOperations): void {
  if (session.active?.expiryTimer) clearTimeout(session.active.expiryTimer);
  if (session.active?.pendingStillsBytes) {
    pendingMappingStillsBytes = Math.max(0, pendingMappingStillsBytes - session.active.pendingStillsBytes);
  }
  session.active = undefined;
}

function attemptKey(identity: VideoOperationIdentity): string {
  return createHash("sha256")
    .update(JSON.stringify([identity.analysisId, identity.attempt]))
    .digest("hex");
}

/** Stable key for the complete source-video and analysis identity. */
function operationKey(identity: VideoOperationIdentity): string {
  return createHash("sha256")
    .update(JSON.stringify([
      identity.sessionId,
      identity.schemaVersion,
      identity.videoId,
      identity.videoRevision,
      identity.analysisId,
      identity.attempt,
      identity.catalogVersion,
      identity.expectedVideoSha256,
    ]))
    .digest("hex");
}

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function digestMatches(left: string | undefined, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function busy(): VideoSegmentError {
  return new VideoSegmentError(409, "OPERATION_BUSY", "Another video operation is active for this walkthrough. Try again shortly.");
}

function stale(): VideoSegmentError {
  return new VideoSegmentError(409, "STALE_REQUEST", "This video request is no longer current. Start a new analysis attempt.");
}

function sweepExpired(now: number): void {
  for (const [sessionId, session] of operationsBySession) {
    if (session.active?.phase === "awaiting-map" && (session.active.mappingExpiresAt ?? 0) <= now) {
      clearActive(session);
    }
    if (session.expiresAt <= now && !session.active) {
      operationsBySession.delete(sessionId);
    }
  }
}

function getOrCreateSession(sessionId: string, now: number): SessionOperations {
  sweepExpired(now);
  const existing = operationsBySession.get(sessionId);
  if (existing) return existing;
  if (operationsBySession.size >= MAX_TRACKED_SESSIONS) throw busy();
  const created: SessionOperations = {
    expiresAt: now + SESSION_DEDUPE_TTL_MS,
    seenAnalysisAttempts: new Set(),
  };
  operationsBySession.set(sessionId, created);
  return created;
}

function makeLease(sessionId: string, key: string, pendingStills?: PendingMappingStills): VideoOperationLease {
  return {
    ...(pendingStills ? { pendingStills } : {}),
    awaitingMap(candidateToken, expiresAt, nextPendingStills) {
      const session = operationsBySession.get(sessionId);
      if (session?.active?.key !== key || session.active.phase !== "segmenting") return;
      if (nextPendingStills) {
        const measuredBytes = [...nextPendingStills.candidates, ...nextPendingStills.samples]
          .reduce((total, still) => total + still.bytes.byteLength, 0);
        if (
          !Number.isSafeInteger(nextPendingStills.byteLength) ||
          nextPendingStills.byteLength !== measuredBytes ||
          measuredBytes <= 0 || measuredBytes > MAX_SINGLE_MAPPING_STILLS_BYTES ||
          pendingMappingStillsBytes + measuredBytes > MAX_PENDING_MAPPING_STILLS_BYTES
        ) {
          throw new VideoSegmentError(429, "OPERATION_BUSY", "The server has reached its temporary video evidence capacity. Try again shortly.");
        }
        pendingMappingStillsBytes += measuredBytes;
      }
      const active: ActiveOperation = {
        key,
        phase: "awaiting-map",
        candidateTokenDigest: tokenDigest(candidateToken),
        mappingExpiresAt: expiresAt,
        ...(nextPendingStills ? { pendingStills: nextPendingStills, pendingStillsBytes: nextPendingStills.byteLength } : {}),
      };
      active.expiryTimer = setTimeout(() => {
        const current = operationsBySession.get(sessionId);
        if (current?.active?.key === key && current.active.phase === "awaiting-map" && (current.active.mappingExpiresAt ?? 0) <= Date.now()) {
          clearActive(current);
        }
      }, Math.max(0, expiresAt - Date.now()));
      active.expiryTimer.unref?.();
      session.active = active;
    },
    complete() {
      const session = operationsBySession.get(sessionId);
      if (session?.active?.key === key) clearActive(session);
    },
  };
}

/** Claim the session before the first paid SAM call and retain the attempt for replay protection. */
export function claimVideoSegmentation(identity: VideoOperationIdentity): VideoOperationLease {
  const now = Date.now();
  const session = getOrCreateSession(identity.sessionId, now);
  const key = operationKey(identity);
  const attempt = attemptKey(identity);
  if (session.active) throw busy();
  if (session.seenAnalysisAttempts.has(attempt)) throw stale();
  if (session.seenAnalysisAttempts.size >= MAX_ATTEMPTS_PER_SESSION) throw busy();

  session.seenAnalysisAttempts.add(attempt);
  session.expiresAt = now + SESSION_DEDUPE_TTL_MS;
  session.active = { key, phase: "segmenting" };
  return makeLease(identity.sessionId, key);
}

/** Claim the awaiting SAM result before the Muse call; replayed maps never trigger another paid request. */
export function claimVideoMapping(
  identity: VideoOperationIdentity,
  candidateToken: string,
): VideoOperationLease {
  const now = Date.now();
  sweepExpired(now);
  const session = operationsBySession.get(identity.sessionId);
  if (!session?.active) throw stale();

  const active = session.active;
  if (active.key !== operationKey(identity) || active.phase === "segmenting" ||
      !digestMatches(active.candidateTokenDigest, tokenDigest(candidateToken))) {
    throw stale();
  }
  if (active.phase === "mapping") throw busy();

  active.phase = "mapping";
  session.expiresAt = now + SESSION_DEDUPE_TTL_MS;
  return makeLease(identity.sessionId, active.key, active.pendingStills);
}

/**
 * Release an abandoned SAM result only while it is awaiting Muse mapping.
 * The complete identity and the exact signed candidate token bind the release
 * to the lease returned by segmentation. The attempt remains consumed so the
 * original segmentation cannot be replayed for another paid request.
 */
export function releaseAwaitingVideoMapping(
  identity: VideoOperationIdentity,
  candidateToken: string,
): boolean {
  const now = Date.now();
  sweepExpired(now);
  const session = operationsBySession.get(identity.sessionId);
  const active = session?.active;
  if (
    !session || !active || active.phase !== "awaiting-map" ||
    active.key !== operationKey(identity) ||
    !digestMatches(active.candidateTokenDigest, tokenDigest(candidateToken))
  ) {
    return false;
  }

  clearActive(session);
  return true;
}

/** Release a pending map lease when the client never received its response token. */
export function releaseAwaitingVideoMappingByIdentity(identity: VideoOperationIdentity): boolean {
  const now = Date.now();
  sweepExpired(now);
  const session = operationsBySession.get(identity.sessionId);
  const active = session?.active;
  if (!session || !active || active.phase !== "awaiting-map" || active.key !== operationKey(identity)) {
    return false;
  }

  clearActive(session);
  return true;
}
