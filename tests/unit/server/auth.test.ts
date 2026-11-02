import { describe, expect, it, vi } from "vitest";
import {
  clientIpFromHeaders,
  createUnlockThrottle,
  isAuthGateEnabled,
  signAuthCookie,
  verifyAuthCookie,
  verifyPasscode,
} from "../../../src/server/auth";

describe("passcode gate", () => {
  it("is enabled only when a passcode is configured", () => {
    expect(isAuthGateEnabled({})).toBe(false);
    expect(isAuthGateEnabled({ INSPECTION_PASSCODE: "" })).toBe(false);
    expect(isAuthGateEnabled({ INSPECTION_PASSCODE: "pilot-code" })).toBe(true);
  });

  it("accepts the exact passcode and rejects wrong or empty input", async () => {
    expect(await verifyPasscode("pilot-code", "pilot-code")).toBe(true);
    expect(await verifyPasscode("Pilot-Code", "pilot-code")).toBe(false);
    expect(await verifyPasscode("", "pilot-code")).toBe(false);
    expect(await verifyPasscode("pilot-code", "")).toBe(false);
  });

  it("round-trips the session cookie and rejects tampered values", async () => {
    const cookie = await signAuthCookie("pilot-code");
    expect(await verifyAuthCookie(cookie, "pilot-code")).toBe(true);
    expect(await verifyAuthCookie(`${cookie}x`, "pilot-code")).toBe(false);
    expect(await verifyAuthCookie(cookie, "other-code")).toBe(false);
    expect(await verifyAuthCookie(undefined, "pilot-code")).toBe(false);
    expect(await verifyAuthCookie(cookie, "")).toBe(false);
  });

  it("keys throttling on the rightmost forwarded entry, never the spoofable leftmost", () => {
    const chained = new Headers({ "x-forwarded-for": "203.0.113.9, 198.51.100.7, 192.0.2.44" });
    expect(clientIpFromHeaders(chained)).toBe("192.0.2.44");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": " 203.0.113.9 ,, " }))).toBe("203.0.113.9");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "   " }))).toBe("unknown");
  });

  it("allows ten tries per window per IP, then throttles until expiry", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const throttle = createUnlockThrottle({ maxAttempts: 10, windowMs: 60_000 });
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        expect(throttle.throttled("192.0.2.44")).toBe(false);
      }
      expect(throttle.throttled("192.0.2.44")).toBe(true);
      expect(throttle.throttled("203.0.113.9")).toBe(false);
      vi.setSystemTime(1_000_000 + 60_001);
      expect(throttle.throttled("192.0.2.44")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds throttle memory with expiry sweep plus oldest-first eviction", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(2_000_000);
      const throttle = createUnlockThrottle({ maxAttempts: 10, windowMs: 60_000, maxEntries: 2 });
      expect(throttle.throttled("192.0.2.1")).toBe(false);
      expect(throttle.throttled("192.0.2.2")).toBe(false);
      expect(throttle.size()).toBe(2);
      vi.setSystemTime(2_000_000 + 60_001);
      expect(throttle.throttled("192.0.2.3")).toBe(false);
      expect(throttle.size()).toBe(1);
      expect(throttle.throttled("192.0.2.1")).toBe(false);
      expect(throttle.throttled("192.0.2.2")).toBe(false);
      expect(throttle.size()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
