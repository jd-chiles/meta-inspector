import { describe, expect, it } from "vitest";

import {
  ANALYSIS_TRACE_NAME,
  analysisTraceId,
  createAnalysisTracer,
  isLangfuseConfigured,
  runSpan,
  runSpanSync,
  spanErrorCode,
  type AnalysisTracer,
} from "../../../../src/server/observability/langfuse-trace";

describe("langfuse tracer gating (REQ-O1)", () => {
  it("stays disabled unless both keys are present", () => {
    expect(isLangfuseConfigured({})).toBe(false);
    expect(isLangfuseConfigured({ LANGFUSE_SECRET_KEY: "sk" })).toBe(false);
    expect(isLangfuseConfigured({ LANGFUSE_PUBLIC_KEY: "pk" })).toBe(false);
    expect(isLangfuseConfigured({ LANGFUSE_SECRET_KEY: "  ", LANGFUSE_PUBLIC_KEY: "pk" })).toBe(false);
    expect(isLangfuseConfigured({ LANGFUSE_SECRET_KEY: "sk", LANGFUSE_PUBLIC_KEY: "pk" })).toBe(true);
  });

  it("derives a deterministic sanitized trace id shared by both stages", () => {
    const identity = { sessionId: "session-1", analysisId: "analysis-9", attempt: 2 };
    expect(analysisTraceId(identity)).toBe("analysis-session-1-analysis-9-a2");
    expect(analysisTraceId(identity)).toBe(analysisTraceId({ ...identity }));
    expect(
      analysisTraceId({ sessionId: "a/b:c", analysisId: "d e", attempt: 1 }),
    ).toBe("analysis-a-b-c-d-e-a1");
  });

  it("returns a safe no-op tracer when unconfigured", async () => {
    const tracer = createAnalysisTracer({}, "analysis-x", { room: "kitchen" });
    expect(tracer.enabled).toBe(false);
    expect(ANALYSIS_TRACE_NAME).toBe("video-analysis");
    const span = tracer.span("sam-upload", { fileId: "file-1" });
    expect(() => span.end({ ok: true })).not.toThrow();
    expect(() => span.fail("PROVIDER_FAILURE")).not.toThrow();
    expect(() =>
      tracer.generation({ name: "muse-map", model: "muse-spark-1.3", input: {}, outputText: "ok" }),
    ).not.toThrow();
    await expect(tracer.flush()).resolves.toBeUndefined();
  });

  it("constructs an enabled tracer with keys without touching the network", () => {
    const tracer = createAnalysisTracer(
      { LANGFUSE_SECRET_KEY: "sk-test-never-sent", LANGFUSE_PUBLIC_KEY: "pk-test-never-sent" },
      "analysis-construct-only",
      { room: "kitchen" },
    );
    expect(tracer.enabled).toBe(true);
  });

  it("extracts safe span error codes without leaking messages", () => {
    expect(spanErrorCode(Object.assign(new Error("secret bytes here"), { code: "PROVIDER_FAILURE" }))).toBe(
      "PROVIDER_FAILURE",
    );
    expect(spanErrorCode(new Error("plain"))).toBe("ERROR");
    expect(spanErrorCode(null)).toBe("ERROR");
    expect(spanErrorCode({ code: 500 })).toBe("ERROR");
  });

  it("ends spans on success and fails plus rethrows on error", async () => {
    const calls: string[] = [];
    const fake: AnalysisTracer = {
      enabled: true,
      span: (name: string) => {
        calls.push(`open:${name}`);
        return {
          end: () => { calls.push("end"); },
          fail: (code: string) => { calls.push(`fail:${code}`); },
        };
      },
      generation: () => {},
      flush: async () => {},
    };
    await expect(
      runSpan(fake, "phase-ok", {}, async (span) => {
        span.end({ ok: true });
        return 7;
      }),
    ).resolves.toBe(7);
    await expect(
      runSpan(fake, "phase-bad", {}, async () => {
        throw Object.assign(new Error("boom"), { code: "SAM_DOWN" });
      }),
    ).rejects.toThrow("boom");
    expect(() =>
      runSpanSync(fake, "phase-sync", {}, (span) => {
        span.end({});
        return "done";
      }),
    ).not.toThrow();
    expect(calls).toEqual([
      "open:phase-ok",
      "end",
      "open:phase-bad",
      "fail:SAM_DOWN",
      "open:phase-sync",
      "end",
    ]);
  });
});
