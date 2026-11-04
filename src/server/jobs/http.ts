import { isAuthGateEnabled } from "../auth";
import { AUTH_COOKIE_NAME, verifyAuthCookie } from "../auth";
import { WALKTHROUGH_CLIENT_HEADER, WALKTHROUGH_CLIENT_ID } from "../../domain/walkthrough-client";

export class VideoJobHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "VideoJobHttpError";
    this.status = status;
    this.code = code;
  }
}

function normalizedOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    if (url.hostname.toLowerCase() === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") {
      url.hostname = "localhost";
      return url.origin;
    }
  } catch { /* invalid origins fail closed below */ }
  return origin;
}

export function assertVideoJobsLive(): void {
  if (process.env.APP_ANALYSIS_MODE !== "live") {
    throw new VideoJobHttpError(503, "SETUP_REQUIRED", "Live video processing is not enabled on this server.");
  }
  if (!/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL?.trim() ?? "")) {
    throw new VideoJobHttpError(503, "SETUP_REQUIRED", "Durable video job storage is not configured on this server.");
  }
  if (!process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || !process.env.R2_BUCKET_NAME?.trim() ||
      !process.env.R2_ACCESS_KEY_ID?.trim() || !process.env.R2_SECRET_ACCESS_KEY?.trim()) {
    throw new VideoJobHttpError(503, "SETUP_REQUIRED", "Private video storage is not configured on this server.");
  }
  if (process.env.NODE_ENV === "production" && !isAuthGateEnabled()) {
    throw new VideoJobHttpError(503, "SETUP_REQUIRED", "Protected access is required before live video processing can be enabled.");
  }
}

/** API routes return JSON auth failures instead of middleware's unlock redirect. */
export async function assertVideoJobAccess(request: Request): Promise<void> {
  assertVideoJobsLive();
  const passcode = process.env.INSPECTION_PASSCODE ?? "";
  if (!passcode) {
    if (process.env.NODE_ENV === "production") {
      throw new VideoJobHttpError(503, "SETUP_REQUIRED", "Protected access is required before video jobs can be used.");
    }
    return;
  }
  const cookie = request.headers.get("cookie")?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_COOKIE_NAME}=`))
    ?.slice(AUTH_COOKIE_NAME.length + 1);
  if (!(await verifyAuthCookie(cookie, passcode))) {
    throw new VideoJobHttpError(401, "UNAUTHORIZED", "Unlock this app before accessing video jobs.");
  }
}

export function assertJobRequestSameOrigin(request: Request): void {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  let suppliedOrigin = origin;
  if (!suppliedOrigin && referer) {
    try { suppliedOrigin = new URL(referer).origin; } catch { suppliedOrigin = null; }
  }
  if (suppliedOrigin) {
    let trustedOrigin = requestOrigin;
    const configured = process.env.APP_PUBLIC_ORIGIN?.trim();
    if (configured) {
      try {
        const url = new URL(configured);
        if ((url.protocol !== "https:" && url.protocol !== "http:") ||
            url.origin !== configured.replace(/\/$/, "")) throw new Error("Invalid origin");
        trustedOrigin = url.origin;
      } catch {
        throw new VideoJobHttpError(503, "SETUP_REQUIRED", "The public app origin is not configured correctly.");
      }
    }
    if (normalizedOrigin(suppliedOrigin) !== normalizedOrigin(trustedOrigin)) throw new VideoJobHttpError(400, "INVALID_REQUEST", "Submit the video from this app.");
    return;
  }
  if (request.headers.get(WALKTHROUGH_CLIENT_HEADER) !== WALKTHROUGH_CLIENT_ID) {
    throw new VideoJobHttpError(400, "INVALID_REQUEST", "Submit the video from this app.");
  }
}

export function parseJobId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new VideoJobHttpError(404, "JOB_NOT_FOUND", "The video job could not be found.");
  }
  return value.toLowerCase();
}

export function noStoreJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, private, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function jobFailure(error: unknown): Response {
  const typed = error instanceof VideoJobHttpError
    ? error
    : new VideoJobHttpError(503, "JOB_SERVICE_UNAVAILABLE", "Durable video processing is temporarily unavailable.");
  return noStoreJson({ ok: false, error: { code: typed.code, message: typed.message } }, typed.status);
}

export async function boundedJsonBody(request: Request, maxBytes = 16 * 1024): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new VideoJobHttpError(400, "INVALID_REQUEST", "Send the video job details as JSON.");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
    throw new VideoJobHttpError(413, "INVALID_REQUEST", "The video job request exceeded its size limit.");
  }
  if (!request.body) throw new VideoJobHttpError(400, "INVALID_REQUEST", "The video job details were not valid JSON.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new VideoJobHttpError(413, "INVALID_REQUEST", "The video job request exceeded its size limit.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof VideoJobHttpError) throw error;
    throw new VideoJobHttpError(400, "INVALID_REQUEST", "The video job details were not valid JSON.");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; } catch {
    throw new VideoJobHttpError(400, "INVALID_REQUEST", "The video job details were not valid JSON.");
  }
}

export function publicVideoJob(job: {
  id: string;
  status: string;
  stage: string;
  retryable: boolean;
  roomId: string;
  identity: Record<string, unknown>;
  safeErrorCode: string | null;
  safeErrorMessage: string | null;
  segmentResult: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
}) {
  return {
    ok: true,
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    retryable: job.retryable,
    room: job.roomId,
    identity: job.identity,
    error: job.safeErrorCode ? { code: job.safeErrorCode, message: job.safeErrorMessage ?? "Video processing could not be completed." } : null,
    ...(job.status === "completed" && job.result
      ? { result: job.result }
      : job.status === "mapping" && job.segmentResult
        ? { result: { segment: job.segmentResult, mapped: null } }
        : {}),
  };
}
