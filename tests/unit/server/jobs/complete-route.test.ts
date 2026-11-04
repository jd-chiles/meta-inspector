import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({ getJob: vi.fn(), verify: vi.fn(), uploadRead: vi.fn(), hasMedia: vi.fn() }));
vi.mock("../../../../src/server/jobs/http", () => ({
  assertJobRequestSameOrigin: vi.fn(), assertVideoJobAccess: vi.fn(),
  noStoreJson: (body: unknown, status = 200) => Response.json(body, { status }),
  jobFailure: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "failure" }, {
    status: typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 500,
  }),
  parseJobId: (id: string) => id,
  VideoJobHttpError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } },
}));
vi.mock("../../../../src/server/storage/r2", () => ({
  MAX_R2_VIDEO_BYTES: 60 * 1024 * 1024,
  createR2Storage: () => ({
    headObject: async () => ({ contentLength: 8, contentType: "video/quicktime" }),
    getObject: async () => ({ contentLength: 8, contentType: "video/quicktime", body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1,2,3,4,5,6,7,8])); c.close(); } }) }),
    createMediaDownloadUrl: async () => ({ downloadUrl: "https://r2.test/private-source" }),
  }),
}));
vi.mock("../../../../src/server/jobs/video-job-store", () => ({
  getVideoJob: mocks.getJob, verifyUploadedVideoObject: mocks.verify,
  hasLiveVideoJobMediaObject: mocks.hasMedia,
}));
vi.mock("../../../../src/server/video/validate", () => ({ validateVideoBytes: () => ({ mimeType: "video/quicktime", durationMs: 1250, frameTimestampsMs: [0] }) }));
vi.mock("../../../../src/server/video/source-stills", () => ({ decodeSourceFrames: async () => [new Uint8Array([0xff,0xd8,0xff,0xc0,0x00,0x11,0x08,0x00,0x02,0x00,0x01,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0xff,0xd9])] }));

import { POST } from "../../../../src/app/api/video/jobs/[jobId]/complete/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getJob.mockResolvedValue({ id: "job-1", status: "upload_pending", mediaObjectKey: "media/x.mov", mediaContentLength: 8,
    mediaContentType: "video/quicktime", identity: { expectedVideoSha256: null } });
  mocks.verify.mockImplementation(async (_id: string, media: unknown) => ({ id: "job-1", status: "ready", identity: { expectedVideoSha256: (media as {sha256:string}).sha256 },
    mediaObjectKey: "media/x.mov", mediaContentLength: 8, mediaContentType: "video/quicktime", mediaDurationMs: 1250, mediaWidth: 1, mediaHeight: 2 }));
  mocks.hasMedia.mockResolvedValue(true);
});

describe("video upload completion", () => {
  it("stores server-computed identity and stops at ready until explicit consent", async () => {
    const response = await POST(new Request("https://app.test/api/video/jobs/job-1/complete", { method: "POST" }), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    const body = await response.json();
    const sha256 = createHash("sha256").update(new Uint8Array([1,2,3,4,5,6,7,8])).digest("hex");
    expect(response.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.identity.expectedVideoSha256).toBe(sha256);
    expect(body.media).toMatchObject({ sha256, durationMs: 1250, width: 1, height: 2 });
    expect(body.sourceUrl).toBe("https://r2.test/private-source");
    expect(mocks.verify).toHaveBeenCalledWith("job-1", { sha256, durationMs: 1250, width: 1, height: 2 });
  });
});
