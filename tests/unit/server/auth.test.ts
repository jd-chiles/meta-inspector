import { describe, expect, it } from "vitest";
import {
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
});
