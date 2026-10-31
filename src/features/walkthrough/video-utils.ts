/**
 * Browser-side video helpers for the walkthrough capture flow.
 *
 * Stills returned here are decoded from the selected clip at the requested
 * playback timestamps. They are not generated, annotated, enhanced, or
 * substituted for the original video. Server-side byte validation remains
 * authoritative before any later processing.
 */

import {
  isSupportedMp4Brand,
  MAX_FTYP_BOX_BYTES,
  QUICKTIME_BRAND,
} from "../../domain/video-format";

export const VIDEO_MAX_DURATION_SECONDS = 30;
export const VIDEO_MAX_BYTES = 60 * 1024 * 1024;
export const VIDEO_ALLOWED_MIME_TYPES = [
  "video/mp4",
  "video/quicktime",
] as const;

const MAX_REVIEW_STILL_DIMENSION = 1280;
const MAX_REVIEW_STILL_PIXELS = 1_000_000;
const MAX_REVIEW_STILL_BYTES = 512 * 1024;
// Keep browser decode within the same source-pixel ceiling used by the server
// frame extractor. This lets current 4K phone clips through while rejecting
// 8K and other inputs that can exhaust a mobile decoder before still resizing.
const MAX_SOURCE_VIDEO_PIXELS = 9_000_000;

export interface VideoStill {
  /** Actual presentation timestamp of the decoded source frame, in seconds. */
  timestampSeconds: number;
  /** JPEG encoded directly from the decoded source frame. */
  blob: Blob;
  width: number;
  height: number;
}

export interface VideoMetadata {
  durationSeconds: number;
  width: number;
  height: number;
}

export type VideoFileValidation = {
  ok: true;
  mime: (typeof VIDEO_ALLOWED_MIME_TYPES)[number];
} | {
  ok: false;
  code: "EMPTY_FILE" | "FILE_TOO_LARGE" | "UNSUPPORTED_TYPE" | "INVALID_CONTAINER";
  message: string;
};

const SUPPORTED_EXTENSIONS = new Set(["mp4", "mov"]);

/** Validate file size/type without opening or retaining any file bytes. */
export function validateVideoFileBasics(
  file: Pick<File, "size" | "type" | "name">,
  maxBytes = VIDEO_MAX_BYTES,
): VideoFileValidation {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return {
      ok: false,
      code: "EMPTY_FILE",
      message: "That video is empty. Choose a non-empty MP4 or MOV file.",
    };
  }
  if (file.size > maxBytes) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `That video is larger than ${formatMiB(maxBytes)} MiB. Choose a shorter or smaller clip. Any earlier clip is kept.`,
    };
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = file.type.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  const mimeSupported = (VIDEO_ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
  const extensionSupported = SUPPORTED_EXTENSIONS.has(extension);
  const mimeGeneric = mime.length === 0 || mime === "application/octet-stream";
  if (!mimeSupported && !(mimeGeneric && extensionSupported)) {
    return {
      ok: false,
      code: "UNSUPPORTED_TYPE",
      message: "Choose an MP4 or MOV video. Other formats are not accepted.",
    };
  }

  return { ok: true, mime: mimeSupported ? mime as (typeof VIDEO_ALLOWED_MIME_TYPES)[number] : mimeForExtension(extension) };
}

/**
 * Check the ISO base media `ftyp` signature and its major brand. This is a
 * client-side format check only; callers must still validate actual bytes on
 * the server before trusting or processing uploaded media.
 */
export async function validateVideoContainer(file: Blob): Promise<VideoFileValidation> {
  if (file.size < 16) {
    return {
      ok: false,
      code: "INVALID_CONTAINER",
      message: "This file does not contain a valid MP4 or MOV video header.",
    };
  }
  const prefix = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (ascii(prefix, 4, 4) !== "ftyp") {
    return {
      ok: false,
      code: "INVALID_CONTAINER",
      message: "This file does not contain a valid MP4 or MOV video header.",
    };
  }
  const ftypSize = readUint32(prefix, 0);
  if (
    ftypSize < 16 ||
    ftypSize > file.size ||
    ftypSize > MAX_FTYP_BOX_BYTES ||
    (ftypSize - 16) % 4 !== 0
  ) {
    return {
      ok: false,
      code: "INVALID_CONTAINER",
      message: "This file has an unsupported or incomplete video header.",
    };
  }
  const ftyp = new Uint8Array(await file.slice(0, ftypSize).arrayBuffer());
  const majorBrand = ascii(ftyp, 8, 4);
  const compatibleBrands = Array.from(
    { length: (ftypSize - 16) / 4 },
    (_, index) => ascii(ftyp, 16 + index * 4, 4),
  );
  const isQuickTime = majorBrand === QUICKTIME_BRAND;
  if (!isQuickTime && !isSupportedMp4Brand(majorBrand) && !compatibleBrands.some(isSupportedMp4Brand)) {
    return {
      ok: false,
      code: "INVALID_CONTAINER",
      message: "This file uses an unsupported video container. Choose an MP4 or MOV clip.",
    };
  }
  return { ok: true, mime: isQuickTime ? "video/quicktime" : "video/mp4" };
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

/** Read decoded video metadata using a short-lived, revoked object URL. */
export async function readVideoMetadata(
  file: Blob,
  timeoutMs = 15_000,
  signal?: AbortSignal,
): Promise<VideoMetadata> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("Video preview is not available in this browser.");
  }
  throwIfAborted(signal);
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  try {
    return await new Promise<VideoMetadata>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener("loadedmetadata", onMetadata);
        video.removeEventListener("error", onError);
        signal?.removeEventListener("abort", onAbort);
        callback();
      };
      const onMetadata = () => {
        const metadata = {
          durationSeconds: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        };
        if (
          !Number.isFinite(metadata.durationSeconds) ||
          metadata.durationSeconds <= 0 ||
          metadata.width <= 0 ||
          metadata.height <= 0
        ) {
          finish(() => reject(new Error("The browser could not read this video’s duration or dimensions.")));
          return;
        }
        finish(() => resolve(metadata));
      };
      const onError = () => finish(() => reject(new Error("This browser could not decode the selected video.")));
      const onAbort = () => finish(() => reject(abortError()));
      const timer = setTimeout(
        () => finish(() => reject(new Error("Reading video details timed out. Try a different MP4 or MOV file."))),
        timeoutMs,
      );
      video.addEventListener("loadedmetadata", onMetadata, { once: true });
      video.addEventListener("error", onError, { once: true });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      video.src = url;
      video.load();
    });
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export interface PrepareVideoReviewOptions {
  quality?: number;
  timeoutMs?: number;
  timestampsSeconds?: readonly number[];
  maxDurationSeconds?: number;
  /** Stops local frame decoding when the selected room or clip changes. */
  signal?: AbortSignal;
}

export interface PreparedVideoReview {
  metadata: VideoMetadata;
  stills: VideoStill[];
}

export interface NormalizeVideoOptions {
  maxBytes?: number;
  maxDurationSeconds?: number;
  signal?: AbortSignal;
}

export interface NormalizedVideo {
  video: Blob;
  mime: "video/mp4";
  converted: boolean;
}

/**
 * Return an MP4-ready clip for local review and later server processing.
 * Existing MP4 bytes are returned unchanged. QuickTime clips are remuxed with
 * packet copying only; unsupported tracks fail instead of being transcoded or
 * silently discarded.
 */
export async function normalizeVideoForCapture(
  file: Blob,
  sourceMime: (typeof VIDEO_ALLOWED_MIME_TYPES)[number],
  options: NormalizeVideoOptions = {},
): Promise<NormalizedVideo> {
  const maxBytes = options.maxBytes ?? VIDEO_MAX_BYTES;
  if (file.size <= 0) throw new Error("That video is empty. Choose a non-empty MP4 or MOV file.");
  if (file.size > maxBytes) {
    throw new Error(`That video is larger than ${formatMiB(maxBytes)} MiB. Choose a shorter or smaller clip. Any earlier clip is kept.`);
  }
  throwIfAborted(options.signal);

  if (sourceMime === "video/mp4") return { video: file, mime: "video/mp4", converted: false };

  const video = await remuxQuickTimeToMp4(file, options);
  return { video, mime: "video/mp4", converted: true };
}

const REMUX_BLOCK_BYTES = 256 * 1024;

/** A bounded random-access collector behind Mediabunny's public stream target. */
type BoundedRemuxTargetHandle = {
  target: import("mediabunny").StreamTarget;
  toBlob(): Blob;
  discard(): void;
};

function createBoundedRemuxTarget(
  StreamTarget: typeof import("mediabunny").StreamTarget,
  maxBytes: number,
): BoundedRemuxTargetHandle {
  const blocks = new Map<number, Uint8Array>();
  let allocatedBytes = 0;
  let outputExtent = 0;
  let closed = false;

  const discard = () => {
    closed = true;
    blocks.clear();
    allocatedBytes = 0;
    outputExtent = 0;
  };

  const write = (data: Uint8Array, position: number) => {
    if (closed) throw abortError();
    const end = position + data.byteLength;
    if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(end) || end > maxBytes) {
      throw new RemuxSizeLimitError();
    }
    if (data.byteLength === 0) return;

    const firstBlock = Math.floor(position / REMUX_BLOCK_BYTES);
    const lastBlock = Math.floor((end - 1) / REMUX_BLOCK_BYTES);
    let newAllocation = 0;
    for (let index = firstBlock; index <= lastBlock; index += 1) {
      if (blocks.has(index)) continue;
      const blockStart = index * REMUX_BLOCK_BYTES;
      newAllocation += Math.min(REMUX_BLOCK_BYTES, maxBytes - blockStart);
    }
    if (allocatedBytes + newAllocation > maxBytes) throw new RemuxSizeLimitError();

    for (let index = firstBlock; index <= lastBlock; index += 1) {
      if (blocks.has(index)) continue;
      const blockStart = index * REMUX_BLOCK_BYTES;
      const blockSize = Math.min(REMUX_BLOCK_BYTES, maxBytes - blockStart);
      blocks.set(index, new Uint8Array(blockSize));
      allocatedBytes += blockSize;
    }

    let sourceOffset = 0;
    while (sourceOffset < data.byteLength) {
      const absolutePosition = position + sourceOffset;
      const blockIndex = Math.floor(absolutePosition / REMUX_BLOCK_BYTES);
      const blockOffset = absolutePosition - blockIndex * REMUX_BLOCK_BYTES;
      const block = blocks.get(blockIndex);
      if (!block) throw new Error("Could not retain the converted video output.");
      const copyLength = Math.min(block.byteLength - blockOffset, data.byteLength - sourceOffset);
      block.set(data.subarray(sourceOffset, sourceOffset + copyLength), blockOffset);
      sourceOffset += copyLength;
    }
    outputExtent = Math.max(outputExtent, end);
  };

  const writable = new WritableStream<import("mediabunny").StreamTargetChunk>({
    write({ data, position }) {
      write(data, position);
    },
    abort() {
      discard();
    },
  }, { highWaterMark: 1 });
  const target = new StreamTarget(writable, { chunked: true, chunkSize: REMUX_BLOCK_BYTES });

  return {
    target,
    toBlob() {
      if (closed) throw abortError();
      if (outputExtent <= 0) throw new Error("The converted video output was empty.");
      const blockCount = Math.ceil(outputExtent / REMUX_BLOCK_BYTES);
      const parts: BlobPart[] = [];
      for (let index = 0; index < blockCount; index += 1) {
        const block = blocks.get(index);
        if (!block) throw new Error("The converted video output contains an incomplete byte range.");
        const usedBytes = Math.min(block.byteLength, outputExtent - index * REMUX_BLOCK_BYTES);
        parts.push(block.subarray(0, usedBytes));
      }
      return new Blob(parts, { type: "video/mp4" });
    },
    discard,
  };
}

class RemuxSizeLimitError extends Error {
  constructor() {
    super("The converted MP4 exceeds the local video size limit.");
    this.name = "RemuxSizeLimitError";
  }
}

class RemuxDurationLimitError extends Error {
  constructor(maxDurationSeconds: number) {
    super(`Keep each room clip to ${maxDurationSeconds} seconds or less. Any earlier clip is kept.`);
    this.name = "RemuxDurationLimitError";
  }
}

class RemuxTrackError extends Error {
  constructor() {
    super("This MOV cannot be converted to MP4 while keeping its primary video and audio tracks. Choose another MOV or an MP4. Any earlier clip is kept.");
    this.name = "RemuxTrackError";
  }
}

async function remuxQuickTimeToMp4(file: Blob, options: NormalizeVideoOptions): Promise<Blob> {
  const maxBytes = options.maxBytes ?? VIDEO_MAX_BYTES;
  const maxDurationSeconds = options.maxDurationSeconds ?? VIDEO_MAX_DURATION_SECONDS;
  const signal = options.signal;
  throwIfAborted(signal);

  const { ALL_FORMATS, BlobSource, Conversion, ConversionCanceledError, Input, Mp4OutputFormat, Output, StreamTarget } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const boundedTarget = createBoundedRemuxTarget(StreamTarget, maxBytes);
  const output = new Output({ format: new Mp4OutputFormat(), target: boundedTarget.target });
  let conversion: import("mediabunny").Conversion | null = null;
  const abortCleanup: { promise: Promise<void> | null } = { promise: null };
  let success = false;

  const cancel = () => {
    if (abortCleanup.promise) return;
    input.dispose();
    abortCleanup.promise = (async () => {
      if (conversion) await conversion.cancel();
      else await output.cancel();
      boundedTarget.discard();
    })();
  };
  signal?.addEventListener("abort", cancel, { once: true });

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!videoTrack) throw new RemuxTrackError();
    const requiredTracks = audioTrack ? [videoTrack, audioTrack] : [videoTrack];
    const durationSeconds = await input.computeDuration(requiredTracks);
    throwIfAborted(signal);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("The MOV does not have a readable duration.");
    }
    if (durationSeconds > maxDurationSeconds) throw new RemuxDurationLimitError(maxDurationSeconds);

    conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      copy: { mode: "forced" },
      showWarnings: false,
    });
    throwIfAborted(signal);
    if (
      !conversion.isValid ||
      requiredTracks.some((track) => !conversion?.utilizedTracks.includes(track)) ||
      conversion.discardedTracks.some(({ track }) => requiredTracks.includes(track as typeof videoTrack))
    ) {
      throw new RemuxTrackError();
    }

    await conversion.execute();
    throwIfAborted(signal);
    const normalized = boundedTarget.toBlob();
    if (normalized.size <= 0 || normalized.size > maxBytes) throw new RemuxSizeLimitError();

    const header = await validateVideoContainer(normalized);
    if (!header.ok || header.mime !== "video/mp4") {
      throw new Error("The MOV did not produce a valid MP4 file.");
    }
    const checkInput = new Input({ source: new BlobSource(normalized), formats: ALL_FORMATS });
    try {
      const outputVideoTrack = await checkInput.getPrimaryVideoTrack();
      const outputAudioTrack = await checkInput.getPrimaryAudioTrack();
      if (!outputVideoTrack || Boolean(audioTrack) !== Boolean(outputAudioTrack)) throw new RemuxTrackError();
      const outputTracks = outputAudioTrack ? [outputVideoTrack, outputAudioTrack] : [outputVideoTrack];
      const outputDurationSeconds = await checkInput.computeDuration(outputTracks);
      if (!Number.isFinite(outputDurationSeconds) || outputDurationSeconds <= 0 || outputDurationSeconds > maxDurationSeconds) {
        throw new RemuxDurationLimitError(maxDurationSeconds);
      }
    } finally {
      checkInput.dispose();
    }
    success = true;
    return normalized;
  } catch (error) {
    if (abortCleanup.promise) await abortCleanup.promise.catch(() => undefined);
    if (signal?.aborted || isAbortError(error) || error instanceof ConversionCanceledError) throw abortError();
    if (error instanceof RemuxSizeLimitError) {
      throw new Error(`The converted MP4 is larger than ${formatMiB(maxBytes)} MiB. Choose a shorter or smaller MOV. Any earlier clip is kept.`);
    }
    if (error instanceof RemuxDurationLimitError || error instanceof RemuxTrackError) throw error;
    throw new Error("Could not convert this MOV to MP4 on this device without re-encoding. Choose another MOV or an MP4. Any earlier clip is kept.");
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (!input.disposed) input.dispose();
    if (!success) {
      if (!abortCleanup.promise) {
        await conversion?.cancel().catch(() => undefined);
        await output.cancel().catch(() => undefined);
      }
      boundedTarget.discard();
    } else {
      boundedTarget.discard();
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** Reject promptly on cancellation while the caller's finally block disposes its decoder. */
function awaitWithAbort<T>(operation: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(operation);
  if (signal.aborted) {
    void Promise.resolve(operation).catch(() => undefined);
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      void Promise.resolve(operation).catch(() => undefined);
      return;
    }
    Promise.resolve(operation).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function abortError(): Error {
  const error = new Error("Video preparation was cancelled.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Hash an exact source blob for local video identity and server verification. */
export async function sha256Blob(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Secure video hashing is unavailable in this browser.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Decode metadata and source-frame stills in one pass for the capture flow. */
export async function prepareVideoReview(
  file: Blob,
  options: PrepareVideoReviewOptions = {},
): Promise<PreparedVideoReview> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("Video still extraction is not available in this browser.");
  }
  if ((options.timestampsSeconds?.length ?? 3) > 12) {
    throw new Error("Choose no more than 12 still timestamps at a time.");
  }
  throwIfAborted(options.signal);
  // Preflight coded dimensions before WebCodecs decodes a frame. If Mediabunny
  // cannot inspect the container/track, let the native path read metadata;
  // it validates dimensions before seeking or rendering any review frame.
  let sourceDimensions: { width: number; height: number };
  try {
    sourceDimensions = await readVideoSourceDimensions(file, options.signal);
  } catch (error) {
    throwIfAborted(options.signal);
    if (isAbortError(error)) throw error;
    return prepareWithHtmlVideo(file, options);
  }
  throwIfAborted(options.signal);
  if (!hasReadableVideoDimensions(sourceDimensions.width, sourceDimensions.height)) {
    return prepareWithHtmlVideo(file, options);
  }
  // Keep this validation outside the inspection catch: a confirmed unsafe
  // coded size must never be retried through a decoder with different metadata.
  validateSourceDimensions(sourceDimensions.width, sourceDimensions.height);

  // @meta-sam/video is imported only from this browser-only path. It uses
  // Mediabunny/WebCodecs for exact presentation-timestamp seeking; keeping
  // this import dynamic prevents server rendering from loading video APIs.
  if (typeof VideoDecoder === "undefined") {
    return prepareWithHtmlVideo(file, options);
  }
  let createMediaPlayer: typeof import("@meta-sam/video").createMediaPlayer;
  try {
    ({ createMediaPlayer } = await import("@meta-sam/video"));
  } catch (error) {
    throwIfAborted(options.signal);
    if (isAbortError(error)) throw error;
    // A browser bundle/runtime without the optional decoder chunk falls back
    // to native HTML video, while preserving exact requested timestamps.
    return prepareWithHtmlVideo(file, options);
  }

  throwIfAborted(options.signal);
  const mediaCanvas = document.createElement("canvas");
  let player: ReturnType<typeof createMediaPlayer>;
  try {
    player = createMediaPlayer(mediaCanvas);
  } catch (error) {
    if (isVideoEngineUnavailable(error)) {
      return prepareWithHtmlVideo(file, options);
    }
    throw error;
  }
  try {
    try {
      await awaitWithAbort(player.open(file), options.signal);
    } catch (error) {
      throwIfAborted(options.signal);
      if (isAbortError(error)) throw error;
      if (isVideoEngineUnavailable(error)) {
        return await prepareWithHtmlVideo(file, options);
      }
      throw error;
    }

    const firstFrame = player.getCurrentFrame();
    if (!firstFrame || !Number.isFinite(player.duration) || player.duration <= 0) {
      throw new Error("The video decoder could not read the clip duration or first frame.");
    }
    const metadata: VideoMetadata = {
      durationSeconds: player.duration,
      width: firstFrame.width,
      height: firstFrame.height,
    };
    validateSourceDimensions(metadata.width, metadata.height);
    validateDuration(metadata, options.maxDurationSeconds);
    const timestamps = normalizeStillTimestamps(
      options.timestampsSeconds ?? defaultStillTimestamps(metadata.durationSeconds),
      metadata.durationSeconds,
    );
    const stills: VideoStill[] = [];
    for (const timestampSeconds of timestamps) {
      throwIfAborted(options.signal);
      if (timestampSeconds >= player.duration) {
        throw new Error("A still timestamp falls outside the decoded source video.");
      }
      await awaitWithAbort(player.seek(timestampSeconds), options.signal);
      throwIfAborted(options.signal);
      const presentedFrameIndex = player.currentFrameIndex;
      const presentedTimestampSeconds = player.getTimeAtFrameIndexExact(presentedFrameIndex);
      if (!Number.isFinite(presentedTimestampSeconds) || presentedTimestampSeconds < 0) {
        throw new Error("The video decoder did not return a valid presentation timestamp for this source frame.");
      }
      const frame = player.getCurrentFrame();
      if (!frame) throw new Error("The video decoder did not return a source frame at the requested timestamp.");
      const sourceWidth = frame.width;
      const sourceHeight = frame.height;
      const { width, height } = reviewStillDimensions(sourceWidth, sourceHeight);
      mediaCanvas.width = width;
      mediaCanvas.height = height;
      const context = mediaCanvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("This browser cannot copy decoded video frames for review.");
      context.drawImage(frame, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
      const blob = await awaitWithAbort(canvasToBoundedJpeg(mediaCanvas, options.quality ?? 0.86), options.signal);
      stills.push({ timestampSeconds: presentedTimestampSeconds, blob, width, height });
    }
    throwIfAborted(options.signal);
    return { metadata, stills };
  } finally {
    player.dispose();
    mediaCanvas.width = 0;
    mediaCanvas.height = 0;
  }
}

/** Extract source frames as JPEG blobs, preserving their source timestamps. */
export async function extractVideoStills(
  file: Blob,
  timestampsSeconds: readonly number[],
  options: Omit<PrepareVideoReviewOptions, "timestampsSeconds"> = {},
): Promise<VideoStill[]> {
  if (timestampsSeconds.length === 0) return [];
  return (await prepareVideoReview(file, { ...options, timestampsSeconds })).stills;
}

async function prepareWithHtmlVideo(
  file: Blob,
  options: PrepareVideoReviewOptions,
): Promise<PreparedVideoReview> {
  const metadata = await readVideoMetadata(file, options.timeoutMs, options.signal);
  validateSourceDimensions(metadata.width, metadata.height);
  validateDuration(metadata, options.maxDurationSeconds);
  const timestamps = normalizeStillTimestamps(
    options.timestampsSeconds ?? defaultStillTimestamps(metadata.durationSeconds),
    metadata.durationSeconds,
  );
  const stills = timestamps.length === 0
    ? []
    : await extractWithHtmlVideo(file, timestamps, metadata, options);
  throwIfAborted(options.signal);
  return { metadata, stills };
}

async function readVideoSourceDimensions(file: Blob, signal?: AbortSignal): Promise<{ width: number; height: number }> {
  const { ALL_FORMATS, BlobSource, Input } = await import("mediabunny");
  throwIfAborted(signal);
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    input.dispose();
  };
  signal?.addEventListener("abort", dispose, { once: true });
  try {
    const track = await awaitWithAbort(input.getPrimaryVideoTrack(), signal);
    if (!track) throw new Error("The video has no readable video track.");
    const [width, height] = await awaitWithAbort(Promise.all([track.getCodedWidth(), track.getCodedHeight()]), signal);
    return { width, height };
  } finally {
    signal?.removeEventListener("abort", dispose);
    dispose();
  }
}

function validateSourceDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("The video dimensions could not be read safely on this device. Choose another MP4 or MOV. Any earlier clip is kept.");
  }
  if (width * height > MAX_SOURCE_VIDEO_PIXELS) {
    throw new Error("This clip's resolution is too high for mobile review. Choose or record a lower-resolution video (up to 9 megapixels). Any earlier clip is kept.");
  }
}

function hasReadableVideoDimensions(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0;
}

function validateDuration(metadata: VideoMetadata, maxDurationSeconds?: number): void {
  if (maxDurationSeconds !== undefined && metadata.durationSeconds > maxDurationSeconds) {
    throw new Error(`Keep each room clip to ${maxDurationSeconds} seconds or less. This clip is ${formatTimestamp(metadata.durationSeconds)} long. Any earlier clip is kept.`);
  }
}

function normalizeStillTimestamps(
  requested: readonly number[],
  durationSeconds: number,
): number[] {
  if (requested.length > 12) throw new Error("Choose no more than 12 still timestamps at a time.");
  return [...new Set(requested.map((time) => {
    if (!Number.isFinite(time) || time < 0 || time >= durationSeconds) {
      throw new Error("A still timestamp falls outside the source video.");
    }
    return Math.round(time * 1000) / 1000;
  }))];
}

async function extractWithHtmlVideo(
  file: Blob,
  timestamps: readonly number[],
  metadata: VideoMetadata,
  options: { quality?: number; timeoutMs?: number; signal?: AbortSignal },
): Promise<VideoStill[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    URL.revokeObjectURL(url);
    throw new Error("This browser cannot extract review stills from video.");
  }
  const stillDimensions = reviewStillDimensions(metadata.width, metadata.height);
  canvas.width = stillDimensions.width;
  canvas.height = stillDimensions.height;

  try {
    await waitForVideoEvent(video, url, "loadedmetadata", options.timeoutMs ?? 15_000, options.signal);
    const stills: VideoStill[] = [];
    for (const timestampSeconds of timestamps) {
      throwIfAborted(options.signal);
      const presentedTimestampSeconds = await seekVideo(
        video,
        timestampSeconds,
        options.timeoutMs ?? 15_000,
        options.signal,
      );
      if (!Number.isFinite(presentedTimestampSeconds) || presentedTimestampSeconds < 0) {
        throw new Error("The browser did not return a valid presentation timestamp for this source frame.");
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await awaitWithAbort(canvasToBoundedJpeg(canvas, options.quality ?? 0.86), options.signal);
      stills.push({ timestampSeconds: presentedTimestampSeconds, blob, width: stillDimensions.width, height: stillDimensions.height });
    }
    throwIfAborted(options.signal);
    return stills;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    canvas.width = 0;
    canvas.height = 0;
  }
}

function isVideoEngineUnavailable(error: unknown): boolean {
  const candidate = error as { name?: unknown; message?: unknown } | null;
  const name = candidate && typeof candidate.name === "string" ? candidate.name : "";
  const message = candidate && typeof candidate.message === "string"
    ? candidate.message.toLowerCase()
    : "";
  return (
    name === "NotSupportedError" ||
    /cannot decode (?:the )?video track/.test(message) ||
    name === "MediaPlayerSourceError" && /cannot decode|mediabunny cannot read|unsupported|not supported/.test(message) ||
    /webcodecs|videodecoder|mediabunny.*(?:unavailable|unsupported)/.test(message)
  );
}

/** Three actual frames spread across the clip; frames retain their exact offsets. */
export function defaultStillTimestamps(durationSeconds: number): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const usableDuration = Math.max(0, durationSeconds - 0.15);
  const candidates = [durationSeconds * 0.1, durationSeconds * 0.5, usableDuration];
  return [...new Set(candidates.map((time) => Math.max(0, Math.min(time, usableDuration)).toFixed(3)))].map(Number);
}

export function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, "0");
  const remaining = (safeSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
}

export function formatMiB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1);
}

async function waitForVideoEvent(
  video: HTMLVideoElement,
  url: string,
  eventName: "loadedmetadata",
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener(eventName, onReady);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onReady = () => finish(resolve);
    const onError = () => finish(() => reject(new Error("This browser could not decode the selected video.")));
    const onAbort = () => finish(() => reject(abortError()));
    const timer = setTimeout(() => finish(() => reject(new Error("Video frame extraction timed out."))), timeoutMs);
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    video.src = url;
    video.load();
  });
}

async function seekVideo(video: HTMLVideoElement, seconds: number, timeoutMs: number, signal?: AbortSignal): Promise<number> {
  throwIfAborted(signal);
  if (typeof video.requestVideoFrameCallback !== "function") {
    throw new Error("This browser cannot report exact video-frame timestamps. Use a recent Safari or Chrome browser to review this clip.");
  }
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    let seeked = false;
    let frameMediaTime: number | undefined;
    let frameCallbackId: number | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (frameCallbackId !== undefined) video.cancelVideoFrameCallback(frameCallbackId);
      callback();
    };
    const finishWhenReady = () => {
      if (seeked && frameMediaTime !== undefined) {
        finish(() => resolve(frameMediaTime!));
      }
    };
    const onPresentedFrame: VideoFrameRequestCallback = (_now, metadata) => {
      frameCallbackId = undefined;
      if (video.seeking) {
        frameCallbackId = video.requestVideoFrameCallback(onPresentedFrame);
        return;
      }
      if (Number.isFinite(metadata.mediaTime) && metadata.mediaTime >= 0) {
        frameMediaTime = metadata.mediaTime;
        finishWhenReady();
      } else {
        finish(() => reject(new Error("The browser did not return a valid presentation timestamp for this source frame.")));
      }
    };
    const onSeeked = () => {
      seeked = true;
      if (frameMediaTime === undefined && video.readyState >= 2 && Number.isFinite(video.currentTime) && video.currentTime >= 0) {
        // Newer headless Chromium never presents frames for a detached,
        // paused video, so no frame callback arrives. The seek position is
        // exact enough for local review stills; server-decoded frames back
        // any model-cited evidence.
        frameMediaTime = video.currentTime;
      }
      finishWhenReady();
    };
    const onError = () => finish(() => reject(new Error("Could not seek to a review still timestamp.")));
    const onAbort = () => finish(() => reject(abortError()));
    const timer = setTimeout(() => finish(() => reject(new Error("Seeking to a review still timed out."))), timeoutMs);
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    frameCallbackId = video.requestVideoFrameCallback(onPresentedFrame);
    try {
      video.currentTime = seconds;
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error("Could not seek to a review still timestamp.")));
    }
  });
}

function reviewStillDimensions(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const scale = Math.min(
    1,
    MAX_REVIEW_STILL_DIMENSION / Math.max(sourceWidth, sourceHeight),
    Math.sqrt(MAX_REVIEW_STILL_PIXELS / (sourceWidth * sourceHeight)),
  );
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
  };
}

async function canvasToBoundedJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const qualities = [...new Set([
    Math.max(0.5, Math.min(quality, 0.95)),
    0.75,
    0.65,
    0.55,
    0.5,
  ])];
  for (const candidateQuality of qualities) {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (!result) {
          reject(new Error("The browser could not save a review still."));
          return;
        }
        resolve(result);
      }, "image/jpeg", candidateQuality);
    });
    if (blob.size <= MAX_REVIEW_STILL_BYTES) return blob;
  }
  throw new Error("A decoded source still is larger than the 512 KiB mapping limit. Use a lower-resolution source video.");
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return Array.from(bytes.slice(offset, offset + length), (value) => String.fromCharCode(value)).join("");
}

function mimeForExtension(extension: string): (typeof VIDEO_ALLOWED_MIME_TYPES)[number] {
  return extension === "mov" ? "video/quicktime" : "video/mp4";
}
