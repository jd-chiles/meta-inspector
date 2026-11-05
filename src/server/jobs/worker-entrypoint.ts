import type { Job } from "pg-boss";
import { getJobPool, JobInfrastructureError } from "./database";
import { getVideoBoss, stopVideoBoss, VIDEO_PROCESS_QUEUE, type VideoProcessJobData } from "./queue";
import { processVideoMuseStage, processVideoSamStage } from "./video-worker";
import { cleanupExpiredVideoJobs, cleanupTerminalVideoSources } from "./worker";
import { recoverRunnableVideoJobs } from "./recovery";

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const RECOVERY_INTERVAL_MS = 60 * 1_000;
let maintenanceTimer: NodeJS.Timeout | null = null;
let cleanupTimer: NodeJS.Timeout | null = null;
let workerStart: Promise<void> | null = null;

async function processQueueJob(job: Job<VideoProcessJobData>): Promise<void> {
  const data = job.data;
  if (!data || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.videoJobId) ||
      (data.stage !== "sam" && data.stage !== "muse")) {
    return;
  }

  const result = data.stage === "sam"
    ? await processVideoSamStage(data.videoJobId)
    : await processVideoMuseStage(data.videoJobId);

  // A competing in-process wake may own the lease. Consume this delivery;
  // the scanner re-dispatches after lease expiry. It never retries a provider
  // call once the durable provider-start marker is present.
  void result;
}

/** Start the stage queue in the managed CPU worker process. */
export async function startVideoJobWorker(): Promise<void> {
  if (!workerStart) {
    workerStart = (async () => {
      if (!process.env.DATABASE_URL?.trim()) throw new JobInfrastructureError();
      getJobPool();
      const boss = await getVideoBoss();
      await boss.work<VideoProcessJobData>(VIDEO_PROCESS_QUEUE, {
        batchSize: 1,
        localConcurrency: 2,
        groupConcurrency: 2,
        pollingIntervalSeconds: 1,
      }, async (jobs: Job<VideoProcessJobData>[]) => {
        for (const job of jobs) await processQueueJob(job);
      });
      void recoverRunnableVideoJobs().catch(() => undefined);
      void cleanupTerminalVideoSources().catch(() => undefined);
      void cleanupExpiredVideoJobs().catch(() => undefined);
      if (!maintenanceTimer) {
        maintenanceTimer = setInterval(() => {
          void recoverRunnableVideoJobs().catch(() => undefined);
          void cleanupTerminalVideoSources().catch(() => undefined);
        }, RECOVERY_INTERVAL_MS);
        maintenanceTimer.unref?.();
      }
      if (!cleanupTimer) {
        cleanupTimer = setInterval(() => { void cleanupExpiredVideoJobs().catch(() => undefined); }, CLEANUP_INTERVAL_MS);
        cleanupTimer.unref?.();
      }
    })().catch((error: unknown) => {
      workerStart = null;
      throw error;
    });
  }
  return workerStart;
}

/** Explicit entry point for a dedicated Azure Container Apps worker process. */
export async function runVideoWorkerProcess(): Promise<void> {
  await startVideoJobWorker();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (maintenanceTimer) clearInterval(maintenanceTimer);
    maintenanceTimer = null;
    if (cleanupTimer) clearInterval(cleanupTimer);
    cleanupTimer = null;
    workerStart = null;
    void stopVideoBoss().finally(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void runVideoWorkerProcess().catch(() => process.exit(1));
}
