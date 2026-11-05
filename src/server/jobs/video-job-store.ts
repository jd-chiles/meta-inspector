import { getJobPool, withTransaction } from "./database";

export type VideoJobStatus =
  | "upload_pending"
  | "ready"
  | "queued"
  | "segmenting"
  | "mapping"
  | "completed"
  | "failed"
  | "ambiguous"
  | "cancel_requested"
  | "cancelled";

export type VideoJobStage = "upload" | "ready" | "queued" | "sam" | "muse" | "complete";

export interface DurableVideoIdentity {
  sessionId: string;
  schemaVersion: number;
  videoId: string;
  videoRevision: number;
  analysisId: string;
  attempt: number;
  catalogVersion: string;
  expectedVideoSha256: string | null;
  normalizedVideoSha256?: string;
}

export interface VideoJobObject {
  objectKey: string;
  kind: "candidate" | "context";
  candidateId?: string;
  frameIndex: number;
  timestampMs: number;
  sha256: string;
  byteLength: number;
  width: number;
  height: number;
}

export interface VideoJobRow {
  id: string;
  sessionId: string;
  roomId: string;
  identity: DurableVideoIdentity;
  mediaObjectKey: string;
  mediaContentType: "video/mp4" | "video/quicktime";
  mediaContentLength: number;
  mediaDurationMs: number | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
  normalizedVideoSha256: string | null;
  status: VideoJobStatus;
  stage: VideoJobStage;
  retryable: boolean;
  safeErrorCode: string | null;
  safeErrorMessage: string | null;
  samStartedAt: Date | null;
  samCompletedAt: Date | null;
  museStartedAt: Date | null;
  candidateToken: string | null;
  segmentResult: Record<string, unknown> | null;
  stillObjects: VideoJobObject[];
  result: Record<string, unknown> | null;
  cancelRequestedAt: Date | null;
  workerLeaseId: string | null;
  workerLeaseExpiresAt: Date | null;
  expiresAt: Date;
}

export interface NewVideoJob {
  id: string;
  sessionId: string;
  roomId: string;
  identity: DurableVideoIdentity;
  mediaObjectKey: string;
  mediaContentType: "video/mp4" | "video/quicktime";
  mediaContentLength: number;
  expiresAt: Date;
}

const LEASE_MS = 4 * 60 * 1000;

function asDate(value: unknown): Date | null {
  return value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch { return null; }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function objectList(value: unknown): VideoJobObject[] {
  if (typeof value === "string") {
    try { value = JSON.parse(value) as unknown; } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is VideoJobObject =>
    typeof item === "object" && item !== null &&
    typeof (item as VideoJobObject).objectKey === "string" &&
    ((item as VideoJobObject).kind === "candidate" || (item as VideoJobObject).kind === "context") &&
    Number.isSafeInteger((item as VideoJobObject).frameIndex) &&
    Number.isSafeInteger((item as VideoJobObject).timestampMs) &&
    typeof (item as VideoJobObject).sha256 === "string" &&
    Number.isSafeInteger((item as VideoJobObject).byteLength) &&
    Number.isSafeInteger((item as VideoJobObject).width) &&
    Number.isSafeInteger((item as VideoJobObject).height),
  );
}

function mapJob(row: Record<string, unknown>): VideoJobRow {
  const rawIdentity = asObject(row.identity);
  if (!rawIdentity) throw new Error("Invalid durable video job identity.");
  const identity: DurableVideoIdentity = {
    ...(rawIdentity as unknown as Omit<DurableVideoIdentity, "expectedVideoSha256">),
    expectedVideoSha256: typeof rawIdentity.expectedVideoSha256 === "string" ? rawIdentity.expectedVideoSha256.trim() : null,
    ...(typeof rawIdentity.normalizedVideoSha256 === "string" ? { normalizedVideoSha256: rawIdentity.normalizedVideoSha256.trim() } : {}),
  };
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    roomId: String(row.room_id),
    identity: identity as unknown as DurableVideoIdentity,
    mediaObjectKey: String(row.media_object_key),
    mediaContentType: row.media_content_type === "video/quicktime" ? "video/quicktime" : "video/mp4",
    mediaContentLength: Number(row.media_content_length),
    mediaDurationMs: row.media_duration_ms === null ? null : Number(row.media_duration_ms),
    mediaWidth: row.media_width === null ? null : Number(row.media_width),
    mediaHeight: row.media_height === null ? null : Number(row.media_height),
    normalizedVideoSha256: typeof row.normalized_video_sha256 === "string" ? row.normalized_video_sha256.trim() : null,
    status: row.status as VideoJobStatus,
    stage: row.stage as VideoJobStage,
    retryable: Boolean(row.retryable),
    safeErrorCode: typeof row.safe_error_code === "string" ? row.safe_error_code : null,
    safeErrorMessage: typeof row.safe_error_message === "string" ? row.safe_error_message : null,
    samStartedAt: asDate(row.sam_started_at),
    samCompletedAt: asDate(row.sam_completed_at),
    museStartedAt: asDate(row.muse_started_at),
    candidateToken: typeof row.candidate_token === "string" ? row.candidate_token : null,
    segmentResult: asObject(row.segment_result),
    stillObjects: objectList(row.still_objects),
    result: asObject(row.result),
    cancelRequestedAt: asDate(row.cancel_requested_at),
    workerLeaseId: typeof row.worker_lease_id === "string" ? row.worker_lease_id : null,
    workerLeaseExpiresAt: asDate(row.worker_lease_expires_at),
    expiresAt: asDate(row.expires_at) ?? new Date(0),
  };
}

const JOB_COLUMNS = `id, session_id, room_id,
  jsonb_strip_nulls(jsonb_build_object(
    'sessionId', session_id,
    'schemaVersion', schema_version,
    'videoId', video_id,
    'videoRevision', video_revision,
    'analysisId', analysis_id,
    'attempt', attempt,
    'catalogVersion', catalog_version,
    'expectedVideoSha256', expected_video_sha256,
    'normalizedVideoSha256', normalized_video_sha256
  )) AS identity,
  media_object_key, media_content_type, media_content_length, media_duration_ms, media_width, media_height, normalized_video_sha256, status, stage, retryable,
  safe_error_code, safe_error_message, sam_started_at, sam_completed_at,
  muse_started_at, candidate_token, segment_result, still_objects, result,
  cancel_requested_at, worker_lease_id, worker_lease_expires_at, expires_at`;

const CURRENT_CLIP_SQL = `EXISTS (
  SELECT 1 FROM inspection_sessions s
  WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL
    AND s.schema_version=video_analysis_jobs.schema_version
    AND s.catalog_version=video_analysis_jobs.catalog_version
    AND s.inspection->'clipIdentities'->video_analysis_jobs.room_id->>'jobId'=video_analysis_jobs.id::text
    AND s.inspection->'clipIdentities'->video_analysis_jobs.room_id->>'videoId'=video_analysis_jobs.video_id
    AND s.inspection->'clipIdentities'->video_analysis_jobs.room_id->>'videoRevision'=video_analysis_jobs.video_revision::text
    AND s.inspection->'clipIdentities'->video_analysis_jobs.room_id->>'analysisId'=video_analysis_jobs.analysis_id
    AND s.inspection->'clipIdentities'->video_analysis_jobs.room_id->>'attempt'=video_analysis_jobs.attempt::text
    AND s.inspection->'clipIdentities'->video_analysis_jobs.room_id->>'catalogVersion'=video_analysis_jobs.catalog_version
    AND s.inspection->'clipIdentities'->video_analysis_jobs.room_id->>'videoHash'=rtrim(video_analysis_jobs.expected_video_sha256)
)`;

export async function insertVideoJob(input: NewVideoJob): Promise<VideoJobRow> {
  return withTransaction(async (client) => {
    const session = await client.query(
      `SELECT session_id FROM inspection_sessions WHERE session_id=$1 AND deleted_at IS NULL FOR SHARE`,
      [input.sessionId],
    );
    if (session.rowCount !== 1) throw new Error("The inspection session is no longer available.");
    const result = await client.query(
      `INSERT INTO video_analysis_jobs (
      id, session_id, room_id, schema_version, video_id,
      video_revision, analysis_id, attempt, catalog_version, expected_video_sha256,
      media_object_key, media_content_type, media_content_length, status, stage, expires_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12,'upload_pending','upload',$13)
    RETURNING ${JOB_COLUMNS}`,
      [input.id, input.sessionId, input.roomId, input.identity.schemaVersion,
        input.identity.videoId, input.identity.videoRevision, input.identity.analysisId, input.identity.attempt,
        input.identity.catalogVersion, input.mediaObjectKey,
        input.mediaContentType, input.mediaContentLength, input.expiresAt],
    );
    await client.query(
      `INSERT INTO video_analysis_job_objects (job_id, object_key, object_kind, sha256, byte_length)
       VALUES ($1,$2,'media',$3,$4)`,
      [input.id, input.mediaObjectKey, null, input.mediaContentLength],
    );
    return mapJob(result.rows[0] as Record<string, unknown>);
  });
}

export async function getAuthorizedVideoJob(id: string): Promise<VideoJobRow | null> {
  return getVideoJob(id);
}

export async function getVideoJob(id: string): Promise<VideoJobRow | null> {
  const result = await getJobPool().query(`SELECT ${JOB_COLUMNS} FROM video_analysis_jobs j
    WHERE j.id = $1 AND j.expires_at > now()
      AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=j.session_id AND s.deleted_at IS NULL)`, [id]);
  return result.rows[0] ? mapJob(result.rows[0] as Record<string, unknown>) : null;
}

export async function verifyUploadedVideoObject(
  id: string,
  media: { sha256: string; durationMs: number; width?: number; height?: number },
): Promise<VideoJobRow | null> {
  return withTransaction(async (client) => {
    const found = await client.query(
      `SELECT ${JOB_COLUMNS} FROM video_analysis_jobs
       WHERE id=$1 AND expires_at > now()
         AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL)
       FOR UPDATE`, [id],
    );
    if (!found.rows[0]) return null;
    const job = mapJob(found.rows[0] as Record<string, unknown>);
    if (job.status !== "upload_pending") return job;
    if (job.identity.expectedVideoSha256 && media.sha256 !== job.identity.expectedVideoSha256) return null;
    const updated = await client.query(
      `UPDATE video_analysis_jobs SET expected_video_sha256=$2, media_duration_ms=$3, media_width=$4,
         media_height=$5, status='ready', stage='ready', updated_at=now()
       WHERE id=$1 AND status='upload_pending'
         AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL)
       RETURNING ${JOB_COLUMNS}`,
      [id, media.sha256, media.durationMs, media.width ?? null, media.height ?? null],
    );
    await client.query(
      `UPDATE video_analysis_job_objects SET sha256=$2 WHERE job_id=$1 AND object_kind='media' AND deleted_at IS NULL`,
      [id, media.sha256],
    );
    return updated.rows[0] ? mapJob(updated.rows[0] as Record<string, unknown>) : null;
  });
}

export async function queueVerifiedVideoJob(id: string, identity: DurableVideoIdentity): Promise<VideoJobRow | null> {
  return withTransaction(async (client) => {
    const found = await client.query(
      `SELECT ${JOB_COLUMNS} FROM video_analysis_jobs j
       WHERE j.id=$1 AND j.expires_at > now()
         AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=j.session_id AND s.deleted_at IS NULL)
       FOR UPDATE`, [id],
    );
    if (!found.rows[0]) return null;
    const job = mapJob(found.rows[0] as Record<string, unknown>);
    const same = job.identity.sessionId === identity.sessionId && job.identity.schemaVersion === identity.schemaVersion &&
      job.identity.videoId === identity.videoId && job.identity.videoRevision === identity.videoRevision &&
      job.identity.analysisId === identity.analysisId && job.identity.attempt === identity.attempt &&
      job.identity.catalogVersion === identity.catalogVersion && job.identity.expectedVideoSha256 === identity.expectedVideoSha256;
    if (!same || !job.identity.expectedVideoSha256) return null;
    const saved = await client.query(
      `SELECT inspection->'clipIdentities'-> $2 AS clip FROM inspection_sessions
       WHERE session_id=$1 AND deleted_at IS NULL FOR SHARE`, [job.sessionId, job.roomId],
    );
    const clip = asObject(saved.rows[0]?.clip);
    if (!clip || clip.videoId !== identity.videoId || clip.videoRevision !== identity.videoRevision ||
        clip.schemaVersion !== identity.schemaVersion || clip.catalogVersion !== identity.catalogVersion ||
        clip.videoHash !== identity.expectedVideoSha256) return null;
    if (job.status !== "ready") return job;
    const updated = await client.query(
      `UPDATE video_analysis_jobs SET status='queued', stage='queued', updated_at=now()
       WHERE id=$1 AND status='ready'
         AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL)
       RETURNING ${JOB_COLUMNS}`, [id],
    );
    return updated.rows[0] ? mapJob(updated.rows[0] as Record<string, unknown>) : null;
  });
}

export type StageClaim =
  | { kind: "claimed"; job: VideoJobRow }
  | { kind: "busy"; job: VideoJobRow }
  | { kind: "sam-complete"; job: VideoJobRow }
  | { kind: "terminal"; job: VideoJobRow };

async function claimStage(id: string, leaseId: string, stage: "sam" | "muse"): Promise<StageClaim> {
  return withTransaction(async (client) => {
    const found = await client.query(
      `SELECT ${JOB_COLUMNS} FROM video_analysis_jobs
       WHERE id=$1 AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL)
       FOR UPDATE`,
      [id],
    );
    if (!found.rows[0]) throw new Error("Video job not found.");
    let job = mapJob(found.rows[0] as Record<string, unknown>);
    if (job.status === "completed" || job.status === "failed" || job.status === "ambiguous" || job.status === "cancelled" || job.status === "cancel_requested") {
      return { kind: "terminal", job };
    }
    const isActive = stage === "sam" ? job.status === "segmenting" : job.status === "mapping";
    const hasLease = Boolean(job.workerLeaseId);
    if (isActive && hasLease && job.workerLeaseExpiresAt && job.workerLeaseExpiresAt.getTime() > Date.now()) {
      return { kind: "busy", job };
    }

    const providerStarted = stage === "sam" ? job.samStartedAt : job.museStartedAt;
    const stageComplete = stage === "sam" ? job.samCompletedAt : Boolean(job.result);
    if (isActive && providerStarted && !stageComplete) {
      const code = stage === "sam" ? "SAM_OUTCOME_AMBIGUOUS" : "MUSE_OUTCOME_AMBIGUOUS";
      const update = await client.query(
        `UPDATE video_analysis_jobs SET status='ambiguous', retryable=false, safe_error_code=$2,
           safe_error_message='The provider outcome could not be confirmed. Start a new analysis only if you approve a new provider request.',
           worker_lease_id=NULL, worker_lease_expires_at=NULL, updated_at=now()
         WHERE id=$1 AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL)
         RETURNING ${JOB_COLUMNS}`,
        [id, code],
      );
      return { kind: "terminal", job: mapJob(update.rows[0] as Record<string, unknown>) };
    }
    if (stage === "sam" && job.samCompletedAt) return { kind: "sam-complete", job };
    if (stage === "sam" && isActive && hasLease && !providerStarted && job.workerLeaseExpiresAt && job.workerLeaseExpiresAt.getTime() > Date.now()) {
      return { kind: "busy", job };
    }
    if (stage === "muse" && !job.samCompletedAt) return { kind: "terminal", job };

    const status = stage === "sam" ? "segmenting" : "mapping";
    const updated = await client.query(
      `UPDATE video_analysis_jobs SET status=$2, stage=$3, worker_lease_id=$4,
         worker_lease_expires_at=now() + ($5 * interval '1 millisecond'),
         updated_at=now()
       WHERE id=$1 AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL)
       RETURNING ${JOB_COLUMNS}`,
      [id, status, stage, leaseId, LEASE_MS],
    );
    job = mapJob(updated.rows[0] as Record<string, unknown>);
    return { kind: "claimed", job };
  });
}

export const claimSamStage = (id: string, leaseId: string) => claimStage(id, leaseId, "sam");
export const claimMuseStage = (id: string, leaseId: string) => claimStage(id, leaseId, "muse");

export async function markProviderStarted(id: string, leaseId: string, stage: "sam" | "muse"): Promise<void> {
  const column = stage === "sam" ? "sam_started_at" : "muse_started_at";
  const status = stage === "sam" ? "segmenting" : "mapping";
  const result = await getJobPool().query(
    `UPDATE video_analysis_jobs SET ${column}=COALESCE(${column}, now()),
       worker_lease_expires_at=now() + ($4 * interval '1 millisecond'), updated_at=now()
     WHERE id=$1 AND worker_lease_id=$2 AND status=$3 AND cancel_requested_at IS NULL
       AND ${CURRENT_CLIP_SQL}`,
    [id, leaseId, status, LEASE_MS],
  );
  if (result.rowCount !== 1) throw new Error("Video job lease is no longer current.");
}

export async function setNormalizedVideoHash(id: string, leaseId: string, sha256: string): Promise<void> {
  const result = await getJobPool().query(
    `UPDATE video_analysis_jobs SET normalized_video_sha256=$3, updated_at=now()
     WHERE id=$1 AND worker_lease_id=$2 AND status='segmenting'
       AND (normalized_video_sha256 IS NULL OR normalized_video_sha256=$3)
       AND ${CURRENT_CLIP_SQL}`,
    [id, leaseId, sha256],
  );
  if (result.rowCount !== 1) throw new Error("The video job lease is no longer current.");
}

export async function updateStoredCandidateToken(id: string, leaseId: string, token: string): Promise<void> {
  const result = await getJobPool().query(
    `UPDATE video_analysis_jobs SET candidate_token=$3, updated_at=now()
     WHERE id=$1 AND worker_lease_id=$2 AND status='mapping' AND sam_completed_at IS NOT NULL
       AND muse_started_at IS NULL AND cancel_requested_at IS NULL
       AND ${CURRENT_CLIP_SQL}`,
    [id, leaseId, token],
  );
  if (result.rowCount !== 1) throw new Error("The stored video mapping token is no longer current.");
}

export async function persistSegmentStage(
  id: string,
  leaseId: string,
  segment: Record<string, unknown>,
  candidateToken: string | null,
  stillObjects: VideoJobObject[],
): Promise<void> {
  await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE video_analysis_jobs SET
         status=CASE WHEN $4::text IS NULL THEN 'completed' ELSE 'mapping' END,
         stage=CASE WHEN $4::text IS NULL THEN 'complete' ELSE 'muse' END,
         sam_completed_at=now(), completed_at=CASE WHEN $4::text IS NULL THEN now() ELSE NULL END,
         segment_result=$3::jsonb, candidate_token=$4, still_objects=$5::jsonb,
         result=CASE WHEN $4::text IS NULL THEN jsonb_build_object('segment', $3::jsonb, 'mapped', NULL) ELSE NULL END,
         worker_lease_id=NULL, worker_lease_expires_at=NULL, updated_at=now()
       WHERE id=$1 AND worker_lease_id=$2 AND status='segmenting' AND cancel_requested_at IS NULL
         AND ${CURRENT_CLIP_SQL}
       RETURNING id`,
      [id, leaseId, JSON.stringify(segment), candidateToken, JSON.stringify(stillObjects)],
    );
    if (updated.rowCount !== 1) throw new Error("Video job lease is no longer current.");
    for (const object of stillObjects) {
      await client.query(
        `INSERT INTO video_analysis_job_objects
           (job_id, object_key, object_kind, still_id, sha256, byte_length)
         VALUES ($1,$2,$3,NULL,$4,$5) ON CONFLICT (job_id, object_key) DO NOTHING`,
        [id, object.objectKey, object.kind, object.sha256, object.byteLength],
      );
    }
  });
}

export async function persistCompletedStage(
  id: string,
  leaseId: string,
  result: Record<string, unknown>,
  evidenceObjects: Array<{ objectKey: string; stillId: string; sha256: string; byteLength: number }>,
): Promise<void> {
  await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE video_analysis_jobs SET status='completed', stage='complete', completed_at=now(),
         candidate_token=NULL, result=$3::jsonb, safe_error_code=NULL, safe_error_message=NULL,
         retryable=false, worker_lease_id=NULL, worker_lease_expires_at=NULL, updated_at=now()
       WHERE id=$1 AND worker_lease_id=$2 AND status='mapping' AND cancel_requested_at IS NULL
         AND ${CURRENT_CLIP_SQL}
       RETURNING id`,
      [id, leaseId, JSON.stringify(result)],
    );
    if (updated.rowCount !== 1) throw new Error("Video job lease is no longer current.");
    const uniqueEvidence = new Map(evidenceObjects.map((object) => [object.stillId, object]));
    for (const object of uniqueEvidence.values()) {
      await client.query(
        `UPDATE video_analysis_job_objects SET object_kind='evidence', still_id=$3
         WHERE job_id=$1 AND object_key=$2 AND deleted_at IS NULL`,
        [id, object.objectKey, object.stillId],
      );
    }
  });
}

export async function markVideoJobFailed(
  id: string,
  leaseId: string,
  stage: "sam" | "muse",
  code: string,
  message: string,
  retryable = false,
): Promise<void> {
  await getJobPool().query(
    `UPDATE video_analysis_jobs SET status='failed', stage=$3, retryable=$6,
       safe_error_code=$4, safe_error_message=$5,
       candidate_token=CASE WHEN $3='muse' AND $6=true THEN candidate_token ELSE NULL END,
       worker_lease_id=NULL,
       worker_lease_expires_at=NULL, updated_at=now()
     WHERE id=$1 AND worker_lease_id=$2 AND cancel_requested_at IS NULL
       AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL)`,
    [id, leaseId, stage, code.slice(0, 64), message.slice(0, 240), retryable],
  );
}

export async function releaseSafeStageForRetry(id: string, leaseId: string, stage: "sam" | "muse"): Promise<void> {
  const status = stage === "sam" ? "queued" : "mapping";
  const result = await getJobPool().query(
    `UPDATE video_analysis_jobs SET status=$3, stage=CASE WHEN $3='queued' THEN 'queued' ELSE 'muse' END,
       worker_lease_id=NULL, worker_lease_expires_at=NULL, updated_at=now()
     WHERE id=$1 AND worker_lease_id=$2 AND cancel_requested_at IS NULL
       AND (( $3='queued' AND sam_started_at IS NULL ) OR ( $3='mapping' AND muse_started_at IS NULL AND sam_completed_at IS NOT NULL ))
       AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL)`,
    [id, leaseId, status],
  );
  if (result.rowCount !== 1) throw new Error("Safe retry lease could not be released.");
}

/** Requeue only failures whose provider call was never started for that stage. */
export async function requeueRetryableVideoJob(id: string, stage: "sam" | "muse"): Promise<boolean> {
  const result = await getJobPool().query(
    `UPDATE video_analysis_jobs SET
       status=CASE WHEN $2='sam' THEN 'queued' ELSE 'mapping' END,
       stage=$2, retryable=false, safe_error_code=NULL, safe_error_message=NULL,
       worker_lease_id=NULL, worker_lease_expires_at=NULL, updated_at=now()
     WHERE id=$1 AND status='failed' AND retryable=true
       AND (( $2='sam' AND sam_started_at IS NULL )
         OR ( $2='muse' AND muse_started_at IS NULL AND sam_completed_at IS NOT NULL ))
       AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL)
     RETURNING id`,
    [id, stage],
  );
  return result.rowCount === 1;
}

export async function markVideoJobAmbiguous(id: string, leaseId: string, stage: "sam" | "muse"): Promise<void> {
  await getJobPool().query(
    `UPDATE video_analysis_jobs SET status='ambiguous', retryable=false,
       safe_error_code=$3, safe_error_message='The provider outcome could not be confirmed. Start a new analysis only if you approve a new provider request.',
       candidate_token=NULL, worker_lease_id=NULL, worker_lease_expires_at=NULL, updated_at=now()
     WHERE id=$1 AND worker_lease_id=$2
       AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL)`,
    [id, leaseId, stage === "sam" ? "SAM_OUTCOME_AMBIGUOUS" : "MUSE_OUTCOME_AMBIGUOUS"],
  );
}

export async function isVideoJobCancellationRequested(id: string): Promise<boolean> {
  const result = await getJobPool().query(
    `SELECT (cancel_requested_at IS NOT NULL OR status IN ('cancel_requested','cancelled')) AS requested
     FROM video_analysis_jobs WHERE id=$1
       AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL)`, [id],
  );
  return result.rows.length === 0 || Boolean(result.rows[0]?.requested);
}

export async function finishVideoJobCancelled(id: string, leaseId: string): Promise<void> {
  await getJobPool().query(
    `UPDATE video_analysis_jobs SET status='cancelled', retryable=false,
       safe_error_code='CANCELLED', safe_error_message='Video processing was cancelled.',
       candidate_token=NULL, worker_lease_id=NULL, worker_lease_expires_at=NULL, updated_at=now()
     WHERE id=$1 AND worker_lease_id=$2 AND cancel_requested_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL)`, [id, leaseId],
  );
}

export async function requestVideoJobCancellation(id: string): Promise<VideoJobRow | null> {
  return withTransaction(async (client) => {
    const result = await client.query(
      `SELECT ${JOB_COLUMNS} FROM video_analysis_jobs
       WHERE id=$1
         AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL)
       FOR UPDATE`,
      [id],
    );
    if (!result.rows[0]) return null;
    const updated = await client.query(
      `UPDATE video_analysis_jobs SET status='cancelled', stage='complete', retryable=false,
         safe_error_code='CANCELLED', safe_error_message='Video processing was cancelled.',
         candidate_token=NULL, segment_result=NULL, still_objects=NULL, result=NULL,
         cancel_requested_at=COALESCE(cancel_requested_at,now()),
         worker_lease_id=NULL, worker_lease_expires_at=NULL, updated_at=now()
       WHERE id=$1 AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL)
       RETURNING ${JOB_COLUMNS}`,
      [id],
    );
    return mapJob(updated.rows[0] as Record<string, unknown>);
  });
}

export async function registerJobObject(
  id: string,
  object: { objectKey: string; kind: "media" | "candidate" | "context" | "evidence"; stillId?: string; sha256: string; byteLength: number },
): Promise<void> {
  const result = await getJobPool().query(
    `INSERT INTO video_analysis_job_objects (job_id, object_key, object_kind, still_id, sha256, byte_length)
     SELECT j.id,$2,$3,$4,$5,$6 FROM video_analysis_jobs j WHERE j.id=$1
       AND j.status NOT IN ('cancel_requested','cancelled') AND j.cancel_requested_at IS NULL
       AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=j.session_id AND s.deleted_at IS NULL)
     ON CONFLICT (job_id, object_key) DO NOTHING`,
    [id, object.objectKey, object.kind, object.stillId ?? null, object.sha256, object.byteLength],
  );
  if (result.rowCount !== 1) throw new Error("The inspection session is no longer available.");
}


export async function getLiveJobObjects(id: string): Promise<Array<{ object_key: string; still_id: string | null; sha256: string | null; byte_length: number }>> {
  const result = await getJobPool().query(
    `SELECT refs.object_key, refs.still_id, refs.sha256, refs.byte_length FROM (
       SELECT o.object_key, o.still_id, o.sha256, o.byte_length
       FROM video_analysis_job_objects o JOIN video_analysis_jobs j ON j.id=o.job_id
       WHERE o.job_id=$1 AND o.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=j.session_id AND s.deleted_at IS NULL)
       UNION
       SELECT j.media_object_key, NULL::varchar, NULL::char(64), j.media_content_length
       FROM video_analysis_jobs j
       WHERE j.id=$1
         AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=j.session_id AND s.deleted_at IS NULL)
     ) refs`, [id],
  );
  return result.rows as Array<{ object_key: string; still_id: string | null; sha256: string | null; byte_length: number }>;
}

export async function hasLiveVideoJobMediaObject(id: string): Promise<boolean> {
  const result = await getJobPool().query(
    `SELECT 1 FROM video_analysis_jobs j JOIN video_analysis_job_objects o
       ON o.job_id=j.id AND o.object_key=j.media_object_key AND o.object_kind='media' AND o.deleted_at IS NULL
     WHERE j.id=$1 AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=j.session_id AND s.deleted_at IS NULL)
     LIMIT 1`, [id],
  );
  return result.rowCount === 1;
}

export async function getVideoEvidenceObjectByOrdinal(id: string, ordinal: number): Promise<{ objectKey: string; sha256: string; byteLength: number } | null> {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > 100) return null;
  const result = await getJobPool().query(
    // Ordinals are assigned by the worker with a UTF-16 lexicographic sort of
    // still ids, so this lookup must order identically. COLLATE "C" (byte
    // order) matches that sort for identifier charset still ids regardless of
    // the database's locale collation; a locale-aware ORDER BY could resolve
    // an ordinal to a different still than the URL the worker wrote.
    `SELECT o.object_key, o.sha256, o.byte_length
     FROM video_analysis_job_objects o JOIN video_analysis_jobs j ON j.id=o.job_id
     WHERE o.job_id=$1 AND o.object_kind='evidence' AND o.deleted_at IS NULL AND o.still_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=j.session_id AND s.deleted_at IS NULL)
     ORDER BY o.still_id COLLATE "C" OFFSET $2 LIMIT 1`,
    [id, ordinal],
  );
  const row = result.rows[0] as { object_key?: unknown; sha256?: unknown; byte_length?: unknown } | undefined;
  if (!row || typeof row.object_key !== "string" || typeof row.sha256 !== "string") return null;
  return { objectKey: row.object_key, sha256: row.sha256.trim(), byteLength: Number(row.byte_length) };
}

export async function listVideoJobObjectsForCleanup(id: string): Promise<string[]> {
  const result = await getJobPool().query(
    `SELECT refs.object_key FROM (
       SELECT o.object_key FROM video_analysis_job_objects o JOIN video_analysis_jobs j ON j.id=o.job_id
       WHERE o.job_id=$1 AND o.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=j.session_id AND s.deleted_at IS NULL)
       UNION
       SELECT j.media_object_key FROM video_analysis_jobs j
       WHERE j.id=$1
         AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=j.session_id AND s.deleted_at IS NULL)
     ) refs`, [id],
  );
  return result.rows.map((row) => String((row as { object_key: unknown }).object_key));
}

/** Original source media is retained for active work and explicit safe retries only. */
export async function listTerminalVideoJobMedia(limit = 100): Promise<Array<{ id: string; objectKey: string }>> {
  const result = await getJobPool().query(
    `SELECT j.id, j.media_object_key AS object_key FROM video_analysis_jobs j
     JOIN video_analysis_job_objects o ON o.job_id=j.id AND o.object_key=j.media_object_key AND o.deleted_at IS NULL
     WHERE (j.status IN ('completed','ambiguous','cancelled') OR (j.status='failed' AND j.retryable=false))
       AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=j.session_id AND s.deleted_at IS NULL)
     ORDER BY j.updated_at LIMIT $1`,
    [Math.max(1, Math.min(500, limit))],
  );
  return result.rows.map((row) => ({
    id: String((row as { id: unknown }).id), objectKey: String((row as { object_key: unknown }).object_key),
  }));
}

export async function markVideoJobObjectDeleted(id: string, objectKey: string): Promise<void> {
  await getJobPool().query(
    `UPDATE video_analysis_job_objects SET deleted_at=now() WHERE job_id=$1 AND object_key=$2 AND deleted_at IS NULL`,
    [id, objectKey],
  );
}

export async function deleteVideoJobRow(id: string): Promise<void> {
  await getJobPool().query("DELETE FROM video_analysis_jobs WHERE id=$1", [id]);
}

/**
 * Expired work is made terminal before its R2 objects are removed. An active
 * provider stage whose start marker was committed is ambiguous and can never
 * be dispatched again; a stage that had not started is a non-retryable expiry.
 * Row locks serialize this with stage claims and provider-start markers.
 */
export async function terminalizeExpiredActiveVideoJobs(limit = 100): Promise<string[]> {
  const result = await getJobPool().query(
    `WITH expired AS (
       SELECT j.id FROM video_analysis_jobs j
       WHERE j.expires_at <= now() AND j.status IN ('queued','segmenting','mapping')
         AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=j.session_id AND s.deleted_at IS NULL)
       ORDER BY j.expires_at LIMIT $1 FOR UPDATE OF j SKIP LOCKED
     )
     UPDATE video_analysis_jobs j SET
       status=CASE
         WHEN j.status='segmenting' AND j.sam_started_at IS NOT NULL AND j.sam_completed_at IS NULL THEN 'ambiguous'
         WHEN j.status='mapping' AND j.muse_started_at IS NOT NULL AND j.completed_at IS NULL THEN 'ambiguous'
         ELSE 'failed'
       END,
       stage='complete', retryable=false,
       safe_error_code=CASE
         WHEN j.status='segmenting' AND j.sam_started_at IS NOT NULL AND j.sam_completed_at IS NULL THEN 'SAM_OUTCOME_AMBIGUOUS'
         WHEN j.status='mapping' AND j.muse_started_at IS NOT NULL AND j.completed_at IS NULL THEN 'MUSE_OUTCOME_AMBIGUOUS'
         ELSE 'VIDEO_JOB_EXPIRED'
       END,
       safe_error_message=CASE
         WHEN (j.status='segmenting' AND j.sam_started_at IS NOT NULL AND j.sam_completed_at IS NULL)
           OR (j.status='mapping' AND j.muse_started_at IS NOT NULL AND j.completed_at IS NULL)
           THEN 'The provider outcome could not be confirmed. Start a new analysis only if you approve a new provider request.'
         ELSE 'This video job expired before processing completed.'
       END,
       candidate_token=NULL, segment_result=NULL, still_objects=NULL, result=NULL,
       worker_lease_id=NULL, worker_lease_expires_at=NULL, updated_at=now()
     FROM expired WHERE j.id=expired.id
       AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=j.session_id AND s.deleted_at IS NULL)
     RETURNING j.id`,
    [Math.max(1, Math.min(500, limit))],
  );
  return result.rows.map((row) => String((row as { id: unknown }).id));
}

export async function listExpiredVideoJobIds(limit = 100): Promise<string[]> {
  const result = await getJobPool().query(
    `SELECT id FROM video_analysis_jobs
     WHERE expires_at < now() AND status IN ('upload_pending','ready','completed','failed','ambiguous','cancelled')
       AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=video_analysis_jobs.session_id AND s.deleted_at IS NULL)
     ORDER BY expires_at LIMIT $1`,
    [Math.max(1, Math.min(500, limit))],
  );
  return result.rows.map((row) => String((row as { id: unknown }).id));
}

export async function listRunnableVideoJobs(limit = 100): Promise<Array<{ id: string; stage: "sam" | "muse" }>> {
  const result = await getJobPool().query(
    `SELECT j.id, CASE WHEN j.status='mapping' THEN 'muse' ELSE 'sam' END AS stage
     FROM video_analysis_jobs j
     WHERE j.expires_at > now() AND j.status IN ('queued','segmenting','mapping')
       AND (j.worker_lease_expires_at IS NULL OR j.worker_lease_expires_at <= now())
       AND EXISTS (SELECT 1 FROM inspection_sessions s WHERE s.session_id=j.session_id AND s.deleted_at IS NULL)
     ORDER BY j.updated_at LIMIT $1`, [Math.max(1, Math.min(500, limit))],
  );
  return result.rows.map((row) => ({ id: String((row as { id: unknown }).id), stage: (row as { stage: "sam" | "muse" }).stage }));
}
