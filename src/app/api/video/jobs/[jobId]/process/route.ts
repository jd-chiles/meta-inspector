import { assertJobRequestSameOrigin, assertVideoJobAccess, boundedJsonBody, jobFailure, noStoreJson, parseJobId, VideoJobHttpError } from "../../../../../../server/jobs/http";
import { getInspection } from "../../../../../../server/inspection/store";
import { getVideoJob, queueVerifiedVideoJob, type DurableVideoIdentity } from "../../../../../../server/jobs/video-job-store";
import { recoverVideoJob } from "../../../../../../server/jobs/recovery";
import { isMoveInReadyRoomId } from "../../../../../../domain/move-in-ready";

export const runtime = "nodejs";
export const maxDuration = 10;

function parseIdentity(value: unknown): DurableVideoIdentity | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const keys = ["sessionId", "schemaVersion", "videoId", "videoRevision", "analysisId", "attempt", "catalogVersion", "expectedVideoSha256"];
  if (Object.keys(item).length !== keys.length || Object.keys(item).some((key) => !keys.includes(key)) ||
      typeof item.sessionId !== "string" || typeof item.schemaVersion !== "number" || !Number.isSafeInteger(item.schemaVersion) ||
      typeof item.videoId !== "string" || typeof item.videoRevision !== "number" || !Number.isSafeInteger(item.videoRevision) ||
      typeof item.analysisId !== "string" || typeof item.attempt !== "number" || !Number.isSafeInteger(item.attempt) ||
      typeof item.catalogVersion !== "string" || typeof item.expectedVideoSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.expectedVideoSha256)) return null;
  return item as unknown as DurableVideoIdentity;
}

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }): Promise<Response> {
  try {
    assertJobRequestSameOrigin(request);
    await assertVideoJobAccess(request);
    const { jobId } = await context.params;
    const id = parseJobId(jobId);
    const body = await boundedJsonBody(request, 4096);
    const identity = typeof body === "object" && body !== null && !Array.isArray(body)
      ? parseIdentity((body as Record<string, unknown>).identity) : null;
    if (!identity) throw new VideoJobHttpError(400, "INVALID_REQUEST", "The verified video identity is required to start processing.");
    const existing = await getVideoJob(id);
    if (!existing || existing.sessionId !== identity.sessionId || !isMoveInReadyRoomId(existing.roomId)) {
      throw new VideoJobHttpError(404, "JOB_NOT_FOUND", "The video job could not be found.");
    }
    const stored = await getInspection(identity.sessionId);
    const clip = stored?.inspection.clipIdentities[existing.roomId];
    if (!clip || clip.jobId !== id || clip.videoId !== identity.videoId ||
        clip.videoRevision !== identity.videoRevision || clip.videoHash !== identity.expectedVideoSha256 ||
        clip.schemaVersion !== identity.schemaVersion || clip.catalogVersion !== identity.catalogVersion) {
      throw new VideoJobHttpError(409, "STALE_REQUEST", "This video no longer matches the current saved inspection.");
    }
    const job = await queueVerifiedVideoJob(id, identity);
    if (!job) throw new VideoJobHttpError(409, "STALE_REQUEST", "This video no longer matches the current saved inspection.");
    await recoverVideoJob(id);
    return noStoreJson({ ok: true, jobId: job.id, status: job.status, identity: job.identity }, job.status === "queued" ? 202 : 200);
  } catch (error) { return jobFailure(error); }
}
