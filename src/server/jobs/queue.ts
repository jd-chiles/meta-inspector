import { PgBoss } from "pg-boss";
import { getJobPool, JobInfrastructureError } from "./database";

export const VIDEO_PROCESS_QUEUE = "move-in-ready-video-process";
export const VIDEO_QUEUE_RETRY_LIMIT = 0;

export interface VideoProcessJobData {
  videoJobId: string;
  stage: "sam" | "muse";
}

let bossPromise: Promise<PgBoss> | null = null;

export async function getVideoBoss(): Promise<PgBoss> {
  if (!process.env.DATABASE_URL?.trim()) throw new JobInfrastructureError();
  if (!bossPromise) {
    bossPromise = (async () => {
      const connectionString = process.env.DATABASE_URL!.trim();
      // Validate the durable-state connection before opening pg-boss's pool.
      getJobPool();
      const boss = new PgBoss({
        connectionString,
        schema: "pgboss",
        max: 4,
        application_name: "move-in-ready-video-queue",
        monitorIntervalSeconds: 30,
      });
      boss.on("error", () => {
        // Driver errors can contain connection details; keep them out of logs.
      });
      await boss.start();
      await boss.createQueue(VIDEO_PROCESS_QUEUE);
      return boss;
    })().catch((error: unknown) => {
      bossPromise = null;
      throw error;
    });
  }
  return bossPromise;
}

export async function enqueueVideoProcessing(videoJobId: string, stage: "sam" | "muse"): Promise<void> {
  const boss = await getVideoBoss();
  await boss.send(VIDEO_PROCESS_QUEUE, { videoJobId, stage }, {
    // Calls are billable; only a user-created new attempt may retry a stage.
    retryLimit: VIDEO_QUEUE_RETRY_LIMIT,
    expireInSeconds: 15 * 60,
    heartbeatSeconds: 30,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
    singletonKey: `${videoJobId}:${stage}`,
    // Suppress duplicate HTTP dispatches briefly while leaving room for a
    // later explicit user retry after the bounded queue retry window ends.
    singletonSeconds: 120,
  });
}

export async function stopVideoBoss(): Promise<void> {
  const boss = await bossPromise;
  bossPromise = null;
  if (boss) await boss.stop({ graceful: true, timeout: 30_000 });
}
