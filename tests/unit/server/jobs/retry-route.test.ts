import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJob: vi.fn(), inspection: vi.fn(), requeue: vi.fn(), enqueue: vi.fn(), wake: vi.fn(),
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
vi.mock("../../../../src/server/jobs/video-job-store", () => ({ getVideoJob: mocks.getJob, requeueRetryableVideoJob: mocks.requeue }));
vi.mock("../../../../src/server/inspection/store", () => ({ getInspection: mocks.inspection }));
vi.mock("../../../../src/server/jobs/queue", () => ({ enqueueVideoProcessing: mocks.enqueue }));
vi.mock("../../../../src/server/jobs/wakeup", () => ({ wakeVideoWorker: mocks.wake }));
vi.mock("../../../../src/domain/move-in-ready", () => ({ isMoveInReadyRoomId: (value: unknown) => value === "bathroom" }));

import { POST } from "../../../../src/app/api/video/jobs/[jobId]/retry/route";

const identity = {
  sessionId: "session-1", schemaVersion: 5, videoId: "video-1", videoRevision: 1,
  analysisId: "analysis-1", attempt: 0, catalogVersion: "catalog-v1", expectedVideoSha256: "a".repeat(64),
};
const job = {
  id: "job-1", sessionId: identity.sessionId, roomId: "bathroom", identity,
  status: "failed", stage: "sam", retryable: true, samStartedAt: null,
  samCompletedAt: null, museStartedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getJob.mockResolvedValue(job);
  mocks.inspection.mockResolvedValue({ inspection: { clipIdentities: { bathroom: {
    jobId: "job-1", videoId: identity.videoId, videoRevision: identity.videoRevision,
    videoHash: identity.expectedVideoSha256, schemaVersion: identity.schemaVersion,
    catalogVersion: identity.catalogVersion, analysisId: identity.analysisId, attempt: identity.attempt,
  } } } });
  mocks.requeue.mockResolvedValue(true);
});

describe("explicit durable video retries", () => {
  it("resumes a safe failed stage only after the current clip identity is checked", async () => {
    mocks.getJob.mockResolvedValueOnce(job).mockResolvedValueOnce({ ...job, status: "queued", stage: "sam", retryable: false });
    const response = await POST(new Request("https://app.test/api/video/jobs/job-1/retry", { method: "POST" }), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(response.status).toBe(202);
    expect(mocks.requeue).toHaveBeenCalledWith("job-1", "sam");
    expect(mocks.enqueue).toHaveBeenCalledWith("job-1", "sam");
    expect(mocks.wake).toHaveBeenCalledWith("job-1", "sam");
  });

  it("does not replay an ambiguous provider outcome", async () => {
    mocks.getJob.mockResolvedValue({ ...job, status: "ambiguous", retryable: false, samStartedAt: new Date() });
    const response = await POST(new Request("https://app.test/api/video/jobs/job-1/retry", { method: "POST" }), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(response.status).toBe(409);
    expect(mocks.requeue).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.wake).not.toHaveBeenCalled();
  });

  it("does not retry when the saved inspection refers to a different video", async () => {
    mocks.inspection.mockResolvedValue({ inspection: { clipIdentities: { bathroom: { ...identity, jobId: "new-job" } } } });
    const response = await POST(new Request("https://app.test/api/video/jobs/job-1/retry", { method: "POST" }), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(response.status).toBe(409);
    expect(mocks.requeue).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.wake).not.toHaveBeenCalled();
  });
});
