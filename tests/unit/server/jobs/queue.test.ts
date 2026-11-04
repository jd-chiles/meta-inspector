import { describe, expect, it } from "vitest";
import { VIDEO_QUEUE_RETRY_LIMIT } from "../../../../src/server/jobs/queue";

describe("durable video queue", () => {
  it("does not automatically retry a provider stage", () => {
    expect(VIDEO_QUEUE_RETRY_LIMIT).toBe(0);
  });
});
