import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  terminalize: vi.fn(), listIds: vi.fn(), listObjects: vi.fn(), markDeleted: vi.fn(),
  deleteRow: vi.fn(), deleteObject: vi.fn(), listTerminalMedia: vi.fn(),
}));

vi.mock("../../../../src/server/jobs/video-job-store", () => ({
  deleteVideoJobRow: mocks.deleteRow,
  listExpiredVideoJobIds: mocks.listIds,
  listVideoJobObjectsForCleanup: mocks.listObjects,
  markVideoJobObjectDeleted: mocks.markDeleted,
  listTerminalVideoJobMedia: mocks.listTerminalMedia,
  terminalizeExpiredActiveVideoJobs: mocks.terminalize,
}));
vi.mock("../../../../src/server/storage/r2", () => ({
  createR2Storage: () => ({ deleteObject: mocks.deleteObject }),
}));

import { cleanupExpiredVideoJobs, cleanupTerminalVideoSources } from "../../../../src/server/jobs/worker";

describe("expired video job cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.terminalize.mockResolvedValue(["job-1"]);
    mocks.listIds.mockResolvedValue(["job-1"]);
    mocks.listObjects.mockResolvedValue(["private/unregistered-upload.mov", "private/source.mp4", "private/evidence.jpg"]);
    mocks.deleteObject.mockResolvedValue(undefined);
    mocks.markDeleted.mockResolvedValue(undefined);
    mocks.deleteRow.mockResolvedValue(undefined);
    mocks.listTerminalMedia.mockResolvedValue([{ id: "job-terminal", objectKey: "private/original.mp4" }]);
  });

  it("terminalizes before deleting every registered object and then removes the row", async () => {
    const order: string[] = [];
    mocks.terminalize.mockImplementation(async () => { order.push("terminalize"); return ["job-1"]; });
    mocks.listIds.mockImplementation(async () => { order.push("list"); return ["job-1"]; });
    mocks.deleteObject.mockImplementation(async (key: string) => { order.push(`object:${key}`); });
    mocks.deleteRow.mockImplementation(async () => { order.push("row"); });

    await cleanupExpiredVideoJobs();

    expect(order).toEqual([
      "terminalize", "list", "object:private/unregistered-upload.mov", "object:private/source.mp4", "object:private/evidence.jpg", "row",
    ]);
    expect(mocks.markDeleted).toHaveBeenCalledTimes(3);
  });

  it("keeps the terminal row for an idempotent cleanup retry when an object delete fails", async () => {
    mocks.deleteObject.mockRejectedValueOnce(new Error("storage temporarily unavailable"));

    await cleanupExpiredVideoJobs();

    expect(mocks.markDeleted).toHaveBeenCalledTimes(2);
    expect(mocks.deleteRow).not.toHaveBeenCalled();
  });

  it("deletes and marks only media returned as terminal and non-retryable", async () => {
    await cleanupTerminalVideoSources();
    expect(mocks.listTerminalMedia).toHaveBeenCalledOnce();
    expect(mocks.deleteObject).toHaveBeenCalledWith("private/original.mp4");
    expect(mocks.markDeleted).toHaveBeenCalledWith("job-terminal", "private/original.mp4");
    expect(mocks.deleteRow).not.toHaveBeenCalled();
  });

  it("leaves the durable object reference live when source deletion fails", async () => {
    mocks.deleteObject.mockRejectedValueOnce(new Error("storage temporarily unavailable"));
    await cleanupTerminalVideoSources();
    expect(mocks.markDeleted).not.toHaveBeenCalled();
  });
});
