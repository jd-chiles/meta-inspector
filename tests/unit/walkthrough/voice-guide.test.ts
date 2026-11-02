import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __setGuideSpeakerForTests,
  cancelSpeech,
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
});
