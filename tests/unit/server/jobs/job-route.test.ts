import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorized: vi.fn(), liveObjects: vi.fn(), hasMedia: vi.fn(), markDeleted: vi.fn(),
  requestCancel: vi.fn(), deleteRow: vi.fn(), recover: vi.fn(),
  createMediaUrl: vi.fn(), deleteObject: vi.fn(),
}));

vi.mock("../../../../src/server/jobs/http", () => ({
  assertJobRequestSameOrigin: vi.fn(), assertVideoJobAccess: vi.fn(),
  parseJobId: (id: string) => id,
  noStoreJson: (body: unknown, status = 200) => Response.json(body, { status }),
  jobFailure: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "failure" }, {
    status: typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 500,
  }),
  VideoJobHttpError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } },
}));
vi.mock("../../../../src/server/jobs/video-job-store", () => ({
  deleteVideoJobRow: mocks.deleteRow,
  getAuthorizedVideoJob: mocks.authorized,
  getLiveJobObjects: mocks.liveObjects,
  hasLiveVideoJobMediaObject: mocks.hasMedia,
  markVideoJobObjectDeleted: mocks.markDeleted,
  requestVideoJobCancellation: mocks.requestCancel,
}));
vi.mock("../../../../src/server/storage/r2", () => ({
  createR2Storage: () => ({ createMediaDownloadUrl: mocks.createMediaUrl, deleteObject: mocks.deleteObject }),
}));
vi.mock("../../../../src/server/jobs/recovery", () => ({ recoverVideoJob: mocks.recover }));

import { DELETE, GET } from "../../../../src/app/api/video/jobs/[jobId]/route";

const identity = {
  sessionId: "session-1", schemaVersion: 5, videoId: "video-1", videoRevision: 1,
  analysisId: "analysis-1", attempt: 1, catalogVersion: "catalog-v1", expectedVideoSha256: "a".repeat(64),
};
const job = {
  id: "job-1", sessionId: "session-1", roomId: "bathroom", identity,
  mediaObjectKey: "media/source.mp4", mediaContentType: "video/mp4", mediaContentLength: 100,
  mediaDurationMs: 1000, mediaWidth: 640, mediaHeight: 480,
  status: "mapping", stage: "muse", retryable: false,
  safeErrorCode: null, safeErrorMessage: null, segmentResult: { mappingExpiresAt: 123 }, result: null,
};
const context = { params: Promise.resolve({ jobId: "job-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorized.mockResolvedValue(job);
  mocks.recover.mockResolvedValue(true);
  mocks.hasMedia.mockResolvedValue(true);
  mocks.createMediaUrl.mockResolvedValue({ downloadUrl: "https://r2.test/private-source" });
  mocks.liveObjects.mockResolvedValue([{ object_key: "media/source.mp4" }]);
  mocks.deleteObject.mockResolvedValue(undefined);
  mocks.requestCancel.mockResolvedValue({ ...job, status: "cancelled" });
});

describe("video job status reads", () => {
  it("still returns the stored status when opportunistic recovery dispatch fails", async () => {
    mocks.recover.mockRejectedValueOnce(new Error("wake gateway unavailable"));
    const response = await GET(new Request("https://app.test/api/video/jobs/job-1"), context);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ jobId: "job-1", status: "mapping", result: { segment: { mappingExpiresAt: 123 }, mapped: null } });
    expect(body.sourceUrl).toBe("https://r2.test/private-source");
  });

  it("hides cancelled jobs from status polling", async () => {
    mocks.authorized.mockResolvedValue({ ...job, status: "cancelled" });
    const response = await GET(new Request("https://app.test/api/video/jobs/job-1"), context);
    expect(response.status).toBe(404);
    expect(mocks.recover).not.toHaveBeenCalled();
  });
});

describe("video job deletion", () => {
  it("cancels, deletes every live object, and removes the row only when cleanup completes", async () => {
    const response = await DELETE(new Request("https://app.test/api/video/jobs/job-1", { method: "DELETE" }), context);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, jobId: "job-1", status: "deleted", cleanupPending: false });
    expect(mocks.requestCancel).toHaveBeenCalledWith("job-1");
    expect(mocks.deleteObject).toHaveBeenCalledWith("media/source.mp4");
    expect(mocks.markDeleted).toHaveBeenCalledWith("job-1", "media/source.mp4");
    expect(mocks.deleteRow).toHaveBeenCalledWith("job-1");
  });

  it("keeps the cancelled row for a maintenance retry when an object delete fails", async () => {
    mocks.deleteObject.mockRejectedValueOnce(new Error("storage temporarily unavailable"));
    const response = await DELETE(new Request("https://app.test/api/video/jobs/job-1", { method: "DELETE" }), context);
    const body = await response.json();
    expect(body).toEqual({ ok: true, jobId: "job-1", status: "deleted", cleanupPending: true });
    expect(mocks.deleteRow).not.toHaveBeenCalled();
  });

  it("reports an unknown job as deleted without touching storage", async () => {
    mocks.requestCancel.mockResolvedValue(null);
    const response = await DELETE(new Request("https://app.test/api/video/jobs/job-1", { method: "DELETE" }), context);
    const body = await response.json();
    expect(body).toEqual({ ok: true, jobId: "job-1", status: "deleted", cleanupPending: false });
    expect(mocks.liveObjects).not.toHaveBeenCalled();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });
});
