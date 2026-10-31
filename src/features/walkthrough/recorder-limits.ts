import { VIDEO_MAX_DURATION_SECONDS } from "./video-utils";

/** A 720p, video-only recording estimate that leaves substantial room below 60 MiB. */
export const WALKTHROUGH_VIDEO_BITS_PER_SECOND = 5_000_000;

/** Leave a small tail for MediaRecorder to flush and mux its final sample. */
export const RECORDER_STOP_MARGIN_MS = 500;

/** Honor a smaller caller limit, but never exceed the server's accepted duration. */
export function getEffectiveRecordingDurationSeconds(requestedSeconds: number): number {
  const safeRequestedSeconds = Number.isFinite(requestedSeconds) && requestedSeconds > 0
    ? requestedSeconds
    : VIDEO_MAX_DURATION_SECONDS;
  return Math.min(safeRequestedSeconds, VIDEO_MAX_DURATION_SECONDS);
}

/** Stop slightly before the duration limit so the final encoded sample stays within it. */
export function getRecordingStopDelayMs(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return Math.max(0, Math.floor(durationSeconds * 1000) - RECORDER_STOP_MARGIN_MS);
}

/** Return false before retaining a chunk that would exceed the local byte ceiling. */
export function canAppendRecorderChunk(
  currentBytes: number,
  nextChunkBytes: number,
  maxBytes: number,
): boolean {
  return Number.isSafeInteger(currentBytes) && currentBytes >= 0 &&
    Number.isSafeInteger(nextChunkBytes) && nextChunkBytes >= 0 &&
    Number.isSafeInteger(maxBytes) && maxBytes >= 0 &&
    nextChunkBytes <= maxBytes - currentBytes;
}
