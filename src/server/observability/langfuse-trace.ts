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
 *   SAM concept labels with box coordinates + confidences, frame
 *   timestamps/ids/counts/byte totals, still references (candidate id,
 *   frame index, timestamp, still hash), the mapping-instructions
 *   SHA-256 as a prompt version proxy, Muse response TEXT, proposal
 *   summaries (element, suggestion, confidence, evidence still ids),
 *   validation outcomes, and safe error codes.
 * - EXCLUDE (never sent): image/video bytes or base64, unit pseudonyms,
 *   evaluator/participant names or signatures, API keys, provider file
 *   contents, provider error bodies, and raw request bodies.
 *
 * Keys stay server-side: this module must never be imported by client
 * code, and trace payloads never enter logs, responses, or exports.
 */
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

function langfuseBaseUrl(env: LangfuseEnv): string {
  const configured = (env.LANGFUSE_BASEURL ?? "").trim();
  return configured.length > 0 ? configured : LANGFUSE_DEFAULT_BASEURL;
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
}

export interface AnalysisTracer {
  readonly enabled: boolean;
  /** Open a child span; no-op when tracing is disabled. Never throws. */
  span(name: string, input?: unknown): ActiveSpan;
  /** Record a model generation observation. Never throws. */
  generation(input: GenerationInput): void;
  /** Best-effort delivery of queued events. Never throws. */
  flush(): Promise<void>;
}

const noopSpan: ActiveSpan = {
  end(): void {},
  fail(): void {},
};

const noopTracer: AnalysisTracer = {
  enabled: false,
  span(): ActiveSpan {
    return noopSpan;
  },
  generation(): void {},
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
): Promise<T> {
  const span = tracer.span(name, input);
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
): T {
  const span = tracer.span(name, input);
  try {
    return phase(span);
  } catch (error) {
    span.fail(spanErrorCode(error));
    throw error;
  }
}

/**
 * Create the tracer for one analysis attempt. Returns a no-op tracer
 * when Langfuse is not configured. Never throws.
 */
export function createAnalysisTracer(
  env: LangfuseEnv,
  traceId: string,
  traceInput: unknown,
): AnalysisTracer {
  if (!isLangfuseConfigured(env)) return noopTracer;
  try {
    const client = new Langfuse({
      secretKey: (env.LANGFUSE_SECRET_KEY ?? "").trim(),
      publicKey: (env.LANGFUSE_PUBLIC_KEY ?? "").trim(),
      baseUrl: langfuseBaseUrl(env),
    });
    const trace = client.trace({ id: traceId, name: ANALYSIS_TRACE_NAME, input: traceInput });
    return {
      enabled: true,
      span(name: string, input?: unknown): ActiveSpan {
        try {
          const observed = trace.span({ name, input: input ?? {} });
          return {
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
        } catch {
          return noopSpan;
        }
      },
      generation(input: GenerationInput): void {
        try {
          trace.generation({
            name: input.name,
            model: input.model,
            input: input.input,
            output: input.outputText,
          });
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
