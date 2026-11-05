import { describe, expect, it } from "vitest";

import { splashStatus } from "../../../src/app/boot-splash";

describe("boot splash status", () => {
  it("stays quiet for fast boots, then narrates local device loading", () => {
    expect(splashStatus(0)).toBe("Loading…");
    expect(splashStatus(2999)).toBe("Loading…");
    // The server is always warm on the VPS: never claim it needs waking.
    expect(splashStatus(3000)).toContain("saved work");
    expect(splashStatus(3000)).not.toContain("Waking");
    expect(splashStatus(11_000)).toContain("saved work");
    expect(splashStatus(12_000)).toContain("Tap to reload");
    expect(splashStatus(45_000)).toContain("(45s)");
  });
});
