import { describe, expect, it } from "vitest";

import { validateEvidenceReference } from "../../../src/domain/move-in-ready";
import {
  buildDetectorTestReference,
  DETECTOR_TEST_PROMPT,
  firstFreeEvidenceTimestampMs,
  isDetectorPresenceQuestion,
  isDetectorTestRoom,
} from "../../../src/features/walkthrough/detector-test";
import {
  VISUAL_STROBE_ALARM_CHECK,
  VISUAL_STROBE_ALARM_CHECK_ES,
} from "../../../src/features/walkthrough/voice-checks";

describe("detector test shot", () => {
  it("targets bedroom, living-room, and hallway rooms only", () => {
    expect(isDetectorTestRoom("bedroom")).toBe(true);
    expect(isDetectorTestRoom("bedroom-2")).toBe(true);
    expect(isDetectorTestRoom("living-room")).toBe(true);
    expect(isDetectorTestRoom("hallway")).toBe(true);
    expect(isDetectorTestRoom("kitchen")).toBe(false);
    expect(isDetectorTestRoom("bathroom")).toBe(false);
    expect(isDetectorTestRoom("not-a-room")).toBe(false);
  });

  it("matches the detector presence question in either tour language", () => {
    expect(isDetectorPresenceQuestion("Is there a working smoke detector in or near this room?")).toBe(true);
    expect(isDetectorPresenceQuestion("Is there a working smoke detector along this path?")).toBe(true);
    expect(isDetectorPresenceQuestion("¿Hay un detector de humo en funcionamiento a lo largo de este pasaje?")).toBe(true);
    expect(isDetectorPresenceQuestion("Do the windows and door locks work?")).toBe(false);
    // The F2 strobe question must never match: the detector-test panel
    // belongs on detector-presence cards only, in either language.
    expect(isDetectorPresenceQuestion(VISUAL_STROBE_ALARM_CHECK)).toBe(false);
    expect(isDetectorPresenceQuestion(VISUAL_STROBE_ALARM_CHECK_ES)).toBe(false);
    expect(DETECTOR_TEST_PROMPT).toBe("Press the detector's test button now");
  });

  it("finds a free millisecond slot inside the clip timeline", () => {
    expect(firstFreeEvidenceTimestampMs([], 10)).toBe(0);
    expect(firstFreeEvidenceTimestampMs([0, 1, 2], 10)).toBe(3);
    expect(firstFreeEvidenceTimestampMs([0], 0.001)).toBeNull();
  });

  it("builds a valid local-still evidence reference", () => {
    const reference = buildDetectorTestReference(
      {
        schemaVersion: 5,
        catalogVersion: "0.3.0-demo.3",
        videoId: "video-bedroom-1",
        videoRevision: 1,
        roomId: "bedroom",
      },
      42,
      "c".repeat(64),
    );
    expect(reference.frameIndex).toBeNull();
    expect(reference.timestampMs).toBe(42);
    expect(reference.stillId.startsWith("detector-test-")).toBe(true);
    expect(validateEvidenceReference(reference).ok).toBe(true);
  });
});
