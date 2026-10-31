import { describe, expect, it } from "vitest";

import {
  deriveAssistantNode,
  type AssistantScriptInput,
} from "../../../src/features/walkthrough/assistant-script";

const base: AssistantScriptInput = {
  fundingType: "unknown",
  canCapture: false,
  pseudonym: "",
  evaluatorName: "",
  roomIds: ["kitchen", "bathroom", "bedroom", "living-room", "hallway"],
  filmedRoomIds: [],
  analyzedRoomIds: [],
  analyzedTotal: 0,
  resolvedDecisions: 0,
  nextUndecidedLabel: "Structure and materials",
  nextUndecidedId: "demo-item-05",
  signed: false,
  batchActive: false,
};

describe("deriveAssistantNode", () => {
  it("starts with unit setup", () => {
    const node = deriveAssistantNode(base);
    expect(node.key).toBe("setup");
    expect(node.actions).toMatchObject([{ id: "setup" }]);
    expect(node.speak.length).toBeGreaterThan(0);
  });

  it("walks rooms in order after setup", () => {
    const node = deriveAssistantNode({ ...base, fundingType: "lahsa", canCapture: true });
    expect(node.key).toBe("film-kitchen");
    expect(node.actions[0]).toMatchObject({ id: "film-room", roomId: "kitchen" });
    const next = deriveAssistantNode({
      ...base,
      fundingType: "lahsa",
      canCapture: true,
      filmedRoomIds: ["kitchen", "bathroom", "bedroom"],
    });
    expect(next.key).toBe("film-living-room");
    const last = deriveAssistantNode({
      ...base,
      fundingType: "lahsa",
      canCapture: true,
      filmedRoomIds: ["kitchen", "bathroom", "bedroom", "living-room"],
    });
    expect(last.key).toBe("film-hallway");
  });

  it("offers one-tap analysis once every room is filmed", () => {
    const node = deriveAssistantNode({
      ...base,
      fundingType: "lahsa",
      canCapture: true,
      filmedRoomIds: ["kitchen", "bathroom", "bedroom", "living-room", "hallway"],
      analyzedTotal: 1,
    });
    expect(node.key).toBe("analyze");
    expect(node.actions[0]?.id).toBe("analyze-all");
  });

  it("moves requirement by requirement after analysis", () => {
    const node = deriveAssistantNode({
      ...base,
      fundingType: "lahsa",
      canCapture: true,
      filmedRoomIds: ["kitchen", "bathroom", "bedroom", "living-room", "hallway"],
      analyzedRoomIds: ["kitchen", "bathroom", "bedroom", "living-room", "hallway"],
      analyzedTotal: 5,
    });
    expect(node.key).toBe("confirm");
    expect(node.actions[0]).toMatchObject({ id: "confirm-all" });
    expect(node.actions[1]).toMatchObject({ id: "open-requirement", elementId: "demo-item-05" });
  });

  it("ends at sign-off and completion", () => {
    const signoff = deriveAssistantNode({
      ...base,
      fundingType: "lahsa",
      canCapture: true,
      filmedRoomIds: ["kitchen", "bathroom", "bedroom", "living-room", "hallway"],
      analyzedTotal: 5,
      resolvedDecisions: 11,
    });
    expect(signoff.key).toBe("signoff");
    const done = deriveAssistantNode({
      ...base,
      fundingType: "lahsa",
      canCapture: true,
      filmedRoomIds: ["kitchen", "bathroom", "bedroom", "living-room", "hallway"],
      analyzedTotal: 5,
      resolvedDecisions: 11,
      signed: true,
    });
    expect(done.key).toBe("done");
  });

  it("has no walkthrough on the HUD route", () => {
    const node = deriveAssistantNode({ ...base, fundingType: "hud" });
    expect(node.key).toBe("hud");
  });
});
