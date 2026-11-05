import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../../../src/server/jobs/database", () => ({
  getJobPool: () => ({ query }),
  withTransaction: vi.fn(),
}));

import { listTerminalVideoJobMedia, terminalizeExpiredActiveVideoJobs } from "../../../../src/server/jobs/video-job-store";

describe("expired active video jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockResolvedValue({ rows: [{ id: "job-1" }] });
  });

  it("atomically makes expired work terminal and preserves provider ambiguity", async () => {
    await expect(terminalizeExpiredActiveVideoJobs(25)).resolves.toEqual(["job-1"]);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([25]);
    expect(sql).toContain("FOR UPDATE OF j SKIP LOCKED");
    expect(sql).toContain("j.expires_at <= now() AND j.status IN ('queued','segmenting','mapping')");
    expect(sql).toContain("j.status='segmenting' AND j.sam_started_at IS NOT NULL AND j.sam_completed_at IS NULL THEN 'ambiguous'");
    expect(sql).toContain("j.status='mapping' AND j.muse_started_at IS NOT NULL AND j.completed_at IS NULL THEN 'ambiguous'");
    expect(sql).toContain("ELSE 'failed'");
    expect(sql).toContain("retryable=false");
    expect(sql).toContain("worker_lease_id=NULL, worker_lease_expires_at=NULL");
    expect(sql).toContain("s.deleted_at IS NULL");
    expect(sql).toContain("candidate_token=NULL, segment_result=NULL, still_objects=NULL, result=NULL");
  });

  it("caps cleanup batches", async () => {
    await terminalizeExpiredActiveVideoJobs(50_000);
    expect(query.mock.calls[0]?.[1]).toEqual([500]);
  });

  it("selects originals only for terminal non-retryable jobs", async () => {
    await listTerminalVideoJobMedia(17);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([17]);
    expect(sql).toContain("j.status IN ('completed','ambiguous','cancelled') OR (j.status='failed' AND j.retryable=false)");
    expect(sql).toContain("o.object_key=j.media_object_key AND o.deleted_at IS NULL");
    expect(sql).toContain("s.deleted_at IS NULL");
  });
});
