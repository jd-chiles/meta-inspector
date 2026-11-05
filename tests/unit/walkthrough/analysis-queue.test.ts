import { describe, expect, it } from "vitest";
import {
  dequeueAnalysisQueue,
  enqueueAnalysisQueue,
  pruneAnalysisQueue,
} from "../../../src/domain/move-in-ready";
import {
  createInitialInspectionRecord,
  validateInspectionRecord,
} from "../../../src/features/walkthrough/inspection-store";

const NOW = "2026-11-01T00:00:00.000Z";

describe("offline analysis queue helpers (REQ-L2)", () => {
  it("enqueues rooms in order and dedupes re-queues", () => {
    expect(enqueueAnalysisQueue([], "kitchen")).toEqual(["kitchen"]);
    expect(enqueueAnalysisQueue(["kitchen"], "bathroom")).toEqual(["kitchen", "bathroom"]);
    expect(enqueueAnalysisQueue(["kitchen", "bathroom"], "kitchen")).toEqual(["kitchen", "bathroom"]);
  });

  it("ignores non-room entries without throwing", () => {
    expect(enqueueAnalysisQueue(["kitchen"], "attic")).toEqual(["kitchen"]);
  });

  it("removes a room once analyzed or its clip is removed", () => {
    expect(dequeueAnalysisQueue(["kitchen", "bathroom"], "kitchen")).toEqual(["bathroom"]);
    expect(dequeueAnalysisQueue(["kitchen"], "bathroom")).toEqual(["kitchen"]);
    expect(dequeueAnalysisQueue([], "kitchen")).toEqual([]);
  });

  it("drops queue entries for removed rooms and keeps the rest in order", () => {
    expect(pruneAnalysisQueue(["kitchen", "hallway", "bathroom"], ["kitchen", "bathroom"]))
      .toEqual(["kitchen", "bathroom"]);
    expect(pruneAnalysisQueue(["hallway"], ["kitchen"])).toEqual([]);
  });
});

describe("persisted analysis queue on the record (REQ-L2)", () => {
  it("starts empty on new records", () => {
    expect(createInitialInspectionRecord("queue-1", NOW).analysisQueue).toEqual([]);
  });

  it("defaults legacy records without a queue to empty", () => {
    const record = createInitialInspectionRecord("queue-2", NOW);
    const legacy = { ...record } as unknown as Record<string, unknown>;
    delete legacy.analysisQueue;
    delete legacy.inspectionLocation;
    const validated = validateInspectionRecord(legacy, "queue-2");
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.record.analysisQueue).toEqual([]);
      expect(validated.record.inspectionLocation).toBeNull();
    }
  });

  it("round-trips a queue and dedupes repeated entries", () => {
    const record = {
      ...createInitialInspectionRecord("queue-3", NOW),
      analysisQueue: ["kitchen", "bathroom", "kitchen"],
    };
    const validated = validateInspectionRecord(record, "queue-3");
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.record.analysisQueue).toEqual(["kitchen", "bathroom"]);
  });

  it("fails closed on non-room queue entries", () => {
    const record = {
      ...createInitialInspectionRecord("queue-4", NOW),
      analysisQueue: ["kitchen", "attic"],
    };
    const validated = validateInspectionRecord(record as unknown as Record<string, unknown>, "queue-4");
    expect(validated.ok).toBe(false);
  });
});
