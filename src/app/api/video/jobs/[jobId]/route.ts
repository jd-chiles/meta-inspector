import { assertJobRequestSameOrigin, assertVideoJobAccess, jobFailure, noStoreJson, parseJobId, VideoJobHttpError } from "../../../../../server/jobs/http";
import { deleteVideoJobRow, getAuthorizedVideoJob, getLiveJobObjects, hasLiveVideoJobMediaObject, markVideoJobObjectDeleted, requestVideoJobCancellation } from "../../../../../server/jobs/video-job-store";
import { createR2Storage } from "../../../../../server/storage/r2";
import { recoverVideoJob } from "../../../../../server/jobs/recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ jobId: string }> };

async function authorizedJob(request: Request, context: RouteContext) {
  assertJobRequestSameOrigin(request);
  await assertVideoJobAccess(request);
  const { jobId } = await context.params;
  const job = await getAuthorizedVideoJob(parseJobId(jobId));
  if (!job) throw new VideoJobHttpError(404, "JOB_NOT_FOUND", "The video job could not be found.");
  return job;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const authorized = await authorizedJob(request, context);
    if (authorized.status === "cancelled" || authorized.status === "cancel_requested") {
      throw new VideoJobHttpError(404, "JOB_NOT_FOUND", "The video job could not be found.");
    }
    try {
      await recoverVideoJob(authorized.id);
    } catch {
      // Recovery is opportunistic: a status read must not fail because the
      // dispatch queue or wake gateway is temporarily unavailable. The next
      // poll and the worker maintenance scanner retry the dispatch.
    }
    const job = await authorizedJob(request, context);
    const body: Record<string, unknown> = {
      ok: true, jobId: job.id, status: job.status, stage: job.stage, retryable: job.retryable,
      room: job.roomId, identity: job.identity.expectedVideoSha256 ? job.identity : {
        sessionId: job.identity.sessionId, schemaVersion: job.identity.schemaVersion,
        videoId: job.identity.videoId, videoRevision: job.identity.videoRevision,
        analysisId: job.identity.analysisId, attempt: job.identity.attempt,
        catalogVersion: job.identity.catalogVersion,
      },
      error: job.safeErrorCode ? { code: job.safeErrorCode, message: job.safeErrorMessage ?? "Video processing could not be completed." } : null,
    };
    if (job.status === "completed" && job.result) body.result = job.result;
    else if (job.status === "mapping" && job.segmentResult) body.result = { segment: job.segmentResult, mapped: null };
    if (job.identity.expectedVideoSha256 && job.status !== "completed" && job.status !== "ambiguous" &&
        job.status !== "cancelled" && (job.status !== "failed" || job.retryable) && await hasLiveVideoJobMediaObject(job.id)) {
      const source = await createR2Storage().createMediaDownloadUrl({ objectKey: job.mediaObjectKey, expiresInSeconds: 180 });
      body.sourceUrl = source.downloadUrl;
      body.media = {
        contentType: job.mediaContentType, contentLength: job.mediaContentLength,
        sha256: job.identity.expectedVideoSha256, durationMs: job.mediaDurationMs,
        durationSeconds: job.mediaDurationMs ? job.mediaDurationMs / 1000 : undefined,
        ...(job.mediaWidth !== null ? { width: job.mediaWidth } : {}),
        ...(job.mediaHeight !== null ? { height: job.mediaHeight } : {}),
      };
    }
    return noStoreJson(body);
  } catch (error) { return jobFailure(error); }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertJobRequestSameOrigin(request);
    await assertVideoJobAccess(request);
    const { jobId } = await context.params;
    const id = parseJobId(jobId);
    const cancelled = await requestVideoJobCancellation(id);
    if (!cancelled) return noStoreJson({ ok: true, jobId: id, status: "deleted", cleanupPending: false });
    const objects = await getLiveJobObjects(id);
    const storage = createR2Storage();
    let cleanupPending = false;
    for (const object of objects) {
      try {
        await storage.deleteObject(object.object_key);
        await markVideoJobObjectDeleted(id, object.object_key);
      } catch { cleanupPending = true; }
    }
    if (!cleanupPending) await deleteVideoJobRow(id);
    return noStoreJson({ ok: true, jobId: id, status: "deleted", cleanupPending });
  } catch (error) { return jobFailure(error); }
}
