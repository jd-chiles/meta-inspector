import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { speakPrompt } from "../../../src/features/walkthrough/voice-conversation";

/**
 * Autoplay policy must never be mistaken for a broken clip. Falling through to
 * live synthesis bills a provider call that cannot play either, and the device
 * voice then reads the line in a different voice.
 */
class AutoplayBlockedAudio {
  src = "";
  playbackRate = 1;
  play(): Promise<void> {
    return Promise.reject(Object.assign(new Error("play() blocked"), { name: "NotAllowedError" }));
  }
  pause(): void {}
}

function clipId(text: string): string {
  return createHash("sha256").update(text.trim(), "utf8").digest("hex").slice(0, 16);
}

describe("voice playback under autoplay policy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stays silent instead of calling live synthesis when the browser blocks autoplay", async () => {
    const text = "Tap Start inspection on Home to begin. I'll guide you from there.";
    const manifest = { version: 1, clips: { [clipId(text)]: { chars: text.length } } };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/voice/manifest.json")) {
        return { ok: true, json: async () => manifest } as unknown as Response;
      }
      return { ok: true, blob: async () => new Blob([]) } as unknown as Response;
    });

    vi.stubGlobal("Audio", AutoplayBlockedAudio);
    vi.stubGlobal("fetch", fetchMock);

    const result = await speakPrompt(text);

    expect(result.engine).toBe("none");
    const calledLive = fetchMock.mock.calls.some(([input]) => String(input).includes("/api/voice/speak"));
    expect(calledLive).toBe(false);
  });
});
