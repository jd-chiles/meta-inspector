import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queueJob: vi.fn(), getJob: vi.fn(), inspection: vi.fn(), recover: vi.fn(),
}));

vi.mock("../../../../src/server/jobs/http", () => ({
  assertJobRequestSameOrigin: vi.fn(), assertVideoJobAccess: vi.fn(),
  boundedJsonBody: async (request: Request) => request.json(),
  parseJobId: (id: string) => id,
  noStoreJson: (body: unknown, status = 200) => Response.json(body, { status }),
  jobFailure: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "failure" }, {
    status: typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 500,
  }),
  VideoJobHttpError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } },
}));
vi.mock("../../../../src/server/jobs/video-job-store", () => ({ queueVerifiedVideoJob: mocks.queueJob, getVideoJob: mocks.getJob }));
vi.mock("../../../../src/server/inspection/store", () => ({ getInspection: mocks.inspection }));
vi.mock("../../../../src/server/jobs/recovery", () => ({ recoverVideoJob: mocks.recover }));
vi.mock("../../../../src/domain/move-in-ready", () => ({ isMoveInReadyRoomId: (value: unknown) => value === "bathroom" }));

import { POST } from "../../../../src/app/api/video/jobs/[jobId]/process/route";

const identity = {
  sessionId: "session-1", schemaVersion: 5, videoId: "video-1", videoRevision: 1,
  analysisId: "analysis-1", attempt: 0, catalogVersion: "catalog-v1", expectedVideoSha256: "a".repeat(64),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getJob.mockResolvedValue({ id: "job-1", sessionId: "session-1", roomId: "bathroom" });
  mocks.inspection.mockResolvedValue({ inspection: { clipIdentities: { bathroom: {
    jobId: "job-1", videoId: identity.videoId, videoRevision: identity.videoRevision,
    videoHash: identity.expectedVideoSha256, schemaVersion: identity.schemaVersion,
    catalogVersion: identity.catalogVersion, analysisId: identity.analysisId, attempt: identity.attempt,
  } } } });
});

describe("video processing consent gate", () => {
  it("queues and wakes only the explicitly started, verified identity", async () => {
    mocks.queueJob.mockResolvedValue({ id: "job-1", status: "queued", identity });
    const response = await POST(new Request("https://app.test/api/video/jobs/job-1/process", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identity }),
    }), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(response.status).toBe(202);
    expect(mocks.queueJob).toHaveBeenCalledWith("job-1", identity);
    expect(mocks.recover).toHaveBeenCalledWith("job-1");
  });

  it("refuses a stale identity without queueing a provider stage", async () => {
    mocks.queueJob.mockResolvedValue(null);
    const response = await POST(new Request("https://app.test/api/video/jobs/job-1/process", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identity }),
    }), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(response.status).toBe(409);
    expect(mocks.recover).not.toHaveBeenCalled();
  });
});
