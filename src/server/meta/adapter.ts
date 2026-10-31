/**
 * Server-only Meta (Muse Spark) adapter plus the explicit fixture adapter
 * (REQ-003, REQ-010).
 *
 * Trust rules enforced here:
 * - Keys never leave the server: the Authorization header is built here, and
 *   no helper returns, logs, or echoes the key, any key-presence signal,
 *   or any provider body. Use describeConfigForLog() for diagnostics
 *   (mode and endpoint only).
 * - The base URL must equal the allowlisted Meta endpoint exactly; anything
 *   else is a setup failure, never a silent fallback.
 * - Mode is explicit and server-side (APP_ANALYSIS_MODE=live|fixture).
 *   Unknown modes and missing live credentials fail closed with
 *   SETUP_REQUIRED; a failed live call never falls back to fixture output.
 * - Contributor model IDs (training opt-in) are rejected for any pilot or
 *   tenant-adjacent data path.
 * - Model text is untrusted: provider JSON is parsed then strictly validated
 *   with validateAnalysisDraft before it can become a draft.
 *
 * Contract source: docs/integration/FORM_1083_MAPPING.md §2 (accessed
 * 2026-10-27). Endpoint POST {base}/chat/completions, model muse-spark-1.3,
 * images as user-role image_url data URLs, strict json_schema output.
 */
import { validateAnalysisDraft, type AnalysisDraft, type AnalysisMode } from "../../domain/evidence";
import {
  validateGuideDraft,
  type GuideAction,
  type GuideDraft,
  type GuideStage,
} from "../../domain/guide";
import type { AllowedImageMime } from "../media/validate";

/** Exact allowlist for the Meta Model API base URL (REQ-010). */
export const META_API_ALLOWLIST = ["https://api.meta.ai/v1"] as const;

export const DEFAULT_META_MODEL = "muse-spark-1.3";

/** Single-session analysis budget: 45 seconds including provider round trip. */
export const META_TIMEOUT_MS = 45_000;
const MAX_META_RESPONSE_BYTES = 64 * 1024;

const CONTRIBUTOR_PATTERN = /contributor/i;

export type MetaErrorCode =
  | "SETUP_REQUIRED"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_MODEL_OUTPUT";

/** Safe, client-shareable provider failure. Never carries keys or bodies. */
export class MetaCallError extends Error {
  readonly code: MetaErrorCode;
  /** HTTP status the route must use for this failure. */
  readonly status: 429 | 502 | 503 | 504;
  /** True when the worker may explicitly retry once (never automatic). */
  readonly retryable: boolean;

  constructor(code: MetaErrorCode, status: 429 | 502 | 503 | 504, message: string, retryable: boolean) {
    super(message);
    this.name = "MetaCallError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function isMetaCallError(value: unknown): value is MetaCallError {
  return value instanceof MetaCallError;
}

function setupFailure(message: string): MetaCallError {
  return new MetaCallError("SETUP_REQUIRED", 503, message, false);
}

export interface ResolvedMetaConfig {
  /** Server bearer value. Present only in memory; never logged or returned. */
  apiKey: string | null;
  model: string;
  baseUrl: (typeof META_API_ALLOWLIST)[number];
  mode: AnalysisMode;
  keySource: "META_API_KEY" | "MODEL_API_KEY" | null;
}

export type MetaEnv = Record<string, string | undefined>;

/**
 * Parse the explicit server analysis mode. Missing/blank defaults to
 * "fixture" (the safe, keyless default also used by the walkthrough page);
 * any other value is null so the caller fails closed instead of guessing.
 */
export function parseAnalysisMode(value: string | undefined): AnalysisMode | null {
  if (value === undefined || value.trim().length === 0) return "fixture";
  if (value === "live" || value === "fixture") return value;
  return null;
}

function normalizeBaseUrl(value: string | undefined): (typeof META_API_ALLOWLIST)[number] {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  const candidate = trimmed.length === 0 ? META_API_ALLOWLIST[0] : trimmed;
  const allowed = (META_API_ALLOWLIST as readonly string[]).find((entry) => entry === candidate);
  if (!allowed) {
    throw setupFailure(
      "Meta API base URL is not allowlisted. The server must use https://api.meta.ai/v1.",
    );
  }
  return allowed as (typeof META_API_ALLOWLIST)[number];
}

/**
 * Resolve server Meta configuration from environment names only (values stay
 * server-side). Canonical bearer name is META_API_KEY; the official
 * MODEL_API_KEY value is accepted as a fallback alias (documented in
 * docs/integration/FORM_1083_MAPPING.md §2.1). Throws MetaCallError on any
 * misconfiguration so misconfig fails closed at request time.
 */
export function resolveMetaConfig(env: MetaEnv): ResolvedMetaConfig {
  const mode = parseAnalysisMode(env.APP_ANALYSIS_MODE);
  if (mode === null) {
    throw setupFailure(
      'Server analysis mode is not configured (APP_ANALYSIS_MODE must be "live" or "fixture").',
    );
  }
  const baseUrl = normalizeBaseUrl(env.META_API_BASE_URL);
  const model = (env.META_MODEL ?? "").trim() || DEFAULT_META_MODEL;
  if (CONTRIBUTOR_PATTERN.test(model)) {
    throw setupFailure(
      "Contributor model IDs are training opt-in and out of scope for walkthrough data. Configure the Standard-mode model.",
    );
  }
  const fromMeta = (env.META_API_KEY ?? "").trim();
  const fromOfficial = (env.MODEL_API_KEY ?? "").trim();
  const apiKey = fromMeta.length > 0 ? fromMeta : fromOfficial.length > 0 ? fromOfficial : null;
  const keySource = fromMeta.length > 0
    ? ("META_API_KEY" as const)
    : fromOfficial.length > 0
      ? ("MODEL_API_KEY" as const)
      : null;
  return { apiKey, model, baseUrl, mode, keySource };
}

/** Fail closed when a live call has no credentials (never fall back silently). */
export function requireLiveConfig(config: ResolvedMetaConfig): asserts config is ResolvedMetaConfig & { apiKey: string } {
  if (config.apiKey === null || config.apiKey.length === 0) {
    throw setupFailure(
      "Live analysis is not configured on this server (missing Meta credentials). No live call was attempted.",
    );
  }
}

/** Diagnostics-safe config description: mode and endpoint only. Carries no
 * key material and no key-presence signal so serialized output never
 * indicates whether credentials are configured. */
export function describeConfigForLog(config: ResolvedMetaConfig): {
  mode: AnalysisMode;
  baseUrl: string;
} {
  return {
    mode: config.mode,
    baseUrl: config.baseUrl,
  };
}

export interface ChatCompletionsImageInput {
  model: string;
  itemLabel: string;
  captureGuidance: string;
  imageMime: AllowedImageMime;
  imageBase64: string;
}

export interface ChatCompletionsGuideInput {
  model: string;
  action: GuideAction;
  stage: GuideStage;
  itemLabel: string;
  captureGuidance: string;
  manualCheck: string;
}

const GUIDE_DEVELOPER_INSTRUCTIONS =
  "You are a practical guide for a housing worker using LAHSA Form 1083. " +
  "Give the next procedural step for the selected area using only the supplied catalog guidance and progress stage. " +
  "Never judge habitability, compliance, pass/fail, deficiency, safety, eligibility, or approval. " +
  "Do not invent inspection rules, physical tests, deadlines, or sign-offs. " +
  "The worker makes all decisions. Do not ask for or echo identifying information. " +
  "Return JSON only: a concise message and one to three short actions. Avoid inspection-verdict wording.";

const GUIDE_ACTION_LABELS: Record<GuideAction, string> = {
  next: "Explain the worker's next step",
  photo: "Give photo-framing tips",
  check: "Explain the required in-person check",
  correction: "Explain how to record a worker correction",
};

/** Build a text-only guide request; it contains no photos or session data. */
export function buildChatCompletionsGuidePayload(
  input: ChatCompletionsGuideInput,
): Record<string, unknown> {
  return {
    model: input.model,
    messages: [
      { role: "developer", content: GUIDE_DEVELOPER_INSTRUCTIONS },
      {
        role: "user",
        content:
          `Area: ${input.itemLabel}. Progress: ${input.stage}. ` +
          `Requested help: ${GUIDE_ACTION_LABELS[input.action]}. ` +
          `Capture guidance: ${input.captureGuidance}. ` +
          `Required in-person check: ${input.manualCheck}. ` +
          "Create a brief, state-aware response and action card.",
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "WalkthroughGuideDraft",
        strict: true,
        schema: {
          type: "object",
          properties: {
            message: { type: "string" },
            actionPlan: { type: "array", items: { type: "string" } },
          },
          required: ["message", "actionPlan"],
          additionalProperties: false,
        },
      },
    },
  };
}

const DEVELOPER_INSTRUCTIONS =
  "You are preparing a neutral visual observation for a housing walkthrough draft. " +
  "Describe only what is visible in the single photo. " +
  "Never judge habitability, compliance, pass/fail, deficiency, or approval. " +
  "Never invent measurements, readings, sounds, smells, or motion. " +
  "Respond with strict JSON matching the provided schema: observation (1-600 characters), " +
  "visibleEvidence (0-5 strings, each at most 200 characters), " +
  "unknowns (0-5 strings, each at most 200 characters), " +
  "suggestedManualChecks (0-5 strings, each at most 200 characters). " +
  "If the image is unclear, say so in unknowns. At least one of visibleEvidence, " +
  "unknowns, or suggestedManualChecks must be non-empty.";

/**
 * Build the Chat Completions payload: one image as a user-role image_url
 * data URL plus strict json_schema output for the neutral AnalysisDraft.
 * Server-normalized data: bytes only; client URLs are never accepted here
 * (there is no URL field to fill).
 */
export function buildChatCompletionsPayload(input: ChatCompletionsImageInput): Record<string, unknown> {
  const itemContext =
    `Item: ${input.itemLabel}. Capture context: ${input.captureGuidance}. ` +
    "Describe the visible state of this item in the single photo as strict JSON.";
  return {
    model: input.model,
    messages: [
      { role: "developer", content: DEVELOPER_INSTRUCTIONS },
      {
        role: "user",
        content: [
          { type: "text", text: itemContext },
          {
            type: "image_url",
            image_url: { url: `data:${input.imageMime};base64,${input.imageBase64}` },
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "AnalysisDraft",
        strict: true,
        schema: {
          type: "object",
          properties: {
            observation: { type: "string" },
            visibleEvidence: { type: "array", items: { type: "string" } },
            unknowns: { type: "array", items: { type: "string" } },
            suggestedManualChecks: { type: "array", items: { type: "string" } },
          },
          required: ["observation", "visibleEvidence", "unknowns", "suggestedManualChecks"],
          additionalProperties: false,
        },
      },
    },
  };
}

export type FetchImpl = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal | null;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body?: ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
}>;

export interface MetaCallParams {
  config: ResolvedMetaConfig & { apiKey: string };
  itemLabel: string;
  captureGuidance: string;
  imageMime: AllowedImageMime;
  imageBase64: string;
  signal?: AbortSignal | null;
  fetchImpl?: FetchImpl;
  now?: () => number;
}

export interface MetaCallSuccess {
  draft: AnalysisDraft;
  model: string;
  mode: "live";
  requestId: string;
  latencyMs: number;
}

export interface MetaGuideSuccess {
  guide: GuideDraft;
  model: string;
  mode: "live";
  requestId: string;
  latencyMs: number;
}

function timeoutFailure(): MetaCallError {
  return new MetaCallError(
    "PROVIDER_TIMEOUT",
    504,
    "The analysis timed out or was cancelled. The photo is kept; retry once if the attempt is still current.",
    true,
  );
}

function isAbort(error: unknown, signal?: AbortSignal | null): boolean {
  if (signal?.aborted) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
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

function extractRequestId(payload: unknown, headers: { get(name: string): string | null }): string {
  const headerId = headers.get("x-request-id") ?? headers.get("request-id");
  if (typeof headerId === "string" && headerId.trim().length > 0) return headerId.trim();
  if (typeof payload === "object" && payload !== null) {
    const bodyId = (payload as { id?: unknown }).id;
    if (typeof bodyId === "string" && bodyId.trim().length > 0) return bodyId.trim();
  }
  return `req-${Date.now().toString(36)}`;
}

/** Bound provider response parsing before JSON decoding and schema validation. */
async function readBoundedJson(response: Awaited<ReturnType<FetchImpl>>): Promise<unknown> {
  // The optional fallback preserves lightweight test adapters; native fetch
  // responses always expose a body and are read through the byte limit below.
  if (!response.body) return response.json();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_META_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Provider response exceeded the supported size.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

/**
 * Call the allowlisted Meta endpoint with the server key. Maps provider
 * outcomes to safe client codes; throws MetaCallError (never the raw body).
 * Aborts (timeout or client cancellation) surface as PROVIDER_TIMEOUT.
 */
export async function callMetaDraft(params: MetaCallParams): Promise<MetaCallSuccess> {
  const fetchImpl: FetchImpl = params.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  const startedAt = (params.now ?? Date.now)();
  const url = `${params.config.baseUrl}/chat/completions`;
  if (!(META_API_ALLOWLIST as readonly string[]).some((entry) => url === `${entry}/chat/completions`)) {
    throw setupFailure("Meta API base URL is not allowlisted.");
  }
  const payload = buildChatCompletionsPayload({
    model: params.config.model,
    itemLabel: params.itemLabel,
    captureGuidance: params.captureGuidance,
    imageMime: params.imageMime,
    imageBase64: params.imageBase64,
  });
  let response: Awaited<ReturnType<FetchImpl>>;
  try {
    const signal = params.signal ?? null;
    if (signal?.aborted) {
      throw timeoutFailure();
    }
    const pending = fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: signal,
    });
    if (signal === null) {
      response = await pending;
    } else {
      // Surface cancellation promptly even when the fetch implementation
      // ignores the signal (no 45s-budget wait, no automatic retry).
      let onAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = (): void => {
          reject(timeoutFailure());
        };
        signal.addEventListener("abort", onAbort, { once: true });
      });
      // Avoid an unhandled rejection from the losing fetch promise after
      // the abort race settles.
      pending.catch(() => undefined);
      try {
        response = await Promise.race([pending, aborted]);
      } finally {
        if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
      }
    }
  } catch (error: unknown) {
    if (error instanceof MetaCallError && error.code === "PROVIDER_TIMEOUT") {
      throw error;
    }
    if (isAbort(error, params.signal)) {
      throw timeoutFailure();
    }
    throw new MetaCallError(
      "PROVIDER_UNAVAILABLE",
      502,
      "The provider is unavailable or returned an error. The photo is kept; retry once if the attempt is still current.",
      true,
    );
  }
  const latencyMs = Math.max(0, (params.now ?? Date.now)() - startedAt);
  if (response.status === 429) {
    throw new MetaCallError(
      "PROVIDER_RATE_LIMIT",
      429,
      "The provider is throttling requests. Wait and retry once; no automatic retry was made.",
      true,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw setupFailure(
      "Live analysis credentials were rejected by the provider. Ask the operator to check the server key; no draft was produced.",
    );
  }
  if (response.status === 400) {
    throw new MetaCallError(
      "PROVIDER_UNAVAILABLE",
      502,
      "The provider rejected the analysis request. The photo is kept; retry once if the attempt is still current.",
      true,
    );
  }
  if (!response.ok) {
    throw new MetaCallError(
      "PROVIDER_UNAVAILABLE",
      502,
      "The provider is unavailable or returned an error. The photo is kept; retry once if the attempt is still current.",
      true,
    );
  }
  let body: unknown;
  try {
    body = await readBoundedJson(response);
  } catch {
    throw new MetaCallError(
      "INVALID_MODEL_OUTPUT",
      502,
      "The provider returned output that failed strict validation. The photo is kept; retry once if the attempt is still current.",
      true,
    );
  }
  const content = extractContentText(body);
  if (content === null) {
    throw new MetaCallError(
      "INVALID_MODEL_OUTPUT",
      502,
      "The provider returned output that failed strict validation. The photo is kept; retry once if the attempt is still current.",
      true,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new MetaCallError(
      "INVALID_MODEL_OUTPUT",
      502,
      "The provider returned output that failed strict validation. The photo is kept; retry once if the attempt is still current.",
      true,
    );
  }
  const draft = validateAnalysisDraft(parsed);
  if (!draft.ok) {
    throw new MetaCallError(
      "INVALID_MODEL_OUTPUT",
      502,
      "The provider returned output that failed strict validation. The photo is kept; retry once if the attempt is still current.",
      true,
    );
  }
  return {
    draft: draft.value,
    model: params.config.model,
    mode: "live",
    requestId: extractRequestId(body, response.headers),
    latencyMs,
  };
}

/** A bounded, text-only guide call. No photo, worker note, or session ID is sent. */
export async function callMetaGuide(params: {
  config: ResolvedMetaConfig & { apiKey: string };
  action: GuideAction;
  stage: GuideStage;
  itemLabel: string;
  captureGuidance: string;
  manualCheck: string;
  signal?: AbortSignal | null;
  fetchImpl?: FetchImpl;
  now?: () => number;
}): Promise<MetaGuideSuccess> {
  const fetchImpl = params.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  const startedAt = (params.now ?? Date.now)();
  const url = `${params.config.baseUrl}/chat/completions`;
  if (!(META_API_ALLOWLIST as readonly string[]).some((entry) => url === `${entry}/chat/completions`)) {
    throw setupFailure("Meta API base URL is not allowlisted.");
  }
  const payload = buildChatCompletionsGuidePayload({
    model: params.config.model,
    action: params.action,
    stage: params.stage,
    itemLabel: params.itemLabel,
    captureGuidance: params.captureGuidance,
    manualCheck: params.manualCheck,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), META_TIMEOUT_MS);
  const onAbort = (): void => controller.abort();
  if (params.signal?.aborted) controller.abort();
  else params.signal?.addEventListener("abort", onAbort, { once: true });
  let response: Awaited<ReturnType<FetchImpl>>;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new MetaCallError("PROVIDER_TIMEOUT", 504, "The guide request timed out or was cancelled. Try again when the connection is ready.", true);
    }
    throw new MetaCallError("PROVIDER_UNAVAILABLE", 502, "The guide service is unavailable. Your walkthrough progress is unchanged.", true);
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener("abort", onAbort);
  }
  const latencyMs = Math.max(0, (params.now ?? Date.now)() - startedAt);
  if (response.status === 429) {
    throw new MetaCallError("PROVIDER_RATE_LIMIT", 429, "The guide service is busy. Wait before trying again.", true);
  }
  if (response.status === 401 || response.status === 403) {
    throw setupFailure("Live guide credentials were rejected by the provider. Ask the operator to check the server key.");
  }
  if (!response.ok) {
    throw new MetaCallError("PROVIDER_UNAVAILABLE", 502, "The guide service is unavailable. Your walkthrough progress is unchanged.", true);
  }
  let body: unknown;
  try {
    body = await readBoundedJson(response);
  } catch {
    throw new MetaCallError("INVALID_MODEL_OUTPUT", 502, "The guide returned an unusable response. Your walkthrough progress is unchanged.", true);
  }
  const content = extractContentText(body);
  let parsed: unknown;
  try {
    parsed = content === null ? null : JSON.parse(content);
  } catch {
    parsed = null;
  }
  const guide = validateGuideDraft(parsed);
  if (!guide.ok) {
    throw new MetaCallError("INVALID_MODEL_OUTPUT", 502, "The guide returned an unusable response. Your walkthrough progress is unchanged.", true);
  }
  return {
    guide: guide.value,
    model: params.config.model,
    mode: "live",
    requestId: extractRequestId(body, response.headers),
    latencyMs,
  };
}

export interface FixtureAdapterInput {
  mode: string;
  model?: unknown;
  draft?: unknown;
  fixtureNotice?: unknown;
}

export interface FixtureAdapterSuccess {
  draft: AnalysisDraft;
  model: string;
  mode: "fixture";
  requestId: string;
  latencyMs: number;
  fixtureNotice: string;
}

/**
 * Explicit fixture adapter: hand-written mock-unit output, always labeled
 * "fixture", validated with the same strict draft schema. Throws
 * INVALID_MODEL_OUTPUT when the fixture itself is corrupt (a server bug),
 * never a live claim. There is no silent path from live failure to here:
 * callers select this adapter only when mode is explicitly "fixture".
 */
export function runFixtureDraft(
  fixture: FixtureAdapterInput,
  options: { requestId?: string; latencyMs?: number } = {},
): FixtureAdapterSuccess {
  const draft = validateAnalysisDraft(fixture.draft);
  if (!draft.ok) {
    throw new MetaCallError(
      "INVALID_MODEL_OUTPUT",
      502,
      "The fixture draft failed strict validation. The photo is kept; retry once if the attempt is still current.",
      true,
    );
  }
  const model = typeof fixture.model === "string" && fixture.model.trim().length > 0
    ? fixture.model
    : DEFAULT_META_MODEL;
  const fixtureNotice =
    typeof fixture.fixtureNotice === "string" && fixture.fixtureNotice.trim().length > 0
      ? fixture.fixtureNotice
      : "Fixture output — not live inference.";
  return {
    draft: draft.value,
    model,
    mode: "fixture",
    requestId: options.requestId ?? `fixture-${Date.now().toString(36)}`,
    latencyMs: options.latencyMs ?? 0,
    fixtureNotice,
  };
}
