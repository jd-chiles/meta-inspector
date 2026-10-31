import { describe, expect, it } from "vitest";
import {
  deriveGuideModel,
  type GuideInput,
} from "../../../src/features/walkthrough/walkthrough-guide";

const ROOMS = [
  { id: "kitchen", label: "Kitchen", captured: false },
  { id: "bathroom", label: "Bathroom", captured: false },
  { id: "bedroom-living", label: "Bedroom / living room", captured: false },
  { id: "hallway", label: "Hallway", captured: false },
];

function inputFor(overrides: Partial<GuideInput> = {}): GuideInput {
  return {
    fundingType: "lahsa",
    canCapture: false,
    pseudonym: "",
    rooms: ROOMS,
    resolvedDecisions: 0,
    totalElements: 11,
    signed: false,
    ...overrides,
  };
}

describe("walkthrough guide model", () => {
  it("returns null for the HUD route, which has no walkthrough here", () => {
    expect(deriveGuideModel(inputFor({ fundingType: "hud" }))).toBeNull();
  });

  it("starts on setup with everything else locked", () => {
    const model = deriveGuideModel(inputFor())!;
    expect(model.currentIndex).toBe(0);
    expect(model.steps.map((step) => step.state)).toEqual([
      "current",
      "locked",
      "locked",
      "locked",
      "locked",
    ]);
    expect(model.nextLabel).toBe("Set up this unit");
    expect(model.nextAction).toEqual({ type: "setup" });
  });

  it("moves to the first uncaptured room once setup completes", () => {
    const model = deriveGuideModel(
      inputFor({ canCapture: true, pseudonym: "Demo Unit 04" }),
    )!;
    expect(model.steps[0]).toMatchObject({ state: "done", detail: "Demo Unit 04" });
    expect(model.currentIndex).toBe(1);
    expect(model.nextLabel).toBe("Film the Kitchen (1 of 4)");
    expect(model.nextAction).toEqual({ type: "room", roomId: "kitchen" });
  });

  it("names the next uncaptured room as clips land", () => {
    const rooms = ROOMS.map((room, index) => ({ ...room, captured: index < 2 }));
    const model = deriveGuideModel(inputFor({ canCapture: true, rooms }))!;
    expect(model.steps[1]).toMatchObject({ state: "current", detail: "2 of 4 clips saved" });
    expect(model.nextLabel).toBe("Film the Bedroom / living room (3 of 4)");
    expect(model.nextAction).toEqual({ type: "room", roomId: "bedroom-living" });
  });

  it("advances review, then sign-off, then export in order", () => {
    const filmed = ROOMS.map((room) => ({ ...room, captured: true }));
    const reviewing = deriveGuideModel(
      inputFor({ canCapture: true, rooms: filmed, resolvedDecisions: 4 }),
    )!;
    expect(reviewing.currentIndex).toBe(2);
    expect(reviewing.nextLabel).toBe("Review decisions (4 of 11)");
    expect(reviewing.nextAction).toEqual({ type: "step", step: "review" });

    const signing = deriveGuideModel(
      inputFor({ canCapture: true, rooms: filmed, resolvedDecisions: 11 }),
    )!;
    expect(signing.currentIndex).toBe(3);
    expect(signing.nextLabel).toBe("Sign off this walkthrough");

    const exporting = deriveGuideModel(
      inputFor({ canCapture: true, rooms: filmed, resolvedDecisions: 11, signed: true }),
    )!;
    expect(exporting.currentIndex).toBe(4);
    expect(exporting.steps.map((step) => step.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "current",
    ]);
    expect(exporting.nextLabel).toBe("Export the packet");
    expect(exporting.nextAction).toEqual({ type: "step", step: "signoff" });
  });
});
