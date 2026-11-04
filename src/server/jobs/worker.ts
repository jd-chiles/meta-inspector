import type { Job } from "pg-boss";
import { createR2Storage } from "../storage/r2";
import { getVideoBoss, VIDEO_PROCESS_QUEUE, type VideoProcessJobData } from "./queue";
import {
  deleteVideoJobRow, listExpiredVideoJobIds, listVideoJobObjectsForCleanup,
  listTerminalVideoJobMedia, markVideoJobObjectDeleted, terminalizeExpiredActiveVideoJobs,
} from "./video-job-store";
import { processVideoMuseStage, processVideoSamStage } from "./video-worker";

/** One queue message represents one durable, at-most-once provider stage. */
export async function processVideoJob(jobId: string, stage: "sam" | "muse"): Promise<void> {
  if (stage === "sam") await processVideoSamStage(jobId);
  else await processVideoMuseStage(jobId);
}

export async function startVideoJobWorker(): Promise<void> {
  const boss = await getVideoBoss();
  await boss.work<VideoProcessJobData>(VIDEO_PROCESS_QUEUE, {
    batchSize: 1,
    localConcurrency: 2,
    groupConcurrency: 2,
    pollingIntervalSeconds: 1,
  }, async (jobs: Job<VideoProcessJobData>[]) => {
    for (const job of jobs) {
      if (!job.data || typeof job.data.videoJobId !== "string" ||
          (job.data.stage !== "sam" && job.data.stage !== "muse")) continue;
      // Stage processors own failures and durable ambiguity markers. Queue
      // retries remain disabled because a provider-started stage is billable.
      await processVideoJob(job.data.videoJobId, job.data.stage);
    }
  });
}

/** Bounded retention pass; source media remains until session deletion or TTL. */
export async function cleanupExpiredVideoJobs(limit = 100): Promise<void> {
  // Expire active rows first, invalidating their leases before cleanup. A
  // provider-start marker becomes terminal ambiguity, never another call.
  await terminalizeExpiredActiveVideoJobs(limit);
  const expiredIds = await listExpiredVideoJobIds(limit);
  const storage = createR2Storage();
  for (const id of expiredIds) {
    const objectKeys = await listVideoJobObjectsForCleanup(id);
    let failed = false;
    for (const objectKey of objectKeys) {
      try {
        await storage.deleteObject(objectKey);
        await markVideoJobObjectDeleted(id, objectKey);
      } catch { failed = true; }
    }
    if (!failed) await deleteVideoJobRow(id);
  }
}

/** Delete only the original source object after terminal, non-retryable work. */
export async function cleanupTerminalVideoSources(limit = 100): Promise<void> {
  const refs = await listTerminalVideoJobMedia(limit);
  const storage = createR2Storage();
  for (const { id, objectKey } of refs) {
    try {
      await storage.deleteObject(objectKey);
      await markVideoJobObjectDeleted(id, objectKey);
    } catch {
      // The durable object reference stays live for the next maintenance pass.
    }
  }
}
