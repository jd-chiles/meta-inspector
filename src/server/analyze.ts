/**
 * Server-only analysis core (REQ-002, REQ-003, REQ-004, REQ-010).
 *
 * Same-origin bounded analysis invoked by POST /api/analyze with multipart
 * form-data only: image (file) plus sessionId, itemId, catalogVersion,
 * analysisId, and optional mediaId. There are intentionally no URL, model-ID,
 * or system-prompt fields: any request carrying client-supplied fetch URLs,
 * model IDs, or prompts is rejected with INVALID_MEDIA and nothing is ever
 * fetched.
 *
 * Kept out of the route module so Next.js route-type validation only sees
 * the POST handler plus `runtime`. Logic here is unchanged from the route
 * module: same validation, same error codes, same envelope construction.
 */
import { getCatalogItem, type Catalog } from "../domain/catalog";
import {
  validateEnvelope,
  type AnalysisDraft,
  type AnalysisEnvelope,
} from "../domain/evidence";
import fixtureJson from "../../fixtures/responses/fixture-draft.json";
import { getServerCatalog } from "./catalog";
import {
  callMetaDraft,
  isMetaCallError,
  parseAnalysisMode,
  requireLiveConfig,
  resolveMetaConfig,
  runFixtureDraft,
  META_TIMEOUT_MS,
  type FetchImpl,
} from "./meta/adapter";
import {
  encodeNormalizedMedia,
  generateMediaId,
  MAX_IMAGE_BYTES,
  MediaValidationError,
  sha256Hex,
  validateAndNormalizeImage,
  type NormalizedImage,
} from "./media/validate";

/** Extra stable code for the same-origin guard (403). All other codes follow the integration contract. */
export type AnalyzeErrorCode =
  | "SETUP_REQUIRED"
  | "INVALID_MEDIA"
  | "ITEM_MISMATCH"
  | "REQUEST_IN_PROGRESS"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_MODEL_OUTPUT"
  | "ORIGIN_FORBIDDEN";

export interface AnalyzeErrorBody {
  error: { code: AnalyzeErrorCode; message: string; retryable: boolean };
  analysisId: string;
}

/** Client-supplied field names that are never accepted (no fetch URLs, model IDs, or prompts). */
const FORBIDDEN_FORM_FIELDS = [
  "imageUrl",
  "image_url",
  "url",
  "model",
  "modelId",
  "systemPrompt",
  "prompt",
] as const;

/**
 * Lowercased forbidden set: multipart field names are case-sensitive, so an
 * exact-case check alone lets `MODEL` / `ImageURL` / `SystemPrompt` variants
 * through. Matching is case-insensitive; none of the legitimate fields
 * (sessionId, itemId, catalogVersion, analysisId, image, mediaId) collide.
 */
const FORBIDDEN_FORM_FIELDS_LOWER = new Set(
  FORBIDDEN_FORM_FIELDS.map((field) => field.toLowerCase()),
);

/** One active analysis per session. Exported for tests; the route uses a module singleton. */
export class InflightTracker {
  private readonly active = new Map<string, string>();

  acquire(sessionId: string, analysisId: string): boolean {
    if (this.active.has(sessionId)) return false;
    this.active.set(sessionId, analysisId);
    return true;
  }

  release(sessionId: string, analysisId: string): void {
    if (this.active.get(sessionId) === analysisId) {
      this.active.delete(sessionId);
    }
  }

  has(sessionId: string): boolean {
    return this.active.has(sessionId);
  }
}

const routeTracker = new InflightTracker();

/** Optional decoder-backed pixel step (see media module seam). */
export interface PixelResampler {
  resample(normalized: NormalizedImage): Promise<{
    bytes: Uint8Array;
    width: number;
    height: number;
  }>;
}

export interface AnalyzeDeps {
  catalog?: Catalog;
  mode?: "live" | "fixture";
  metaEnv?: Record<string, string | undefined>;
  fetchImpl?: FetchImpl;
  tracker?: InflightTracker;
  timeoutMs?: number;
  now?: () => number;
  generateRequestId?: () => string;
  resampler?: PixelResampler;
  /** Override the explicit fixture payload (tests). Defaults to the bundled fixture. */
  fixture?: { mode: string; model?: unknown; draft?: unknown; fixtureNotice?: unknown };
}

function errorBody(
  code: AnalyzeErrorCode,
  message: string,
  retryable: boolean,
  analysisId: string,
): AnalyzeErrorBody {
  return { error: { code, message, retryable }, analysisId: analysisId || "unknown" };
}

function errorResult(
  status: number,
  code: AnalyzeErrorCode,
  message: string,
  retryable: boolean,
  analysisId: string,
): { status: number; body: AnalyzeErrorBody } {
  return { status, body: errorBody(code, message, retryable, analysisId) };
}

function isNonEmpty(value: FormDataEntryValue | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Loopback aliases for the same-machine origin gate (REQ-002, REQ-010). */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeOriginHost(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  return host;
}

function checkSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null || origin.trim().length === 0) return true;
  try {
    const originUrl = new URL(origin);
    const targetUrl = new URL(request.url);
    if (originUrl.origin === targetUrl.origin) return true;
    // Real browsers on the same machine may use a different loopback alias
    // than the page URL (e.g. page on 127.0.0.1:3100 while Next.js reports
    // localhost:3100). Treat localhost, 127.0.0.1, and ::1 as the same host
    // only when scheme and port also match.
    if (originUrl.protocol !== targetUrl.protocol) return false;
    if (originUrl.port !== targetUrl.port) return false;
    return (
      LOOPBACK_HOSTS.has(normalizeOriginHost(originUrl.hostname)) &&
      LOOPBACK_HOSTS.has(normalizeOriginHost(targetUrl.hostname))
    );
  } catch {
    return false;
  }
}

function linkTimeout(
  timeoutMs: number,
  external: AbortSignal | null | undefined,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternal = (): void => controller.abort();
  if (external) {
    if (external.aborted) {
      controller.abort();
    } else {
      external.addEventListener("abort", onExternal, { once: true });
    }
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternal);
    },
  };
}

/** Safe server log: IDs, timings and codes only — never keys, bodies, or bytes. */
function logSafe(event: string, context: Record<string, string | number | boolean>): void {
  console.info(JSON.stringify({ event, ...context }));
}

export interface NormalizedMediaPayload {
  mediaId: string;
  mime: NormalizedImage["mime"];
  width: number;
  height: number;
  digest: string;
  base64: string;
  targetWidth: number;
  targetHeight: number;
  resampleRequired: boolean;
  pixelTransposeRequired: boolean;
}

export interface AnalyzeSuccessBody {
  envelope: AnalysisEnvelope;
  normalizedMedia: NormalizedMediaPayload;
  mode: "live" | "fixture";
  model: string;
  requestId: string;
  latencyMs: number;
  fixtureNotice?: string;
}

async function buildNormalizedPayload(
  normalized: NormalizedImage,
  resampler: PixelResampler | undefined,
): Promise<{ payload: NormalizedMediaPayload; digest: string; bytes: Uint8Array }> {
  let bytes = normalized.bytes;
  let width = normalized.width;
  let height = normalized.height;
  let resampleRequired = normalized.resampleRequired;
  if (resampleRequired && resampler) {
    const resampled = await resampler.resample(normalized);
    if (resampled.bytes.length === 0 || resampled.bytes.length > MAX_IMAGE_BYTES) {
      throw new MediaValidationError(
        413,
        "Resampled image exceeds the 8 MiB bound. Retake with a lower resolution.",
      );
    }
    bytes = resampled.bytes;
    width = resampled.width;
    height = resampled.height;
    resampleRequired = false;
  }
  const base64 = encodeNormalizedMedia(bytes);
  const digest = sha256Hex(bytes);
  return {
    payload: {
      mediaId: normalized.mediaId,
      mime: normalized.mime,
      width,
      height,
      digest,
      base64,
      targetWidth: normalized.targetWidth,
      targetHeight: normalized.targetHeight,
      resampleRequired,
      pixelTransposeRequired: normalized.pixelTransposeRequired,
    },
    digest,
    bytes,
  };
}

/**
 * Core analysis flow against web-standard Request/Response so unit tests can
 * exercise the real path with mocked HTTP. Returns a status plus a
 * JSON-serializable body (success or safe error).
 */
export async function handleAnalyzeRequest(
  request: Request,
  deps: AnalyzeDeps = {},
): Promise<{ status: number; body: unknown }> {
  const timeoutMs = deps.timeoutMs ?? META_TIMEOUT_MS;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const tracker = deps.tracker ?? routeTracker;
  let analysisId = "unknown";
  let sessionId = "";

  try {
    if (!checkSameOrigin(request)) {
      return errorResult(
        403,
        "ORIGIN_FORBIDDEN",
        "Cross-origin requests are rejected. Use the same-origin walkthrough client.",
        false,
        analysisId,
      );
    }
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return errorResult(
        400,
        "INVALID_MEDIA",
        "Multipart form-data is required. Client fetch URLs, model IDs, and system prompts are never accepted.",
        false,
        analysisId,
      );
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResult(400, "INVALID_MEDIA", "Unreadable multipart upload. Retake or re-select the photo.", false, analysisId);
    }
    for (const key of form.keys()) {
      if (FORBIDDEN_FORM_FIELDS_LOWER.has(key.toLowerCase())) {
        return errorResult(
          400,
          "INVALID_MEDIA",
          "Client-supplied fetch URLs, model IDs, and system prompts are never accepted.",
          false,
          analysisId,
        );
      }
    }
    const sessionField = form.get("sessionId");
    const itemField = form.get("itemId");
    const versionField = form.get("catalogVersion");
    const analysisField = form.get("analysisId");
    if (!isNonEmpty(sessionField) || !isNonEmpty(itemField) || !isNonEmpty(analysisField)) {
      return errorResult(
        400,
        "INVALID_MEDIA",
        "sessionId, itemId, and analysisId are required multipart fields.",
        false,
        analysisId,
      );
    }
    sessionId = sessionField.trim();
    const itemId = itemField.trim();
    analysisId = analysisField.trim();
    const catalogVersion = typeof versionField === "string" ? versionField.trim() : "";

    const catalog = deps.catalog ?? getServerCatalog();
    const item = getCatalogItem(catalog, itemId);
    if (!item || catalogVersion !== catalog.version) {
      return errorResult(
        409,
        "ITEM_MISMATCH",
        "Unknown item or catalog version mismatch. Reselect the item from the current checklist.",
        false,
        analysisId,
      );
    }

    const file = form.get("image");
    if (!(file instanceof Blob) || file.size === 0) {
      return errorResult(400, "INVALID_MEDIA", "An image file field named \"image\" is required.", false, analysisId);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return errorResult(
        413,
        "INVALID_MEDIA",
        "Image exceeds the 8 MiB upload bound. Retake or choose a smaller photo.",
        false,
        analysisId,
      );
    }
    if (!tracker.acquire(sessionId, analysisId)) {
      return errorResult(
        409,
        "REQUEST_IN_PROGRESS",
        "An analysis is already running for this session. Wait for it to finish or cancel it before retrying.",
        true,
        analysisId,
      );
    }
    try {
      const raw = new Uint8Array(await file.arrayBuffer());
      let normalized: NormalizedImage;
      try {
        normalized = validateAndNormalizeImage(raw, {
          claimedMime: typeof file.type === "string" && file.type.length > 0 ? file.type : undefined,
          mediaId: generateMediaId(),
        });
      } catch (error) {
        if (error instanceof MediaValidationError) {
          const failure = error.toFailure();
          return errorResult(failure.status, "INVALID_MEDIA", failure.message, false, analysisId);
        }
        throw error;
      }

      let normalizedMedia: NormalizedMediaPayload;
      try {
        ({ payload: normalizedMedia } = await buildNormalizedPayload(normalized, deps.resampler));
      } catch (error) {
        if (error instanceof MediaValidationError) {
          const failure = error.toFailure();
          return errorResult(failure.status, "INVALID_MEDIA", failure.message, false, analysisId);
        }
        throw error;
      }

      const mode = deps.mode ?? parseAnalysisMode(deps.metaEnv?.APP_ANALYSIS_MODE ?? process.env.APP_ANALYSIS_MODE);
      if (mode === null) {
        return errorResult(
          503,
          "SETUP_REQUIRED",
          'Server analysis mode is not configured (APP_ANALYSIS_MODE must be "live" or "fixture").',
          false,
          analysisId,
        );
      }

      let draft: AnalysisDraft;
      let model: string;
      let requestId: string;
      let latencyMs: number;
      let fixtureNotice: string | undefined;
      if (mode === "fixture") {
        let fixture;
        try {
          fixture = runFixtureDraft(
            (deps.fixture ?? fixtureJson) as { mode: string; model?: unknown; draft?: unknown; fixtureNotice?: unknown },
            { requestId: deps.generateRequestId?.() ?? `fixture-${analysisId}`, latencyMs: 0 },
          );
        } catch (error) {
          if (isMetaCallError(error)) {
            return errorResult(error.status, error.code, error.message, error.retryable, analysisId);
          }
          throw error;
        }
        draft = fixture.draft;
        model = fixture.model;
        requestId = fixture.requestId;
        latencyMs = fixture.latencyMs;
        fixtureNotice = fixture.fixtureNotice;
      } else {
        let config;
        try {
          config = resolveMetaConfig(deps.metaEnv ?? process.env);
          requireLiveConfig(config);
        } catch (error) {
          if (isMetaCallError(error)) {
            return errorResult(error.status, error.code, error.message, error.retryable, analysisId);
          }
          throw error;
        }
        const invocation = linkTimeout(timeoutMs, request.signal ?? null);
        try {
          const outcome = await callMetaDraft({
            config,
            itemLabel: item.label,
            captureGuidance: item.captureGuidance,
            imageMime: normalized.mime,
            imageBase64: normalizedMedia.base64,
            signal: invocation.signal,
            fetchImpl: deps.fetchImpl,
            now,
          });
          draft = outcome.draft;
          model = outcome.model;
          requestId = outcome.requestId;
          latencyMs = outcome.latencyMs;
        } catch (error) {
          if (isMetaCallError(error)) {
            return errorResult(error.status, error.code, error.message, error.retryable, analysisId);
          }
          throw error;
        } finally {
          invocation.dispose();
        }
      }

      // Application-generated envelope: IDs and provenance come from the
      // server/catalog, never from model text (design § Contracts).
      const envelope: AnalysisEnvelope = {
        analysisId,
        sessionId,
        itemId,
        catalogVersion: catalog.version,
        mediaId: normalized.mediaId,
        mediaHash: normalizedMedia.digest,
        model,
        mode,
        requestId,
        latencyMs,
        draft,
      };
      const checked = validateEnvelope(envelope);
      if (!checked.ok) {
        return errorResult(
          502,
          "INVALID_MODEL_OUTPUT",
          "The provider returned output that failed strict validation. The photo is kept; retry once if the attempt is still current.",
          true,
          analysisId,
        );
      }
      const body: AnalyzeSuccessBody = {
        envelope: checked.value,
        normalizedMedia,
        mode,
        model,
        requestId,
        latencyMs,
        ...(fixtureNotice !== undefined ? { fixtureNotice } : {}),
      };
      logSafe("analyze.success", {
        sessionId,
        itemId,
        analysisId,
        mode,
        model,
        requestId,
        latencyMs: now() - startedAt,
      });
      return { status: 200, body };
    } finally {
      tracker.release(sessionId, analysisId);
    }
  } catch {
    logSafe("analyze.error", {
      sessionId: sessionId || "unknown",
      analysisId,
      code: "PROVIDER_UNAVAILABLE",
    });
    return errorResult(
      502,
      "PROVIDER_UNAVAILABLE",
      "The provider is unavailable or returned an error. The photo is kept; retry once if the attempt is still current.",
      true,
      analysisId,
    );
  }
}
