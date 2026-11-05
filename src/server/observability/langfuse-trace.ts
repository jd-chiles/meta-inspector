/**
 * Server-only Langfuse tracing for the video analysis pipeline
 * (Sprint 5 REQ-O1, migrated to JS/TS SDK v6 for the Langfuse v4
 * observations-first data model).
 *
 * One trace per analysis attempt, shared by the stage=segment and
 * stage=map requests via a deterministic W3C trace id derived from the
 * request identity (sha256 of the analysis seed, mirroring
 * `createTraceId(seed)`; see analysisTraceId). Each stage opens one
 * root observation on that trace id through an explicit
 * parentSpanContext (the documented join pattern: the parent span id
 * value is irrelevant, only used for trace-id inheritance), nests its
 * phase spans under that root, and records its stage summary as the
 * root output. There is no trace-create/update call: traces exist only
 * as the observations-first grouping, so re-sending an id can never
 * duplicate a trace.
 *
 * Correlating attributes (trace name, session id, tags, environment)
 * are propagated onto EVERY observation at creation time via
 * propagateAttributes, including cost-bearing generations, per the
 * v4/v5 observations-first contract. Overall input/output live on the
 * stage root observations.
 *
 * Tracing is strictly optional: without both LANGFUSE_SECRET_KEY and
 * LANGFUSE_PUBLIC_KEY every helper below is a synchronous no-op, and
 * tracing failures never break analysis (all SDK calls are guarded and
 * flush is best-effort). The OpenTelemetry provider is isolated
 * (setLangfuseTracerProvider, never the global provider) and
 * initialized at most once per process. Attribute propagation needs a
 * real async context manager (the default noop manager silently drops
 * propagated session/tags/environment), so setup also registers
 * AsyncLocalStorageContextManager once — the only global OTEL state
 * this module touches.
 *
 * Sanitization contract (repo rule 3 + housing-privacy posture):
 * - INCLUDE (debugging metadata only): room, container, duration,
 *   source-video SHA-256, video/analysis identity fields, model ids,
 *   token usage counts, SAM concept labels with box coordinates +
 *   confidences, frame timestamps/ids/counts/byte totals, still
 *   references (candidate id, frame index, timestamp, still hash), the
 *   mapping-instructions SHA-256 as a prompt version proxy, Muse
 *   response TEXT, proposal summaries (element, suggestion,
 *   confidence, evidence still ids), validation outcomes, and safe
 *   error codes. Traces group by inspection session id (an opaque
 *   `walkthrough-<random>` key, never a name) and carry an
 *   environment + room tag for filtering.
 * - EXCLUDE (never sent): image/video bytes or base64, unit pseudonyms,
 *   evaluator/participant names or signatures, API keys, provider file
 *   ids or contents, provider error bodies, and raw request bodies.
 *
 * Keys stay server-side: this module must never be imported by client
 * code, and trace payloads never enter logs, responses, or exports.
 */
import { createHash, randomUUID } from "node:crypto";

import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  propagateAttributes,
  setLangfuseTracerProvider,
  startObservation,
  type LangfuseSpan,
} from "@langfuse/tracing";

export const LANGFUSE_DEFAULT_BASEURL = "https://cloud.langfuse.com";

/** Langfuse trace name for one room-clip analysis attempt. */
export const ANALYSIS_TRACE_NAME = "video-analysis";

/**
 * Phantom parent span id for deterministic-trace-id roots (the
 * documented @langfuse/tracing pattern: any valid 16-hex string; the
 * span does not exist and is only used for trace-id inheritance).
 */
const DETERMINISTIC_TRACE_PARENT_SPAN_ID = "0123456789abcdef";

export type LangfuseEnv = Record<string, string | undefined>;

/** True only when both Langfuse keys are present (safe-unset gate). */
export function isLangfuseConfigured(env: LangfuseEnv): boolean {
  return (
    (env.LANGFUSE_SECRET_KEY ?? "").trim().length > 0 &&
    (env.LANGFUSE_PUBLIC_KEY ?? "").trim().length > 0
  );
}

/**
 * Base URL for the Langfuse client. `LANGFUSE_BASE_URL` (canonical
 * v4+ spelling) wins; legacy `LANGFUSE_BASEURL` is accepted as a
 * fallback so older configuration keeps working.
 */
export function resolveLangfuseBaseUrl(env: LangfuseEnv): string {
  for (const key of ["LANGFUSE_BASE_URL", "LANGFUSE_BASEURL"] as const) {
    const configured = (env[key] ?? "").trim();
    if (configured.length > 0) return configured;
  }
  return LANGFUSE_DEFAULT_BASEURL;
}

const ENVIRONMENT_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;

/**
 * Trace environment for dashboard separation. An explicit valid
 * `LANGFUSE_ENVIRONMENT` wins; otherwise the production app origin
 * maps to `production` and everything else (dev app, local, tests)
 * maps to `development`. Propagated onto every observation (v4+
 * observations carry their own environment).
 */
export function resolveLangfuseEnvironment(env: LangfuseEnv): string {
  const explicit = (env.LANGFUSE_ENVIRONMENT ?? "").trim().toLowerCase();
  if (explicit.length > 0 && ENVIRONMENT_PATTERN.test(explicit) && !explicit.startsWith("langfuse")) {
    return explicit;
  }
  const origin = (env.APP_PUBLIC_ORIGIN ?? "").trim().toLowerCase();
  if (origin.includes("metainspect-app.")) return "production";
  return "development";
}

/** Low-cardinality room tag for trace filtering (`room:kitchen`). */
export function sanitizeRoomTag(room: string): string {
  const slug = room
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `room:${slug.length > 0 ? slug : "unknown"}`;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

function validTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Token usage from a provider response body. Accepts the Muse
 * responses shape (`usage.input_tokens/output_tokens`) and the chat
 * shape (`usage.prompt_tokens/completion_tokens`); anything else
 * yields undefined so generations never carry fabricated counts.
 */
export function extractResponseUsage(value: unknown): ModelUsage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const usage = (value as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const record = usage as Record<string, unknown>;
  const input = record.input_tokens ?? record.prompt_tokens;
  const output = record.output_tokens ?? record.completion_tokens;
  if (!validTokenCount(input) || !validTokenCount(output)) return undefined;
  return { inputTokens: input, outputTokens: output };
}

export interface AnalysisTraceIdentity {
  sessionId: string;
  analysisId: string;
  attempt: number;
}

/**
 * Deterministic W3C trace id shared by the segment and map stages of
 * one analysis attempt: first 32 hex chars of the sha256 of the
 * analysis seed. This mirrors `createTraceId(seed)` from
 * `@langfuse/tracing` exactly (verified against its implementation:
 * hex(sha256(utf8(seed)))[0:32]) while staying synchronous so tracer
 * construction never becomes async. Parity is covered by unit test.
 */
export function analysisTraceId(identity: AnalysisTraceIdentity): string {
  const seed = `analysis-${identity.sessionId}-${identity.analysisId}-a${identity.attempt}`;
  return createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32);
}

export interface ActiveSpan {
  /** Observation id for nesting children; null when tracing is disabled. */
  readonly id: string | null;
  /** Close the span with a sanitized output payload. Never throws. */
  end(output?: unknown): void;
  /** Close the span as failed with a safe error code. Never throws. */
  fail(code: string): void;
}

export interface GenerationInput {
  name: string;
  model: string;
  /** Sanitized model input summary (references, never bytes). */
  input: unknown;
  /** Raw model response text (the debugging target). */
  outputText: string;
  /** Token usage for cost tracking; omitted when the provider gives none. */
  usage?: ModelUsage;
  /** Parent span to nest under; defaults to the stage root. */
  parent?: ActiveSpan | null;
}

export interface AnalysisTracer {
  readonly enabled: boolean;
  /** Open a span; no-op when tracing is disabled. Never throws. */
  span(name: string, input?: unknown, parent?: ActiveSpan | null): ActiveSpan;
  /** Record a model generation observation. Never throws. */
  generation(input: GenerationInput): void;
  /** Record the stage result on the stage root. Never throws. */
  finish(summary: unknown): void;
  /** Best-effort delivery of queued events. Never throws. */
  flush(): Promise<void>;
}

const noopSpan: ActiveSpan = {
  id: null,
  end(): void {},
  fail(): void {},
};

const noopTracer: AnalysisTracer = {
  enabled: false,
  span(): ActiveSpan {
    return noopSpan;
  },
  generation(): void {},
  finish(): void {},
  async flush(): Promise<void> {},
};

/** Shared no-op tracer for unconfigured or tracer-less call paths. */
export function noopAnalysisTracer(): AnalysisTracer {
  return noopTracer;
}

/** Safe error code for a failed span (structural; never leaks messages). */
export function spanErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    ((error as { code: string }).code.length > 0)
  ) {
    return (error as { code: string }).code.slice(0, 64);
  }
  return "ERROR";
}

/**
 * Run an async phase under a child span: the phase ends the span with
 * its output on success; a throw fails the span with a safe code and
 * rethrows. Span failures never mask the original error.
 */
export async function runSpan<T>(
  tracer: AnalysisTracer,
  name: string,
  input: unknown,
  phase: (span: ActiveSpan) => Promise<T>,
  parent?: ActiveSpan | null,
): Promise<T> {
  const span = tracer.span(name, input, parent);
  try {
    return await phase(span);
  } catch (error) {
    span.fail(spanErrorCode(error));
    throw error;
  }
}

/** Sync variant of runSpan for pure phases (candidate selection). */
export function runSpanSync<T>(
  tracer: AnalysisTracer,
  name: string,
  input: unknown,
  phase: (span: ActiveSpan) => T,
  parent?: ActiveSpan | null,
): T {
  const span = tracer.span(name, input, parent);
  try {
    return phase(span);
  } catch (error) {
    span.fail(spanErrorCode(error));
    throw error;
  }
}

export interface AnalysisTraceOptions {
  /** Opaque inspection session id; groups one inspection's room traces. */
  sessionId: string;
  /** Room id for the low-cardinality room tag. */
  room: string;
}

interface OtelSetup {
  flush: () => Promise<void>;
}

let otelSetupAttempted = false;
let otelSetup: OtelSetup | null = null;

/**
 * Initialize the isolated OpenTelemetry provider at most once per
 * process. Isolated (never the global provider), so unit tests and any
 * other instrumentation in the process are unaffected. Returns null
 * when initialization fails; callers fall back to the no-op tracer.
 * The first configured call wins; later env differences are ignored
 * (production callers share one process env).
 */
function ensureOtelSetup(env: LangfuseEnv): OtelSetup | null {
  if (otelSetupAttempted) return otelSetup;
  otelSetupAttempted = true;
  try {
    // Without this, propagateAttributes() silently drops every
    // attribute (verified: session/tags/environment missing on
    // export). setGlobalContextManager keeps an existing manager.
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    const processor = new LangfuseSpanProcessor({
      secretKey: (env.LANGFUSE_SECRET_KEY ?? "").trim(),
      publicKey: (env.LANGFUSE_PUBLIC_KEY ?? "").trim(),
      baseUrl: resolveLangfuseBaseUrl(env),
    });
    const provider = new NodeTracerProvider({ spanProcessors: [processor] });
    setLangfuseTracerProvider(provider);
    otelSetup = {
      flush: () => processor.forceFlush(),
    };
    return otelSetup;
  } catch {
    return null;
  }
}

function nativeSpanId(span: LangfuseSpan): string | null {
  try {
    const id = span.otelSpan.spanContext().spanId;
    return typeof id === "string" && /^[0-9a-f]{16}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Create the tracer for one analysis attempt. Returns a no-op tracer
 * when Langfuse is not configured. Never throws. Every stage opens
 * its own root observation on the shared deterministic trace id
 * (segment creates, map joins by construction — there is no
 * trace-create call to duplicate); `joinExistingTrace` is retained so
 * callers keep declaring their stage role.
 */
export function createAnalysisTracer(
  env: LangfuseEnv,
  traceId: string,
  traceInput: unknown,
  options: AnalysisTraceOptions,
  joinExistingTrace = false,
): AnalysisTracer {
  void joinExistingTrace;
  if (!isLangfuseConfigured(env)) return noopTracer;
  if (!/^[0-9a-f]{32}$/.test(traceId)) return noopTracer;
  const setup = ensureOtelSetup(env);
  if (!setup) return noopTracer;
  try {
    const sessionId = options.sessionId.trim();
    const propagated = {
      traceName: ANALYSIS_TRACE_NAME,
      ...(sessionId.length > 0 ? { sessionId } : {}),
      tags: [ANALYSIS_TRACE_NAME, sanitizeRoomTag(options.room)],
      environment: resolveLangfuseEnvironment(env),
    };
    const withPropagation = <T>(create: () => T): T => propagateAttributes(propagated, create);
    const rootContext = {
      traceId,
      spanId: DETERMINISTIC_TRACE_PARENT_SPAN_ID,
      traceFlags: 1 as const,
    };
    const root: LangfuseSpan = withPropagation(() =>
      startObservation(ANALYSIS_TRACE_NAME, { input: traceInput ?? {} }, { parentSpanContext: rootContext }),
    );
    let rootEnded = false;
    const endRoot = (output?: unknown): void => {
      if (rootEnded) return;
      rootEnded = true;
      try {
        if (output !== undefined) root.update({ output });
        root.end();
      } catch {
        // Tracing must never break analysis.
      }
    };
    const wrap = (native: LangfuseSpan): ActiveSpan => {
      let ended = false;
      const finish = (update: () => void): void => {
        if (ended) return;
        ended = true;
        try {
          update();
          native.end();
        } catch {
          // Tracing must never break analysis.
        }
      };
      return {
        id: nativeSpanId(native),
        end(output?: unknown): void {
          finish(() => {
            native.update({ output: output ?? {} });
          });
        },
        fail(code: string): void {
          finish(() => {
            native.update({ output: { ok: false }, level: "ERROR", statusMessage: code });
          });
        },
      };
    };
    // Native handle registry: parents always resolve within this
    // request (cross-stage parents are never needed: each stage owns
    // its root), so handles never cross request boundaries.
    const natives = new Map<string, LangfuseSpan>();
    const registerNative = (handle: ActiveSpan, native: LangfuseSpan): ActiveSpan => {
      natives.set(handle.id ?? randomUUID(), native);
      return handle;
    };
    const resolveNative = (parent?: ActiveSpan | null): LangfuseSpan => {
      if (parent?.id) {
        const native = natives.get(parent.id);
        if (native) return native;
      }
      return root;
    };
    const openSpan = (name: string, input: unknown, parent: ActiveSpan | null): ActiveSpan => {
      try {
        const nativeParent = resolveNative(parent);
        const native = withPropagation(() => nativeParent.startObservation(name, { input: input ?? {} }));
        return registerNative(wrap(native), native);
      } catch {
        return noopSpan;
      }
    };
    const recordGeneration = (input: GenerationInput): void => {
      try {
        const nativeParent = resolveNative(input.parent ?? null);
        withPropagation(() => {
          const generation = nativeParent.startObservation(
            input.name,
            { model: input.model, input: input.input },
            { asType: "generation" },
          );
          generation.update({
            output: input.outputText,
            ...(input.usage
              ? { usageDetails: { input: input.usage.inputTokens, output: input.usage.outputTokens } }
              : {}),
          });
          generation.end();
        });
      } catch {
        // Tracing must never break analysis.
      }
    };
    return {
      enabled: true,
      span(name: string, input?: unknown, parent?: ActiveSpan | null): ActiveSpan {
        return openSpan(name, input ?? {}, parent ?? null);
      },
      generation(input: GenerationInput): void {
        recordGeneration(input);
      },
      finish(summary: unknown): void {
        // Stage output lands on the stage root observation (v4
        // guidance: trace input/output come from the root
        // observation), never on a trace-update call.
        endRoot({ summary: summary ?? {} });
      },
      async flush(): Promise<void> {
        // A stage that throws before finish() still exports its root
        // (without claiming an output) so failed analyses stay
        // visible; then best-effort delivery of queued events.
        endRoot();
        try {
          await setup.flush();
        } catch {
          // Best-effort delivery only.
        }
      },
    };
  } catch {
    return noopTracer;
  }
}
