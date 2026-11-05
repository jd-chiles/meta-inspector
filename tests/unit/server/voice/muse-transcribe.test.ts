import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  MUSE_TRANSCRIBE_FFMPEG_ARGS,
  convertMicClipToWav,
  isMuseTranscribeError,
  resolveMuseTranscribeConfig,
  transcribeWithMuse,
  type MuseTranscribeConfig,
} from "../../../../src/server/voice/muse-transcribe";

const ENV = { META_API_KEY: "server-only-meta-key" };

function cannedWav(): Uint8Array {
  // Minimal RIFF/WAVE header; bytes are never decoded here.
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    0x00, 0x01, 0x02, 0x03,
  ]);
}

interface FakeSpawn {
  impl: typeof spawn;
  seen: { command?: string; args?: readonly string[]; stdinBytes?: Uint8Array };
}

/** Fake ffmpeg: records its invocation, feeds canned WAV to stdout, exits 0. */
function fakeSpawnSuccess(wav: Uint8Array): FakeSpawn {
  const seen: FakeSpawn["seen"] = {};
  const impl = ((command: string, args: readonly string[]) => {
    seen.command = command;
    seen.args = args;
    const child = new EventEmitter() as EventEmitter & { kill: () => void; stdin: EventEmitter & { write: (c: Uint8Array) => void; end: () => void }; stdout: EventEmitter; stderr: EventEmitter };
    child.kill = () => undefined;
    const stdin = new EventEmitter() as EventEmitter & { write: (c: Uint8Array) => void; end: () => void };
    stdin.write = (chunk: Uint8Array) => {
      seen.stdinBytes = chunk;
    };
    stdin.end = () => {
      queueMicrotask(() => {
        child.stdout.emit("data", wav);
        child.emit("close", 0);
      });
    };
    child.stdin = stdin;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    return child;
  }) as unknown as typeof spawn;
  return { impl, seen };
}

function fakeSpawnExit(code: number): typeof spawn {
  return (( ) => {
    const child = new EventEmitter() as EventEmitter & { kill: () => void; stdin: EventEmitter & { write: () => void; end: () => void }; stdout: EventEmitter; stderr: EventEmitter };
    child.kill = () => undefined;
    const stdin = new EventEmitter() as EventEmitter & { write: () => void; end: () => void };
    stdin.write = () => undefined;
    stdin.end = () => {
      queueMicrotask(() => child.emit("close", code));
    };
    child.stdin = stdin;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    return child;
  }) as unknown as typeof spawn;
}

function fakeSpawnError(): typeof spawn {
  return (( ) => {
    const child = new EventEmitter() as EventEmitter & { kill: () => void; stdin: EventEmitter & { write: () => void; end: () => void }; stdout: EventEmitter; stderr: EventEmitter };
    child.kill = () => undefined;
    const stdin = new EventEmitter() as EventEmitter & { write: () => void; end: () => void };
    stdin.write = () => undefined;
    stdin.end = () => undefined;
    child.stdin = stdin;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit("error", new Error("spawn ffmpeg ENOENT")));
    return child;
  }) as unknown as typeof spawn;
}

describe("muse-transcribe config", () => {
  it("defaults model, base URL, and ffmpeg path", () => {
    expect(resolveMuseTranscribeConfig(ENV)).toEqual({
      apiKey: "server-only-meta-key",
      baseUrl: "https://api.meta.ai/v1",
      model: "muse-voice-transcribe-1.0",
      ffmpegPath: "ffmpeg",
    });
  });

  it("honors server-only overrides and the MODEL_API_KEY alias", () => {
    const config = resolveMuseTranscribeConfig({
      MODEL_API_KEY: "official-key",
      META_API_BASE_URL: "https://api.meta.ai/v1/",
      META_TRANSCRIBE_MODEL: "muse-voice-transcribe-2.0",
      FFMPEG_PATH: "/usr/bin/ffmpeg",
    });
    expect(config).toEqual({
      apiKey: "official-key",
      baseUrl: "https://api.meta.ai/v1",
      model: "muse-voice-transcribe-2.0",
      ffmpegPath: "/usr/bin/ffmpeg",
    });
  });

  it("fails closed without credentials, with a non-allowlisted base, or a contributor model", () => {
    for (const env of [{}, { META_API_BASE_URL: "https://attacker.example/v1", META_API_KEY: "k" }, { META_API_KEY: "k", META_TRANSCRIBE_MODEL: "muse-contributor-1" }]) {
      try {
        resolveMuseTranscribeConfig(env);
        expect.unreachable("misconfigured transcribe must throw");
      } catch (error) {
        expect(isMuseTranscribeError(error)).toBe(true);
        expect((error as { code: string }).code).toBe("SETUP_REQUIRED");
      }
    }
  });
});

describe("muse-transcribe wav conversion", () => {
  it("converts with the cookbook ffmpeg flags over pipes, never a shell", () => {
    expect([...MUSE_TRANSCRIBE_FFMPEG_ARGS]).toEqual([
      "-hide_banner",
      "-nostdin",
      "-i",
      "pipe:0",
      "-ac",
      "1",
      "-ar",
      "24000",
      "-sample_fmt",
      "s16",
      "-f",
      "wav",
      "pipe:1",
    ]);
  });

  it("feeds mic bytes to ffmpeg and returns the converted WAV", async () => {
    const wav = cannedWav();
    const fake = fakeSpawnSuccess(wav);
    const input = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);
    const converted = await convertMicClipToWav(input, "/usr/bin/ffmpeg", { spawnImpl: fake.impl });
    expect(converted).toEqual(wav);
    expect(fake.seen.command).toBe("/usr/bin/ffmpeg");
    expect([...(fake.seen.args ?? [])]).toEqual([...MUSE_TRANSCRIBE_FFMPEG_ARGS]);
    expect(Buffer.from(fake.seen.stdinBytes ?? [])).toEqual(Buffer.from(input));
  });

  it("maps ffmpeg failure to a fallback-triggering error", async () => {
    await expect(convertMicClipToWav(new Uint8Array([1, 2, 3]), "ffmpeg", { spawnImpl: fakeSpawnExit(1) }))
      .rejects.toMatchObject({ name: "MuseTranscribeError", code: "PROVIDER_FAILURE" });
  });

  it("maps a missing ffmpeg binary to setup-required", async () => {
    await expect(convertMicClipToWav(new Uint8Array([1, 2, 3]), "ffmpeg", { spawnImpl: fakeSpawnError() }))
      .rejects.toMatchObject({ name: "MuseTranscribeError", code: "SETUP_REQUIRED", status: 503 });
  });
});

describe("transcribeWithMuse", () => {
  function config(): MuseTranscribeConfig {
    return resolveMuseTranscribeConfig(ENV);
  }

  it("posts the cookbook multipart body and returns the transcript", async () => {
    const wav = cannedWav();
    const fake = fakeSpawnSuccess(wav);
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({ sessionId: "s-1", transcript: "two bedrooms", audioDurationMs: 1200 }),
    );
    const { text } = await transcribeWithMuse(
      new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      config(),
      fetchImpl as unknown as typeof fetch,
      { spawnImpl: fake.impl },
    );
    expect(text).toBe("two bedrooms");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer server-only-meta-key");
    const form = init.body as FormData;
    const requestPart = form.get("request");
    expect(requestPart).toBeInstanceOf(Blob);
    expect(JSON.parse(await (requestPart as Blob).text())).toEqual({
      mode: "PUSH_TO_TALK",
      model: "muse-voice-transcribe-1.0",
      audioEncoding: "WAV",
    });
    const audioPart = form.get("audio");
    expect(audioPart).toBeInstanceOf(File);
    expect((audioPart as File).name).toBe("audio.wav");
    expect((audioPart as File).type).toBe("audio/wav");
    expect(new Uint8Array(await (audioPart as File).arrayBuffer())).toEqual(wav);
  });

  it("treats empty text as silence, not failure", async () => {
    const fake = fakeSpawnSuccess(cannedWav());
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ transcript: "" }));
    const { text } = await transcribeWithMuse(
      new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      config(),
      fetchImpl as unknown as typeof fetch,
      { spawnImpl: fake.impl },
    );
    expect(text).toBe("");
  });

  it("maps provider outcomes like fish.ts without leaking key material", async () => {
    const cases = [
      { status: 500, body: "boom", code: "PROVIDER_FAILURE", http: 502 },
      { status: 401, body: "nope", code: "SETUP_REQUIRED", http: 503 },
      { status: 429, body: "slow", code: "PROVIDER_FAILURE", http: 429 },
    ] as const;
    for (const { status, body, code, http } of cases) {
      const fake = fakeSpawnSuccess(cannedWav());
      const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status }));
      const failure = await transcribeWithMuse(
        new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
        config(),
        fetchImpl as unknown as typeof fetch,
        { spawnImpl: fake.impl },
      ).then(
        () => null,
        (error: unknown) => error as { code: string; status: number; message: string },
      );
      expect(failure?.code).toBe(code);
      expect(failure?.status).toBe(http);
      expect(failure?.message).not.toContain("server-only-meta-key");
    }
  });

  it("maps fetch failure to a retryable timeout and unreadable JSON to provider failure", async () => {
    const rejecting = vi.fn().mockRejectedValue(new Error("socket hangup"));
    await expect(transcribeWithMuse(
      new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      config(),
      rejecting as unknown as typeof fetch,
      { spawnImpl: fakeSpawnSuccess(cannedWav()).impl },
    )).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT", status: 504 });

    const badJson = vi.fn().mockResolvedValue(Response.json({ transcript: 42 }));
    await expect(transcribeWithMuse(
      new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      config(),
      badJson as unknown as typeof fetch,
      { spawnImpl: fakeSpawnSuccess(cannedWav()).impl },
    )).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  });
});
