import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(), upload: vi.fn(), inspection: vi.fn(),
}));
vi.mock("../../../../src/server/jobs/http", () => ({
  assertJobRequestSameOrigin: vi.fn(), assertVideoJobAccess: vi.fn(),
  boundedJsonBody: async (request: Request) => request.json(),
  noStoreJson: (body: unknown, status = 200) => Response.json(body, { status }),
  jobFailure: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "failure" }, {
    status: typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 500,
  }),
  VideoJobHttpError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } },
}));
vi.mock("../../../../src/server/catalog", () => ({ getServerCatalog: () => ({ version: "catalog-v1" }) }));
vi.mock("../../../../src/server/inspection/store", () => ({ getInspection: mocks.inspection }));
vi.mock("../../../../src/server/jobs/video-job-store", () => ({ insertVideoJob: mocks.insert }));
vi.mock("../../../../src/server/storage/r2", () => ({
  MAX_R2_VIDEO_BYTES: 60 * 1024 * 1024,
  createR2Storage: () => ({ createUploadUrl: mocks.upload }),
}));
vi.mock("../../../../src/domain/move-in-ready", () => ({
  MOVE_IN_READY_SCHEMA_VERSION: 5,
  isMoveInReadyRoomId: (value: unknown) => value === "bathroom",
}));

import { POST } from "../../../../src/app/api/video/jobs/route";

const seed = {
  sessionId: "session-1", schemaVersion: 5, videoId: "new-video", videoRevision: 3,
  analysisId: "analysis-3", attempt: 0, catalogVersion: "catalog-v1",
};
const body = { room: "bathroom", identity: seed, media: { contentType: "video/quicktime", contentLength: 4096 } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inspection.mockResolvedValue({ inspection: {
    schemaVersion: 5, catalogVersion: "catalog-v1", roomIds: ["bathroom"],
    clipIdentities: { bathroom: { videoId: "old-video", videoRevision: 2 } },
  } });
  mocks.upload.mockResolvedValue({ objectKey: "media/object.mov", uploadUrl: "https://r2.test/upload", requiredHeaders: {}, expiresAt: "later" });
  mocks.insert.mockImplementation(async (job) => ({ id: job.id, identity: job.identity }));
});

describe("video job creation", () => {
  it("allows an unhashed upload-pending row and requires a hash after verification", () => {
    const migration = readFileSync(resolve(process.cwd(), "migrations/0001_video_analysis_jobs.sql"), "utf8");
    expect(migration).toContain("expected_video_sha256 char(64)");
    expect(migration).toMatch(/status = 'upload_pending' AND expected_video_sha256 IS NULL/);
    expect(migration).toMatch(/status <> 'upload_pending' AND expected_video_sha256 ~/);
  });

  it("accepts a new next-revision seed and creates a pending upload before hashing", async () => {
    const response = await POST(new Request("https://app.test/api/video/jobs", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    const result = await response.json();
    expect(response.status).toBe(201);
    expect(result.status).toBe("upload_pending");
    expect(result.upload.method).toBe("PUT");
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      identity: { ...seed, expectedVideoSha256: null },
      mediaContentType: "video/quicktime", mediaContentLength: 4096,
    }));
  });

  it("rejects a non-next revision before creating an upload", async () => {
    const staleBody = { ...body, identity: { ...seed, videoRevision: 2 } };
    const response = await POST(new Request("https://app.test/api/video/jobs", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(staleBody),
    }));
    expect(response.status).toBe(409);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
