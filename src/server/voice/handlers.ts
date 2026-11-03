/**
 * Same-app voice request handlers. The Fish Audio key and voice id stay
 * server-side; routes only pass the browser's text or mic clip through.
 * Follows the video API's sender rule: a matching Origin/Referer, or the
 * same-app marker header when the proxy strips both (Azure ingress does).
 */
import { createHash } from "node:crypto";

import { WALKTHROUGH_CLIENT_HEADER, WALKTHROUGH_CLIENT_ID } from "../../domain/walkthrough-client";
import {
  FishCallError,
  MAX_SPEAK_TEXT_LENGTH,
  MAX_TRANSCRIBE_BYTES,
  isFishCallError,
  resolveFishConfig,
  resolveFishConfigForLanguage,
  speakText,
  transcribeAudio,
} from "./fish";
import {
  resolveMuseTranscribeConfig,
  transcribeWithMuse,
  type MuseTranscribeConfig,
  type MuseTranscription,
} from "./muse-transcribe";

export interface VoiceDeps {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetch?: typeof fetch;
  /**
   * Test seam for the Muse ASR path (production uses transcribeWithMuse,
   * which converts the clip with server FFmpeg before posting).
   */
  transcribeWithMuse?: (
    audio: Uint8Array,
    config: MuseTranscribeConfig,
    fetchImpl?: typeof fetch,
  ) => Promise<MuseTranscription>;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHost(hostname: string): string {
  const host = hostname.trim().toLowerCase();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function senderIsSameApp(request: Request, configuredPublicOrigin?: string): boolean {
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (origin === null || origin.trim().length === 0) {
    return request.headers.get(WALKTHROUGH_CLIENT_HEADER) === WALKTHROUGH_CLIENT_ID;
  }
  try {
    const originUrl = new URL(origin);
    const targetUrl = new URL(request.url);
    if (originUrl.origin === targetUrl.origin) return true;
    // Managed ingress (Azure Container Apps) serves an internal request
    // URL behind the public origin: trust the configured public origin
    // too, exactly like the video API. A malformed value fails loudly so
    // voice can never silently degrade to the device fallback again.
    const publicOrigin = configuredPublicOrigin?.trim().replace(/\/$/, "");
    if (publicOrigin) {
      let configured: URL;
      try {
        configured = new URL(publicOrigin);
      } catch {
        throw new FishCallError("SETUP_REQUIRED", 503, "The public app origin must be an HTTP(S) origin without a path.", false);
      }
      if ((configured.protocol !== "https:" && configured.protocol !== "http:") ||
          configured.origin !== publicOrigin) {
        throw new FishCallError("SETUP_REQUIRED", 503, "The public app origin must be an HTTP(S) origin without a path.", false);
      }
      if (originUrl.origin === configured.origin) return true;
    }
    return originUrl.protocol === targetUrl.protocol &&
      originUrl.port === targetUrl.port &&
      LOOPBACK_HOSTS.has(normalizeHost(originUrl.hostname)) &&
      LOOPBACK_HOSTS.has(normalizeHost(targetUrl.hostname));
  } catch (error) {
    if (isFishCallError(error)) throw error;
    return false;
  }
}

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

function fishErrorResponse(error: unknown): Response {
  if (isFishCallError(error)) {
    const code = error.code === "QUOTA_EXCEEDED" ? "QUOTA_EXCEEDED"
      : error.code === "SETUP_REQUIRED" ? "SETUP_REQUIRED"
        : error.code === "PROVIDER_TIMEOUT" ? "PROVIDER_TIMEOUT"
          : "PROVIDER_FAILURE";
    return errorResponse(code, error.message, error.status);
  }
  return errorResponse("PROVIDER_FAILURE", "Voice processing did not complete.", 502);
}

/**
 * Speech cache for dynamic prompts (film-room position, live proofs,
 * review-item excerpts): same text + voice + model always synthesizes the
 * same bytes, so repeats serve instantly without a provider call. Static
 * script clips never reach this path — the client plays pre-generated
 * files first. Bounded LRU-ish FIFO, failures never cached.
 */
const SPEAK_CACHE_MAX_BYTES = 16 * 1024 * 1024;

interface CachedSpeech {
  audio: Uint8Array;
  contentType: string;
}

const speakCache = new Map<string, CachedSpeech>();
let speakCacheBytes = 0;

/** Test-only reset for the speech cache. */
export function __resetSpeakCacheForTests(): void {
  speakCache.clear();
  speakCacheBytes = 0;
}

function speakCacheKey(text: string, voiceId: string, ttsModel: string): string {
  return createHash("sha256").update(`${voiceId}\n${ttsModel}\n${text}`, "utf8").digest("hex");
}

function speakCacheGet(key: string): CachedSpeech | null {
  const hit = speakCache.get(key);
  if (!hit) return null;
  speakCache.delete(key);
  speakCache.set(key, hit);
  return hit;
}

function speakCacheSet(key: string, entry: CachedSpeech): void {
  const existing = speakCache.get(key);
  if (existing) speakCacheBytes -= existing.audio.byteLength;
  speakCache.delete(key);
  speakCache.set(key, entry);
  speakCacheBytes += entry.audio.byteLength;
  while (speakCacheBytes > SPEAK_CACHE_MAX_BYTES && speakCache.size > 1) {
    const oldest = speakCache.keys().next();
    if (oldest.done) break;
    const removed = speakCache.get(oldest.value);
    if (!removed) break;
    speakCache.delete(oldest.value);
    speakCacheBytes -= removed.audio.byteLength;
  }
}

export async function handleSpeakRequest(request: Request, deps: VoiceDeps = {}): Promise<Response> {
  try {
    if (!senderIsSameApp(request, (deps.env ?? process.env).APP_PUBLIC_ORIGIN)) {
      return errorResponse("INVALID_REQUEST", "Send voice requests from this app.", 400);
    }
  } catch (error) {
    return fishErrorResponse(error);
  }
  let text: unknown = "";
  let language: unknown = "en";
  try {
    const body: unknown = await request.json();
    text = typeof body === "object" && body !== null ? (body as { text?: unknown }).text : "";
    language = typeof body === "object" && body !== null && "language" in body
      ? (body as { language?: unknown }).language
      : "en";
  } catch {
    return errorResponse("INVALID_REQUEST", "Send the text to speak as JSON.", 400);
  }
  if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_SPEAK_TEXT_LENGTH) {
    return errorResponse("INVALID_REQUEST", `Text must be 1–${MAX_SPEAK_TEXT_LENGTH} characters.`, 400);
  }
  if (language === undefined) language = "en";
  if (language !== "en" && language !== "es") {
    return errorResponse("INVALID_REQUEST", "Language must be en or es.", 400);
  }
  try {
    const config = resolveFishConfigForLanguage(deps.env ?? process.env, language);
    const key = speakCacheKey(text, config.voiceId, config.ttsModel);
    const cached = speakCacheGet(key);
    if (cached) {
      return new Response(cached.audio, {
        status: 200,
        headers: { "content-type": cached.contentType, "cache-control": "public, max-age=31536000, immutable" },
      });
    }
    const { audio, contentType } = await speakText(text, config, deps.fetch ?? fetch);
    speakCacheSet(key, { audio, contentType });
    return new Response(audio, {
      status: 200,
      headers: { "content-type": contentType, "cache-control": "public, max-age=31536000, immutable" },
    });
  } catch (error) {
    return fishErrorResponse(error);
  }
}

function sniffAudio(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const head = Array.from(bytes.slice(0, 12));
  // WebM/Matroska EBML, WAV RIFF....WAVE, OggS, MP4 ftyp, MP3 ID3/frame sync, M4A ftyp.
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true;
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) return true;
  if (head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) return true;
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return true;
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return true;
  if (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) return true;
  return false;
}

export async function handleTranscribeRequest(request: Request, deps: VoiceDeps = {}): Promise<Response> {
  try {
    if (!senderIsSameApp(request, (deps.env ?? process.env).APP_PUBLIC_ORIGIN)) {
      return errorResponse("INVALID_REQUEST", "Send voice requests from this app.", 400);
    }
  } catch (error) {
    return fishErrorResponse(error);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("INVALID_REQUEST", "Send one mic clip as multipart audio.", 400);
  }
  const keys = Array.from(form.keys());
  if (keys.length !== 1 || keys[0] !== "audio") {
    return errorResponse("INVALID_REQUEST", "Send one mic clip as multipart audio.", 400);
  }
  const file = form.get("audio");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_TRANSCRIBE_BYTES) {
    return errorResponse("INVALID_REQUEST", "The mic clip must be 1 byte–5 MiB.", 400);
  }
  if (file.type && !file.type.startsWith("audio/")) {
    return errorResponse("INVALID_REQUEST", "The mic clip must be audio.", 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffAudio(bytes)) {
    return errorResponse("INVALID_REQUEST", "The mic clip is not recognized audio.", 400);
  }
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? fetch;
  const provider = (env.VOICE_ASR_PROVIDER ?? "muse").trim().toLowerCase();
  if (provider !== "muse" && provider !== "fish") {
    return errorResponse("SETUP_REQUIRED", "The server voice transcription provider is not configured.", 503);
  }
  if (provider === "fish") {
    try {
      const config = resolveFishConfig(env);
      const { text } = await transcribeAudio(bytes, "mic.webm", config, fetchImpl);
      return Response.json({ ok: true, text, providerUsed: "fish" }, { status: 200 });
    } catch (error) {
      return fishErrorResponse(error);
    }
  }
  // Default Muse ASR with a flagged Fish fallback: any Muse failure (HTTP,
  // timeout, conversion, or missing Meta credentials) retries once against
  // Fish, and providerUsed tells the client which engine answered so the
  // fallback is surfaced, never silent.
  try {
    const museConfig = resolveMuseTranscribeConfig(env);
    const museImpl = deps.transcribeWithMuse ?? transcribeWithMuse;
    const { text } = await museImpl(bytes, museConfig, fetchImpl);
    return Response.json({ ok: true, text, providerUsed: "muse" }, { status: 200 });
  } catch {
    try {
      const fishConfig = resolveFishConfig(env);
      const { text } = await transcribeAudio(bytes, "mic.webm", fishConfig, fetchImpl);
      return Response.json({ ok: true, text, providerUsed: "fish" }, { status: 200 });
    } catch (error) {
      return fishErrorResponse(error);
    }
  }
}
