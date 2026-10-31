import { describe, expect, it } from "vitest";

import { MOVE_IN_READY_SCHEMA_VERSION, type EvidenceReference } from "../../../src/domain/move-in-ready";
import {
  findVerifiedEvidenceStill,
  isExpectedMp4Media,
  resolveMappedProposalState,
  verifyMappedServerEvidence,
  type CandidateEvidenceIdentity,
} from "../../../src/features/walkthrough/evidence-verification";
import { sha256Blob, type VideoStill } from "../../../src/features/walkthrough/video-utils";

const SERVER_JPEG = new Uint8Array(Buffer.from(
  "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzU5LjM3LjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z",
  "base64",
));

const CANDIDATE: CandidateEvidenceIdentity = {
  candidateId: "cand-0001",
  elementId: "demo-water-supply",
  concept: "water faucet",
  evidence: {
    frameIndex: 7,
    timestampMs: 700,
    objectOrdinal: 0,
    box: { left: 1, top: 2, right: 8, bottom: 9 },
    samConfidence: 0.83,
  },
};

async function mappedEvidence(candidate = CANDIDATE): Promise<Record<string, unknown>> {
  const blob = new Blob([SERVER_JPEG.buffer.slice(SERVER_JPEG.byteOffset, SERVER_JPEG.byteOffset + SERVER_JPEG.byteLength) as ArrayBuffer]);
  return {
    candidateId: candidate.candidateId,
    elementId: candidate.elementId,
    concept: candidate.concept,
    evidence: structuredClone(candidate.evidence),
    still: {
      sha256: await sha256Blob(blob),
      mimeType: "image/jpeg",
      width: 8,
      height: 8,
      base64: Buffer.from(SERVER_JPEG).toString("base64"),
    },
  };
}

describe("findVerifiedEvidenceStill", () => {
  it("returns a still only when its exact bytes match the evidence hash and timestamp", async () => {
    const blob = new Blob(["source frame"]);
    const still: VideoStill = { timestampSeconds: 1, blob, width: 16, height: 9 };
    const reference: EvidenceReference = {
      schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
      catalogVersion: "0.3.0-demo.3",
      videoId: "video-current",
      videoRevision: 1,
      roomId: "kitchen",
      stillId: "still-current",
      timestampMs: 1_000,
      frameIndex: 30,
      stillHash: await sha256Blob(blob),
    };

    await expect(findVerifiedEvidenceStill([still], reference)).resolves.toBe(still);
    await expect(findVerifiedEvidenceStill([{ ...still, blob: new Blob(["changed frame"]) }], reference)).resolves.toBeNull();
    await expect(findVerifiedEvidenceStill([{ ...still, timestampSeconds: 2 }], reference)).resolves.toBeNull();
  });
});

describe("verifyMappedServerEvidence", () => {
  const identity = {
    schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
    catalogVersion: "0.3.0-demo.3",
    videoId: "video-current",
    videoRevision: 4,
    roomId: "kitchen" as const,
  };

  it("returns the exact bounded server JPEG only for the matching candidate frame and hash", async () => {
    const payload = await mappedEvidence();
    const verified = await verifyMappedServerEvidence(payload, CANDIDATE, identity);

    expect(verified).not.toBeNull();
    expect(verified?.reference).toMatchObject({
      videoId: identity.videoId,
      videoRevision: identity.videoRevision,
      roomId: identity.roomId,
      timestampMs: CANDIDATE.evidence.timestampMs,
      frameIndex: CANDIDATE.evidence.frameIndex,
    });
    expect(Buffer.from(await verified!.still.blob.arrayBuffer())).toEqual(Buffer.from(SERVER_JPEG));
    expect(await sha256Blob(verified!.still.blob)).toBe(verified!.reference.stillHash);
  });

  it("rejects candidate-frame identity and JPEG hash mismatches and requires a human check", async () => {
    const valid = await mappedEvidence();
    const changedFrame = {
      ...valid,
      evidence: { ...CANDIDATE.evidence, frameIndex: CANDIDATE.evidence.frameIndex + 1 },
    };
    const changedHash = {
      ...valid,
      still: { ...(valid.still as Record<string, unknown>), sha256: "0".repeat(64) },
    };

    await expect(verifyMappedServerEvidence(changedFrame, CANDIDATE, identity)).resolves.toBeNull();
    await expect(verifyMappedServerEvidence(changedHash, CANDIDATE, identity)).resolves.toBeNull();
    expect(resolveMappedProposalState("draft-proposal", 0, false)).toBe("needs-human-check");
    expect(resolveMappedProposalState("draft-proposal", 1, false)).toBe("needs-human-check");
    expect(resolveMappedProposalState("draft-proposal", 1, true)).toBe("draft-proposal");
  });

  it("accepts only hash-matched normalized MP4 response media", () => {
    const sourceHash = "a".repeat(64);
    expect(isExpectedMp4Media({ container: "mp4", sourceVideoSha256: sourceHash }, sourceHash)).toBe(true);
    expect(isExpectedMp4Media({ container: "mov", sourceVideoSha256: sourceHash }, sourceHash)).toBe(false);
    expect(isExpectedMp4Media({ container: "mp4", sourceVideoSha256: "b".repeat(64) }, sourceHash)).toBe(false);
  });
});
