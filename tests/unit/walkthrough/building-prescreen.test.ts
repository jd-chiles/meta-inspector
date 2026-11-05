import { describe, expect, it } from "vitest";

import {
  DEMO_PRESREEN_ADDRESS,
  PRESCREEN_FIXTURE_BANNER,
  PRESCREEN_ILLUSTRATIVE_BANNER,
  prescreenDecisionForAddress,
} from "../../../src/features/walkthrough/building-prescreen";

describe("building pre-screen routing", () => {
  it("answers blank input with the explainer only", () => {
    expect(prescreenDecisionForAddress("")).toEqual({ kind: "empty" });
    expect(prescreenDecisionForAddress("   ")).toEqual({ kind: "empty" });
  });

  it("answers the literal demo address with the labeled example", () => {
    expect(DEMO_PRESREEN_ADDRESS).toBe("123 Demo St (example)");
    expect(prescreenDecisionForAddress("123 Demo St (example)")).toEqual({ kind: "example" });
    expect(prescreenDecisionForAddress("  123 demo st (example) ")).toEqual({ kind: "example" });
    expect(PRESCREEN_ILLUSTRATIVE_BANNER).toBe("Illustrative example — live records not connected.");
  });

  it("routes every other address to the live pipeline, never to the example", () => {
    for (const address of ["123 Demo St", "123 Demo Street", "456 Real Ave", "123 Demo St (example) Apt 2"]) {
      expect(prescreenDecisionForAddress(address)).toEqual({ kind: "live" });
    }
    expect(PRESCREEN_FIXTURE_BANNER).toBe("Sample pre-screen — not live public records.");
  });
});
