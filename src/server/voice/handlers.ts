/**
 * Same-app voice request handlers. The Fish Audio key and voice id stay
 * server-side; routes only pass the browser's text or mic clip through.
 * Follows the video API's sender rule: a matching Origin/Referer, or the
 * same-app marker header when the proxy strips both (Azure ingress does).
 */
import { WALKTHROUGH_CLIENT_HEADER, WALKTHROUGH_CLIENT_ID } from "../../domain/walkthrough-client";
import {
  MAX_SPEAK_TEXT_LENGTH,
  MAX_TRANSCRIBE_BYTES,
  isFishCallError,
  resolveFishConfig,
  speakText,
  transcribeAudio,
} from "./fish";

export interface VoiceDeps {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetch?: typeof fetch;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHost(hostname: string): string {
  const host = hostname.trim().toLowerCase();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function senderIsSameApp(request: Request): boolean {
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (origin === null || origin.trim().length === 0) {
    return request.headers.get(WALKTHROUGH_CLIENT_HEADER) === WALKTHROUGH_CLIENT_ID;
  }
  try {
    const originUrl = new URL(origin);
    const targetUrl = new URL(request.url);
    if (originUrl.origin === targetUrl.origin) return true;
    return originUrl.protocol === targetUrl.protocol &&
      originUrl.port === targetUrl.port &&
      LOOPBACK_HOSTS.has(normalizeHost(originUrl.hostname)) &&
      LOOPBACK_HOSTS.has(normalizeHost(targetUrl.hostname));
  } catch {
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

export async function handleSpeakRequest(request: Request, deps: VoiceDeps = {}): Promise<Response> {
  if (!senderIsSameApp(request)) {
    return errorResponse("INVALID_REQUEST", "Send voice requests from this app.", 400);
  }
  let text: unknown = "";
  try {
    const body: unknown = await request.json();
    text = typeof body === "object" && body !== null ? (body as { text?: unknown }).text : "";
  } catch {
    return errorResponse("INVALID_REQUEST", "Send the text to speak as JSON.", 400);
  }
  if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_SPEAK_TEXT_LENGTH) {
    return errorResponse("INVALID_REQUEST", `Text must be 1–${MAX_SPEAK_TEXT_LENGTH} characters.`, 400);
  }
  try {
    const config = resolveFishConfig(deps.env ?? process.env);
    const { audio, contentType } = await speakText(text, config, deps.fetch ?? fetch);
    return new Response(audio, {
      status: 200,
      headers: { "content-type": contentType, "cache-control": "no-store" },
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
  if (!senderIsSameApp(request)) {
    return errorResponse("INVALID_REQUEST", "Send voice requests from this app.", 400);
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
  try {
    const config = resolveFishConfig(deps.env ?? process.env);
    const { text } = await transcribeAudio(bytes, "mic.webm", config, deps.fetch ?? fetch);
    return Response.json({ ok: true, text }, { status: 200 });
  } catch (error) {
    return fishErrorResponse(error);
  }
}
