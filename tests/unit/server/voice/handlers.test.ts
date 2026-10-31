import { describe, expect, it, vi } from "vitest";
import { handleSpeakRequest, handleTranscribeRequest } from "../../../../src/server/voice/handlers";
import { WALKTHROUGH_CLIENT_HEADER, WALKTHROUGH_CLIENT_ID } from "../../../../src/domain/walkthrough-client";

const ORIGIN = "https://walkthrough.example";
const ENV = { FISH_API_KEY: "server-only-fish-key", FISH_VOICE_ID: "voice-123" };
const APP_HEADERS = { [WALKTHROUGH_CLIENT_HEADER]: WALKTHROUGH_CLIENT_ID };

function webmBytes(): Uint8Array {
  // Minimal EBML header so the audio sniff passes; content is never decoded here.
  return new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
}

describe("voice handlers", () => {
  it("speaks text through Fish and returns audio bytes", async () => {
    const audio = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(audio, { status: 200 }));
    const response = await handleSpeakRequest(
      new Request(`${ORIGIN}/api/voice/speak`, {
        method: "POST",
        headers: { ...APP_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({ text: "Film the kitchen." }),
      }),
      { env: ENV, fetch: fetchImpl as unknown as typeof fetch },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(audio);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.fish.audio/v1/tts");
    expect((init.headers as Record<string, string>).model).toBe("s2.1-pro-free");
    expect(String((init.headers as Record<string, string>).authorization)).toContain("server-only-fish-key");
    expect(JSON.parse(String(init.body))).toMatchObject({ text: "Film the kitchen.", reference_id: "voice-123", format: "mp3" });
  });

  it("rejects overlong speech text and missing senders without provider calls", async () => {
    const fetchImpl = vi.fn();
    const long = await handleSpeakRequest(
      new Request(`${ORIGIN}/api/voice/speak`, {
        method: "POST",
        headers: { ...APP_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({ text: "x".repeat(501) }),
      }),
      { env: ENV, fetch: fetchImpl as unknown as typeof fetch },
    );
    expect(long.status).toBe(400);
    const foreign = await handleSpeakRequest(
      new Request(`${ORIGIN}/api/voice/speak`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://attacker.example" },
        body: JSON.stringify({ text: "hi" }),
      }),
      { env: ENV, fetch: fetchImpl as unknown as typeof fetch },
    );
    expect(foreign.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps provider auth failure to setup-required, never leaking the key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    const response = await handleSpeakRequest(
      new Request(`${ORIGIN}/api/voice/speak`, {
        method: "POST",
        headers: { ...APP_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      }),
      { env: ENV, fetch: fetchImpl as unknown as typeof fetch },
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: "SETUP_REQUIRED" } });
    expect(JSON.stringify(body)).not.toContain("server-only-fish-key");
  });

  it("transcribes one mic clip through Fish ASR", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({ text: "two bedrooms", duration: 1.2 }),
    );
    const form = new FormData();
    form.append("audio", new File([webmBytes()], "mic.webm", { type: "audio/webm" }));
    const response = await handleTranscribeRequest(
      new Request(`${ORIGIN}/api/voice/transcribe`, { method: "POST", headers: APP_HEADERS, body: form }),
      { env: ENV, fetch: fetchImpl as unknown as typeof fetch },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, text: "two bedrooms" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.fish.audio/v1/asr");
    expect((init.headers as Record<string, string>).model).toBe("transcribe-1-pro");
  });

  it("rejects non-audio mic clips without provider calls", async () => {
    const fetchImpl = vi.fn();
    const form = new FormData();
    form.append("audio", new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], "mic.webm", { type: "audio/webm" }));
    const response = await handleTranscribeRequest(
      new Request(`${ORIGIN}/api/voice/transcribe`, { method: "POST", headers: APP_HEADERS, body: form }),
      { env: ENV, fetch: fetchImpl as unknown as typeof fetch },
    );
    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
