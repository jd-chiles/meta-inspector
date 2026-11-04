import type { InspectionStore, MoveInReadyInspection } from "./inspection-store";
import { WALKTHROUGH_CLIENT_HEADER, WALKTHROUGH_CLIENT_ID } from "../../domain/walkthrough-client";

const pathFor = (id: string) => `/api/inspections/${encodeURIComponent(id)}`;

/** Cloud-only inspection persistence. It deliberately has no browser storage fallback. */
export function createCloudInspectionStore(): InspectionStore {
  const revisions = new Map<string, number>();
  const writes = new Map<string, Promise<void>>();
  let closed = false;

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    if (closed) throw new Error("Cloud walkthrough storage is closed.");
    const headers = new Headers(init.headers);
    headers.set(WALKTHROUGH_CLIENT_HEADER, WALKTHROUGH_CLIENT_ID);
    if (init.body) headers.set("content-type", "application/json");
    const response = await fetch(path, { ...init, headers, credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
      throw new Error(payload?.error?.message ?? "Cloud walkthrough storage is unavailable.");
    }
    return response;
  }

  return {
    async get(sessionId) {
      const response = await request(pathFor(sessionId));
      const payload = await response.json() as { inspection: MoveInReadyInspection | null; revision: number };
      revisions.set(sessionId, payload.revision);
      return payload.inspection;
    },
    async put(record) {
      const previous = writes.get(record.sessionId) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(async () => {
        let revision = revisions.get(record.sessionId);
        if (revision === undefined) {
          await this.get(record.sessionId);
          revision = revisions.get(record.sessionId) ?? 0;
        }
        const response = await request(pathFor(record.sessionId), {
          method: "PUT",
          body: JSON.stringify({ inspection: record, expectedRevision: revision }),
        });
        const payload = await response.json() as { revision: number };
        revisions.set(record.sessionId, payload.revision);
      });
      writes.set(record.sessionId, next);
      try { await next; } finally { if (writes.get(record.sessionId) === next) writes.delete(record.sessionId); }
    },
    async delete(sessionId) {
      await (writes.get(sessionId) ?? Promise.resolve()).catch(() => undefined);
      await request(pathFor(sessionId), { method: "DELETE" });
      revisions.delete(sessionId);
    },
    async list() { return []; },
    isMemoryOnly() { return false; },
    close() { closed = true; },
  };
}
