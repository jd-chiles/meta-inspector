import { createHash, timingSafeEqual } from "node:crypto";
import { VideoSegmentError } from "./errors";

const SESSION_DEDUPE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_TRACKED_SESSIONS = 5_000;
const MAX_ATTEMPTS_PER_SESSION = 64;
// A walkthrough analyses four rooms as one batch. A cap of two turned a
// normal batch into two provider calls plus two 429s, which the UI reported
// as "needs attention" on every room.
const MAX_CONCURRENT_VIDEO_OPERATIONS = 4;
const MAX_CONCURRENT_STILLS_OPERATIONS = 4;
/**
 * Concurrent operations per walkthrough session (Sprint 0 REQ-S2). Two
 * rooms analyze at once; the full request identity (session, video,
 * analysis, attempt, versions, hash) is the isolation key, so rooms of
 * one session can never share a lease, token, or retained stills.
 */
// One walkthrough analyses its four rooms together and shares a session id.
// A cap of two admitted half the batch and rejected the rest as busy.
const MAX_ACTIVE_OPERATIONS_PER_SESSION = 4;
const MAX_PENDING_MAPPING_STILLS_BYTES = 64 * 1024 * 1024;
const MAX_SINGLE_MAPPING_STILLS_BYTES = 16 * 1024 * 1024;

export interface PendingMappingStill {
  candidateId?: string;
  frameIndex: number;
  timestampMs: number;
  bytes: Uint8Array;
  width?: number;
  height?: number;
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
  /** Active operations keyed by full request-identity digest. */
  active: Map<string, ActiveOperation>;
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
  return claimWithCap(MAX_CONCURRENT_VIDEO_OPERATIONS);
}

/**
 * Stills requests carry a few JPEG frames instead of a full clip, so the
 * shared counter admits more of them at once. The cap still bounds total
 * concurrent provider work when legacy and stills requests mix.
 */
export function claimStillsProcessing(): VideoProcessingLease {
  return claimWithCap(MAX_CONCURRENT_STILLS_OPERATIONS);
}

function claimWithCap(cap: number): VideoProcessingLease {
  if (activeVideoOperations >= cap) {
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

function clearOperation(session: SessionOperations, key: string): void {
  const active = session.active.get(key);
  if (!active) return;
  if (active.expiryTimer) clearTimeout(active.expiryTimer);
  if (active.pendingStillsBytes) {
    pendingMappingStillsBytes = Math.max(0, pendingMappingStillsBytes - active.pendingStillsBytes);
  }
  session.active.delete(key);
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
    for (const [key, active] of session.active) {
      if (active.phase === "awaiting-map" && (active.mappingExpiresAt ?? 0) <= now) {
        clearOperation(session, key);
      }
    }
    if (session.expiresAt <= now && session.active.size === 0) {
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
    active: new Map(),
  };
  operationsBySession.set(sessionId, created);
  return created;
}

function makeLease(sessionId: string, key: string, pendingStills?: PendingMappingStills): VideoOperationLease {
  return {
    ...(pendingStills ? { pendingStills } : {}),
    awaitingMap(candidateToken, expiresAt, nextPendingStills) {
      const session = operationsBySession.get(sessionId);
      if (!session) return;
      const segmenting = session.active.get(key);
      if (!segmenting || segmenting.phase !== "segmenting") return;
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
        const currentOp = current?.active.get(key);
        if (current && currentOp?.phase === "awaiting-map" && (currentOp.mappingExpiresAt ?? 0) <= Date.now()) {
          clearOperation(current, key);
        }
      }, Math.max(0, expiresAt - Date.now()));
      active.expiryTimer.unref?.();
      session.active.set(key, active);
    },
    complete() {
      const session = operationsBySession.get(sessionId);
      if (session) clearOperation(session, key);
    },
  };
}

/** Claim the request identity before the first paid SAM call and retain the attempt for replay protection. */
export function claimVideoSegmentation(identity: VideoOperationIdentity): VideoOperationLease {
  const now = Date.now();
  const session = getOrCreateSession(identity.sessionId, now);
  const key = operationKey(identity);
  const attempt = attemptKey(identity);
  if (session.active.has(key)) throw busy();
  if (session.active.size >= MAX_ACTIVE_OPERATIONS_PER_SESSION) throw busy();
  if (session.seenAnalysisAttempts.has(attempt)) throw stale();
  if (session.seenAnalysisAttempts.size >= MAX_ATTEMPTS_PER_SESSION) throw busy();

  session.seenAnalysisAttempts.add(attempt);
  session.expiresAt = now + SESSION_DEDUPE_TTL_MS;
  session.active.set(key, { key, phase: "segmenting" });
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
  const active = session?.active.get(operationKey(identity));
  if (!session || !active) throw stale();

  if (active.phase === "segmenting" ||
      !digestMatches(active.candidateTokenDigest, tokenDigest(candidateToken))) {
    throw stale();
  }
  if (active.phase === "mapping") throw busy();

  active.phase = "mapping";
  session.expiresAt = now + SESSION_DEDUPE_TTL_MS;
  return makeLease(identity.sessionId, active.key, active.pendingStills);
}

/** Rebuild a one-time map lease after a durable worker is restarted between SAM and Muse. */
export function restoreAwaitingVideoMapping(
  identity: VideoOperationIdentity,
  candidateToken: string,
  expiresAt: number,
  pendingStills: PendingMappingStills,
): void {
  const now = Date.now();
  const session = getOrCreateSession(identity.sessionId, now);
  if (expiresAt <= now || expiresAt > now + 15 * 60 * 1000 + 5_000) throw stale();
  const key = operationKey(identity);
  const existing = session.active.get(key);
  if (existing) {
    if (existing.phase === "awaiting-map") {
      if (digestMatches(existing.candidateTokenDigest, tokenDigest(candidateToken))) return;
      // A durable worker may need to renew its private signed token after a
      // restart. Replace only the same identity's unused mapping lease.
      clearOperation(session, key);
    } else {
      throw busy();
    }
  }
  if (session.active.size >= MAX_ACTIVE_OPERATIONS_PER_SESSION) throw busy();
  const attempt = attemptKey(identity);
  if (!session.seenAnalysisAttempts.has(attempt)) {
    if (session.seenAnalysisAttempts.size >= MAX_ATTEMPTS_PER_SESSION) throw busy();
    session.seenAnalysisAttempts.add(attempt);
  }
  session.expiresAt = now + SESSION_DEDUPE_TTL_MS;
  session.active.set(key, { key, phase: "segmenting" });
  const lease = makeLease(identity.sessionId, key);
  lease.awaitingMap(candidateToken, expiresAt, pendingStills);
  if (operationsBySession.get(identity.sessionId)?.active.get(key)?.phase !== "awaiting-map") throw stale();
}

/** Allow pg-boss to safely retry only when no SAM request was started. */
export function releaseSafeVideoSegmentationAttempt(identity: VideoOperationIdentity): void {
  const session = operationsBySession.get(identity.sessionId);
  if (!session) return;
  session.seenAnalysisAttempts.delete(attemptKey(identity));
  if (session.active.size === 0) session.expiresAt = Math.min(session.expiresAt, Date.now() + SESSION_DEDUPE_TTL_MS);
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
  const key = operationKey(identity);
  const active = session?.active.get(key);
  if (
    !session || !active || active.phase !== "awaiting-map" ||
    !digestMatches(active.candidateTokenDigest, tokenDigest(candidateToken))
  ) {
    return false;
  }

  clearOperation(session, key);
  return true;
}

/** Release a pending map lease when the client never received its response token. */
export function releaseAwaitingVideoMappingByIdentity(identity: VideoOperationIdentity): boolean {
  const now = Date.now();
  sweepExpired(now);
  const session = operationsBySession.get(identity.sessionId);
  const key = operationKey(identity);
  const active = session?.active.get(key);
  if (!session || !active || active.phase !== "awaiting-map") {
    return false;
  }

  clearOperation(session, key);
  return true;
}
