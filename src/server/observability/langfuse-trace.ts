/**
 * Server-only Langfuse tracing for the video analysis pipeline
 * (Sprint 5 REQ-O1).
 *
 * One trace per analysis attempt, shared by the stage=segment and
 * stage=map requests via a deterministic trace id derived from the
 * request identity. Tracing is strictly optional: without both
 * LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY every helper below is a
 * synchronous no-op, and tracing failures never break analysis
 * (all SDK calls are guarded and flush is best-effort).
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
 *
 * Best-practice notes (langfuse/skills instrumentation reference):
 * - One trace per analysis attempt; segment/map stages nest their
 *   phases under a stage span instead of dangling at the trace root.
 * - Generations carry model + token usage for cost tracking.
 * - Observation `asType` needs JS SDK >= 4 (`@langfuse/tracing`);
 *   this module stays on the stable `langfuse` v3 line, so spans keep
 *   the generic type until that migration is scheduled.
 */
import { randomUUID } from "node:crypto";

import { Langfuse } from "langfuse";

export const LANGFUSE_DEFAULT_BASEURL = "https://cloud.langfuse.com";

/** Langfuse trace name for one room-clip analysis attempt. */
export const ANALYSIS_TRACE_NAME = "video-analysis";

export type LangfuseEnv = Record<string, string | undefined>;

/** True only when both Langfuse keys are present (safe-unset gate). */
export function isLangfuseConfigured(env: LangfuseEnv): boolean {
  return (
    (env.LANGFUSE_SECRET_KEY ?? "").trim().length > 0 &&
    (env.LANGFUSE_PUBLIC_KEY ?? "").trim().length > 0
  );
}

/**
 * Base URL for the Langfuse client. `LANGFUSE_BASEURL` (JS SDK
 * spelling) wins; `LANGFUSE_BASE_URL` (docs/CLI spelling) is accepted
 * as a fallback so either configuration works.
 */
export function resolveLangfuseBaseUrl(env: LangfuseEnv): string {
  for (const key of ["LANGFUSE_BASEURL", "LANGFUSE_BASE_URL"] as const) {
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
 * maps to `development`.
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
 * Deterministic trace id shared by the segment and map stages of one
 * analysis attempt, sanitized to trace-id-safe characters.
 */
export function analysisTraceId(identity: AnalysisTraceIdentity): string {
  return `analysis-${identity.sessionId}-${identity.analysisId}-a${identity.attempt}`
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 128);
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
  /** Parent span to nest under; defaults to the trace root. */
  parent?: ActiveSpan | null;
}

export interface AnalysisTracer {
  readonly enabled: boolean;
  /** Open a span; no-op when tracing is disabled. Never throws. */
  span(name: string, input?: unknown, parent?: ActiveSpan | null): ActiveSpan;
  /** Record a model generation observation. Never throws. */
  generation(input: GenerationInput): void;
  /** Record the stage result as a closing span. Never throws. */
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

/**
 * Create the tracer for one analysis attempt. Returns a no-op tracer
 * when Langfuse is not configured. Never throws. Pass joinExistingTrace
 * for every stage after the first: it binds to the existing trace id
 * instead of re-sending a trace-create (which v4 backends ingest as a
 * duplicate trace).
 */
export function createAnalysisTracer(
  env: LangfuseEnv,
  traceId: string,
  traceInput: unknown,
  options: AnalysisTraceOptions,
  joinExistingTrace = false,
): AnalysisTracer {
  if (!isLangfuseConfigured(env)) return noopTracer;
  try {
    const client = new Langfuse({
      secretKey: (env.LANGFUSE_SECRET_KEY ?? "").trim(),
      publicKey: (env.LANGFUSE_PUBLIC_KEY ?? "").trim(),
      baseUrl: resolveLangfuseBaseUrl(env),
    });
    const sessionId = options.sessionId.trim();
    // Traces are immutable once ingested: the segment stage creates the
    // trace, and the map stage joins it by trace id. Re-sending
    // client.trace with the same id would duplicate the trace on v4
    // backends (Langfuse FAQ "How to update traces..."), so the join
    // path emits observations with an explicit traceId instead.
    const trace = joinExistingTrace ? null : client.trace({
      id: traceId,
      name: ANALYSIS_TRACE_NAME,
      input: traceInput,
      ...(sessionId.length > 0 ? { sessionId } : {}),
      environment: resolveLangfuseEnvironment(env),
      tags: [ANALYSIS_TRACE_NAME, sanitizeRoomTag(options.room)],
    });
    const openSpan = (name: string, input: unknown, parent: ActiveSpan | null): ActiveSpan => {
      try {
        const id = randomUUID();
        const parentId = parent?.id ?? null;
        const observed = trace
          ? trace.span({
            id,
            name,
            input: input ?? {},
            ...(parentId ? { parentObservationId: parentId } : {}),
          })
          : client.span({
            traceId,
            id,
            name,
            input: input ?? {},
            ...(parentId ? { parentObservationId: parentId } : {}),
          });
        const handle: ActiveSpan = {
          id,
          end(output?: unknown): void {
            try {
              observed.end({ output: output ?? {} });
            } catch {
              // Tracing must never break analysis.
            }
          },
          fail(code: string): void {
            try {
              observed.end({ output: { ok: false }, level: "ERROR", statusMessage: code });
            } catch {
              // Tracing must never break analysis.
            }
          },
        };
        return handle;
      } catch {
        return noopSpan;
      }
    };
    const recordGeneration = (input: GenerationInput): void => {
      try {
        const parentId = input.parent?.id ?? null;
        const body = {
          name: input.name,
          model: input.model,
          input: input.input,
          output: input.outputText,
          ...(input.usage
            ? {
              usage: {
                input: input.usage.inputTokens,
                output: input.usage.outputTokens,
                unit: "TOKENS" as const,
              },
            }
            : {}),
          ...(parentId ? { parentObservationId: parentId } : {}),
        };
        if (trace) trace.generation(body);
        else client.generation({ traceId, ...body });
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
        // Recorded as a closing span, never trace.update: update()
        // re-sends a trace-create with the same id, which duplicates
        // the trace on v4 backends.
        try {
          openSpan("stage-result", { summary: summary ?? {} }, null).end({ summary: summary ?? {} });
        } catch {
          // Tracing must never break analysis.
        }
      },
      async flush(): Promise<void> {
        try {
          await client.flushAsync();
        } catch {
          // Best-effort delivery only.
        }
      },
    };
  } catch {
    return noopTracer;
  }
}
