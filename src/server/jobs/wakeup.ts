import { JobInfrastructureError } from "./database";

export type VideoJobStageName = "sam" | "muse";

/**
 * Dispatch a wake to the dedicated, always-on ACA worker app. Its protected
 * start route attaches a pg-boss consumer to the durable queue. A queued row
 * alone cannot wake a service that has scaled to zero.
 */
export async function wakeVideoWorker(jobId: string, stage: VideoJobStageName): Promise<void> {
  const rawUrl = process.env.VIDEO_JOB_WAKE_URL?.trim();
  const token = process.env.VIDEO_JOB_WAKE_TOKEN?.trim();
  if (!rawUrl || !token) throw new JobInfrastructureError();
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new JobInfrastructureError(); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new JobInfrastructureError();
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({ jobId, stage }),
    });
  } catch {
    throw new JobInfrastructureError();
  }
  if (!response.ok) throw new JobInfrastructureError();
  try { await response.body?.cancel(); } catch { /* Response content is never needed. */ }
}
