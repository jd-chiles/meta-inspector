import { describe, expect, it } from "vitest";

import { checkAppOrigin } from "../../../src/server/request-origin";

function request(url: string, origin?: string): Request {
  return new Request(url, {
    method: "POST",
    headers: origin ? { origin } : {},
    body: "{}",
  });
}

const PUBLIC = "https://metainspect-dev.livelyriver-978b26d8.westus2.azurecontainerapps.io";
// What managed ingress forwards to the container: internal scheme and host.
const INTERNAL = "http://10.0.0.5:3000/api/prescreen";

describe("checkAppOrigin", () => {
  it("allows a direct same-origin match", () => {
    expect(checkAppOrigin(request("https://app.test/api/x", "https://app.test"), null)).toEqual({
      allowed: true,
      configError: false,
    });
  });

  it("allows the public origin behind managed ingress (the production case)", () => {
    expect(checkAppOrigin(request(INTERNAL, PUBLIC), PUBLIC)).toEqual({
      allowed: true,
      configError: false,
    });
  });

  it("still rejects other origins when a public origin is configured", () => {
    expect(checkAppOrigin(request(INTERNAL, "https://evil.test"), PUBLIC)).toEqual({
      allowed: false,
      configError: false,
    });
  });

  it("rejects behind ingress when no public origin is configured", () => {
    expect(checkAppOrigin(request(INTERNAL, PUBLIC), null).allowed).toBe(false);
    expect(checkAppOrigin(request(INTERNAL, PUBLIC), "").allowed).toBe(false);
  });

  it("fails loudly on a malformed configured origin", () => {
    for (const bad of ["not-a-url", "https://app.test/path", "ftp://app.test", "https://app.test:bad"]) {
      expect(checkAppOrigin(request(INTERNAL, PUBLIC), bad)).toEqual({
        allowed: false,
        configError: true,
      });
    }
  });

  it("keeps loopback equivalence and missing-origin callers", () => {
    expect(
      checkAppOrigin(request("http://127.0.0.1:3101/api/x", "http://localhost:3101"), null).allowed,
    ).toBe(true);
    expect(
      checkAppOrigin(request("http://127.0.0.1:3101/api/x", "http://localhost:3100"), null).allowed,
    ).toBe(false);
    expect(checkAppOrigin(request("http://127.0.0.1:3101/api/x"), null).allowed).toBe(true);
    expect(checkAppOrigin(request(INTERNAL, ":::not a url:::"), PUBLIC).allowed).toBe(false);
  });
});
