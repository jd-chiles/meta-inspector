import { describe, expect, it, vi } from "vitest";

import { commitReplacementThenDeletePrevious, createCloudVideoClient, type CloudVideoIdentity, type CloudVideoIdentitySeed } from "../../../src/features/walkthrough/cloud-video-client";

const IDENTITY: CloudVideoIdentitySeed = {
  sessionId: "session-1",
  schemaVersion: 4,
  videoId: "video-1",
  videoRevision: 1,
  analysisId: "analysis-1",
  attempt: 1,
  catalogVersion: "catalog-1",
};
const VIDEO = new Blob([new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0])], { type: "video/mp4" });
const SERVER_HASH = "a".repeat(64);
const VERIFIED_IDENTITY: CloudVideoIdentity = { ...IDENTITY, expectedVideoSha256: SERVER_HASH };
const JOB = {
  ok: true,
  jobId: "job-1",
  status: "upload_pending",
  upload: {
    url: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/bucket/media/video.mp4?signature=secret",
    method: "PUT",
    headers: { "content-type": "video/mp4", "if-none-match": "*" },
    expiresAt: "2026-11-04T06:00:00.000Z",
  },
};
const COMPLETE = {
  ok: true,
  jobId: "job-1",
  status: "queued",
  identity: VERIFIED_IDENTITY,
  media: {
    sourceUrl: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/bucket/media/video.mp4?download=secret",
    contentType: "video/mp4",
    contentLength: VIDEO.size,
    sha256: SERVER_HASH,
    durationMs: 12_000,
    width: 1280,
    height: 720,
    capturedAt: "2026-11-04T05:00:00.000Z",
  },
};

describe("cloud video job client", () => {
  it("deletes a superseded job only after the replacement commit succeeds", async () => {
    const order: string[] = [];
    const result = await commitReplacementThenDeletePrevious({
      previousJobId: "old-job",
      replacementJobId: "new-job",
      commit: async () => { order.push("commit"); return { committed: true, value: "saved" }; },
      deletePrevious: async (jobId) => { order.push(`delete:${jobId}`); },
    });
    expect(order).toEqual(["commit", "delete:old-job"]);
    expect(result).toEqual({ value: "saved", cleanupPending: false });
  });

  it("does not delete the current job when replacement persistence fails or is stale", async () => {
    const deletePrevious = vi.fn(async () => undefined);
    await expect(commitReplacementThenDeletePrevious({
      previousJobId: "old-job",
      replacementJobId: "new-job",
      commit: async () => { throw new Error("save failed"); },
      deletePrevious,
    })).rejects.toThrow("save failed");
    await commitReplacementThenDeletePrevious({
      previousJobId: "old-job",
      replacementJobId: "new-job",
      commit: async () => ({ committed: false, value: undefined }),
      deletePrevious,
    });
    expect(deletePrevious).not.toHaveBeenCalled();
  });

  it("reports R2 cleanup pending instead of treating a 2xx DELETE as complete", async () => {
    const client = createCloudVideoClient({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        ok: true, jobId: "job-1", status: "deleted", cleanupPending: true,
      })),
    });
    await expect(client.cancel("job-1")).rejects.toMatchObject({ code: "JOB_CLEANUP_PENDING" });
  });

  it("accepts DELETE only when the server confirms object cleanup", async () => {
    const client = createCloudVideoClient({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        ok: true, jobId: "job-1", status: "deleted", cleanupPending: false,
      })),
    });
    await expect(client.cancel("job-1")).resolves.toBeUndefined();
  });

  it("creates a job, uploads direct to the signed R2 URL, and completes without returning the URL", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(JOB))
      .mockResolvedValueOnce(Response.json(COMPLETE));
    const uploadImpl = vi.fn(async ({ onProgress }: { onProgress: (loadedBytes: number) => void }) => {
      order.push("put");
      onProgress(VIDEO.size);
    });
    const onProgress = vi.fn();
    const onUploadJobCreated = vi.fn(async () => { order.push("persist-job"); });
    const order: string[] = [];
    const client = createCloudVideoClient({
      fetchImpl: fetchMock,
      uploadImpl,
    });

    const result = await client.upload({
      sessionId: "session-1",
      roomId: "kitchen",
      fileName: "kitchen.mp4",
      contentType: "video/mp4",
      video: VIDEO,
      identity: IDENTITY,
      onUploadJobCreated,
      onProgress,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/video/jobs");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      room: "kitchen",
      identity: IDENTITY,
      media: { contentType: "video/mp4", contentLength: VIDEO.size },
    });
    expect(uploadImpl).toHaveBeenCalledWith(expect.objectContaining({
      url: new URL(JOB.upload.url),
      video: VIDEO,
    }));
    expect(onUploadJobCreated).toHaveBeenCalledWith("job-1", IDENTITY);
    expect(order).toEqual(["persist-job", "put"]);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/video/jobs/job-1/complete");
    expect(result).toEqual({ jobId: "job-1", status: "queued", identity: VERIFIED_IDENTITY, sourceUrl: COMPLETE.media.sourceUrl, media: COMPLETE.media });
    expect(JSON.stringify(result)).not.toContain("signature");
    expect(onProgress).toHaveBeenCalledWith({ stage: "uploading", loadedBytes: VIDEO.size, totalBytes: VIDEO.size });
  });

  it("cancels an incomplete job after upload failure and does not call completion", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(JOB))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createCloudVideoClient({
      fetchImpl: fetchMock,
      uploadImpl: async () => { throw new Error("network details must not escape"); },
    });

    await expect(client.upload({
      sessionId: "session-1",
      roomId: "kitchen",
      fileName: "kitchen.mp4",
      contentType: "video/mp4",
      video: VIDEO,
      identity: IDENTITY,
    })).rejects.toMatchObject({ code: "VIDEO_UPLOAD_FAILED" });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/video/jobs",
      "/api/video/jobs/job-1",
    ]);
  });

  it("rejects upload URLs outside the expected R2 endpoint before transmitting bytes", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      ...JOB,
      upload: { ...JOB.upload, url: "https://attacker.example/upload" },
    }));
    const uploadImpl = vi.fn();
    const client = createCloudVideoClient({ fetchImpl: fetchMock, uploadImpl });

    await expect(client.upload({
      sessionId: "session-1",
      roomId: "kitchen",
      fileName: "kitchen.mp4",
      contentType: "video/mp4",
      video: VIDEO,
      identity: IDENTITY,
    })).rejects.toMatchObject({ code: "INVALID_UPLOAD_URL" });
    expect(uploadImpl).not.toHaveBeenCalled();
  });

  it("does not hash the selected video and accepts the authoritative server-computed identity", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createCloudVideoClient({
      fetchImpl: fetchMock.mockResolvedValueOnce(Response.json(JOB)).mockResolvedValueOnce(Response.json(COMPLETE)),
      uploadImpl: async () => undefined,
    });
    const result = await client.upload({
      sessionId: "session-1",
      roomId: "kitchen",
      fileName: "kitchen.mp4",
      contentType: "video/mp4",
      video: VIDEO,
      identity: IDENTITY,
    });
    expect(result.identity.expectedVideoSha256).toBe(SERVER_HASH);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty("media.sha256");
  });

  it("restores an upload-pending job from its seed without inventing media metadata", async () => {
    const pending = {
      ok: true,
      jobId: "job-1",
      status: "upload_pending",
      stage: "upload",
      retryable: true,
      identity: IDENTITY,
    };
    const client = createCloudVideoClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json(pending)) });

    await expect(client.get("job-1")).resolves.toEqual({
      jobId: "job-1",
      status: "upload_pending",
      stage: "upload",
      retryable: true,
      identity: IDENTITY,
    });
  });

  it("preserves bounded server result and safe job errors for status polling", async () => {
    const status = {
      ok: true,
      jobId: "job-1",
      status: "failed",
      stage: "remux",
      retryable: true,
      identity: VERIFIED_IDENTITY,
      error: { code: "REMUX_FAILED", message: "The uploaded video could not be processed.", retryable: true },
      result: { segmentCount: 3, evidence: [{ url: "https://example.invalid/evidence/1" }] },
    };
    const client = createCloudVideoClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json(status)) });

    await expect(client.get("job-1")).resolves.toMatchObject({
      stage: "remux",
      retryable: true,
      error: status.error,
      result: status.result,
    });
  });
});
