import { describe, expect, it, vi } from "vitest";

import { canShareExportFiles } from "../../../src/features/walkthrough/export-share";

describe("canShareExportFiles", () => {
  it("is true when the browser accepts file shares", () => {
    expect(canShareExportFiles({ canShare: () => true })).toBe(true);
  });

  it("is false without file-share support", () => {
    expect(canShareExportFiles({})).toBe(false);
    expect(canShareExportFiles({ canShare: () => false })).toBe(false);
    expect(canShareExportFiles(undefined)).toBe(false);
  });

  it("is false when the probe throws", () => {
    const canShare = vi.fn(() => {
      throw new Error("nope");
    });
    expect(canShareExportFiles({ canShare })).toBe(false);
  });
});
