import { withTransaction, getJobPool } from "../jobs/database";
import { validateInspectionRecord, type MoveInReadyInspection } from "../../features/walkthrough/inspection-store";
import { createR2Storage, readR2StorageConfig } from "../storage/r2";

export class InspectionPersistenceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "InspectionPersistenceError";
    this.code = code;
    this.status = status;
  }
}

export interface StoredInspection {
  inspection: MoveInReadyInspection;
  revision: number;
}

export function validateSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(sessionId);
}

function toInspection(value: unknown, sessionId: string): MoveInReadyInspection {
  const parsed = typeof value === "string" ? safeJsonParse(value) : value;
  const validation = validateInspectionRecord(parsed, sessionId);
  if (!validation.ok) throw new InspectionPersistenceError("INVALID_INSPECTION", 400, validation.message);
  return validation.record;
}

function safeJsonParse(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

export async function getInspection(sessionId: string): Promise<StoredInspection | null> {
  const result = await getJobPool().query(
    `SELECT inspection, revision FROM inspection_sessions
     WHERE session_id = $1 AND deleted_at IS NULL`,
    [sessionId],
  );
  const row = result.rows[0] as { inspection: unknown; revision: string | number } | undefined;
  if (!row) return null;
  return {
    inspection: toInspection(row.inspection, sessionId),
    revision: Number(row.revision),
  };
}

/** Save with optimistic concurrency. expectedRevision=0 creates; otherwise it must match. */
export async function saveInspection(
  sessionId: string,
  rawInspection: unknown,
  expectedRevision: number,
): Promise<StoredInspection> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new InspectionPersistenceError("INVALID_REVISION", 400, "The inspection revision is invalid.");
  }
  const inspection = toInspection(rawInspection, sessionId);
  const now = new Date().toISOString();

  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO inspection_sessions (
         session_id, schema_version, catalog_version, revision, inspection, created_at, updated_at
       ) SELECT $1,$2,$3,1,$4::jsonb,$5::timestamptz,$6::timestamptz
       WHERE $7 = 0
       ON CONFLICT (session_id) DO UPDATE SET
         schema_version = EXCLUDED.schema_version,
         catalog_version = EXCLUDED.catalog_version,
         revision = inspection_sessions.revision + 1,
         inspection = jsonb_set(EXCLUDED.inspection, '{createdAt}', inspection_sessions.inspection->'createdAt'),
         updated_at = EXCLUDED.updated_at
       WHERE inspection_sessions.deleted_at IS NULL
         AND inspection_sessions.revision = $7
       RETURNING inspection, revision`,
      [sessionId, inspection.schemaVersion, inspection.catalogVersion,
        JSON.stringify({ ...inspection, updatedAt: now }), inspection.createdAt, now, expectedRevision],
    );
    const row = result.rows[0] as { inspection: unknown; revision: string | number } | undefined;
    if (!row) {
      const existing = await client.query(
        "SELECT deleted_at FROM inspection_sessions WHERE session_id = $1",
        [sessionId],
      );
      if (existing.rows[0]?.deleted_at) {
        throw new InspectionPersistenceError("SESSION_DELETED", 410, "This walkthrough was deleted.");
      }
      throw new InspectionPersistenceError("REVISION_CONFLICT", 409, "This walkthrough changed elsewhere. Reload it before saving.");
    }
    return { inspection: toInspection(row.inspection, sessionId), revision: Number(row.revision) };
  });
}

/** Mark deleted before touching R2 so an in-flight worker cannot revive the session. */
export async function deleteInspection(sessionId: string): Promise<boolean> {
  const tombstone = await getJobPool().query(
    `UPDATE inspection_sessions SET deleted_at = COALESCE(deleted_at, now()), updated_at = now()
     WHERE session_id = $1 RETURNING session_id`,
    [sessionId],
  );
  if (tombstone.rowCount === 0) return false;

  const objects = await getJobPool().query(
    `SELECT object_key FROM video_analysis_job_objects o
       JOIN video_analysis_jobs j ON j.id = o.job_id
     WHERE j.session_id = $1 AND o.deleted_at IS NULL
     UNION
     SELECT media_object_key AS object_key FROM video_analysis_jobs WHERE session_id = $1`,
    [sessionId],
  );
  const objectKeys: string[] = (objects.rows as Array<{ object_key?: unknown }>)
    .map((row: { object_key?: unknown }) => row.object_key)
    .filter((key: unknown): key is string => typeof key === "string" && key.length > 0);

  // R2 deletes are idempotent. On a transient failure, keep the tombstone and
  // DB rows so a repeated DELETE can safely finish cleanup.
  if (objectKeys.length > 0) {
    const storage = createR2Storage(readR2StorageConfig());
    for (const objectKey of objectKeys) await storage.deleteObject(objectKey);
  }

  await withTransaction(async (client) => {
    await client.query("DELETE FROM video_analysis_jobs WHERE session_id = $1", [sessionId]);
    await client.query("DELETE FROM inspection_sessions WHERE session_id = $1 AND deleted_at IS NOT NULL", [sessionId]);
  });
  return true;
}
