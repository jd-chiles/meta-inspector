import { describe, expect, it, vi } from "vitest";
import { assertJobRequestSameOrigin, boundedJsonBody, VideoJobHttpError } from "../../../../src/server/jobs/http";

describe("video job HTTP boundaries", () => {
  it("accepts the configured public origin behind a rewritten managed ingress URL", () => {
    vi.stubEnv("APP_PUBLIC_ORIGIN", "https://walkthrough.example.org");
    try {
      const request = new Request("http://10.0.0.5:3000/api/video/jobs", {
        method: "POST",
        headers: { origin: "https://walkthrough.example.org" },
      });
      expect(() => assertJobRequestSameOrigin(request)).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects an origin that differs from the configured public app", () => {
    vi.stubEnv("APP_PUBLIC_ORIGIN", "https://walkthrough.example.org");
    try {
      const request = new Request("http://10.0.0.5:3000/api/video/jobs", {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      });
      expect(() => assertJobRequestSameOrigin(request)).toThrowError(VideoJobHttpError);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("accepts equivalent loopback aliases on the same port", () => {
    const request = new Request("http://localhost:3101/api/video/jobs", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3101" },
    });
    expect(() => assertJobRequestSameOrigin(request)).not.toThrow();
  });

  it("bounds the streamed body even when content length is missing", async () => {
    const bytes = new Uint8Array(40_000).fill(0x20);
    const request = new Request("https://app.test/api/video/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: bytes,
    });
    await expect(boundedJsonBody(request)).rejects.toMatchObject({ status: 413, code: "INVALID_REQUEST" });
  });
});
