import { describe, expect, it } from "vitest";

import { splashStatus } from "../../../src/app/boot-splash";

describe("boot splash status", () => {
  it("stays quiet for fast boots, then narrates a cold start", () => {
    expect(splashStatus(0)).toBe("Loading…");
    expect(splashStatus(2999)).toBe("Loading…");
    expect(splashStatus(3000)).toContain("Waking the server");
    expect(splashStatus(12_400)).toContain("(12s)");
    expect(splashStatus(20_000)).toContain("Reload if this persists");
    expect(splashStatus(45_000)).toContain("(45s)");
  });
});
