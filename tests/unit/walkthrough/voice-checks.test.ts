import { describe, expect, it } from "vitest";
import {
  VISUAL_STROBE_ALARM_CHECK,
  VOICE_ROOM_CHECKS,
  checksForRoom,
} from "../../../src/features/walkthrough/voice-checks";

describe("checksForRoom", () => {
  it("returns the constant base table when visual alarms are not required", () => {
    for (const record of [{ participantVisualAlarmsRequired: false }, {}, { participantVisualAlarmsRequired: null }]) {
      expect(checksForRoom(record, "bedroom")).toEqual(VOICE_ROOM_CHECKS.bedroom);
      expect(checksForRoom(record, "hallway")).toEqual(VOICE_ROOM_CHECKS.hallway);
      expect(checksForRoom(record, "kitchen")).toEqual(VOICE_ROOM_CHECKS.kitchen);
      expect(checksForRoom(record, "bedroom")).not.toContain(VISUAL_STROBE_ALARM_CHECK);
    }
    expect(VISUAL_STROBE_ALARM_CHECK).toBe("Is a working visual strobe alarm installed for the sleeping area?");
  });

  it("adds the strobe question to bedroom and hallway only when the flag is on", () => {
    const record = { participantVisualAlarmsRequired: true };
    expect(checksForRoom(record, "bedroom")).toEqual([...VOICE_ROOM_CHECKS.bedroom, VISUAL_STROBE_ALARM_CHECK]);
    expect(checksForRoom(record, "bedroom-2")).toEqual([...VOICE_ROOM_CHECKS.bedroom, VISUAL_STROBE_ALARM_CHECK]);
    expect(checksForRoom(record, "hallway")).toEqual([...VOICE_ROOM_CHECKS.hallway, VISUAL_STROBE_ALARM_CHECK]);
    expect(checksForRoom(record, "kitchen")).toEqual(VOICE_ROOM_CHECKS.kitchen);
    expect(checksForRoom(record, "bathroom")).toEqual(VOICE_ROOM_CHECKS.bathroom);
    expect(checksForRoom(record, "living-room")).toEqual(VOICE_ROOM_CHECKS["living-room"]);
  });

  it("yields no questions for unknown rooms", () => {
    expect(checksForRoom({ participantVisualAlarmsRequired: true }, "attic")).toEqual([]);
  });
});
