import { describe, expect, it } from "vitest";

import {
  claimVideoProcessing,
  claimVideoMapping,
  claimVideoSegmentation,
  releaseAwaitingVideoMapping,
  releaseAwaitingVideoMappingByIdentity,
  type VideoOperationIdentity,
  type PendingMappingStills,
} from "../../../../src/server/video/operation-guard";
import { VideoSegmentError } from "../../../../src/server/video/errors";

let identityNumber = 0;

function identity(): VideoOperationIdentity {
  identityNumber += 1;
  const suffix = String(identityNumber).padStart(4, "0");
  return {
    sessionId: `session-${suffix}`,
    schemaVersion: 5,
    videoId: `video-${suffix}`,
    videoRevision: 1,
    analysisId: `analysis-${suffix}`,
    attempt: 1,
    catalogVersion: `catalog-${suffix}`,
    expectedVideoSha256: suffix.padEnd(64, "a"),
  };
}

function pendingStills(byteLength = 1): PendingMappingStills {
  const bytes = new Uint8Array(byteLength);
  return {
    candidates: [{ candidateId: "cand-0001", frameIndex: 0, timestampMs: 0, bytes }],
    samples: [],
    byteLength,
  };
}

function awaitingMap(label: string, stills?: PendingMappingStills, expiresAt = Date.now() + 60_000) {
  const sourceIdentity = identity();
  const candidateToken = `signed-candidate-token-${label}`;
  const lease = claimVideoSegmentation(sourceIdentity);
  lease.awaitingMap(candidateToken, expiresAt, stills);
  return { identity: sourceIdentity, candidateToken, lease };
}

function expectVideoError(action: () => unknown, code: VideoSegmentError["code"]): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(VideoSegmentError);
  expect(caught).toHaveProperty("code", code);
}

describe("video operation cancellation", () => {
  it("releases the matching awaiting-map lease and consumes its attempt", () => {
    const operation = awaitingMap("success");

    expect(releaseAwaitingVideoMapping(operation.identity, operation.candidateToken)).toBe(true);
    expect(releaseAwaitingVideoMapping(operation.identity, operation.candidateToken)).toBe(false);
    expectVideoError(
      () => claimVideoSegmentation(operation.identity),
      "STALE_REQUEST",
    );
    expectVideoError(
      () => claimVideoMapping(operation.identity, operation.candidateToken),
      "STALE_REQUEST",
    );
  });

  it("does not release when any part of the complete identity differs", () => {
    const operation = awaitingMap("wrong-identity");
    const alteredIdentities: VideoOperationIdentity[] = [
      { ...operation.identity, sessionId: `${operation.identity.sessionId}-other` },
      { ...operation.identity, schemaVersion: operation.identity.schemaVersion - 1 },
      { ...operation.identity, videoId: `${operation.identity.videoId}-other` },
      { ...operation.identity, videoRevision: operation.identity.videoRevision + 1 },
      { ...operation.identity, analysisId: `${operation.identity.analysisId}-other` },
      { ...operation.identity, attempt: operation.identity.attempt + 1 },
      { ...operation.identity, catalogVersion: `${operation.identity.catalogVersion}-other` },
      { ...operation.identity, expectedVideoSha256: "b".repeat(64) },
    ];

    for (const altered of alteredIdentities) {
      expect(releaseAwaitingVideoMapping(altered, operation.candidateToken)).toBe(false);
    }
    expect(releaseAwaitingVideoMapping(operation.identity, operation.candidateToken)).toBe(true);
  });

  it("does not release when the candidate token digest differs", () => {
    const operation = awaitingMap("wrong-token");

    expect(releaseAwaitingVideoMapping(operation.identity, `${operation.candidateToken}-other`)).toBe(false);
    const mappingLease = claimVideoMapping(operation.identity, operation.candidateToken);
    mappingLease.complete();
  });

  it("never releases a lease after mapping has started", () => {
    const operation = awaitingMap("mapping-in-progress");
    const mappingLease = claimVideoMapping(operation.identity, operation.candidateToken);

    expect(releaseAwaitingVideoMapping(operation.identity, operation.candidateToken)).toBe(false);
    mappingLease.complete();
    expect(releaseAwaitingVideoMapping(operation.identity, operation.candidateToken)).toBe(false);
  });

  it("keeps a released token stale for mapping replay", () => {
    const operation = awaitingMap("replay");

    expect(releaseAwaitingVideoMapping(operation.identity, operation.candidateToken)).toBe(true);
    expectVideoError(
      () => claimVideoMapping(operation.identity, operation.candidateToken),
      "STALE_REQUEST",
    );
    const nextAttempt = { ...operation.identity, attempt: operation.identity.attempt + 1 };
    const nextLease = claimVideoSegmentation(nextAttempt);
    nextLease.complete();
  });

  it("releases a lost-token map by exact identity and still consumes the attempt", () => {
    const operation = awaitingMap("lost-token");
    const alteredIdentities: VideoOperationIdentity[] = [
      { ...operation.identity, sessionId: `${operation.identity.sessionId}-other` },
      { ...operation.identity, schemaVersion: operation.identity.schemaVersion - 1 },
      { ...operation.identity, videoId: `${operation.identity.videoId}-other` },
      { ...operation.identity, videoRevision: operation.identity.videoRevision + 1 },
      { ...operation.identity, analysisId: `${operation.identity.analysisId}-other` },
      { ...operation.identity, attempt: operation.identity.attempt + 1 },
      { ...operation.identity, catalogVersion: `${operation.identity.catalogVersion}-other` },
      { ...operation.identity, expectedVideoSha256: "b".repeat(64) },
    ];

    for (const altered of alteredIdentities) {
      expect(releaseAwaitingVideoMappingByIdentity(altered)).toBe(false);
    }
    expect(releaseAwaitingVideoMappingByIdentity(operation.identity)).toBe(true);
    expect(releaseAwaitingVideoMappingByIdentity(operation.identity)).toBe(false);
    expectVideoError(() => claimVideoSegmentation(operation.identity), "STALE_REQUEST");
    expectVideoError(
      () => claimVideoMapping(operation.identity, operation.candidateToken),
      "STALE_REQUEST",
    );

    const nextAttempt = { ...operation.identity, attempt: operation.identity.attempt + 1 };
    const nextLease = claimVideoSegmentation(nextAttempt);
    nextLease.complete();
  });

  it("caps retained frame bytes and frees the global capacity on cancel and map completion", () => {
    const oneChunk = new Uint8Array(4 * 1024 * 1024);
    const fullLeaseStills: PendingMappingStills = {
      candidates: Array.from({ length: 4 }, (_, index) => ({
        candidateId: `cand-${String(index + 1).padStart(4, "0")}`,
        frameIndex: index,
        timestampMs: index,
        bytes: oneChunk,
      })),
      samples: [],
      byteLength: 16 * 1024 * 1024,
    };
    const leases = Array.from({ length: 4 }, (_, index) => awaitingMap(`capacity-${index}`, fullLeaseStills));
    const overflowIdentity = identity();
    const overflowLease = claimVideoSegmentation(overflowIdentity);
    expectVideoError(
      () => overflowLease.awaitingMap("signed-candidate-token-overflow", Date.now() + 60_000, fullLeaseStills),
      "OPERATION_BUSY",
    );
    overflowLease.complete();

    expect(releaseAwaitingVideoMapping(leases[0]!.identity, leases[0]!.candidateToken)).toBe(true);
    const replacement = awaitingMap("capacity-replacement", fullLeaseStills);
    const mappingLease = claimVideoMapping(replacement.identity, replacement.candidateToken);
    expect(mappingLease.pendingStills).toBe(fullLeaseStills);
    mappingLease.complete();
    for (const lease of leases.slice(1)) {
      expect(releaseAwaitingVideoMapping(lease.identity, lease.candidateToken)).toBe(true);
    }
    expect(releaseAwaitingVideoMapping(replacement.identity, replacement.candidateToken)).toBe(false);
  });

  it("drops cached frames when the pending map lease expires", () => {
    const operation = awaitingMap("expired-stills", pendingStills(), Date.now() - 1);
    expectVideoError(() => claimVideoMapping(operation.identity, operation.candidateToken), "STALE_REQUEST");
    const nextAttempt = { ...operation.identity, attempt: operation.identity.attempt + 1 };
    const nextLease = claimVideoSegmentation(nextAttempt);
    nextLease.complete();
  });
});

describe("process-wide video operation admission", () => {
  it("rejects a third concurrent operation and admits it after capacity is released", () => {
    const first = claimVideoProcessing();
    const second = claimVideoProcessing();

    let caught: unknown;
    try {
      claimVideoProcessing();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VideoSegmentError);
    expect(caught).toMatchObject({
      status: 429,
      code: "PROCESSING_BUSY",
      message: "Video processing is busy. Wait briefly and try again.",
    });

    first.release();
    first.release();
    const replacement = claimVideoProcessing();
    second.release();
    replacement.release();
  });
});
