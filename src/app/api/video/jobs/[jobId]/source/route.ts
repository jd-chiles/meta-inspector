import { createHash, timingSafeEqual } from "node:crypto";
import { createR2Storage, MAX_R2_VIDEO_BYTES } from "../../../../../../server/storage/r2";
import { assertJobRequestSameOrigin, assertVideoJobAccess, parseJobId, VideoJobHttpError } from "../../../../../../server/jobs/http";
import { getAuthorizedVideoJob, hasLiveVideoJobMediaObject } from "../../../../../../server/jobs/video-job-store";

export const runtime = "nodejs";
export const maxDuration = 30;

function absent(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store, private, max-age=0", "X-Content-Type-Options": "nosniff" } });
}

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }): Promise<Response> {
  try {
    assertJobRequestSameOrigin(request);
    await assertVideoJobAccess(request);
    const { jobId: rawId } = await context.params;
    const id = parseJobId(rawId);
    const job = await getAuthorizedVideoJob(id);
    if (!job) return absent();
    if (job.status === "completed" || job.status === "ambiguous" || job.status === "cancelled" ||
        (job.status === "failed" && !job.retryable) || !await hasLiveVideoJobMediaObject(id)) return absent();
    const object = await createR2Storage().getObject(job.mediaObjectKey);
    if (!object || object.contentType !== job.mediaContentType || object.contentLength !== job.mediaContentLength) return absent();
    const reader = object.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_R2_VIDEO_BYTES || length > job.mediaContentLength) throw new VideoJobHttpError(404, "VIDEO_NOT_FOUND", "The source video could not be found.");
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (length !== job.mediaContentLength) return absent();
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const actual = createHash("sha256").update(bytes).digest();
    if (!job.identity.expectedVideoSha256) return absent();
    const expected = Buffer.from(job.identity.expectedVideoSha256, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return absent();

    let start = 0;
    let end = bytes.length - 1;
    let status = 200;
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.length}`, "Cache-Control": "no-store" } });
      if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix < 1) return new Response(null, { status: 416 });
        start = Math.max(0, bytes.length - suffix);
      } else {
        start = Number(match[1]);
        if (match[2]) end = Number(match[2]);
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= bytes.length) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.length}`, "Cache-Control": "no-store" } });
      }
      end = Math.min(end, bytes.length - 1);
      status = 206;
    }
    const body = bytes.slice(start, end + 1);
    return new Response(body, { status, headers: {
      "Content-Type": job.mediaContentType,
      "Content-Length": String(body.byteLength),
      "Accept-Ranges": "bytes",
      ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}),
      "Cache-Control": "no-store, private, max-age=0",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch { return absent(); }
}
