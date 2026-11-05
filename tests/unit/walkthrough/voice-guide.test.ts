import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __setGuideSpeakerForTests,
  cancelSpeech,
  speakCueSequence,
  speakText,
} from "../../../src/features/walkthrough/voice-guide";

beforeEach(() => {
  vi.stubGlobal("window", {});
  __setGuideSpeakerForTests(null);
  cancelSpeech();
});

describe("guide voice unification", () => {
  it("speaks guide text through the Fish pipeline, not the device voice", async () => {
    const speaker = vi.fn().mockResolvedValue({ engine: "fish" });
    __setGuideSpeakerForTests(speaker);
    speakText("Let's film the kitchen.");
    await Promise.resolve();
    expect(speaker).toHaveBeenCalledOnce();
    expect(speaker.mock.calls[0]?.[0]).toBe("Let's film the kitchen.");
  });

  it("replaces in-flight guidance when new text arrives", async () => {
    const seen: { current: AbortSignal | null } = { current: null };
    const speaker = vi.fn().mockImplementation(
      (_text: string, signal?: AbortSignal) => {
        if (!seen.current) seen.current = signal ?? null;
        return Promise.resolve({ engine: "fish" });
      },
    );
    __setGuideSpeakerForTests(speaker);
    speakText("First cue.");
    speakText("Second cue.");
    await Promise.resolve();
    expect(speaker).toHaveBeenCalledTimes(2);
    expect(seen.current?.aborted).toBe(true);
  });

  it("walks cues one at a time, in order", async () => {
    const order: string[] = [];
    const heard: string[] = [];
    const speaker = vi.fn().mockImplementation(async (text: string) => {
      order.push(`start:${text}`);
      heard.push(text);
      await Promise.resolve();
      order.push(`end:${text}`);
      return { engine: "fish" };
    });
    __setGuideSpeakerForTests(speaker);
    const sequence = speakCueSequence(["First shot.", "Second shot."], (index) => order.push(`cue:${index}`));
    await sequence.done;
    expect(heard).toEqual(["First shot.", "Second shot."]);
    expect(order.indexOf("end:First shot.")).toBeLessThan(order.indexOf("start:Second shot."));
    expect(order).toContain("cue:1");
  }, 10_000);

  it("cancelSpeech aborts in-flight guidance", async () => {
    const seen: { current: AbortSignal | null } = { current: null };
    const speaker = vi.fn().mockImplementation(
      (_text: string, signal?: AbortSignal) => {
        seen.current = signal ?? null;
        return new Promise(() => undefined);
      },
    );
    __setGuideSpeakerForTests(speaker);
    speakText("A long cue.");
    cancelSpeech();
    expect(seen.current?.aborted).toBe(true);
  });

  it("stopping the sequence stops later cues", async () => {
    const heard: string[] = [];
    const speaker = vi.fn().mockImplementation((text: string, signal?: AbortSignal) => {
      heard.push(text);
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    });
    __setGuideSpeakerForTests(speaker);
    const sequence = speakCueSequence(["First shot.", "Second shot.", "Third shot."]);
    sequence.cancel();
    await sequence.done;
    expect(heard).toEqual(["First shot."]);
  });
});
