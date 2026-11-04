import { describe, expect, it } from "vitest";

import {
  ANALYSIS_TRACE_NAME,
  analysisTraceId,
  createAnalysisTracer,
  extractResponseUsage,
  isLangfuseConfigured,
  resolveLangfuseBaseUrl,
  resolveLangfuseEnvironment,
  runSpan,
  runSpanSync,
  sanitizeRoomTag,
  spanErrorCode,
  type ActiveSpan,
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

  it("derives a deterministic W3C trace id shared by both stages", () => {
    const identity = { sessionId: "session-1", analysisId: "analysis-9", attempt: 2 };
    const first = analysisTraceId(identity);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(analysisTraceId({ ...identity })).toBe(first);
    expect(analysisTraceId({ ...identity, attempt: 3 })).not.toBe(first);
    expect(analysisTraceId({ sessionId: "a/b:c", analysisId: "d e", attempt: 1 })).toMatch(/^[0-9a-f]{32}$/);
  });

  it("matches createTraceId for the same seed (verified sync mirror)", async () => {
    const { createTraceId } = await import("@langfuse/tracing");
    const identity = { sessionId: "session-1", analysisId: "analysis-9", attempt: 2 };
    const seed = `analysis-${identity.sessionId}-${identity.analysisId}-a${identity.attempt}`;
    await expect(createTraceId(seed)).resolves.toBe(analysisTraceId(identity));
  });

  it("returns a safe no-op tracer when unconfigured", async () => {
    const traceId = analysisTraceId({ sessionId: "s", analysisId: "a", attempt: 1 });
    const tracer = createAnalysisTracer({}, traceId, { room: "kitchen" }, { sessionId: "", room: "" });
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
      analysisTraceId({ sessionId: "session-test", analysisId: "construct", attempt: 1 }),
      { room: "kitchen" },
      { sessionId: "session-test", room: "kitchen" },
    );
    expect(tracer.enabled).toBe(true);
  });

  it("falls back to no-op for a non-W3C trace id even with keys", () => {
    const tracer = createAnalysisTracer(
      { LANGFUSE_SECRET_KEY: "sk-test", LANGFUSE_PUBLIC_KEY: "pk-test" },
      "analysis-not-a-trace-id",
      { room: "kitchen" },
      { sessionId: "session-test", room: "kitchen" },
    );
    expect(tracer.enabled).toBe(false);
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
          id: null,
          end: () => { calls.push("end"); },
          fail: (code: string) => { calls.push(`fail:${code}`); },
        };
      },
      generation: () => {},
      finish: () => {},
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

describe("langfuse best-practice attributes", () => {
  it("prefers LANGFUSE_BASE_URL, then legacy LANGFUSE_BASEURL, then the default", () => {
    expect(resolveLangfuseBaseUrl({})).toBe("https://cloud.langfuse.com");
    expect(resolveLangfuseBaseUrl({ LANGFUSE_BASEURL: "https://self.example" })).toBe(
      "https://self.example",
    );
    expect(
      resolveLangfuseBaseUrl({
        LANGFUSE_BASEURL: "https://self.example",
        LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com",
      }),
    ).toBe("https://us.cloud.langfuse.com");
    expect(resolveLangfuseBaseUrl({ LANGFUSE_BASEURL: "  " })).toBe("https://cloud.langfuse.com");
  });

  it("resolves environment from explicit override then app origin", () => {
    expect(resolveLangfuseEnvironment({})).toBe("development");
    expect(resolveLangfuseEnvironment({ LANGFUSE_ENVIRONMENT: "staging" })).toBe("staging");
    expect(resolveLangfuseEnvironment({ LANGFUSE_ENVIRONMENT: "Production" })).toBe("production");
    expect(resolveLangfuseEnvironment({ LANGFUSE_ENVIRONMENT: "langfuse-x" })).toBe("development");
    expect(
      resolveLangfuseEnvironment({ APP_PUBLIC_ORIGIN: "https://metainspect-app.example.io" }),
    ).toBe("production");
    expect(
      resolveLangfuseEnvironment({ APP_PUBLIC_ORIGIN: "https://metainspect-dev.example.io" }),
    ).toBe("development");
  });

  it("sanitizes room tags to safe filter values", () => {
    expect(sanitizeRoomTag("kitchen")).toBe("room:kitchen");
    expect(sanitizeRoomTag("Living Room")).toBe("room:living-room");
    expect(sanitizeRoomTag("")).toBe("room:unknown");
  });

  it("extracts token usage from responses-api and chat shapes only", () => {
    expect(extractResponseUsage({ usage: { input_tokens: 120, output_tokens: 45 } })).toEqual({
      inputTokens: 120,
      outputTokens: 45,
    });
    expect(extractResponseUsage({ usage: { prompt_tokens: 10, completion_tokens: 3 } })).toEqual({
      inputTokens: 10,
      outputTokens: 3,
    });
    expect(extractResponseUsage({})).toBeUndefined();
    expect(extractResponseUsage({ usage: { input_tokens: -1, output_tokens: 2 } })).toBeUndefined();
    expect(extractResponseUsage({ usage: { input_tokens: "many" } })).toBeUndefined();
    expect(extractResponseUsage(null)).toBeUndefined();
  });

  it("threads parent spans through the runSpan helpers", async () => {
    const seen: Array<string | null> = [];
    const parent: ActiveSpan = { id: "parent-1", end: () => {}, fail: () => {} };
    const fake: AnalysisTracer = {
      enabled: true,
      span: (_name: string, _input?: unknown, spanParent?: ActiveSpan | null) => {
        seen.push(spanParent?.id ?? null);
        return { id: "child", end: () => {}, fail: () => {} };
      },
      generation: () => {},
      finish: () => {},
      flush: async () => {},
    };
    await runSpan(fake, "child-a", {}, async (span) => { span.end({}); }, parent);
    runSpanSync(fake, "child-b", {}, (span) => { span.end({}); }, parent);
    await runSpan(fake, "orphan", {}, async (span) => { span.end({}); });
    expect(seen).toEqual(["parent-1", "parent-1", null]);
  });

  it("finish and usage generations are safe on the no-op tracer", async () => {
    const traceId = analysisTraceId({ sessionId: "s", analysisId: "a", attempt: 1 });
    const tracer = createAnalysisTracer({}, traceId, { room: "kitchen" }, { sessionId: "s", room: "kitchen" });
    expect(() => tracer.finish({ stage: "mapped" })).not.toThrow();
    expect(() =>
      tracer.generation({
        name: "muse-map",
        model: "muse-spark-1.3",
        input: {},
        outputText: "ok",
        usage: { inputTokens: 1, outputTokens: 2 },
      }),
    ).not.toThrow();
    await expect(tracer.flush()).resolves.toBeUndefined();
  });
});
