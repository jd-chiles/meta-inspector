import { assertJobRequestSameOrigin, assertVideoJobAccess, jobFailure, noStoreJson, parseJobId, VideoJobHttpError } from "../../../../../../server/jobs/http";
import { getInspection } from "../../../../../../server/inspection/store";
import { enqueueVideoProcessing } from "../../../../../../server/jobs/queue";
import { getVideoJob, requeueRetryableVideoJob } from "../../../../../../server/jobs/video-job-store";
import { wakeVideoWorker } from "../../../../../../server/jobs/wakeup";
import { isMoveInReadyRoomId } from "../../../../../../domain/move-in-ready";

export const runtime = "nodejs";
export const maxDuration = 10;

type RouteContext = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertJobRequestSameOrigin(request);
    await assertVideoJobAccess(request);
    const { jobId } = await context.params;
    const id = parseJobId(jobId);
    let job = await getVideoJob(id);
    if (!job || !isMoveInReadyRoomId(job.roomId)) throw new VideoJobHttpError(404, "JOB_NOT_FOUND", "The video job could not be found.");
    const stored = await getInspection(job.sessionId);
    const clip = stored?.inspection.clipIdentities[job.roomId];
    if (!clip || clip.jobId !== id || clip.videoId !== job.identity.videoId ||
        clip.videoRevision !== job.identity.videoRevision || clip.videoHash !== job.identity.expectedVideoSha256 ||
        clip.schemaVersion !== job.identity.schemaVersion || clip.catalogVersion !== job.identity.catalogVersion ||
        (clip.analysisId !== undefined && clip.analysisId !== job.identity.analysisId) ||
        (clip.attempt !== undefined && clip.attempt !== job.identity.attempt)) {
      throw new VideoJobHttpError(409, "STALE_REQUEST", "This video no longer matches the current saved inspection.");
    }

    let stage: "sam" | "muse";
    if (job.status === "failed") {
      if (!job.retryable || (job.stage !== "sam" && job.stage !== "muse")) {
        throw new VideoJobHttpError(409, "RETRY_NOT_SAFE", "This job cannot be safely resumed. Start a new analysis attempt from the saved local video.");
      }
      stage = job.stage;
      const requeued = await requeueRetryableVideoJob(id, stage);
      if (!requeued) throw new VideoJobHttpError(409, "RETRY_NOT_SAFE", "This job can no longer be safely resumed. Start a new analysis attempt from the saved local video.");
      job = (await getVideoJob(id))!;
    } else if (job.status === "queued" && !job.samStartedAt) {
      stage = "sam";
    } else if (job.status === "mapping" && job.samCompletedAt && !job.museStartedAt) {
      stage = "muse";
    } else {
      throw new VideoJobHttpError(409, "RETRY_NOT_SAFE", "This job is already running or its provider outcome is uncertain. It will not be sent again automatically.");
    }

    await enqueueVideoProcessing(id, stage);
    await wakeVideoWorker(id, stage);
    return noStoreJson({ ok: true, jobId: id, status: job.status, stage: job.stage, retryable: false, identity: job.identity }, 202);
  } catch (error) {
    return jobFailure(error);
  }
}
