import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetVoiceManifestForTests, staticVoiceUrl } from "../../../src/features/walkthrough/voice-manifest";

function clipId(text: string): string {
  return createHash("sha256").update(text.trim(), "utf8").digest("hex").slice(0, 16);
}

beforeEach(() => {
  __resetVoiceManifestForTests();
});

describe("staticVoiceUrl", () => {
  it("resolves a pre-generated clip by exact text", async () => {
    const text = "How many bathrooms?";
    const id = clipId(text);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ version: 1, clips: { [id]: { chars: text.length } } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await expect(staticVoiceUrl(text, fetchImpl)).resolves.toBe(`/voice/${id}.mp3`);
    await expect(staticVoiceUrl(`  ${text}  `, fetchImpl)).resolves.toBe(`/voice/${id}.mp3`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns null for dynamic text with no clip", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ version: 1, clips: {} }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await expect(staticVoiceUrl("Room 3 of 7 has a custom note.", fetchImpl)).resolves.toBeNull();
  });

  it("falls back to live speech when no manifest was generated yet", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));
    await expect(staticVoiceUrl("How many bathrooms?", fetchImpl)).resolves.toBeNull();
    await expect(staticVoiceUrl("How many bathrooms?", fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
