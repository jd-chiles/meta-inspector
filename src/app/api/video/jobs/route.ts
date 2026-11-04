import { randomUUID } from "node:crypto";
import { getServerCatalog } from "../../../../server/catalog";
import { getInspection } from "../../../../server/inspection/store";
import { assertJobRequestSameOrigin, assertVideoJobAccess, boundedJsonBody, jobFailure, noStoreJson, VideoJobHttpError } from "../../../../server/jobs/http";
import { insertVideoJob, type DurableVideoIdentity } from "../../../../server/jobs/video-job-store";
import { createR2Storage, MAX_R2_VIDEO_BYTES } from "../../../../server/storage/r2";
import { isMoveInReadyRoomId, MOVE_IN_READY_SCHEMA_VERSION } from "../../../../domain/move-in-ready";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function parseIdentity(value: unknown): Omit<DurableVideoIdentity, "expectedVideoSha256"> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const expected = ["sessionId", "schemaVersion", "videoId", "videoRevision", "analysisId", "attempt", "catalogVersion"];
  if (Object.keys(input).length !== expected.length || Object.keys(input).some((key) => !expected.includes(key))) return null;
  if (typeof input.sessionId !== "string" || !ID_PATTERN.test(input.sessionId) ||
      typeof input.videoId !== "string" || !ID_PATTERN.test(input.videoId) ||
      typeof input.analysisId !== "string" || !ID_PATTERN.test(input.analysisId) ||
      typeof input.schemaVersion !== "number" || !Number.isSafeInteger(input.schemaVersion) || input.schemaVersion !== MOVE_IN_READY_SCHEMA_VERSION ||
      typeof input.videoRevision !== "number" || !Number.isSafeInteger(input.videoRevision) || input.videoRevision < 1 || input.videoRevision > 999_999_999 ||
      typeof input.attempt !== "number" || !Number.isSafeInteger(input.attempt) || input.attempt < 0 || input.attempt > 999_999_999 ||
      typeof input.catalogVersion !== "string" || !ID_PATTERN.test(input.catalogVersion)) return null;
  return input as unknown as ReturnType<typeof parseIdentity>;
}

export async function POST(request: Request): Promise<Response> {
  try {
    await assertVideoJobAccess(request);
    assertJobRequestSameOrigin(request);
    const body = await boundedJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new VideoJobHttpError(400, "INVALID_REQUEST", "The video job details are invalid.");
    const value = body as Record<string, unknown>;
    const media = typeof value.media === "object" && value.media !== null && !Array.isArray(value.media)
      ? value.media as Record<string, unknown> : null;
    if (!media || Object.keys(value).length !== 3 || Object.keys(value).some((key) => !["room", "identity", "media"].includes(key))) {
      throw new VideoJobHttpError(400, "INVALID_REQUEST", "Include room, clip identity, and media details.");
    }
    if (!isMoveInReadyRoomId(value.room)) throw new VideoJobHttpError(400, "INVALID_REQUEST", "Choose a supported walkthrough room.");
    const identity = parseIdentity(value.identity);
    if (!identity) throw new VideoJobHttpError(400, "INVALID_REQUEST", "The current video identity is incomplete or invalid.");
    if ((media.contentType !== "video/mp4" && media.contentType !== "video/quicktime") ||
        typeof media.contentLength !== "number" || !Number.isSafeInteger(media.contentLength) ||
        media.contentLength <= 0 || media.contentLength > MAX_R2_VIDEO_BYTES) {
      throw new VideoJobHttpError(413, "VIDEO_TOO_LARGE", "The video must be a supported MP4 or MOV no larger than 60 MiB.");
    }
    let catalogVersion: string;
    try { catalogVersion = getServerCatalog().version; }
    catch { throw new VideoJobHttpError(503, "SETUP_REQUIRED", "The walkthrough catalog is not available on this server."); }
    if (identity.catalogVersion !== catalogVersion) throw new VideoJobHttpError(409, "STALE_REQUEST", "The walkthrough changed. Refresh before analyzing this video.");

    const stored = await getInspection(identity.sessionId);
    const inspection = stored?.inspection;
    if (!inspection || inspection.schemaVersion !== identity.schemaVersion || inspection.catalogVersion !== identity.catalogVersion ||
        !inspection.roomIds.includes(value.room)) {
      throw new VideoJobHttpError(409, "STALE_REQUEST", "Save this walkthrough before starting live analysis.");
    }
    const clip = inspection.clipIdentities[value.room];
    const expectedRevision = clip ? clip.videoRevision + 1 : 1;
    if (identity.videoRevision !== expectedRevision) {
      throw new VideoJobHttpError(409, "STALE_REQUEST", "This video version is not the next saved clip revision for this room.");
    }

    const contentType = media.contentType;
    const contentLength = media.contentLength;
    const upload = await createR2Storage().createUploadUrl({ contentType, contentLength });
    const id = randomUUID();
    let job;
    try {
      job = await insertVideoJob({
        id, sessionId: identity.sessionId, roomId: value.room, identity: { ...identity, expectedVideoSha256: null },
        mediaObjectKey: upload.objectKey, mediaContentType: contentType, mediaContentLength: contentLength,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    } catch (error) {
      // A retried create with an already-registered identity seed is a stale
      // client state, not a service outage. The orphaned presigned URL simply
      // expires; the original job remains upload-pending until its TTL.
      if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505") {
        throw new VideoJobHttpError(409, "STALE_REQUEST", "This video version was already registered. Reload the room before uploading again.");
      }
      throw error;
    }
    const seedIdentity = {
      sessionId: job.identity.sessionId, schemaVersion: job.identity.schemaVersion,
      videoId: job.identity.videoId, videoRevision: job.identity.videoRevision,
      analysisId: job.identity.analysisId, attempt: job.identity.attempt,
      catalogVersion: job.identity.catalogVersion,
    };
    return noStoreJson({
      ok: true, jobId: job.id, status: "upload_pending", identity: seedIdentity,
      upload: { url: upload.uploadUrl, method: "PUT", headers: upload.requiredHeaders, expiresAt: upload.expiresAt },
    }, 201);
  } catch (error) { return jobFailure(error); }
}
