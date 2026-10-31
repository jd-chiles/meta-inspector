import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VIDEO_SAMPLE_TIMESTAMP_TOLERANCE_MS } from "../../domain/video-format";
import { VideoSegmentError } from "./errors";

const MAX_EXTRACTED_FRAMES = 42;
const MAX_EXTRACTED_STILL_BYTES = 512 * 1024;
const MAX_EXTRACTED_TOTAL_BYTES = 16 * 1024 * 1024;
// Covers DCI 4K 4096x2160 (8,847,360 pixels) with a small margin.
const MAX_DECODED_PIXELS = 9_000_000;
const MAX_FFMPEG_STDERR_BYTES = 64 * 1024;
const FFMPEG_TIMEOUT_MS = 45_000;
const FFMPEG_CAPABILITY_TIMEOUT_MS = 10_000;
const MAX_FFMPEG_CAPABILITY_OUTPUT_BYTES = 256 * 1024;
const MAX_CONCURRENT_DECODES = 2;
const REQUIRED_VIDEO_DECODERS = ["h264", "hevc", "mpeg4"] as const;

let activeDecodes = 0;
const verifiedFfmpegPaths = new Set<string>();
const pendingCapabilityChecks = new Map<string, Promise<void>>();

export interface SourceStillDecoderOptions {
  ffmpegPath?: string;
  timeoutMs?: number;
}

/**
 * Decode selected presentation-order frames from the supplied, already
 * validated video bytes. The caller must verify the source hash and frame
 * indexes before invoking this function.
 *
 * FFmpeg is invoked with an argument array (never through a shell), one
 * decoder thread, a per-frame pixel ceiling, a fixed output format, a bounded
 * number of frames, an execution timeout, and a temporary directory that is
 * removed on every exit path.
 */
export async function decodeSourceFrames(
  videoBytes: Uint8Array,
  frameIndexes: readonly number[],
  expectedTimestampsMs: readonly number[],
  signal: AbortSignal,
  options: SourceStillDecoderOptions = {},
): Promise<Uint8Array[]> {
  if (frameIndexes.length === 0) return [];
  if (
    frameIndexes.length > MAX_EXTRACTED_FRAMES ||
    expectedTimestampsMs.length !== frameIndexes.length ||
    frameIndexes.some((index, position) => !Number.isSafeInteger(index) || index < 0 || (position > 0 && index <= frameIndexes[position - 1]!)) ||
    expectedTimestampsMs.some((timestamp) => !Number.isSafeInteger(timestamp) || timestamp < 0)
  ) {
    throw new VideoSegmentError(400, "INVALID_REQUEST", "The requested source frames could not be validated.");
  }
  if (signal.aborted) throw new VideoSegmentError(504, "PROVIDER_TIMEOUT", "Video frame verification was interrupted.");
  if (activeDecodes >= MAX_CONCURRENT_DECODES) {
    throw new VideoSegmentError(429, "OPERATION_BUSY", "Video frame verification is busy. Try again shortly.");
  }
  activeDecodes += 1;

  let directory: string | undefined;
  try {
    const ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
    await requireFfmpegCapabilities(ffmpegPath, signal);
    directory = await mkdtemp(join(tmpdir(), "habitability-video-"));
    const inputPath = join(directory, "source-video");
    const outputPattern = join(directory, "source-frame-%03d.jpg");
    await writeFile(inputPath, Buffer.from(videoBytes.buffer, videoBytes.byteOffset, videoBytes.byteLength), { mode: 0o600, flag: "wx" });

    const selection = frameIndexes.map((index) => `eq(n\\,${index})`).join("+");
    // A 1000px maximum on each side guarantees the encoded still is <=1MP,
    // matching the image validator used before provider mapping.
    const filter = `select=${selection},showinfo,scale=w='min(1000,iw)':h='min(1000,ih)':force_original_aspect_ratio=decrease`;
    const args = [
      "-hide_banner", "-nostdin", "-loglevel", "info",
      "-threads", "1", "-filter_threads", "1", "-max_alloc", "134217728",
      "-max_pixels", String(MAX_DECODED_PIXELS), "-i", inputPath,
      "-map", "0:v:0", "-an", "-sn", "-dn", "-vf", filter,
      "-fps_mode", "passthrough", "-frames:v", String(frameIndexes.length), "-q:v", "4",
      "-f", "image2", outputPattern,
    ];
    const decodedTimestampsMs = await runFfmpeg(
      ffmpegPath,
      args,
      signal,
      options.timeoutMs ?? FFMPEG_TIMEOUT_MS,
    );
    if (decodedTimestampsMs.length !== expectedTimestampsMs.length || decodedTimestampsMs.some((timestamp, index) =>
      Math.abs(timestamp - expectedTimestampsMs[index]!) > VIDEO_SAMPLE_TIMESTAMP_TOLERANCE_MS
    )) {
      throw new VideoSegmentError(422, "INVALID_VIDEO", "The decoded frames did not match the signed source timestamps.");
    }

    const names = (await readdir(directory))
      .filter((name) => /^source-frame-\d{3}\.jpg$/.test(name))
      .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
    if (names.length !== frameIndexes.length) {
      throw new VideoSegmentError(422, "INVALID_VIDEO", "The source video could not provide every signed review frame.");
    }

    const stills: Uint8Array[] = [];
    let totalBytes = 0;
    for (const name of names) {
      const path = join(directory, name);
      const fileInfo = await stat(path);
      if (fileInfo.size < 4 || fileInfo.size > MAX_EXTRACTED_STILL_BYTES) {
        throw new VideoSegmentError(413, "VIDEO_TOO_LARGE", "A decoded source frame exceeded the supported image size.");
      }
      totalBytes += fileInfo.size;
      if (totalBytes > MAX_EXTRACTED_TOTAL_BYTES) {
        throw new VideoSegmentError(413, "VIDEO_TOO_LARGE", "The decoded source frames exceeded the supported image size.");
      }
      const bytes = new Uint8Array(await readFile(path));
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
        throw new VideoSegmentError(422, "INVALID_VIDEO", "The source video produced an invalid review frame.");
      }
      stills.push(bytes);
    }
    return stills;
  } catch (error) {
    if (error instanceof VideoSegmentError) throw error;
    if (signal.aborted) throw new VideoSegmentError(504, "PROVIDER_TIMEOUT", "Video frame verification was interrupted.");
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new VideoSegmentError(503, "SETUP_REQUIRED", "Server-side video frame verification is unavailable. Install FFmpeg or configure FFMPEG_PATH.");
    }
    throw new VideoSegmentError(422, "INVALID_VIDEO", "The source video could not be decoded for frame verification.");
  } finally {
    activeDecodes -= 1;
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Fail as a server setup error before touching user media when the configured
 * FFmpeg binary is present but lacks a decoder or encoder required by this
 * pipeline. Successful checks are cached per executable path for this process.
 */
async function requireFfmpegCapabilities(ffmpegPath: string, signal: AbortSignal): Promise<void> {
  if (verifiedFfmpegPaths.has(ffmpegPath)) return;
  let check = pendingCapabilityChecks.get(ffmpegPath);
  if (!check) {
    check = probeFfmpegCapabilities(ffmpegPath, signal).then(() => {
      verifiedFfmpegPaths.add(ffmpegPath);
    });
    pendingCapabilityChecks.set(ffmpegPath, check);
    void check.then(
      () => {
        if (pendingCapabilityChecks.get(ffmpegPath) === check) pendingCapabilityChecks.delete(ffmpegPath);
      },
      () => {
        if (pendingCapabilityChecks.get(ffmpegPath) === check) pendingCapabilityChecks.delete(ffmpegPath);
      },
    );
  }
  await waitForCapabilityCheck(check, signal);
}

function waitForCapabilityCheck(check: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new VideoSegmentError(504, "PROVIDER_TIMEOUT", "Video frame verification was interrupted."));
  }
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      cleanup();
      reject(new VideoSegmentError(504, "PROVIDER_TIMEOUT", "Video frame verification was interrupted."));
    };
    signal.addEventListener("abort", abort, { once: true });
    check.then(
      () => {
        cleanup();
        if (signal.aborted) abort();
        else resolve();
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function probeFfmpegCapabilities(ffmpegPath: string, signal: AbortSignal): Promise<void> {
  const decoderOutput = await runFfmpegListing(ffmpegPath, "-decoders", signal);
  const missingDecoders = REQUIRED_VIDEO_DECODERS.filter((name) => !listingHasCodec(decoderOutput, name));
  if (missingDecoders.length > 0) {
    const labels = missingDecoders.map((name) => name === "hevc" ? "H.265" : name === "mpeg4" ? "MPEG-4" : "H.264");
    throw ffmpegSetupError(`The configured FFmpeg binary is missing the required ${labels.join(", ")} video decoder${labels.length === 1 ? "" : "s"}.`);
  }

  const encoderOutput = await runFfmpegListing(ffmpegPath, "-encoders", signal);
  if (!listingHasCodec(encoderOutput, "mjpeg")) {
    throw ffmpegSetupError("The configured FFmpeg binary is missing the required MJPEG encoder.");
  }
}

function listingHasCodec(output: string, codec: string): boolean {
  return output.split(/\r?\n/).some((line) => {
    const match = /^\s*[A-Z.]{6}\s+(\S+)/.exec(line);
    return match?.[1] === codec;
  });
}

function ffmpegSetupError(detail: string): VideoSegmentError {
  return new VideoSegmentError(
    503,
    "SETUP_REQUIRED",
    `${detail} Install the supported FFmpeg runtime or set server-only FFMPEG_PATH to a compatible executable.`,
  );
}

function runFfmpegListing(ffmpegPath: string, listing: "-decoders" | "-encoders", signal: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal.aborted) {
      reject(new VideoSegmentError(504, "PROVIDER_TIMEOUT", "Video frame verification was interrupted."));
      return;
    }

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(ffmpegPath, ["-hide_banner", listing], { stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      reject(ffmpegSetupError("The configured FFmpeg executable could not be started."));
      return;
    }

    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let outputTooLarge = false;
    let timedOut = false;
    let settled = false;
    const abort = () => child.kill("SIGKILL");
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, FFMPEG_CAPABILITY_TIMEOUT_MS);
    timer.unref();
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const collect = (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_FFMPEG_CAPABILITY_OUTPUT_BYTES) {
        outputTooLarge = true;
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.once("error", () => {
      if (signal.aborted) {
        fail(new VideoSegmentError(504, "PROVIDER_TIMEOUT", "Video frame verification was interrupted."));
      } else {
        // Do not include executable paths or process errors in the client response.
        fail(ffmpegSetupError("The configured FFmpeg executable could not be started."));
      }
    });
    child.once("close", (code) => {
      if (signal.aborted) {
        fail(new VideoSegmentError(504, "PROVIDER_TIMEOUT", "Video frame verification was interrupted."));
      } else if (timedOut) {
        fail(ffmpegSetupError("The configured FFmpeg capability check timed out."));
      } else if (outputTooLarge || code !== 0) {
        fail(ffmpegSetupError("The configured FFmpeg binary could not report its codec capabilities."));
      } else if (!settled) {
        settled = true;
        cleanup();
        resolve(Buffer.concat(chunks, outputBytes).toString("utf8"));
      }
    });
  });
}

async function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  signal: AbortSignal,
  timeoutMs: number,
): Promise<number[]> {
  return new Promise<number[]>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderrLine = "";
    let stderrBufferBytes = 0;
    const decodedTimestampsMs: number[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref();
    const abort = () => child.kill("SIGKILL");
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBufferBytes += chunk.byteLength;
      if (stderrBufferBytes > MAX_FFMPEG_STDERR_BYTES) {
        child.kill("SIGKILL");
        return;
      }
      stderrLine += chunk.toString("utf8");
      const lines = stderrLine.split(/\r?\n/);
      stderrLine = lines.pop() ?? "";
      for (const line of lines) {
        const match = /\bpts_time:([+-]?(?:\d+\.?\d*|\.\d+))\b/.exec(line);
        if (match) decodedTimestampsMs.push(Math.round(Number(match[1]) * 1_000));
      }
      if (stderrLine.length > 1_024) stderrLine = stderrLine.slice(-1_024);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (signal.aborted || timedOut) {
        reject(new VideoSegmentError(504, "PROVIDER_TIMEOUT", "Video frame verification was interrupted."));
      } else if (code === 0) {
        const finalMatch = /\bpts_time:([+-]?(?:\d+\.?\d*|\.\d+))\b/.exec(stderrLine);
        if (finalMatch) decodedTimestampsMs.push(Math.round(Number(finalMatch[1]) * 1_000));
        resolve(decodedTimestampsMs);
      } else {
        reject(new Error("FFmpeg could not decode the selected source frames."));
      }
    });
  });
}
