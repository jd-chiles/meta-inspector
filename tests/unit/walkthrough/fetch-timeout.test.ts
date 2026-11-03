import { describe, expect, it, vi } from "vitest";

import { FetchTimeoutError, fetchWithTimeout } from "../../../src/features/walkthrough/fetch-timeout";

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

describe("fetchWithTimeout", () => {
  it("resolves fast responses untouched", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const response = await fetchWithTimeout("/api/x", { method: "POST" }, 1000, fetchImpl as typeof fetch);
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws FetchTimeoutError when the server never answers", async () => {
    const fetchImpl = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        }),
    );
    await expect(fetchWithTimeout("/api/x", { method: "POST" }, 30, fetchImpl as typeof fetch)).rejects.toBeInstanceOf(
      FetchTimeoutError,
    );
  });

  it("lets a parent abort win over the timeout", async () => {
    const parent = new AbortController();
    const fetchImpl = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("parent", "AbortError")), { once: true });
        }),
    );
    const pending = fetchWithTimeout("/api/x", { method: "POST", signal: parent.signal }, 5000, fetchImpl as typeof fetch);
    parent.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
