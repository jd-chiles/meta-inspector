import { enqueueVideoProcessing } from "./queue";
import { getVideoJob, listRunnableVideoJobs } from "./video-job-store";
import { wakeVideoWorker, type VideoJobStageName } from "./wakeup";

async function dispatch(jobId: string, stage: VideoJobStageName): Promise<void> {
  await enqueueVideoProcessing(jobId, stage);
  await wakeVideoWorker(jobId, stage);
}

/** Re-dispatch only stages already approved by the user. Claims and provider-start markers prevent duplicate billing. */
export async function recoverVideoJob(jobId: string): Promise<boolean> {
  const job = await getVideoJob(jobId);
  if (!job) return false;
  if (job.workerLeaseExpiresAt && job.workerLeaseExpiresAt.getTime() > Date.now()) return false;
  if (job.status === "queued" || job.status === "segmenting") {
    await dispatch(jobId, "sam");
    return true;
  }
  if (job.status === "mapping") {
    await dispatch(jobId, "muse");
    return true;
  }
  return false;
}

/** Periodic scanner for restart recovery; upload_pending/ready remain user-gated. */
export async function recoverRunnableVideoJobs(limit = 50): Promise<void> {
  const jobs = await listRunnableVideoJobs(limit);
  await Promise.all(jobs.map(({ id, stage }) => dispatch(id, stage)));
}
