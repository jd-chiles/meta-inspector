import { describe, expect, it } from "vitest";
import { createPendingCancelTracker } from "../../../src/features/walkthrough/pending-cancel";
import type { VideoIdentityFields } from "../../../src/features/walkthrough/move-in-ready-flow";

const IDENTITY: VideoIdentityFields = {
  sessionId: "session-pagehide",
  schemaVersion: 3,
  videoId: "video-pagehide",
  videoRevision: 1,
  analysisId: "analysis-pagehide",
  attempt: 1,
  catalogVersion: "0.3.0-demo.3",
  expectedVideoSha256: "0".repeat(64),
};

describe("pending cancel tracker", () => {
  it("starts empty and stays empty after clear", () => {
    const tracker = createPendingCancelTracker();
    expect(tracker.hasPending()).toBe(false);
    expect(tracker.consume()).toBeNull();
    tracker.set(IDENTITY, null);
    expect(tracker.hasPending()).toBe(true);
    tracker.clear();
    expect(tracker.hasPending()).toBe(false);
    expect(tracker.consume()).toBeNull();
  });

  it("consume returns the payload once, including a later token update", () => {
    const tracker = createPendingCancelTracker();
    tracker.set(IDENTITY, null);
    tracker.set(IDENTITY, "signed-token-bytes");
    expect(tracker.consume()).toEqual({ identity: IDENTITY, token: "signed-token-bytes" });
    expect(tracker.hasPending()).toBe(false);
    expect(tracker.consume()).toBeNull();
  });
});
