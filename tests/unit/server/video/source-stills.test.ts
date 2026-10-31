import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeSourceFrames } from "../../../../src/server/video/source-stills";
import { validateVideoBytes } from "../../../../src/server/video/validate";

const ffmpegIntegrationPath = process.env.VIDEO_FFMPEG_INTEGRATION_PATH;

async function pendingDecodeDirectories(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((name) => name.startsWith("habitability-video-")).sort();
}

async function makeFakeFfmpeg(decoders: readonly string[], encoders: readonly string[]): Promise<{ path: string; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "habitability-fake-ffmpeg-"));
  const path = join(directory, "ffmpeg");
  const listing = (names: readonly string[], flags: string) => names.length === 0
    ? "printf '%s\\n'\n"
    : `printf '%s\\n' ${names.map((name) => `' ${flags} ${name} mock codec'`).join(" ")}\n`;
  const script = [
    "#!/bin/sh",
    'case " $* " in',
    `  *" -decoders "*) ${listing(decoders, "V....D")}    exit 0 ;;`,
    `  *" -encoders "*) ${listing(encoders, "V.....")}    exit 0 ;;`,
    "esac",
    "exit 1",
    "",
  ].join("\n");
  await writeFile(path, script, { mode: 0o700 });
  return { path, directory };
}

describe("server-side source still extraction", () => {
  it("fails closed with SETUP_REQUIRED when FFmpeg is unavailable", async () => {
    await expect(decodeSourceFrames(
      new Uint8Array([0, 1, 2, 3]),
      [0],
      [0],
      new AbortController().signal,
      { ffmpegPath: "/definitely/missing/habitability-ffmpeg" },
    )).rejects.toMatchObject({ status: 503, code: "SETUP_REQUIRED" });
  });

  it("returns SETUP_REQUIRED when an installed FFmpeg lacks a required video decoder", async () => {
    const fake = await makeFakeFfmpeg(["h264", "mpeg4"], ["mjpeg"]);
    try {
      await expect(decodeSourceFrames(
        new Uint8Array([0, 1, 2, 3]),
        [0],
        [0],
        new AbortController().signal,
        { ffmpegPath: fake.path },
      )).rejects.toMatchObject({
        status: 503,
        code: "SETUP_REQUIRED",
        message: expect.stringContaining("H.265 video decoder"),
      });
    } finally {
      await rm(fake.directory, { recursive: true, force: true });
    }
  });

  it("returns SETUP_REQUIRED when an installed FFmpeg lacks the MJPEG encoder", async () => {
    const fake = await makeFakeFfmpeg(["h264", "hevc", "mpeg4"], []);
    try {
      await expect(decodeSourceFrames(
        new Uint8Array([0, 1, 2, 3]),
        [0],
        [0],
        new AbortController().signal,
        { ffmpegPath: fake.path },
      )).rejects.toMatchObject({
        status: 503,
        code: "SETUP_REQUIRED",
        message: expect.stringContaining("MJPEG encoder"),
      });
    } finally {
      await rm(fake.directory, { recursive: true, force: true });
    }
  });

  it("rejects unbounded or non-presentation-ordered frame selections", async () => {
    await expect(decodeSourceFrames(
      new Uint8Array([0, 1, 2, 3]),
      [2, 1],
      [100, 200],
      new AbortController().signal,
      { ffmpegPath: "/definitely/missing/habitability-ffmpeg" },
    )).rejects.toMatchObject({ status: 400, code: "INVALID_REQUEST" });
  });

  it.skipIf(!ffmpegIntegrationPath)("decodes a real fixture and verifies its presentation timestamp", async () => {
    const videoBytes = new Uint8Array(await readFile(new URL("../../../fixtures/synthetic-h264-test-pattern.mp4", import.meta.url)));
    const metadata = validateVideoBytes(videoBytes);
    const firstTimestampMs = metadata.frameTimestampsMs?.[0];
    expect(firstTimestampMs).toEqual(expect.any(Number));
    const before = await pendingDecodeDirectories();

    const frames = await decodeSourceFrames(
      videoBytes,
      [0],
      [firstTimestampMs!],
      new AbortController().signal,
      { ffmpegPath: ffmpegIntegrationPath },
    );

    expect(frames).toHaveLength(1);
    expect(frames[0]?.[0]).toBe(0xff);
    expect(frames[0]?.[1]).toBe(0xd8);
    expect(await pendingDecodeDirectories()).toEqual(before);
  });

  it.skipIf(!ffmpegIntegrationPath)("rejects a mismatched FFmpeg timestamp and cleans temporary output", async () => {
    const videoBytes = new Uint8Array(await readFile(new URL("../../../fixtures/synthetic-h264-test-pattern.mp4", import.meta.url)));
    const metadata = validateVideoBytes(videoBytes);
    const firstTimestampMs = metadata.frameTimestampsMs?.[0];
    expect(firstTimestampMs).toEqual(expect.any(Number));
    const before = await pendingDecodeDirectories();

    await expect(decodeSourceFrames(
      videoBytes,
      [0],
      [firstTimestampMs! + 2_000],
      new AbortController().signal,
      { ffmpegPath: ffmpegIntegrationPath },
    )).rejects.toMatchObject({ status: 422, code: "INVALID_VIDEO" });

    expect(await pendingDecodeDirectories()).toEqual(before);
  });

  it.skipIf(!ffmpegIntegrationPath)("kills a timed-out FFmpeg process and cleans its temporary directory", async () => {
    const videoBytes = new Uint8Array(await readFile(new URL("../../../fixtures/synthetic-h264-test-pattern.mp4", import.meta.url)));
    const metadata = validateVideoBytes(videoBytes);
    const firstTimestampMs = metadata.frameTimestampsMs?.[0];
    expect(firstTimestampMs).toEqual(expect.any(Number));
    const before = await pendingDecodeDirectories();

    await expect(decodeSourceFrames(
      videoBytes,
      [0],
      [firstTimestampMs!],
      new AbortController().signal,
      { ffmpegPath: ffmpegIntegrationPath, timeoutMs: 1 },
    )).rejects.toMatchObject({ status: 504, code: "PROVIDER_TIMEOUT" });

    expect(await pendingDecodeDirectories()).toEqual(before);
  });
});
