import { describe, expect, it } from "vitest";

import {
  canAppendRecorderChunk,
  getEffectiveRecordingDurationSeconds,
  getRecordingStopDelayMs,
  RECORDER_STOP_MARGIN_MS,
  WALKTHROUGH_VIDEO_BITS_PER_SECOND,
} from "../../../src/features/walkthrough/recorder-limits";

describe("in-page walkthrough recorder limits", () => {
  it("keeps recording duration within the server's 30 second maximum", () => {
    expect(getEffectiveRecordingDurationSeconds(45)).toBe(30);
    expect(getEffectiveRecordingDurationSeconds(12.5)).toBe(12.5);
    expect(getEffectiveRecordingDurationSeconds(Number.NaN)).toBe(30);
  });

  it("stops before the duration boundary to leave room for the final encoded sample", () => {
    expect(RECORDER_STOP_MARGIN_MS).toBe(500);
    expect(getRecordingStopDelayMs(30)).toBe(29_500);
    expect(getRecordingStopDelayMs(2.25)).toBe(1_750);
    expect(getRecordingStopDelayMs(0.25)).toBe(0);
  });

  it("estimates a 720p, 30-second clip well below the 60 MiB file limit", () => {
    const estimatedBytes = WALKTHROUGH_VIDEO_BITS_PER_SECOND * 30 / 8;
    expect(WALKTHROUGH_VIDEO_BITS_PER_SECOND).toBe(5_000_000);
    expect(estimatedBytes).toBeLessThan(60 * 1024 * 1024);
  });

  it("checks the next chunk before retaining it in the in-page recording", () => {
    const maxBytes = 60 * 1024 * 1024;
    expect(canAppendRecorderChunk(maxBytes - 10, 10, maxBytes)).toBe(true);
    expect(canAppendRecorderChunk(maxBytes - 10, 11, maxBytes)).toBe(false);
    expect(canAppendRecorderChunk(maxBytes, 1, maxBytes)).toBe(false);
    expect(canAppendRecorderChunk(Number.NaN, 1, maxBytes)).toBe(false);
  });
});
