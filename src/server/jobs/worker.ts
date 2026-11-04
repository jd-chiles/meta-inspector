import { createR2Storage } from "../storage/r2";
import {
  deleteVideoJobRow, listExpiredVideoJobIds, listVideoJobObjectsForCleanup,
  listTerminalVideoJobMedia, markVideoJobObjectDeleted, terminalizeExpiredActiveVideoJobs,
} from "./video-job-store";

/** Bounded retention pass; source media remains until session deletion or TTL. */
export async function cleanupExpiredVideoJobs(limit = 100): Promise<void> {
  // Expire active rows first, invalidating their leases before cleanup. A
  // provider-start marker becomes terminal ambiguity, never another call.
  await terminalizeExpiredActiveVideoJobs(limit);
  const expiredIds = await listExpiredVideoJobIds(limit);
  const storage = createR2Storage();
  for (const id of expiredIds) {
    const objectKeys = await listVideoJobObjectsForCleanup(id);
    let failed = false;
    for (const objectKey of objectKeys) {
      try {
        await storage.deleteObject(objectKey);
        await markVideoJobObjectDeleted(id, objectKey);
      } catch { failed = true; }
    }
    if (!failed) await deleteVideoJobRow(id);
  }
}

/** Delete only the original source object after terminal, non-retryable work. */
export async function cleanupTerminalVideoSources(limit = 100): Promise<void> {
  const refs = await listTerminalVideoJobMedia(limit);
  const storage = createR2Storage();
  for (const { id, objectKey } of refs) {
    try {
      await storage.deleteObject(objectKey);
      await markVideoJobObjectDeleted(id, objectKey);
    } catch {
      // The durable object reference stays live for the next maintenance pass.
    }
  }
}
