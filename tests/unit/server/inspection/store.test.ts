import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const client = { query };
const pool = { query, connect: async () => ({ ...client, release: vi.fn() }) };

vi.mock("../../../../src/server/jobs/database", () => ({
  getJobPool: () => pool,
  withTransaction: async (run: (client: typeof pool) => Promise<unknown>) => run(pool),
}));

vi.mock("../../../../src/server/storage/r2", () => ({
  createR2Storage: () => ({ deleteObject: vi.fn().mockResolvedValue(undefined) }),
  readR2StorageConfig: () => ({}),
}));

import { createInitialInspectionRecord } from "../../../../src/features/walkthrough/inspection-store";
import { getInspection, saveInspection, validateSessionId, InspectionPersistenceError } from "../../../../src/server/inspection/store";

describe("cloud inspection persistence", () => {
  beforeEach(() => query.mockReset());

  it("accepts app session IDs and rejects unsafe path values", () => {
    expect(validateSessionId("session-550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(validateSessionId("../other-session")).toBe(false);
    expect(validateSessionId("a".repeat(129))).toBe(false);
  });

  it("reads a validated inspection and its optimistic revision", async () => {
    const inspection = createInitialInspectionRecord("session-abc");
    query.mockResolvedValueOnce({ rows: [{ inspection, revision: "3" }] });
    await expect(getInspection("session-abc")).resolves.toEqual({ inspection, revision: 3 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("deleted_at IS NULL"), ["session-abc"]);
  });

  it("saves only when the supplied revision matches and server timestamps the update", async () => {
    const inspection = createInitialInspectionRecord("session-abc", "2026-11-04T00:00:00.000Z");
    query.mockResolvedValueOnce({ rows: [{ inspection: { ...inspection, updatedAt: "2026-11-04T00:00:00.000Z" }, revision: "2" }] });
    const result = await saveInspection("session-abc", inspection, 1);
    expect(result.revision).toBe(2);
    const [statement, values] = query.mock.calls[0] as [string, unknown[]];
    expect(statement).toContain("inspection_sessions.revision = $7");
    expect(statement).toContain("inspection_sessions.deleted_at IS NULL");
    expect(values[0]).toBe("session-abc");
    expect(values[6]).toBe(1);
    expect((JSON.parse(values[3] as string) as { updatedAt: string }).updatedAt).not.toBe(inspection.updatedAt);
  });

  it("returns a conflict when another writer has advanced the revision", async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ deleted_at: null }] });
    const inspection = createInitialInspectionRecord("session-abc");
    await expect(saveInspection("session-abc", inspection, 1)).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      status: 409,
    } satisfies Partial<InspectionPersistenceError>);
  });
});
