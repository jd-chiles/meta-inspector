import { describe, expect, it, vi } from "vitest";

import { validateGuideDraft } from "../../../src/domain/guide";
import { handleGuideRequest } from "../../../src/server/guide";
import type { FetchImpl } from "../../../src/server/meta/adapter";

function request(
  body: unknown,
  headers: Record<string, string> = {},
  url = "https://walkthrough.test/api/guide",
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("bounded Form 1083 guide", () => {
  it("accepts a concise guide artifact and rejects verdict language or extra fields", () => {
    expect(validateGuideDraft({
      message: "Inspect this area in person using the supplied form instructions.",
      actionPlan: ["Record what you observed."],
    }).ok).toBe(true);
    expect(validateGuideDraft({
      message: "This area passes the inspection.",
      actionPlan: ["Continue."],
    }).ok).toBe(false);
    expect(validateGuideDraft({
      message: "Review this area.",
      actionPlan: ["Continue."],
      verdict: "pass",
    }).ok).toBe(false);
  });

  it("returns state-aware fixture guidance and a chat action card", async () => {
    const result = await handleGuideRequest(request({
      itemId: "demo-water-supply",
      action: "next",
      stage: "analysis-ready",
    }), { mode: "fixture" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      mode: "fixture",
      fixtureNotice: "Scripted guide response — not live inference.",
      guide: {
        message: expect.stringContaining("waiting for your review"),
        actionPlan: expect.arrayContaining([expect.stringContaining("in-person check")]),
      },
    });
  });

  it("rejects cross-origin, arbitrary user text, unknown items, and oversized requests", async () => {
    const body = { itemId: "demo-water-supply", action: "next", stage: "start" };
    expect((await handleGuideRequest(request(body, { origin: "https://other.test" }), { mode: "fixture" })).status).toBe(403);
    expect((await handleGuideRequest(request({ ...body, prompt: "tenant address" }), { mode: "fixture" })).status).toBe(400);
    expect((await handleGuideRequest(request({ ...body, itemId: "unknown" }), { mode: "fixture" })).status).toBe(409);
    const large = await handleGuideRequest(request("x".repeat(5000)), { mode: "fixture" });
    expect(large.status).toBe(413);
  });

  it("accepts same-machine loopback aliases only on the same scheme and port", async () => {
    const body = { itemId: "demo-water-supply", action: "next", stage: "start" };
    const alias = request(body, { origin: "http://localhost:3101" }, "http://127.0.0.1:3101/api/guide");
    const wrongPort = request(body, { origin: "http://localhost:3100" }, "http://127.0.0.1:3101/api/guide");
    expect((await handleGuideRequest(alias, { mode: "fixture" })).status).toBe(200);
    expect((await handleGuideRequest(wrongPort, { mode: "fixture" })).status).toBe(403);
  });

  it("sends only an allowlisted guide action and catalog text to Meta in live mode", async () => {
    let sentBody = "";
    const fetchImpl: FetchImpl = vi.fn(async (_url, init) => {
      sentBody = init?.body ?? "";
      return {
        ok: true,
        status: 200,
          headers: { get: (name: string) => name.toLowerCase() === "x-request-id" ? "guide-req-1" : null },
        json: async () => ({
          id: "guide-req-1",
          choices: [{ message: { content: JSON.stringify({
            message: "Check the water in person using the form instructions.",
            actionPlan: ["Record what you observed."],
          }) } }],
        }),
      };
    });
    const result = await handleGuideRequest(request({
      itemId: "demo-water-supply",
      action: "check",
      stage: "worker-reviewed",
    }), {
      mode: "live",
      metaEnv: { APP_ANALYSIS_MODE: "live", META_API_KEY: "test-only-key" },
      fetchImpl,
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ mode: "live", requestId: "guide-req-1" });
    expect(sentBody).toContain("Water supply");
    const payload = JSON.parse(sentBody) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userContent = payload.messages.find((message) => message.role === "user")?.content ?? "";
    expect(userContent).not.toMatch(/tenant|address|sessionId|mediaId|image_url/i);
  });

  it("fails closed on invalid model output without returning a provider body", async () => {
    const fetchImpl: FetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ choices: [{ message: { content: '{"message":"This passes","actionPlan":["Done"]}' } }] }),
    }));
    const result = await handleGuideRequest(request({
      itemId: "demo-water-supply",
      action: "check",
      stage: "start",
    }), {
      mode: "live",
      metaEnv: { APP_ANALYSIS_MODE: "live", META_API_KEY: "test-only-key" },
      fetchImpl,
    });
    expect(result.status).toBe(502);
    expect(JSON.stringify(result.body)).not.toContain("This passes");
  });
});
