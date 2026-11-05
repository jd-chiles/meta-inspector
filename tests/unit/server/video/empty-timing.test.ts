import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateVideoBytes } from "../../../../src/server/video/validate";

/**
 * Safari MediaRecorder and many iPhone exports produce fragmented MP4: the
 * moov carries an empty stts and every sample lives in moof/traf/trun. The
 * deployed FFmpeg is decode-only (no muxer, no encoder), so frame timing has
 * to come from trun rather than from a rewritten container.
 */
describe("fragmented MP4 timing", () => {
  it("derives frame timing from moof/trun when stts is empty", async () => {
    const directory = await mkdtemp(join(tmpdir(), "walkthrough-timing-"));
    const fragmented = join(directory, "fragmented.mp4");
    try {
      execFileSync("/usr/bin/ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=2",
        "-c:v", "libx264", "-preset", "ultrafast",
        "-movflags", "frag_keyframe+empty_moov", fragmented,
      ]);

      const metadata = validateVideoBytes(new Uint8Array(await readFile(fragmented)));
      expect(metadata.durationMs).toBeGreaterThan(1500);
      expect(metadata.durationMs).toBeLessThan(2500);
      expect(metadata.frameTimestampsMs?.length ?? 0).toBeGreaterThan(30);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
