import { describe, expect, it, vi } from "vitest";

/**
 * Join-mode regression tests (v6 SDK): both stages must open their
 * root observation on the shared deterministic trace id through an
 * explicit parentSpanContext (the documented join pattern — there is
 * no trace-create call to duplicate), propagate session/tags/
 * environment onto every observation, and record the stage summary as
 * root output. Generations nest with usage details; failures close
 * spans exactly once with a safe code.
 */
const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; body: unknown }>,
}));

vi.mock("@langfuse/tracing", () => {
  let nextSpanId = 0;
  const spanId = () => `000000000000${String(nextSpanId += 1).padStart(4, "0")}`;
  const makeNative = (name: string) => {
    const id = spanId();
    const native = {
      otelSpan: { spanContext: () => ({ traceId: "0".repeat(32), spanId: id, traceFlags: 1 }) },
      startObservation: (childName: string, attrs: unknown, opts: unknown) => {
        calls.push({ method: "native.startObservation", body: { parent: name, name: childName, attrs, opts } });
        return makeNative(childName);
      },
      update: (attrs: unknown) => {
        calls.push({ method: `update:${name}`, body: attrs });
        return native;
      },
      end: () => {
        calls.push({ method: `end:${name}`, body: {} });
      },
    };
    return native;
  };
  return {
    propagateAttributes: (params: unknown, create: () => unknown) => {
      calls.push({ method: "propagateAttributes", body: params });
      return create();
    },
    setLangfuseTracerProvider: () => {},
    startObservation: (name: string, attrs: unknown, opts: unknown) => {
      calls.push({ method: "startObservation", body: { name, attrs, opts } });
      return makeNative(name);
    },
  };
});

vi.mock("@langfuse/otel", () => ({
  LangfuseSpanProcessor: class {
    constructor(params: unknown) {
      calls.push({ method: "LangfuseSpanProcessor", body: params });
    }

    async forceFlush(): Promise<void> {
      calls.push({ method: "forceFlush", body: {} });
    }
  },
}));

vi.mock("@opentelemetry/sdk-trace-node", () => ({
  NodeTracerProvider: class {
    constructor() {
      calls.push({ method: "NodeTracerProvider", body: {} });
    }
  },
}));

vi.mock("@opentelemetry/context-async-hooks", () => ({
  AsyncLocalStorageContextManager: class {
    enable() {
      calls.push({ method: "AsyncLocalStorageContextManager.enable", body: {} });
      return this;
    }
  },
}));

import {
  ANALYSIS_TRACE_NAME,
  analysisTraceId,
  createAnalysisTracer,
} from "../../../../src/server/observability/langfuse-trace";

const ENV = { LANGFUSE_SECRET_KEY: "sk-test", LANGFUSE_PUBLIC_KEY: "pk-test" };
const IDENTITY = { sessionId: "walkthrough-1", analysisId: "analysis-9", attempt: 2 };
const TRACE_ID = analysisTraceId(IDENTITY);

describe("langfuse v6 stage roots (shared deterministic trace)", () => {
  it("create mode opens a root on the trace id and propagates attributes everywhere", async () => {
    calls.length = 0;
    const tracer = createAnalysisTracer(ENV, TRACE_ID, { room: "kitchen" }, { sessionId: "walkthrough-1", room: "kitchen" });
    expect(tracer.enabled).toBe(true);
    const span = tracer.span("sam-upload", { file: "f" });
    span.end({ ok: true });
    tracer.generation({ name: "muse-map", model: "m", input: {}, outputText: "t", usage: { inputTokens: 1, outputTokens: 2 } });
    tracer.finish({ stage: "segmented" });
    await tracer.flush();

    const processors = calls.filter((call) => call.method === "LangfuseSpanProcessor");
    expect(processors).toHaveLength(1);
    expect(processors[0]?.body).toMatchObject({
      secretKey: "sk-test",
      publicKey: "pk-test",
      baseUrl: "https://cloud.langfuse.com",
    });
    // Propagation needs a real async context manager (noop drops attrs).
    expect(calls.map((call) => call.method)).toContain("AsyncLocalStorageContextManager.enable");

    const roots = calls.filter((call) => call.method === "startObservation");
    expect(roots).toHaveLength(1);
    expect(roots[0]?.body).toMatchObject({
      name: ANALYSIS_TRACE_NAME,
      attrs: { input: { room: "kitchen" } },
      opts: {
        parentSpanContext: { traceId: TRACE_ID, spanId: expect.stringMatching(/^[0-9a-f]{16}$/), traceFlags: 1 },
      },
    });

    const propagated = calls.filter((call) => call.method === "propagateAttributes");
    // Root + span + generation creations each propagate; finish/flush create nothing.
    expect(propagated).toHaveLength(3);
    for (const call of propagated) {
      expect(call.body).toMatchObject({
        traceName: ANALYSIS_TRACE_NAME,
        sessionId: "walkthrough-1",
        tags: [ANALYSIS_TRACE_NAME, "room:kitchen"],
        environment: "development",
      });
    }

    const generations = calls.filter((call) => call.method === "native.startObservation" &&
      (call.body as { opts?: unknown }).opts !== undefined);
    expect(generations.map((call) => (call.body as { name: string }).name)).toContain("muse-map");
    expect(calls).toContainEqual(expect.objectContaining({
      method: "update:muse-map",
      body: { output: "t", usageDetails: { input: 1, output: 2 } },
    }));

    // Stage summary lands on the root observation, not a trace-update call.
    expect(calls).toContainEqual(expect.objectContaining({
      method: `update:${ANALYSIS_TRACE_NAME}`,
      body: { output: { summary: { stage: "segmented" } } },
    }));
    expect(calls.filter((call) => call.method === `end:${ANALYSIS_TRACE_NAME}`)).toHaveLength(1);
    expect(calls.map((call) => call.method)).toContain("forceFlush");
  });

  it("join mode opens a second root on the same trace id (no duplicate trace)", async () => {
    calls.length = 0;
    const tracer = createAnalysisTracer(
      ENV, TRACE_ID, { room: "kitchen" }, { sessionId: "walkthrough-1", room: "kitchen" }, true,
    );
    expect(tracer.enabled).toBe(true);
    tracer.span("map", { room: "kitchen" }).end({ ok: true });
    tracer.finish({ stage: "mapped" });
    await tracer.flush();

    const roots = calls.filter((call) => call.method === "startObservation");
    expect(roots).toHaveLength(1);
    expect(roots[0]?.body).toMatchObject({
      opts: { parentSpanContext: { traceId: TRACE_ID } },
    });
    // One trace-create equivalent never exists in v6: joining is by
    // construction (same trace id), so nothing can duplicate a trace.
    expect(calls.map((call) => call.method)).not.toContain("client.trace");
    expect(calls).toContainEqual(expect.objectContaining({
      method: `update:${ANALYSIS_TRACE_NAME}`,
      body: { output: { summary: { stage: "mapped" } } },
    }));
  });

  it("failures close spans exactly once with a safe code and flush still ends the root", async () => {
    calls.length = 0;
    const tracer = createAnalysisTracer(ENV, TRACE_ID, { room: "kitchen" }, { sessionId: "s", room: "kitchen" });
    const span = tracer.span("sam-upload", {});
    span.fail("PROVIDER_FAILURE");
    span.fail("PROVIDER_FAILURE");
    span.end({ ok: true });
    await tracer.flush();

    expect(calls).toContainEqual(expect.objectContaining({
      method: "update:sam-upload",
      body: { output: { ok: false }, level: "ERROR", statusMessage: "PROVIDER_FAILURE" },
    }));
    expect(calls.filter((call) => call.method === "end:sam-upload")).toHaveLength(1);
    // finish() was never called: flush ends the root without claiming output.
    expect(calls.filter((call) => call.method === `end:${ANALYSIS_TRACE_NAME}`)).toHaveLength(1);
    expect(calls.map((call) => call.method)).not.toContain(`update:${ANALYSIS_TRACE_NAME}`);
    expect(calls.map((call) => call.method)).toContain("forceFlush");
  });

  it("initializes the isolated provider once with explicit credentials", () => {
    calls.length = 0;
    createAnalysisTracer(ENV, TRACE_ID, {}, { sessionId: "s", room: "kitchen" });
    createAnalysisTracer(ENV, TRACE_ID, {}, { sessionId: "s", room: "kitchen" });
    // Singleton: at most one provider setup across tracers in this file
    // (earlier tests may already have initialized it).
    expect(calls.filter((call) => call.method === "NodeTracerProvider").length).toBeLessThanOrEqual(1);
    const processors = calls.filter((call) => call.method === "LangfuseSpanProcessor");
    expect(processors.length).toBeLessThanOrEqual(1);
    if (processors.length === 1) {
      expect(processors[0]?.body).toMatchObject({
        secretKey: "sk-test",
        publicKey: "pk-test",
        baseUrl: "https://cloud.langfuse.com",
      });
    }
  });
});
