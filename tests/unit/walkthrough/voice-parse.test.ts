import { describe, expect, it } from "vitest";
import { parseBathCount, parseUnitType, parseYesNo } from "../../../src/features/walkthrough/voice-parse";

describe("voice parsing", () => {
  it("parses yes/no with first cue winning and not as no", () => {
    expect(parseYesNo("Yes, hot water is running")).toBe("yes");
    expect(parseYesNo("Nope, the fan is dead")).toBe("no");
    expect(parseYesNo("It is not working")).toBe("no");
    expect(parseYesNo("No, but yes actually")).toBe("no");
    expect(parseYesNo("Maybe later")).toBeNull();
  });

  it("parses unit type from words or bare numbers", () => {
    expect(parseUnitType("It's a studio")).toBe("studio");
    expect(parseUnitType("Two bedroom unit")).toBe("2-bedroom");
    expect(parseUnitType("three")).toBe("3-bedroom");
    expect(parseUnitType("1")).toBe("1-bedroom");
    expect(parseUnitType("a house")).toBeNull();
  });

  it("parses bath count", () => {
    expect(parseBathCount("Two baths")).toBe(2);
    expect(parseBathCount("one bathroom")).toBe(1);
    expect(parseBathCount("3")).toBe(3);
    expect(parseBathCount("several")).toBeNull();
  });
});
