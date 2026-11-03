import { describe, expect, it } from "vitest";

import {
  DEMO_PRESREEN_ADDRESS,
  PRESCREEN_ILLUSTRATIVE_BANNER,
  PRESCREEN_NOT_CONNECTED,
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

  it("never presents fixture data for any other address", () => {
    for (const address of ["123 Demo St", "123 Demo Street", "456 Real Ave", "123 Demo St (example) Apt 2"]) {
      expect(prescreenDecisionForAddress(address)).toEqual({ kind: "not-connected" });
    }
    expect(PRESCREEN_NOT_CONNECTED).toBe("Live check not connected for this address.");
  });
});
