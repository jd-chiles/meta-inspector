/**
 * Server-only Muse Voice Transcribe ASR client (REQ-V1). The Meta key never
 * leaves the server; the browser only sends short mic clips.
 *
 * Wire format mirror of the Meta cookbook recipe
 * `06_muse_voice/01_voice_api_fundamentals` (`transcribe_file.py` delegates
 * to `transcribe_recording()` in `utils.py`; inspected 2026-11-03 via
 * https://github.com/meta-models/meta-model-cookbook):
 * - POST {base}/asr/transcribe, base https://api.meta.ai/v1 (allowlisted).
 * - Header `Authorization: Bearer <key>` (the one-shot endpoint reads the
 *   header; only the realtime WebSocket carries the credential in JSON).
 * - multipart/form-data with exactly two parts:
 *   - "request": JSON { mode, model, audioEncoding } with content-type
 *     application/json (params travel as a JSON part, not form fields).
 *     mode is PUSH_TO_TALK (caller-delimited turn), model is
 *     muse-voice-transcribe-1.0, audioEncoding is WAV.
 *   - "audio": the WAV file bytes.
 * - Input audio is mono 16-bit WAV at 24 kHz (16 kHz accepted); other
 *   formats are converted with ffmpeg, per the recipe README:
 *   `ffmpeg -i <in> -ac 1 -ar 24000 -sample_fmt s16 <out.wav>`.
 * - 200 response JSON: { sessionId, transcript, audioDurationMs, turns? }.
 *   An empty transcript means silence, not failure.
 * - Non-200 hints: 400 over-long/malformed, 401 credential rejected,
 *   404 not found, 413 body over 32 MB, 429 rate limited, 500 over budget.
 */

import { spawn } from "node:child_process";

import { META_API_ALLOWLIST } from "../meta/adapter";

export type MuseTranscribeErrorCode =
  | "SETUP_REQUIRED"
  | "QUOTA_EXCEEDED"
  | "INVALID_REQUEST"
  | "PROVIDER_FAILURE"
  | "PROVIDER_TIMEOUT";

/** Safe, client-shareable provider failure. Never carries keys or bodies. */
export class MuseTranscribeError extends Error {
  readonly code: MuseTranscribeErrorCode;
  readonly status: 400 | 402 | 429 | 502 | 503 | 504;
  readonly retryable: boolean;

  constructor(code: MuseTranscribeErrorCode, status: 400 | 402 | 429 | 502 | 503 | 504, message: string, retryable: boolean) {
    super(message);
    this.name = "MuseTranscribeError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function isMuseTranscribeError(value: unknown): value is MuseTranscribeError {
  return value instanceof MuseTranscribeError;
}

export const MUSE_TRANSCRIBE_DEFAULT_MODEL = "muse-voice-transcribe-1.0";
/** Caller-delimited turn: one uploaded clip is one utterance. */
export const MUSE_TRANSCRIBE_MODE = "PUSH_TO_TALK";
export const MUSE_TRANSCRIBE_TIMEOUT_MS = 20_000;
const MUSE_TRANSCRIBE_CONVERT_TIMEOUT_MS = 30_000;
/** Converted mic-clip ceiling: 24 kHz mono s16 is ~2.9 MB per minute. */
const MAX_CONVERTED_WAV_BYTES = 16 * 1024 * 1024;
const MAX_CONVERT_STDERR_BYTES = 64 * 1024;

/**
 * Cookbook conversion flags (`ffmpeg -i <in> -ac 1 -ar 24000 -sample_fmt s16
 * <out.wav>`), adapted to stdin/stdout pipes with no shell.
 */
export const MUSE_TRANSCRIBE_FFMPEG_ARGS = [
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
] as const;

const CONTRIBUTOR_PATTERN = /contributor/i;

export interface MuseTranscribeConfig {
  /** Server Bearer [REDACTED] memory only; never logged or returned. */
  apiKey: string;
  baseUrl: (typeof META_API_ALLOWLIST)[number];
  model: string;
  ffmpegPath: string;
}

export type MuseTranscribeEnv = Record<string, string | undefined>;

/**
 * Resolve server Muse transcribe configuration from environment names only.
 * Model override is META_TRANSCRIBE_MODEL (default
 * muse-voice-transcribe-1.0). The key is META_API_KEY with the official
 * MODEL_API_KEY value accepted as a fallback alias, exactly like the Meta
 * chat adapter. Throws MuseTranscribeError on any misconfiguration.
 */
export function resolveMuseTranscribeConfig(env: MuseTranscribeEnv): MuseTranscribeConfig {
  const trimmedBase = (env.META_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const candidate = trimmedBase.length === 0 ? META_API_ALLOWLIST[0] : trimmedBase;
  const baseUrl = (META_API_ALLOWLIST as readonly string[]).find((entry) => entry === candidate);
  if (!baseUrl) {
    throw new MuseTranscribeError(
      "SETUP_REQUIRED",
      503,
      "Meta API base URL is not allowlisted. The server must use https://api.meta.ai/v1.",
      false,
    );
  }
  const model = (env.META_TRANSCRIBE_MODEL ?? "").trim() || MUSE_TRANSCRIBE_DEFAULT_MODEL;
  if (CONTRIBUTOR_PATTERN.test(model)) {
    throw new MuseTranscribeError(
      "SETUP_REQUIRED",
      503,
      "Contributor model IDs are training opt-in and out of scope for walkthrough data. Configure the Standard-mode model.",
      false,
    );
  }
  const apiKey = (env.META_API_KEY ?? "").trim() || (env.MODEL_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new MuseTranscribeError(
      "SETUP_REQUIRED",
      503,
      "Live voice transcription is not configured on this server.",
      false,
    );
  }
  return {
    apiKey,
    baseUrl: baseUrl as (typeof META_API_ALLOWLIST)[number],
    model,
    ffmpegPath: (env.FFMPEG_PATH ?? "").trim() || "ffmpeg",
  };
}

function transcribeErrorForStatus(status: number): { code: MuseTranscribeErrorCode; http: 402 | 429 | 502; retryable: boolean } {
  if (status === 402) return { code: "QUOTA_EXCEEDED", http: 402, retryable: false };
  if (status === 429) return { code: "PROVIDER_FAILURE", http: 429, retryable: true };
  return { code: "PROVIDER_FAILURE", http: 502, retryable: status >= 500 };
}

export interface WavConvertDeps {
  spawnImpl?: typeof spawn;
  timeoutMs?: number;
}

/**
 * Convert validated mic-clip bytes to mono 24 kHz s16 WAV for the transcribe
 * endpoint, using the same server FFmpeg binary resolution as the video
 * pipeline (FFMPEG_PATH). Argument array only, never through a shell.
 */
export async function convertMicClipToWav(
  audio: Uint8Array,
  ffmpegPath: string,
  deps: WavConvertDeps = {},
): Promise<Uint8Array> {
  const spawnImpl = deps.spawnImpl ?? spawn;
  const timeoutMs = deps.timeoutMs ?? MUSE_TRANSCRIBE_CONVERT_TIMEOUT_MS;
  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;
    const fail = (error: MuseTranscribeError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {
        // The process already exited.
      }
      reject(error);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl(ffmpegPath, [...MUSE_TRANSCRIBE_FFMPEG_ARGS], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      settled = true;
      reject(new MuseTranscribeError(
        "SETUP_REQUIRED",
        503,
        "Server-side voice conversion is unavailable. Install the supported FFmpeg runtime or set server-only FFMPEG_PATH.",
        false,
      ));
      return;
    }
    const timer = setTimeout(
      () => fail(new MuseTranscribeError("PROVIDER_TIMEOUT", 504, "Voice conversion did not finish in time.", true)),
      timeoutMs,
    );
    timer.unref?.();
    const { stdin, stdout, stderr } = child;
    if (!stdin || !stdout || !stderr) {
      fail(new MuseTranscribeError("PROVIDER_FAILURE", 502, "The mic clip could not be converted for transcription.", false));
      return;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    let stderrBytes = 0;
    child.on("error", () => {
      fail(new MuseTranscribeError(
        "SETUP_REQUIRED",
        503,
        "Server-side voice conversion is unavailable. Install the supported FFmpeg runtime or set server-only FFMPEG_PATH.",
        false,
      ));
    });
    stdout.on("data", (chunk: Uint8Array) => {
      total += chunk.byteLength;
      if (total > MAX_CONVERTED_WAV_BYTES) {
        fail(new MuseTranscribeError("PROVIDER_FAILURE", 502, "The converted voice clip exceeded the supported size.", false));
        return;
      }
      chunks.push(chunk);
    });
    stderr.on("data", (chunk: Uint8Array) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_CONVERT_STDERR_BYTES) {
        stderr.pause?.();
      }
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new MuseTranscribeError("PROVIDER_FAILURE", 502, "The mic clip could not be converted for transcription.", false));
        return;
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (merged.byteLength === 0) {
        reject(new MuseTranscribeError("PROVIDER_FAILURE", 502, "The mic clip could not be converted for transcription.", false));
        return;
      }
      resolve(merged);
    });
    try {
      stdin.on("error", () => undefined);
      stdin.write(Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength));
      stdin.end();
    } catch {
      fail(new MuseTranscribeError("PROVIDER_FAILURE", 502, "The mic clip could not be converted for transcription.", false));
    }
  });
}

export interface MuseTranscription {
  text: string;
}

/**
 * Transcribe one mic clip via Muse Voice Transcribe: convert to WAV, then
 * POST the cookbook multipart body. Empty text means silence and is not a
 * failure. Any throw means the caller must use the flagged Fish fallback.
 */
export async function transcribeWithMuse(
  audio: Uint8Array,
  config: MuseTranscribeConfig,
  fetchImpl: typeof fetch = fetch,
  convertDeps: WavConvertDeps = {},
): Promise<MuseTranscription> {
  const wav = await convertMicClipToWav(audio, config.ffmpegPath, convertDeps);
  const requestPart = JSON.stringify({
    mode: MUSE_TRANSCRIBE_MODE,
    model: config.model,
    audioEncoding: "WAV",
  });
  const form = new FormData();
  form.append("request", new Blob([requestPart], { type: "application/json" }));
  form.append("audio", new File([wav], "audio.wav", { type: "audio/wav" }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MUSE_TRANSCRIBE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/asr/transcribe`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch {
    throw new MuseTranscribeError("PROVIDER_TIMEOUT", 504, "Muse voice transcription did not answer in time.", true);
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 403) {
    throw new MuseTranscribeError("SETUP_REQUIRED", 503, "Live voice transcription is not configured on this server.", false);
  }
  if (!response.ok) {
    const mapped = transcribeErrorForStatus(response.status);
    throw new MuseTranscribeError(mapped.code, mapped.http, "Muse voice transcription could not transcribe that clip.", mapped.retryable);
  }
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    throw new MuseTranscribeError("PROVIDER_FAILURE", 502, "Muse voice transcription returned an unreadable transcript.", true);
  }
  const transcript = typeof parsed === "object" && parsed !== null
    ? (parsed as { transcript?: unknown }).transcript
    : undefined;
  if (typeof transcript !== "string") {
    throw new MuseTranscribeError("PROVIDER_FAILURE", 502, "Muse voice transcription returned an unreadable transcript.", true);
  }
  return { text: transcript.slice(0, 2000) };
}
