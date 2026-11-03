/**
 * Case-note wording polish (REQ-E2, optional).
 *
 * POST /api/exports/polish-case-note accepts the deterministic case-note
 * template and, only when `TEXT_POLISH_ENABLED=1` (default off), asks
 * Muse Spark to polish the wording without adding facts. Every other
 * outcome — flag off, missing credentials, provider failure, timeout,
 * or unusable output — returns the template unchanged with
 * `polished: false`, so the caller always has safe text to download.
 *
 * Trust rules: server-only (the key never leaves this module), the base
 * URL must pass the existing Meta allowlist, and no key material or
 * provider body is logged or returned.
 */

import {
  META_API_ALLOWLIST,
  resolveMetaConfig,
  type FetchImpl,
  type MetaEnv,
} from "../meta/adapter";

export const TEXT_POLISH_TIMEOUT_MS = 30_000;
const MAX_TEMPLATE_CHARS = 16_384;
const MAX_REQUEST_BYTES = 24_576;
const MAX_POLISHED_CHARS = 32_768;

const POLISH_INSTRUCTIONS =
  "Polish the wording of a housing case-note draft for clarity and plain " +
  "language, without adding facts. Rewrite the wording only: never add, " +
  "remove, or change facts, names, dates, determinations, element " +
  "outcomes, corrections, or deadlines. " +
  "Keep every line of the original note, including the draft label, the " +
  "determination, each element line, the evaluator and participant names, " +
  "and, when present, the deficiency details and re-inspection sentence. " +
  "Return only the polished note text, no preamble or explanation.";

export interface PolishCaseNoteDeps {
  metaEnv?: MetaEnv;
  fetchImpl?: FetchImpl;
}

export function isTextPolishEnabled(env: MetaEnv): boolean {
  return env.TEXT_POLISH_ENABLED === "1";
}

function failure(status: number, code: string, message: string) {
  return { status, body: { error: { code, message } } };
}

function templateResult(text: string) {
  return { status: 200, body: { text, polished: false as const } };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeOriginHost(hostname: string): string {
  const host = hostname.trim().toLowerCase();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null || origin.trim().length === 0) return true;
  try {
    const originUrl = new URL(origin);
    const targetUrl = new URL(request.url);
    if (originUrl.origin === targetUrl.origin) return true;
    return originUrl.protocol === targetUrl.protocol &&
      originUrl.port === targetUrl.port &&
      LOOPBACK_HOSTS.has(normalizeOriginHost(originUrl.hostname)) &&
      LOOPBACK_HOSTS.has(normalizeOriginHost(targetUrl.hostname));
  } catch {
    return false;
  }
}

function parseRequest(value: unknown): { text: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.text !== "string") return null;
  if (record.text.length === 0 || record.text.length > MAX_TEMPLATE_CHARS) return null;
  if (record.text.trim().length === 0) return null;
  return { text: record.text };
}

function extractContentText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown })?.message as
    | { content?: unknown }
    | undefined;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part === "object" && part !== null ? (part as { text?: unknown }).text : null))
      .filter((entry): entry is string => typeof entry === "string")
      .join("");
    return text.length > 0 ? text : null;
  }
  return null;
}

async function polishWithMeta(
  template: string,
  env: MetaEnv,
  fetchImpl: FetchImpl,
): Promise<string | null> {
  let config: ReturnType<typeof resolveMetaConfig>;
  try {
    config = resolveMetaConfig(env);
  } catch {
    return null;
  }
  if (config.apiKey === null || config.apiKey.length === 0) return null;
  const url = `${config.baseUrl}/chat/completions`;
  if (!(META_API_ALLOWLIST as readonly string[]).some((entry) => url === `${entry}/chat/completions`)) {
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEXT_POLISH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "developer", content: POLISH_INSTRUCTIONS },
          { role: "user", content: template },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const polished = extractContentText(payload);
    if (!polished || polished.trim().length === 0 || polished.length > MAX_POLISHED_CHARS) {
      return null;
    }
    return polished;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** POST /api/exports/polish-case-note: polish wording, or return the template. */
export async function handlePolishCaseNoteRequest(
  request: Request,
  deps: PolishCaseNoteDeps = {},
): Promise<{ status: number; body: unknown }> {
  if (!sameOrigin(request)) return failure(403, "ORIGIN_FORBIDDEN", "Cross-origin requests are rejected.");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return failure(400, "INVALID_REQUEST", "Send the case-note template as JSON.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return failure(413, "INVALID_REQUEST", "The polish request is too large.");
  }
  let raw: string;
  try {
    const reader = request.body?.getReader();
    if (!reader) return failure(400, "INVALID_REQUEST", "The polish request has no body.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.length;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return failure(413, "INVALID_REQUEST", "The polish request is too large.");
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    raw = new TextDecoder().decode(bytes);
  } catch {
    return failure(400, "INVALID_REQUEST", "The polish request could not be read.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failure(400, "INVALID_REQUEST", "The polish request is not valid JSON.");
  }
  const input = parseRequest(parsed);
  if (!input) return failure(400, "INVALID_REQUEST", "Send the case-note template text to polish.");

  const env = deps.metaEnv ?? process.env;
  if (!isTextPolishEnabled(env)) return templateResult(input.text);

  const fetchImpl: FetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  const polished = await polishWithMeta(input.text, env, fetchImpl);
  if (polished === null) return templateResult(input.text);
  let model = "muse-spark-1.3";
  try {
    model = resolveMetaConfig(env).model;
  } catch {
    // Model label is best-effort; the polished text already succeeded.
  }
  return { status: 200, body: { text: polished, polished: true as const, model } };
}
