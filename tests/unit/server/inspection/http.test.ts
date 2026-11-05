import { describe, expect, it, vi } from "vitest";
import { assertInspectionAuth, assertInspectionRequest, boundedInspectionJson } from "../../../../src/server/inspection/http";
import { InspectionPersistenceError } from "../../../../src/server/inspection/store";
import { signAuthCookie } from "../../../../src/server/auth";

describe("inspection HTTP boundaries", () => {
  it("fails closed in production when the passcode is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INSPECTION_PASSCODE", "");
    try {
      await expect(assertInspectionAuth(new Request("https://app.test/api/inspections/session-a")))
        .rejects.toMatchObject({ code: "SETUP_REQUIRED", status: 503 });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("accepts a valid passcode cookie in production", async () => {
    const passcode = "pilot-code";
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INSPECTION_PASSCODE", passcode);
    try {
      const cookie = await signAuthCookie(passcode);
      await expect(assertInspectionAuth(new Request("https://app.test/api/inspections/session-a", {
        headers: { cookie: `mi_auth=${cookie}` },
      }))).resolves.toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("accepts same-origin requests and rejects cross-origin writes", () => {
    const request = new Request("https://app.test/api/inspections/session-a", {
      method: "PUT",
      headers: { origin: "https://app.test" },
    });
    expect(() => assertInspectionRequest(request)).not.toThrow();

    const crossOrigin = new Request("https://app.test/api/inspections/session-a", {
      method: "PUT",
      headers: { origin: "https://attacker.test" },
    });
    expect(() => assertInspectionRequest(crossOrigin)).toThrowError(InspectionPersistenceError);
  });

  it("accepts the configured public origin when the managed ingress rewrites the request URL", () => {
    vi.stubEnv("APP_PUBLIC_ORIGIN", "https://walkthrough.example.org");
    try {
      const request = new Request("http://10.0.0.5:3000/api/inspections/session-a", {
        method: "PUT",
        headers: { origin: "https://walkthrough.example.org" },
      });
      expect(() => assertInspectionRequest(request)).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("accepts equivalent loopback aliases on the same port", () => {
    const request = new Request("http://localhost:3000/api/inspections/session-a", {
      method: "PUT",
      headers: { origin: "http://127.0.0.1:3000" },
    });
    expect(() => assertInspectionRequest(request)).not.toThrow();
  });

  it("parses bounded JSON and rejects oversized payloads before parsing", async () => {
    const request = new Request("https://app.test/api/inspections/session-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inspection: { sessionId: "session-a" } }),
    });
    await expect(boundedInspectionJson(request)).resolves.toEqual({ inspection: { sessionId: "session-a" } });

    const oversized = new Request("https://app.test/api/inspections/session-a", {
      method: "PUT",
      headers: { "content-type": "application/json", "content-length": "1048577" },
      body: "{}",
    });
    await expect(boundedInspectionJson(oversized)).rejects.toMatchObject({ status: 413 });
  });
});
