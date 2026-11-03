/**
 * Guided detector-test shot (REQ-R3): pure helpers. In rooms contributing to
 * Fire Safety (bedroom, living-room, hallway), after the detector presence
 * check the tour prompts the evaluator to press the detector's test button
 * and capture a still from the live camera preview. The still is evidence
 * only — the human still answers the chirp yes/no check, and "Skip still"
 * records no claim.
 */
import { parseRoomId, type EvidenceReference, type MoveInReadyRoomId } from "../../domain/move-in-ready";

/** Exact tour prompt (REQ-R3) plus its Spanish-tour variant (REQ-R2). */
export const DETECTOR_TEST_PROMPT = "Press the detector's test button now";
export const DETECTOR_TEST_PROMPT_ES = "Presione ahora el botón de prueba del detector";

/** Still-id prefix marking live detector-test captures (not clip frames). */
export const DETECTOR_TEST_STILL_PREFIX = "detector-test-";

/** Room types whose detector question gets the test-button prompt. */
const DETECTOR_TEST_ROOM_TYPES = new Set(["bedroom", "living-room", "hallway"]);

/** True for bedroom/living-room/hallway rooms, including counted rooms. */
export function isDetectorTestRoom(roomId: MoveInReadyRoomId): boolean {
  const parsed = parseRoomId(roomId);
  return parsed !== null && DETECTOR_TEST_ROOM_TYPES.has(parsed.type);
}

/**
 * True for the detector presence question in either tour language. Matched
 * by text (not index) so inserted questions never misroute the prompt.
 */
export function isDetectorPresenceQuestion(question: string): boolean {
  const text = question.toLowerCase();
  return text.includes("smoke detector") || text.includes("detector de humo");
}

/**
 * First free millisecond slot for a live-capture still within the clip
 * timeline. Stored stills resolve by (timestampMs, sha256), so the capture
 * must not collide with an existing still's millisecond.
 */
export function firstFreeEvidenceTimestampMs(
  usedTimestampMs: readonly number[],
  durationSeconds: number,
): number | null {
  const used = new Set(usedTimestampMs);
  const durationMs = Math.floor(durationSeconds * 1000);
  for (let ms = 0; ms < durationMs; ms += 1) {
    if (!used.has(ms)) return ms;
  }
  return null;
}

export interface DetectorTestIdentity {
  schemaVersion: number;
  catalogVersion: string;
  videoId: string;
  videoRevision: number;
  roomId: MoveInReadyRoomId;
}

/**
 * Evidence reference for a live detector-test capture. frameIndex is null
 * (a locally captured still, never a SAM moment); the timestamp is a
 * storage slot inside the clip's still timeline, not a video moment.
 */
export function buildDetectorTestReference(
  identity: DetectorTestIdentity,
  timestampMs: number,
  stillHash: string,
): EvidenceReference {
  return {
    schemaVersion: identity.schemaVersion,
    catalogVersion: identity.catalogVersion,
    videoId: identity.videoId,
    videoRevision: identity.videoRevision,
    roomId: identity.roomId,
    stillId: `${DETECTOR_TEST_STILL_PREFIX}${identity.videoId}-${timestampMs}-${stillHash.slice(0, 8)}`,
    timestampMs,
    frameIndex: null,
    stillHash,
  };
}
