import { describe, expect, it, vi } from "vitest";

import {
  handlePolishCaseNoteRequest,
  isTextPolishEnabled,
} from "../../../src/server/exports/polish-case-note";
import type { FetchImpl } from "../../../src/server/meta/adapter";

const TEMPLATE = "Case note draft — review before pasting into HMIS.\nDate: 2026-10-29\nDetermination: APPROVED\n";

function request(
  body: unknown,
  headers: Record<string, string> = {},
  url = "https://walkthrough.test/api/exports/polish-case-note",
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function completionResponse(text: string, status = 200): Response {
  return new Response(
    JSON.stringify({ id: "chatcmpl-test", choices: [{ message: { content: text } }] }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function fetchImplFrom(response: Response | Error): FetchImpl {
  return (async () => {
    if (response instanceof Error) throw response;
    return {
      ok: response.ok,
      status: response.status,
      headers: { get: () => null },
      body: null,
      json: async () => (await response.json()) as unknown,
    };
  }) as FetchImpl;
}

describe("case-note polish route", () => {
  it("is disabled by default and enabled only by TEXT_POLISH_ENABLED=1", () => {
    expect(isTextPolishEnabled({})).toBe(false);
    expect(isTextPolishEnabled({ TEXT_POLISH_ENABLED: undefined })).toBe(false);
    expect(isTextPolishEnabled({ TEXT_POLISH_ENABLED: "0" })).toBe(false);
    expect(isTextPolishEnabled({ TEXT_POLISH_ENABLED: "true" })).toBe(false);
    expect(isTextPolishEnabled({ TEXT_POLISH_ENABLED: "1" })).toBe(true);
  });

  it("returns the template unchanged when the flag is off, without calling a provider", async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => {
      throw new Error("provider must not be called when polish is disabled");
    });
    const result = await handlePolishCaseNoteRequest(request({ text: TEMPLATE }), {
      metaEnv: {},
      fetchImpl,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ text: TEMPLATE, polished: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns polished text when the flag is on and the provider succeeds", async () => {
    const seen: Array<{ url: string; init?: object }> = [];
    const fetchImpl: FetchImpl = (async (url, init) => {
      seen.push({ url, init });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: null,
        json: async () => ({ choices: [{ message: { content: "Polished note text." } }] }),
      };
    }) as FetchImpl;
    const result = await handlePolishCaseNoteRequest(request({ text: TEMPLATE }), {
      metaEnv: { TEXT_POLISH_ENABLED: "1", META_API_KEY: "test-key" },
      fetchImpl,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ text: "Polished note text.", polished: true, model: "muse-spark-1.3" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://api.meta.ai/v1/chat/completions");
    const sent = JSON.parse((seen[0]!.init as { body: string }).body) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(sent.model).toBe("muse-spark-1.3");
    expect(sent.messages[0]).toMatchObject({ role: "developer" });
    expect(sent.messages[0]!.content).toMatch(/without adding facts/i);
    expect(sent.messages[1]).toMatchObject({ role: "user", content: TEMPLATE });
  });

  it.each([
    ["provider error", fetchImplFrom(new Response("{}", { status: 500 }))],
    ["rate limit", fetchImplFrom(new Response("{}", { status: 429 }))],
    ["network failure", fetchImplFrom(new Error("socket hang up"))],
    ["empty output", fetchImplFrom(completionResponse("   "))],
    ["missing key", undefined],
  ])("falls back to the template on %s", async (_caseName, fetchImpl) => {
    const result = await handlePolishCaseNoteRequest(request({ text: TEMPLATE }), {
      metaEnv: { TEXT_POLISH_ENABLED: "1", ...(_caseName === "missing key" ? {} : { META_API_KEY: "test-key" }) },
      fetchImpl: fetchImpl as FetchImpl | undefined,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ text: TEMPLATE, polished: false });
  });

  it("falls back to the template when the base URL is not allowlisted", async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => {
      throw new Error("non-allowlisted base URL must never be fetched");
    });
    const result = await handlePolishCaseNoteRequest(request({ text: TEMPLATE }), {
      metaEnv: { TEXT_POLISH_ENABLED: "1", META_API_KEY: "test-key", META_API_BASE_URL: "https://evil.test/v1" },
      fetchImpl,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ text: TEMPLATE, polished: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects cross-origin, malformed, and oversized requests", async () => {
    const enabled = { metaEnv: { TEXT_POLISH_ENABLED: "1", META_API_KEY: "test-key" } };
    expect((await handlePolishCaseNoteRequest(request({ text: TEMPLATE }, { origin: "https://other.test" }), enabled)).status).toBe(403);
    expect((await handlePolishCaseNoteRequest(request({ text: TEMPLATE, extra: true }), enabled)).status).toBe(400);
    expect((await handlePolishCaseNoteRequest(request({ text: "" }), enabled)).status).toBe(400);
    expect((await handlePolishCaseNoteRequest(request({ text: "x".repeat(20_000) }), enabled)).status).toBe(400);
    expect((await handlePolishCaseNoteRequest(request("x".repeat(30_000)), enabled)).status).toBe(413);
    expect((await handlePolishCaseNoteRequest(request("not-json{"), enabled)).status).toBe(400);
    const wrongContentType = new Request("https://walkthrough.test/api/exports/polish-case-note", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ text: TEMPLATE }),
    });
    expect((await handlePolishCaseNoteRequest(wrongContentType, enabled)).status).toBe(400);
  });
});
