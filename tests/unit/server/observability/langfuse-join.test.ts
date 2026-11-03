import { describe, expect, it, vi } from "vitest";

/**
 * Join-mode regression tests: the map stage must bind to the existing
 * trace id instead of re-sending a trace-create (v4 backends ingest a
 * re-sent id as a duplicate trace), and finish() must record a span
 * instead of trace.update (which re-sends a trace-create).
 */
const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; body: unknown }>,
}));

vi.mock("langfuse", () => {
  const spanHandle = () => ({ end: () => {} });
  return {
    Langfuse: class {
      trace = (body: unknown) => {
        calls.push({ method: "client.trace", body });
        return {
          span: (spanBody: unknown) => {
            calls.push({ method: "trace.span", body: spanBody });
            return spanHandle();
          },
          generation: (genBody: unknown) => {
            calls.push({ method: "trace.generation", body: genBody });
          },
          update: (updateBody: unknown) => {
            calls.push({ method: "trace.update", body: updateBody });
          },
        };
      };
      span = (body: unknown) => {
        calls.push({ method: "client.span", body });
        return spanHandle();
      };
      generation = (body: unknown) => {
        calls.push({ method: "client.generation", body });
      };
      flushAsync = async (): Promise<void> => {};
    },
  };
});

import { createAnalysisTracer } from "../../../../src/server/observability/langfuse-trace";

const ENV = { LANGFUSE_SECRET_KEY: "sk-test", LANGFUSE_PUBLIC_KEY: "pk-test" };

describe("langfuse join mode (no duplicate traces)", () => {
  it("create mode sends one trace-create and routes observations through it", () => {
    calls.length = 0;
    const tracer = createAnalysisTracer(ENV, "analysis-1", { room: "kitchen" }, { sessionId: "s", room: "kitchen" });
    expect(tracer.enabled).toBe(true);
    tracer.span("sam-upload", { file: "f" }).end({ ok: true });
    tracer.generation({ name: "muse-map", model: "m", input: {}, outputText: "t" });
    tracer.finish({ stage: "segmented" });
    const methods = calls.map((call) => call.method);
    expect(methods.filter((method) => method === "client.trace")).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({ id: "analysis-1" });
    expect(methods).toContain("trace.span");
    expect(methods).toContain("trace.generation");
    expect(methods).not.toContain("trace.update");
    expect(methods).not.toContain("client.span");
    expect(methods).not.toContain("client.generation");
  });

  it("join mode never re-sends the trace and routes by explicit traceId", () => {
    calls.length = 0;
    const tracer = createAnalysisTracer(
      ENV, "analysis-1", { room: "kitchen" }, { sessionId: "s", room: "kitchen" }, true,
    );
    expect(tracer.enabled).toBe(true);
    tracer.span("map", { room: "kitchen" }).end({ ok: true });
    tracer.generation({ name: "muse-map", model: "m", input: {}, outputText: "t" });
    tracer.finish({ stage: "mapped" });
    const methods = calls.map((call) => call.method);
    expect(methods).not.toContain("client.trace");
    expect(methods).not.toContain("trace.update");
    const spans = calls.filter((call) => call.method === "client.span");
    expect(spans.length).toBeGreaterThanOrEqual(2);
    for (const span of spans) expect(span.body).toMatchObject({ traceId: "analysis-1" });
    expect(spans.at(-1)?.body).toMatchObject({ name: "stage-result" });
    const generations = calls.filter((call) => call.method === "client.generation");
    expect(generations).toHaveLength(1);
    expect(generations[0]?.body).toMatchObject({ traceId: "analysis-1" });
  });
});
