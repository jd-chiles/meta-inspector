import { describe, expect, it } from "vitest";

import {
  isAnalysisCurrent,
  type AnalysisCurrencyInput,
} from "../../../src/features/walkthrough/analysis-identity";

function baseInput(): AnalysisCurrencyInput {
  return {
    aborted: false,
    generation: 3,
    currentGeneration: 3,
    record: {
      sessionId: "session-1",
      selectedRoomId: "kitchen",
      schemaVersion: 5,
      catalogVersion: "0.3.0-demo.3",
    },
    identity: {
      schemaVersion: 5,
      catalogVersion: "0.3.0-demo.3",
      videoId: "video-kitchen-1",
      videoRevision: 2,
      videoHash: "h".repeat(64),
    },
    expected: {
      sessionId: "session-1",
      roomId: "kitchen",
      videoId: "video-kitchen-1",
      videoRevision: 2,
      videoHash: "h".repeat(64),
      schemaVersion: 5,
      catalogVersion: "0.3.0-demo.3",
    },
  };
}

describe("isAnalysisCurrent", () => {
  it("accepts in-flight work when every identity dimension matches", () => {
    expect(isAnalysisCurrent(baseInput())).toBe(true);
  });

  it("rejects a pure schema version bump during in-flight work", () => {
    const bumpedRecord = baseInput();
    bumpedRecord.record!.schemaVersion = 6;
    expect(isAnalysisCurrent(bumpedRecord)).toBe(false);

    const bumpedIdentity = baseInput();
    bumpedIdentity.identity!.schemaVersion = 6;
    expect(isAnalysisCurrent(bumpedIdentity)).toBe(false);
  });

  it("rejects a pure catalog version bump during in-flight work", () => {
    const bumpedRecord = baseInput();
    bumpedRecord.record!.catalogVersion = "0.4.0-demo.1";
    expect(isAnalysisCurrent(bumpedRecord)).toBe(false);

    const bumpedIdentity = baseInput();
    bumpedIdentity.identity!.catalogVersion = "0.4.0-demo.1";
    expect(isAnalysisCurrent(bumpedIdentity)).toBe(false);
  });

  it("rejects aborted, superseded, or re-targeted work", () => {
    expect(isAnalysisCurrent({ ...baseInput(), aborted: true })).toBe(false);
    expect(isAnalysisCurrent({ ...baseInput(), currentGeneration: 4 })).toBe(false);

    const movedRoom = baseInput();
    movedRoom.record!.selectedRoomId = "bathroom";
    expect(isAnalysisCurrent(movedRoom)).toBe(false);

    const replacedClip = baseInput();
    replacedClip.identity!.videoRevision = 3;
    expect(isAnalysisCurrent(replacedClip)).toBe(false);

    expect(isAnalysisCurrent({ ...baseInput(), record: null })).toBe(false);
    expect(isAnalysisCurrent({ ...baseInput(), identity: null })).toBe(false);
  });

  it("lets batch pipelines skip only the UI selection comparison", () => {
    const movedRoom = baseInput();
    movedRoom.record!.selectedRoomId = "bathroom";
    expect(isAnalysisCurrent(movedRoom)).toBe(false);
    expect(isAnalysisCurrent({ ...movedRoom, requireSelectedRoom: false })).toBe(true);

    const replacedClip = baseInput();
    replacedClip.identity!.videoRevision = 3;
    expect(isAnalysisCurrent({ ...replacedClip, requireSelectedRoom: false })).toBe(false);

    const wrongSession = baseInput();
    wrongSession.record!.sessionId = "session-2";
    expect(isAnalysisCurrent({ ...wrongSession, requireSelectedRoom: false })).toBe(false);
  });
});
