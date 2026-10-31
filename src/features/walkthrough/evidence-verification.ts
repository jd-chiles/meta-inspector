import type { EvidenceReference, ProposalState } from "../../domain/move-in-ready";
import { sha256Blob, type VideoStill } from "./video-utils";

const MAX_SERVER_STILL_BYTES = 512 * 1024;
const MAX_SERVER_STILL_DIMENSION = 1280;
const MAX_SERVER_STILL_PIXELS = 1_000_000;

export interface CandidateEvidenceIdentity {
  candidateId: string;
  elementId: string;
  concept: string;
  evidence: {
    frameIndex: number;
    timestampMs: number;
    objectOrdinal: number;
    box: { left: number; top: number; right: number; bottom: number };
    samConfidence?: number;
  };
}

export interface VerifiedMappedEvidence {
  reference: EvidenceReference;
  still: VideoStill;
}

export function resolveMappedProposalState(
  proposedState: ProposalState,
  evidenceCount: number,
  evidenceIntegrityValid: boolean,
): ProposalState {
  return proposedState === "draft-proposal" && evidenceCount > 0 && evidenceIntegrityValid
    ? "draft-proposal"
    : "needs-human-check";
}

/** Normalized live video responses are MP4-only and must echo the uploaded hash. */
export function isExpectedMp4Media(
  value: unknown,
  expectedSha256: string,
): value is { container: "mp4"; sourceVideoSha256: string } {
  return isRecord(value) && exactKeys(value, ["container", "sourceVideoSha256"]) &&
    value.container === "mp4" && value.sourceVideoSha256 === expectedSha256;
}

/**
 * Accept a mapped still only when both its frame identity and its exact JPEG
 * bytes match the original server candidate sent to Muse.
 */
export async function verifyMappedServerEvidence(
  value: unknown,
  candidate: CandidateEvidenceIdentity,
  identity: Pick<EvidenceReference, "schemaVersion" | "catalogVersion" | "videoId" | "videoRevision" | "roomId">,
): Promise<VerifiedMappedEvidence | null> {
  try {
    if (!isRecord(value) || !exactKeys(value, ["candidateId", "elementId", "concept", "evidence", "still"]) ||
        value.candidateId !== candidate.candidateId || value.elementId !== candidate.elementId || value.concept !== candidate.concept ||
        !sameFrameIdentity(value.evidence, candidate.evidence)) return null;

    const still = value.still;
    if (!isRecord(still) || !exactKeys(still, ["sha256", "mimeType", "width", "height", "base64"]) ||
        still.mimeType !== "image/jpeg" || typeof still.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(still.sha256) ||
        typeof still.width !== "number" || !Number.isSafeInteger(still.width) || still.width <= 0 ||
        still.width > MAX_SERVER_STILL_DIMENSION || typeof still.height !== "number" || !Number.isSafeInteger(still.height) ||
        still.height <= 0 || still.height > MAX_SERVER_STILL_DIMENSION || still.width * still.height > MAX_SERVER_STILL_PIXELS ||
        typeof still.base64 !== "string" || still.base64.length === 0 || still.base64.length > Math.ceil(MAX_SERVER_STILL_BYTES / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(still.base64)) return null;

    const binary = atob(still.base64);
    if (binary.length === 0 || binary.length > MAX_SERVER_STILL_BYTES || btoa(binary) !== still.base64) return null;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const dimensions = jpegDimensions(bytes);
    if (!dimensions || dimensions.width !== still.width || dimensions.height !== still.height) return null;
    const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: "image/jpeg" });
    if (await sha256Blob(blob) !== still.sha256) return null;

    const timestampMs = candidate.evidence.timestampMs;
    const reference: EvidenceReference = {
      ...identity,
      stillId: `s-${identity.videoId}-${timestampMs}-${still.sha256.slice(0, 8)}`,
      timestampMs,
      frameIndex: candidate.evidence.frameIndex,
      stillHash: still.sha256,
    };
    return {
      reference,
      still: { timestampSeconds: timestampMs / 1000, blob, width: dimensions.width, height: dimensions.height },
    };
  } catch {
    return null;
  }
}

/** Resolve a local still only when its timestamp and exact bytes match evidence provenance. */
export async function findVerifiedEvidenceStill(
  stills: readonly VideoStill[],
  reference: EvidenceReference,
): Promise<VideoStill | null> {
  const still = stills.find((item) => Math.round(item.timestampSeconds * 1000) === reference.timestampMs);
  if (!still) return null;
  try {
    return await sha256Blob(still.blob) === reference.stillHash ? still : null;
  } catch {
    return null;
  }
}

function sameFrameIdentity(value: unknown, expected: CandidateEvidenceIdentity["evidence"]): boolean {
  if (!isRecord(value)) return false;
  const expectedKeys = ["frameIndex", "timestampMs", "objectOrdinal", "box"];
  if (expected.samConfidence !== undefined) expectedKeys.push("samConfidence");
  if (!exactKeys(value, expectedKeys) || value.frameIndex !== expected.frameIndex ||
      value.timestampMs !== expected.timestampMs || value.objectOrdinal !== expected.objectOrdinal ||
      (expected.samConfidence !== undefined && value.samConfidence !== expected.samConfidence) || !isRecord(value.box)) return false;
  return exactKeys(value.box, ["left", "top", "right", "bottom"]) &&
    value.box.left === expected.box.left && value.box.top === expected.box.top &&
    value.box.right === expected.box.right && value.box.bottom === expected.box.bottom;
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  let cursor = 2;
  while (cursor + 4 <= bytes.length) {
    if (bytes[cursor] !== 0xff) return null;
    while (bytes[cursor] === 0xff) cursor += 1;
    const marker = bytes[cursor]!;
    cursor += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (cursor + 2 > bytes.length) return null;
    const segmentLength = (bytes[cursor]! << 8) | bytes[cursor + 1]!;
    if (segmentLength < 2 || cursor + segmentLength > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (segmentLength < 7) return null;
      return {
        height: (bytes[cursor + 3]! << 8) | bytes[cursor + 4]!,
        width: (bytes[cursor + 5]! << 8) | bytes[cursor + 6]!,
      };
    }
    cursor += segmentLength;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).length === allowed.size && Object.keys(value).every((key) => allowed.has(key));
}
