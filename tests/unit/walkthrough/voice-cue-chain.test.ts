import { afterEach, describe, expect, it, vi } from "vitest";

import { speakCueChain } from "../../../src/features/walkthrough/voice-conversation";
import { __setGuideSpeakerForTests, speakCueSequence } from "../../../src/features/walkthrough/voice-guide";

afterEach(() => {
  __setGuideSpeakerForTests(null);
  vi.unstubAllGlobals();
});

describe("speakCueChain retry", () => {
  it("retries a failed cue once, then continues the take", async () => {
    const seen: string[] = [];
    const speak = vi.fn(async (text: string) => {
      seen.push(text);
      if (seen.length === 1) throw new Error("network blip");
      return { engine: "fish" as const };
    });
    const cues: string[] = [];
    await speakCueChain(["cue one"], speak, new AbortController().signal, (index) => cues.push(String(index)));
    expect(speak).toHaveBeenCalledTimes(2);
    expect(cues).toEqual(["0"]);
  });

  it("never retries after an abort", async () => {
    const controller = new AbortController();
    const speak = vi.fn(async () => {
      controller.abort();
      throw new Error("aborted");
    });
    await speakCueChain(["cue one", "cue two"], speak, controller.signal);
    expect(speak).toHaveBeenCalledTimes(1);
  });
});

describe("speakCueSequence retry", () => {
  it("retries a failed cue once, then continues the take", async () => {
    let calls = 0;
    __setGuideSpeakerForTests(async () => {
      calls += 1;
      if (calls === 1) throw new Error("network blip");
      return { engine: "fish" as const };
    });
    const cues: number[] = [];
    await speakCueSequence(["cue one"], (index) => cues.push(index)).done;
    expect(calls).toBe(2);
    expect(cues).toEqual([0]);
  });

  it("cancel stops the sequence without retrying", async () => {
    let calls = 0;
    __setGuideSpeakerForTests(async () => {
      calls += 1;
      throw new Error("nope");
    });
    const sequence = speakCueSequence(["cue one", "cue two"]);
    sequence.cancel();
    await sequence.done;
    expect(calls).toBeLessThanOrEqual(2);
  });
});
