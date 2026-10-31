import { describe, expect, it } from "vitest";
import { MOVE_IN_READY_SCHEMA_VERSION } from "../../../src/domain/move-in-ready";
import type { LiveProofMetadata, StoredRoomClipIdentity } from "../../../src/features/walkthrough/inspection-store";
import { LIVE_ELEMENT_SPECS, buildLiveProofDraft } from "../../../src/features/walkthrough/live-elements";

const SPEC = LIVE_ELEMENT_SPECS.find((item) => item.elementId === "demo-water-supply")!;

function identity(): StoredRoomClipIdentity {
  return {
    roomId: "kitchen",
    schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
    catalogVersion: "0.3.0-demo.3",
    videoId: "video-element-faucet",
    videoRevision: 1,
    videoHash: "d".repeat(64),
    capturedAt: "2026-10-29T09:16:00.000Z",
    durationSeconds: 8,
    sizeBytes: 512,
    evidence: [{
      schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
      catalogVersion: "0.3.0-demo.3",
      videoId: "video-element-faucet",
      videoRevision: 1,
      roomId: "kitchen",
      stillId: "still-element-faucet",
      timestampMs: 3000,
      frameIndex: null,
      stillHash: "c".repeat(64),
    }],
  };
}

function proof(overrides: Partial<LiveProofMetadata> = {}): LiveProofMetadata {
  return {
    trackedFrames: 7,
    totalFrames: 8,
    transcriptExcerpt: "I turned the faucet on and the water runs clear.",
    recordedAt: "2026-10-29T09:16:00.000Z",
    ...overrides,
  };
}

describe("live proof drafts", () => {
  it("builds a draft proposal bound to the element clip with the narration quoted", () => {
    const draft = buildLiveProofDraft({
      spec: SPEC,
      sessionId: "session-1",
      roomLabel: "Kitchen",
      identity: identity(),
      proof: proof(),
      analysisId: "analysis-live-1",
    });
    expect(draft).not.toBeNull();
    expect(draft!.state).toBe("draft-proposal");
    expect(draft!.observation).toContain("unreviewed");
    expect(draft!.observation).toContain("7 of 8");
    expect(draft!.observation).toContain("water runs clear");
    expect(draft!.confidence).toBe(80);
    expect(draft!.evidence).toHaveLength(1);
    expect(draft!.evidence[0]!.frameIndex).toBe(4);
    expect(draft!.evidence[0]!.videoId).toBe("video-element-faucet");
    expect(draft!.analysisIdentity.videoId).toBe("video-element-faucet");
    expect(draft!.analysisIdentity.expectedSourceHash).toBe("d".repeat(64));
    expect(draft!.analysisIdentity.analysisId).toBe("analysis-live-1");
  });

  it("falls back to needs-human-check when tracking is weak", () => {
    const draft = buildLiveProofDraft({
      spec: SPEC,
      sessionId: "session-1",
      roomLabel: "Kitchen",
      identity: identity(),
      proof: proof({ trackedFrames: 1, totalFrames: 8, transcriptExcerpt: null }),
      analysisId: "analysis-live-2",
    });
    expect(draft!.state).toBe("needs-human-check");
    expect(draft!.confidence).toBe(40);
    expect(draft!.evidence).toHaveLength(1);
  });

  it("returns null when the element clip has no still to cite", () => {
    const bare = identity();
    bare.evidence = [];
    expect(buildLiveProofDraft({
      spec: SPEC,
      sessionId: "session-1",
      roomLabel: "Kitchen",
      identity: bare,
      proof: proof(),
      analysisId: "analysis-live-3",
    })).toBeNull();
  });
});
