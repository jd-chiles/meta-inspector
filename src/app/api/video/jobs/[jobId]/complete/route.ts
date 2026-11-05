import { createHash } from "node:crypto";
import { createR2Storage, MAX_R2_VIDEO_BYTES } from "../../../../../../server/storage/r2";
import { assertJobRequestSameOrigin, assertVideoJobAccess, jobFailure, noStoreJson, parseJobId, VideoJobHttpError } from "../../../../../../server/jobs/http";
import { getVideoJob, hasLiveVideoJobMediaObject, verifyUploadedVideoObject } from "../../../../../../server/jobs/video-job-store";
import { validateVideoBytes } from "../../../../../../server/video/validate";
import { decodeSourceFrames } from "../../../../../../server/video/source-stills";

export const runtime = "nodejs";
export const maxDuration = 120;

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      return { height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!, width: (bytes[offset + 5]! << 8) | bytes[offset + 6]! };
    }
    offset += length;
  }
  return null;
}

async function boundedObjectBytes(body: ReadableStream<Uint8Array>, expectedLength: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_R2_VIDEO_BYTES || total > expectedLength) throw new VideoJobHttpError(413, "VIDEO_TOO_LARGE", "The uploaded video exceeded its size limit.");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (total !== expectedLength) throw new VideoJobHttpError(422, "INVALID_VIDEO", "The uploaded video was incomplete.");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }): Promise<Response> {
  try {
    assertJobRequestSameOrigin(request);
    await assertVideoJobAccess(request);
    const { jobId: rawId } = await context.params;
    const id = parseJobId(rawId);
    const store = createR2Storage();
    const job = await getVideoJob(id);
    if (!job) throw new VideoJobHttpError(404, "JOB_NOT_FOUND", "The video job could not be found.");
    if (job.status === "upload_pending") {
      const metadata = await store.headObject(job.mediaObjectKey);
      if (!metadata || metadata.contentLength !== job.mediaContentLength || metadata.contentType !== job.mediaContentType) {
        throw new VideoJobHttpError(409, "UPLOAD_INCOMPLETE", "The uploaded video is missing or does not match its upload details.");
      }
      const object = await store.getObject(job.mediaObjectKey);
      if (!object || object.contentLength !== job.mediaContentLength || object.contentType !== job.mediaContentType) {
        throw new VideoJobHttpError(409, "UPLOAD_INCOMPLETE", "The uploaded video could not be verified.");
      }
      const bytes = await boundedObjectBytes(object.body, job.mediaContentLength);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (job.identity.expectedVideoSha256 && sha256 !== job.identity.expectedVideoSha256) {
        throw new VideoJobHttpError(409, "UPLOAD_HASH_MISMATCH", "The uploaded bytes do not match this saved video. Capture the clip again before starting a new analysis.");
      }
      const parsed = validateVideoBytes(bytes);
      if (parsed.mimeType !== job.mediaContentType || !parsed.durationMs || !parsed.frameTimestampsMs?.length) {
        throw new VideoJobHttpError(415, "UNSUPPORTED_VIDEO", "The video bytes do not match the selected format or duration limits.");
      }
      const decoded = await decodeSourceFrames(bytes, [0], [parsed.frameTimestampsMs[0]!], AbortSignal.timeout(60_000));
      const dimensions = decoded[0] && jpegDimensions(decoded[0]);
      if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
        throw new VideoJobHttpError(422, "INVALID_VIDEO", "The uploaded video could not be decoded.");
      }
      const queued = await verifyUploadedVideoObject(id, { sha256, durationMs: parsed.durationMs, ...dimensions });
      if (!queued) throw new VideoJobHttpError(404, "JOB_NOT_FOUND", "The video job could not be found.");
      const source = queued.status !== "cancelled" && await hasLiveVideoJobMediaObject(id)
        ? await store.createMediaDownloadUrl({ objectKey: queued.mediaObjectKey, expiresInSeconds: 180 })
        : null;
      return noStoreJson({
        ok: true, jobId: id, status: queued.status, identity: queued.identity,
        ...(source ? { sourceUrl: source.downloadUrl } : {}),
        media: { sha256, contentLength: queued.mediaContentLength, contentType: queued.mediaContentType,
          durationMs: queued.mediaDurationMs, durationSeconds: queued.mediaDurationMs! / 1000,
          ...(queued.mediaWidth !== null ? { width: queued.mediaWidth } : {}),
          ...(queued.mediaHeight !== null ? { height: queued.mediaHeight } : {}) },
      }, 200);
    }
    const source = job.status !== "completed" && job.status !== "ambiguous" && job.status !== "cancelled" &&
      (job.status !== "failed" || job.retryable) && await hasLiveVideoJobMediaObject(id)
      ? await store.createMediaDownloadUrl({ objectKey: job.mediaObjectKey, expiresInSeconds: 180 })
      : null;
    return noStoreJson({
      ok: true, jobId: id, status: job.status, identity: job.identity,
      ...(source ? { sourceUrl: source.downloadUrl } : {}),
      media: { sha256: job.identity.expectedVideoSha256, contentLength: job.mediaContentLength,
        contentType: job.mediaContentType, durationMs: job.mediaDurationMs, durationSeconds: job.mediaDurationMs ? job.mediaDurationMs / 1000 : undefined,
        width: job.mediaWidth, height: job.mediaHeight },
    }, 200);
  } catch (error) { return jobFailure(error); }
}
