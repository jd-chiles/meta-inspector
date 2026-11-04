import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createInitialInspectionRecord } from "../../../../src/features/walkthrough/inspection-store";
import type { EvidenceReference } from "../../../../src/domain/move-in-ready";
import type { R2Storage } from "../../../../src/server/storage/r2";
import { buildInspectionExport, InspectionExportError, verifiedCapturedRooms, type InspectionExportDependencies } from "../../../../src/server/exports/build-inspection-export";

const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
const sha256 = createHash("sha256").update(bytes).digest("hex");

function sampleInspection() {
  const inspection = createInitialInspectionRecord("export-session");
  const evidence: EvidenceReference = {
    schemaVersion: inspection.schemaVersion,
    catalogVersion: inspection.catalogVersion,
    videoId: "video-current",
    videoRevision: 2,
    roomId: "kitchen",
    // The UI uses a stable synthetic identity; the server export must use the
    // persisted job URL ordinal to find the corresponding R2 object.
    stillId: "s-video-current-1200-abc123",
    timestampMs: 1200,
    frameIndex: 1,
    stillHash: sha256,
    // A persisted client URL must never control the R2 lookup.
    sourceUrl: "/api/video/jobs/job-owned-by-server/evidence/0",
  };
  inspection.clipIdentities.kitchen = {
    roomId: "kitchen",
    schemaVersion: inspection.schemaVersion,
    catalogVersion: inspection.catalogVersion,
    videoId: "video-current",
    videoRevision: 2,
    videoHash: "a".repeat(64),
    jobId: "job-owned-by-server",
    analysisId: "analysis-1",
    attempt: 1,
    capturedAt: "2026-11-04T00:00:00.000Z",
    durationSeconds: 3,
    sizeBytes: 100,
    evidence: [evidence],
  } as typeof inspection.clipIdentities.kitchen;
  // The PDF generator will reject the incomplete review after the evidence
  // loader runs; this decision exists to exercise that loader boundary.
  inspection.decisions["demo-item-05"] = {
    status: "A",
    evaluatorName: "Test evaluator",
    decidedAt: "2026-11-04T00:00:00.000Z",
    inPersonCheckAcknowledgment: { evaluatorName: "Test evaluator", completedAt: "2026-11-04T00:00:00.000Z" },
    rationale: "Manually checked.",
    evidence: [evidence],
    analysisIdentity: {
      sessionId: inspection.sessionId,
      roomId: "kitchen",
      schemaVersion: inspection.schemaVersion,
      videoId: "video-current",
      videoRevision: 2,
      expectedSourceHash: "a".repeat(64),
      analysisId: "analysis-1",
      attempt: 1,
      catalogVersion: inspection.catalogVersion,
    },
  };
  return inspection;
}

function deps(overrides: Partial<InspectionExportDependencies> = {}) {
  const catalogVersion = createInitialInspectionRecord("catalog-session").catalogVersion;
  const job = {
    id: "job-owned-by-server",
    sessionId: "export-session",
    roomId: "kitchen",
    identity: {
      sessionId: "export-session",
      schemaVersion: 5,
      videoId: "video-current",
      videoRevision: 2,
      analysisId: "analysis-1",
      attempt: 1,
      catalogVersion,
      expectedVideoSha256: "a".repeat(64),
    },
    status: "completed" as const,
  };
  const getVideoJob = vi.fn().mockResolvedValue(job);
  const getVideoEvidenceObjectByOrdinal = vi.fn().mockResolvedValue({ objectKey: "evidence/server-created.jpg", sha256, byteLength: bytes.byteLength });
  const getObject = vi.fn().mockResolvedValue({
    objectKey: "evidence/server-created.jpg",
    contentLength: bytes.byteLength,
    contentType: "image/jpeg",
    etag: null,
    lastModified: null,
    body: new Response(bytes).body!,
  });
  const storage = { getObject } as unknown as R2Storage;
  return {
    value: { getVideoJob, getVideoEvidenceObjectByOrdinal, storage, ...overrides } as InspectionExportDependencies,
    getVideoJob,
    job,
    getVideoEvidenceObjectByOrdinal,
    getObject,
  };
}

describe("cloud inspection exports", () => {
  it("loads only server-owned evidence locators and verifies bytes against the stored hash", async () => {
    const mocks = deps();
    await expect(buildInspectionExport(sampleInspection(), "client-file", mocks.value)).rejects.toBeInstanceOf(InspectionExportError);
    expect(mocks.getVideoEvidenceObjectByOrdinal).toHaveBeenCalledWith("job-owned-by-server", 0);
    expect(mocks.getObject).toHaveBeenCalledWith("evidence/server-created.jpg");
    expect(mocks.getObject).not.toHaveBeenCalledWith("/api/video/jobs/job-owned-by-server/evidence/0");
  });

  it("rejects evidence tied to an older saved analysis before reading any object", async () => {
    const inspection = sampleInspection();
    const decision = inspection.decisions["demo-item-05"];
    if (decision.status !== "A") throw new Error("fixture setup failed");
    decision.analysisIdentity = { ...decision.analysisIdentity!, videoRevision: 1 };
    const mocks = deps();
    await expect(buildInspectionExport(inspection, "client-file", mocks.value)).rejects.toMatchObject({
      status: 422,
      message: "A cited evidence still belongs to an older room video or analysis.",
    });
    expect(mocks.getVideoEvidenceObjectByOrdinal).not.toHaveBeenCalled();
  });

  it("rejects a locator whose object hash differs from the saved evidence", async () => {
    const mocks = deps({
      getVideoEvidenceObjectByOrdinal: vi.fn().mockResolvedValue({ objectKey: "evidence/server-created.jpg", sha256: "b".repeat(64), byteLength: bytes.byteLength }),
    });
    await expect(buildInspectionExport(sampleInspection(), "client-file", mocks.value)).rejects.toMatchObject({ status: 422 });
    expect(mocks.getObject).not.toHaveBeenCalled();
  });

  it("counts a verified ready or failed room video as captured without requiring AI completion", async () => {
    const inspection = sampleInspection();
    const ready = deps();
    ready.getVideoJob.mockResolvedValue({ ...ready.job, status: "ready" });
    await expect(verifiedCapturedRooms(inspection, ready.value)).resolves.toContain("kitchen");

    const failed = deps();
    failed.getVideoJob.mockResolvedValue({ ...failed.job, status: "failed" });
    await expect(verifiedCapturedRooms(inspection, failed.value)).resolves.toContain("kitchen");
  });

  it("does not count unverified uploads, cancellation, or deleted sessions as captured", async () => {
    const inspection = sampleInspection();
    for (const status of ["upload_pending", "cancel_requested", "cancelled"] as const) {
      const mocks = deps();
      mocks.getVideoJob.mockResolvedValue({ ...mocks.job, status });
      await expect(verifiedCapturedRooms(inspection, mocks.value)).resolves.not.toContain("kitchen");
    }
    const deleted = deps();
    deleted.getVideoJob.mockResolvedValue(null);
    await expect(verifiedCapturedRooms(inspection, deleted.value)).resolves.not.toContain("kitchen");
  });

  it("rejects a persisted evidence ordinal bound to a different job", async () => {
    const inspection = sampleInspection();
    const decision = inspection.decisions["demo-item-05"];
    if (decision.status !== "A") throw new Error("fixture setup failed");
    decision.evidence[0] = { ...decision.evidence[0]!, sourceUrl: "/api/video/jobs/another-job-id/evidence/0" };
    const mocks = deps();
    await expect(buildInspectionExport(inspection, "client-file", mocks.value)).rejects.toMatchObject({ status: 422 });
    expect(mocks.getVideoEvidenceObjectByOrdinal).not.toHaveBeenCalled();
  });
});
