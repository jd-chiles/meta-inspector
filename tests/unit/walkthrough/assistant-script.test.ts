import { describe, expect, it } from "vitest";

import {
  ASSISTANT_FILMING_SCRIPTS,
  ASSISTANT_FILMING_SCRIPTS_ES,
  filmingScriptForRoom,
} from "../../../src/features/walkthrough/assistant-script";

describe("filmingScriptForRoom", () => {
  it("resolves every room id to its room-type shot list", () => {
    expect(filmingScriptForRoom("kitchen")[0]).toContain("kitchen faucet");
    expect(filmingScriptForRoom("bathroom-2")[0]).toContain("bathroom faucet");
    expect(filmingScriptForRoom("bedroom")[0]).toContain("bedroom");
    expect(filmingScriptForRoom("living-room")[0]).toContain("living room");
    expect(filmingScriptForRoom("hallway")[0]).toContain("hallway");
  });

  it("keeps cues short for spoken readout with ES parity per room type", () => {
    for (const cues of Object.values(ASSISTANT_FILMING_SCRIPTS)) {
      expect(cues.length).toBeGreaterThan(0);
      for (const cue of cues) {
        expect(cue.length).toBeLessThan(160);
      }
    }
    expect(Object.keys(ASSISTANT_FILMING_SCRIPTS_ES).sort()).toEqual(
      Object.keys(ASSISTANT_FILMING_SCRIPTS).sort(),
    );
  });
});
