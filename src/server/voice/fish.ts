/**
 * Server-only Fish Audio voice proxy (REQ-voice): text-to-speech for the
 * spoken guide and speech-to-text for voice answers. The API key never
 * leaves the server; the browser only sends short text and mic clips.
 *
 * REST contract (docs.fish.audio, inspected 2026-10-31):
 * - POST https://api.fish.audio/v1/tts, Bearer auth, `model` header
 *   (`s2.1-pro-free` free tier), JSON { text, reference_id, format }.
 * - POST https://api.fish.audio/v1/asr, Bearer auth, `model` header
 *   (`transcribe-1-pro`), multipart `audio` file -> JSON { text }.
 */

export type FishErrorCode =
  | "SETUP_REQUIRED"
  | "QUOTA_EXCEEDED"
  | "INVALID_REQUEST"
  | "PROVIDER_FAILURE"
  | "PROVIDER_TIMEOUT";

export class FishCallError extends Error {
  readonly code: FishErrorCode;
  readonly status: 400 | 402 | 429 | 502 | 503 | 504;
  readonly retryable: boolean;

  constructor(code: FishErrorCode, status: 400 | 402 | 429 | 502 | 503 | 504, message: string, retryable: boolean) {
    super(message);
    this.name = "FishCallError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function isFishCallError(value: unknown): value is FishCallError {
  return value instanceof FishCallError;
}

/** Fixed provider host; never derived from client input. */
export const FISH_API_BASE_URL = "https://api.fish.audio";

export interface FishConfig {
  apiKey: string;
  voiceId: string;
  ttsModel: string;
  asrModel: string;
}

export const MAX_SPEAK_TEXT_LENGTH = 500;
export const MAX_TRANSCRIBE_BYTES = 5 * 1024 * 1024;
export const MAX_TTS_RESPONSE_BYTES = 5 * 1024 * 1024;
const FISH_REQUEST_TIMEOUT_MS = 60_000;

export function resolveFishConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): FishConfig {
  const apiKey = (env.FISH_API_KEY ?? "").trim();
  const voiceId = (env.FISH_VOICE_ID ?? "").trim();
  if (!apiKey || !voiceId) {
    throw new FishCallError("SETUP_REQUIRED", 503, "Voice is not configured on this server.", false);
  }
  return {
    apiKey,
    voiceId,
    ttsModel: (env.FISH_MODEL ?? "").trim() || "s2.1-pro-free",
    asrModel: (env.FISH_ASR_MODEL ?? "").trim() || "transcribe-1-pro",
  };
}

function fishErrorForStatus(status: number): { code: FishErrorCode; http: 402 | 429 | 502; retryable: boolean } {
  if (status === 402) return { code: "QUOTA_EXCEEDED", http: 402, retryable: false };
  if (status === 429) return { code: "PROVIDER_FAILURE", http: 429, retryable: true };
  return { code: "PROVIDER_FAILURE", http: 502, retryable: status >= 500 };
}

async function readCappedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    const direct = new Uint8Array(await response.arrayBuffer());
    if (direct.byteLength > maxBytes) throw new FishCallError("PROVIDER_FAILURE", 502, "The voice provider returned too much audio.", false);
    return direct;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FishCallError("PROVIDER_FAILURE", 502, "The voice provider returned too much audio.", false);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

async function fishFetch(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    return response;
  } catch (error) {
    if (error instanceof FishCallError) throw error;
    throw new FishCallError("PROVIDER_TIMEOUT", 504, "The voice provider did not answer in time.", true);
  } finally {
    clearTimeout(timer);
  }
}

/** Synthesize speech; returns MP3 bytes. Text is validated by the caller. */
export async function speakText(
  text: string,
  config: FishConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ audio: Uint8Array; contentType: string }> {
  const response = await fishFetch(
    `${FISH_API_BASE_URL}/v1/tts`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        model: config.ttsModel,
      },
      body: JSON.stringify({
        text,
        reference_id: config.voiceId,
        format: "mp3",
        mp3_bitrate: 128,
        normalize: true,
        latency: "normal",
      }),
    },
    fetchImpl,
    FISH_REQUEST_TIMEOUT_MS,
  );
  if (response.status === 401 || response.status === 403) {
    throw new FishCallError("SETUP_REQUIRED", 503, "Voice is not configured on this server.", false);
  }
  if (!response.ok) {
    const mapped = fishErrorForStatus(response.status);
    throw new FishCallError(mapped.code, mapped.http, "The voice provider could not speak that text.", mapped.retryable);
  }
  const audio = await readCappedBytes(response, MAX_TTS_RESPONSE_BYTES);
  if (audio.byteLength === 0) {
    throw new FishCallError("PROVIDER_FAILURE", 502, "The voice provider returned no audio.", true);
  }
  return { audio, contentType: "audio/mpeg" };
}

export interface Transcription {
  text: string;
}

/** Transcribe one mic clip; bytes are validated by the caller. */
export async function transcribeAudio(
  audio: Uint8Array,
  filename: string,
  config: FishConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Transcription> {
  const form = new FormData();
  form.append("audio", new File([audio], filename, { type: "audio/webm" }));
  form.append("language", "en");
  form.append("ignore_timestamps", "true");
  const response = await fishFetch(
    `${FISH_API_BASE_URL}/v1/asr`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        model: config.asrModel,
      },
      body: form,
    },
    fetchImpl,
    FISH_REQUEST_TIMEOUT_MS,
  );
  if (response.status === 401 || response.status === 403) {
    throw new FishCallError("SETUP_REQUIRED", 503, "Voice is not configured on this server.", false);
  }
  if (!response.ok) {
    const mapped = fishErrorForStatus(response.status);
    throw new FishCallError(mapped.code, mapped.http, "The voice provider could not transcribe that clip.", mapped.retryable);
  }
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    throw new FishCallError("PROVIDER_FAILURE", 502, "The voice provider returned an unreadable transcript.", true);
  }
  const text = typeof parsed === "object" && parsed !== null
    ? (parsed as { text?: unknown }).text
    : undefined;
  if (typeof text !== "string") {
    throw new FishCallError("PROVIDER_FAILURE", 502, "The voice provider returned an unreadable transcript.", true);
  }
  return { text: text.slice(0, 2000) };
}
