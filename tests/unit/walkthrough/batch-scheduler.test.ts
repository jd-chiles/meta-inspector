import { describe, expect, it } from "vitest";

import {
  MAX_CONCURRENT_BATCH_ROOMS,
  createRoomBatchQueue,
  runRoomBatch,
  shouldAutoEnqueueOnSave,
  type AutoEnqueueOnSaveInput,
} from "../../../src/features/walkthrough/batch-scheduler";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("room batch queue", () => {
  it("dedupes rooms and drains FIFO", () => {
    const queue = createRoomBatchQueue(["kitchen"]);
    expect(queue.enqueue("kitchen")).toBe(false);
    expect(queue.enqueue("bathroom")).toBe(true);
    expect(queue.has("bathroom")).toBe(true);
    expect(queue.size).toBe(2);
    expect(queue.snapshot()).toEqual(["kitchen", "bathroom"]);
    expect(queue.takeNext()).toBe("kitchen");
    expect(queue.takeNext()).toBe("bathroom");
    expect(queue.takeNext()).toBeUndefined();
    expect(queue.size).toBe(0);
  });
});

describe("runRoomBatch", () => {
  it("runs at most two rooms at once and attributes interleaved results to the correct room", async () => {
    expect(MAX_CONCURRENT_BATCH_ROOMS).toBe(2);
    const queue = createRoomBatchQueue(["kitchen", "bathroom", "bedroom"]);
    const gates = new Map([
      ["kitchen", deferred<boolean>()],
      ["bathroom", deferred<boolean>()],
      ["bedroom", deferred<boolean>()],
    ]);
    let inFlight = 0;
    let maxInFlight = 0;
    const settled: Array<{ roomId: string; proved: boolean }> = [];
    const batch = runRoomBatch({
      queue,
      runRoom: async (roomId) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          return await gates.get(roomId)!.promise;
        } finally {
          inFlight -= 1;
        }
      },
      onRoomSettled: (roomId, proved) => {
        settled.push({ roomId, proved });
      },
    });

    // Two rooms launch synchronously; the third waits for a slot.
    expect(maxInFlight).toBe(2);
    expect(queue.size).toBe(1);
    // Settle out of order: bathroom fails first, kitchen proves.
    gates.get("bathroom")!.resolve(false);
    await tick();
    await tick();
    expect(queue.size).toBe(0);
    gates.get("kitchen")!.resolve(true);
    await tick();
    await tick();
    // Bedroom picked up the freed slot; prove it last.
    gates.get("bedroom")!.resolve(true);
    const outcome = await batch;

    expect(maxInFlight).toBe(2);
    expect(outcome.proved).toEqual(["kitchen", "bedroom"]);
    expect(outcome.failed).toEqual(["bathroom"]);
    expect(settled).toEqual([
      { roomId: "bathroom", proved: false },
      { roomId: "kitchen", proved: true },
      { roomId: "bedroom", proved: true },
    ]);
  });

  it("treats a thrown pipeline as failed and keeps the sibling room result", async () => {
    const queue = createRoomBatchQueue(["kitchen", "bathroom"]);
    const outcome = await runRoomBatch({
      queue,
      runRoom: async (roomId) => {
        if (roomId === "kitchen") throw new Error("segment exploded");
        return true;
      },
    });
    expect(outcome.proved).toEqual(["bathroom"]);
    expect(outcome.failed).toEqual(["kitchen"]);
  });

  it("stops launching on cancel while in-flight rooms settle normally", async () => {
    const queue = createRoomBatchQueue(["kitchen", "bathroom", "bedroom"]);
    const gates = new Map([
      ["kitchen", deferred<boolean>()],
      ["bathroom", deferred<boolean>()],
      ["bedroom", deferred<boolean>()],
    ]);
    const launched: string[] = [];
    let stopped = false;
    const batch = runRoomBatch({
      queue,
      shouldStop: () => stopped,
      runRoom: async (roomId) => {
        launched.push(roomId);
        return gates.get(roomId)!.promise;
      },
    });
    expect(launched).toEqual(["kitchen", "bathroom"]);
    stopped = true;
    gates.get("kitchen")!.resolve(true);
    gates.get("bathroom")!.resolve(false);
    const outcome = await batch;
    expect(launched).toEqual(["kitchen", "bathroom"]);
    expect(queue.snapshot()).toEqual(["bedroom"]);
    expect(outcome.proved).toEqual(["kitchen"]);
    expect(outcome.failed).toEqual(["bathroom"]);
  });
});

describe("shouldAutoEnqueueOnSave (REQ-S5)", () => {
  const eligible: AutoEnqueueOnSaveInput = {
    walkthroughAttested: true,
    walkthroughSendConsent: true,
    batchAttested: true,
    batchSendConsent: true,
    analysisMode: "live",
    online: true,
    manualPipelineInFlight: false,
    hasUnresolvedBatchFailures: false,
    mime: "video/mp4",
    sessionMatches: true,
    fundingType: "lahsa",
    hasCurrentProposal: false,
    queuedInBatch: false,
    analysisInFlight: false,
  };

  it("enqueues a saved room when consent, LAHSA funding, live mode, and online all hold", () => {
    expect(shouldAutoEnqueueOnSave(eligible)).toBe(true);
  });

  const blocked: Array<[string, Partial<AutoEnqueueOnSaveInput>]> = [
    ["offline save", { online: false }],
    ["missing tour attestation", { walkthroughAttested: false }],
    ["missing tour send consent", { walkthroughSendConsent: false }],
    ["missing batch attestation", { batchAttested: false }],
    ["missing batch send consent", { batchSendConsent: false }],
    ["fixture mode", { analysisMode: "fixture" }],
    ["manual pipeline in flight", { manualPipelineInFlight: true }],
    ["unresolved batch failures", { hasUnresolvedBatchFailures: true }],
    ["MOV clip", { mime: "video/quicktime" }],
    ["session mismatch", { sessionMatches: false }],
    ["non-LAHSA funding", { fundingType: "hud" }],
    ["current proposal already proved", { hasCurrentProposal: true }],
    ["already queued in batch", { queuedInBatch: true }],
    ["already in flight", { analysisInFlight: true }],
  ];

  it.each(blocked)("enqueues nothing on %s", (_label, override) => {
    expect(shouldAutoEnqueueOnSave({ ...eligible, ...override })).toBe(false);
  });
});
