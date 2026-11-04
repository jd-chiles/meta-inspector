import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../../../src/server/jobs/database", () => ({
  getJobPool: () => ({ query }),
  withTransaction: vi.fn(),
}));

import { getVideoEvidenceObjectByOrdinal } from "../../../../src/server/jobs/video-job-store";

describe("evidence still ordinal lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("orders by still id with a locale-independent collation matching the worker's ordinal assignment", async () => {
    query.mockResolvedValueOnce({ rows: [{ object_key: "evidence/still.jpg", sha256: `${"b".repeat(64)}  `, byte_length: 4096 }] });
    await expect(getVideoEvidenceObjectByOrdinal("job-1", 2)).resolves.toEqual({
      objectKey: "evidence/still.jpg",
      sha256: "b".repeat(64),
      byteLength: 4096,
    });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(["job-1", 2]);
    expect(sql).toContain("o.object_kind='evidence'");
    expect(sql).toContain("o.still_id IS NOT NULL");
    expect(sql).toContain('ORDER BY o.still_id COLLATE "C"');
    expect(sql).toContain("OFFSET $2 LIMIT 1");
    expect(sql).toContain("s.deleted_at IS NULL");
  });

  it("rejects out-of-range ordinals without querying", async () => {
    for (const ordinal of [-1, 101, 1.5, Number.NaN]) {
      await expect(getVideoEvidenceObjectByOrdinal("job-1", ordinal)).resolves.toBeNull();
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("returns null when no live evidence row backs the ordinal", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(getVideoEvidenceObjectByOrdinal("job-1", 0)).resolves.toBeNull();
  });
});
