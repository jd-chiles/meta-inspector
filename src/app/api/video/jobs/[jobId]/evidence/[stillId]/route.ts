import { assertJobRequestSameOrigin, assertVideoJobAccess, jobFailure, noStoreJson, parseJobId, VideoJobHttpError } from "../../../../../../../server/jobs/http";
import { getAuthorizedVideoJob, getVideoEvidenceObjectByOrdinal } from "../../../../../../../server/jobs/video-job-store";
import { getVerifiedR2Bytes } from "../../../../../../../server/jobs/r2-bytes";
import { createR2Storage, MAX_R2_EVIDENCE_BYTES } from "../../../../../../../server/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ jobId: string; stillId: string }> };

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
    bytes[bytes.byteLength - 2] === 0xff && bytes[bytes.byteLength - 1] === 0xd9;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertJobRequestSameOrigin(request);
    await assertVideoJobAccess(request);
    const { jobId, stillId } = await context.params;
    if (!/^\d{1,3}$/.test(stillId)) throw new VideoJobHttpError(404, "EVIDENCE_NOT_FOUND", "The evidence still could not be found.");
    const ordinal = Number(stillId);
    const job = await getAuthorizedVideoJob(parseJobId(jobId));
    if (!job || job.status !== "completed") throw new VideoJobHttpError(404, "EVIDENCE_NOT_FOUND", "The evidence still could not be found.");
    const evidence = await getVideoEvidenceObjectByOrdinal(job.id, ordinal);
    if (!evidence || evidence.byteLength <= 0 || evidence.byteLength > MAX_R2_EVIDENCE_BYTES) throw new VideoJobHttpError(404, "EVIDENCE_NOT_FOUND", "The evidence still could not be found.");
    const bytes = await getVerifiedR2Bytes(createR2Storage(), evidence.objectKey, MAX_R2_EVIDENCE_BYTES, {
      contentLength: evidence.byteLength, contentType: "image/jpeg", sha256: evidence.sha256,
    });
    if (!isJpeg(bytes)) throw new VideoJobHttpError(502, "EVIDENCE_INTEGRITY_FAILED", "The saved evidence still could not be verified.");
    return new Response(bytes, { status: 200, headers: {
      "Content-Type": "image/jpeg", "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store, private, max-age=0", Pragma: "no-cache", Expires: "0",
      "X-Content-Type-Options": "nosniff", "X-Evidence-SHA256": evidence.sha256,
    } });
  } catch (error) {
    if (error instanceof VideoJobHttpError) return noStoreJson({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    return jobFailure(error);
  }
}
