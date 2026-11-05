import { timingSafeEqual } from "node:crypto";
import { startVideoJobWorker } from "../../../../../server/jobs/worker-entrypoint";
import { VideoJobHttpError, noStoreJson } from "../../../../../server/jobs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasWakeToken(request: Request): boolean {
  const expected = process.env.VIDEO_JOB_WAKE_TOKEN?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return expected.length >= 32 && supplied.length === expected.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.APP_ANALYSIS_MODE !== "live" || process.env.VIDEO_WORKER_IN_WEB_PROCESS !== "1") {
    return noStoreJson({ ok: false, error: { code: "NOT_FOUND", message: "The worker endpoint could not be found." } }, 404);
  }
  if (!hasWakeToken(request)) {
    return noStoreJson({ ok: false, error: { code: "UNAUTHORIZED", message: "Worker authentication is required." } }, 401);
  }
  try {
    await startVideoJobWorker();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    const typed = error instanceof VideoJobHttpError ? error : new VideoJobHttpError(503, "JOB_SERVICE_UNAVAILABLE", "The video worker is temporarily unavailable.");
    return noStoreJson({ ok: false, error: { code: typed.code, message: typed.message } }, typed.status);
  }
}
