/**
 * Server-side validation for bounded SAM video uploads.
 *
 * This accepts only ISO BMFF MP4 / QuickTime MOV files with a video track and
 * a supported AVC, HEVC, or MPEG-4 Visual sample entry. It never follows URLs
 * and never trusts the multipart MIME label or filename.
 */
import { VideoSegmentError } from "./errors";
import {
  isSupportedMp4Brand,
  MAX_FTYP_BOX_BYTES,
  QUICKTIME_BRAND,
} from "../../domain/video-format";

export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
export const MAX_MULTIPART_BYTES = MAX_VIDEO_BYTES + 128 * 1024;
export const MAX_VIDEO_FRAMES = 15_000;
export const MAX_VIDEO_DURATION_MS = 30_000;

export type VideoContainer = "mp4" | "mov";

export interface VideoMetadata {
  container: VideoContainer;
  mimeType: "video/mp4" | "video/quicktime";
  durationMs?: number;
  /** Presentation timestamps indexed by zero-based video frame, when present. */
  frameTimestampsMs?: readonly number[];
}

interface Box {
  type: string;
  payloadStart: number;
  end: number;
}

const SUPPORTED_VIDEO_SAMPLE_ENTRIES = new Set(["avc1", "avc3", "hvc1", "hev1", "mp4v"]);

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function uint64(bytes: Uint8Array, offset: number): number {
  const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset, false);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new VideoSegmentError(422, "INVALID_VIDEO", "The video container has an unsupported size field.");
  }
  return Number(value);
}

function int32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, false);
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}

/** Parse a bounded sequence of ISO BMFF boxes, rejecting truncation and overflow. */
function boxes(bytes: Uint8Array, from: number, to: number): Box[] {
  const result: Box[] = [];
  let cursor = from;
  while (cursor < to) {
    if (to - cursor < 8) {
      throw new VideoSegmentError(422, "INVALID_VIDEO", "The video container is incomplete.");
    }
    let size = uint32(bytes, cursor);
    const type = fourcc(bytes, cursor + 4);
    let headerSize = 8;
    if (size === 1) {
      if (to - cursor < 16) {
        throw new VideoSegmentError(422, "INVALID_VIDEO", "The video container is incomplete.");
      }
      size = uint64(bytes, cursor + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = to - cursor;
    }
    if (size < headerSize || size > to - cursor) {
      throw new VideoSegmentError(422, "INVALID_VIDEO", "The video container is corrupt or truncated.");
    }
    result.push({ type, payloadStart: cursor + headerSize, end: cursor + size });
    cursor += size;
    if (result.length > 100_000) {
      throw new VideoSegmentError(422, "INVALID_VIDEO", "The video container has too many tracks or segments.");
    }
  }
  return result;
}

function childBoxes(bytes: Uint8Array, parent: Box): Box[] {
  return boxes(bytes, parent.payloadStart, parent.end);
}

function findChild(bytes: Uint8Array, parent: Box, type: string): Box | undefined {
  return childBoxes(bytes, parent).find((box) => box.type === type);
}

function sampleEntryTypes(bytes: Uint8Array, stsd: Box): string[] {
  const p = stsd.payloadStart;
  if (stsd.end - p < 8) return [];
  const count = uint32(bytes, p + 4);
  if (count > 256) {
    throw new VideoSegmentError(422, "INVALID_VIDEO", "The video declares too many codecs.");
  }
  const entries = boxes(bytes, p + 8, stsd.end);
  if (entries.length !== count) {
    throw new VideoSegmentError(422, "INVALID_VIDEO", "The video codec table is incomplete.");
  }
  return entries.map((entry) => entry.type);
}

function readTimescale(bytes: Uint8Array, mdhd: Box): number | undefined {
  const p = mdhd.payloadStart;
  if (mdhd.end - p < 20) return undefined;
  const version = bytes[p]!;
  const offset = version === 1 ? p + 20 : p + 12;
  if (version !== 0 && version !== 1) return undefined;
  if (mdhd.end - offset < 4) return undefined;
  const value = uint32(bytes, offset);
  return value > 0 ? value : undefined;
}

function readTimingTable(bytes: Uint8Array, stts: Box, ctts?: Box): { durations: number[]; offsets: number[] } {
  const p = stts.payloadStart;
  if (stts.end - p < 8) {
    throw new VideoSegmentError(422, "INVALID_VIDEO", "The video timing table is incomplete.");
  }
  const entryCount = uint32(bytes, p + 4);
  if (entryCount === 0 || entryCount > MAX_VIDEO_FRAMES) {
    throw new VideoSegmentError(413, "VIDEO_TOO_LONG", "The video contains more frames than this request supports.");
  }
  if (stts.end - (p + 8) !== entryCount * 8) {
    throw new VideoSegmentError(422, "INVALID_VIDEO", "The video timing table is corrupt.");
  }

  const durations: number[] = [];
  let cursor = p + 8;
  for (let entry = 0; entry < entryCount; entry += 1) {
    const sampleCount = uint32(bytes, cursor);
    const sampleDuration = uint32(bytes, cursor + 4);
    if (sampleDuration === 0 || durations.length + sampleCount > MAX_VIDEO_FRAMES) {
      throw new VideoSegmentError(413, "VIDEO_TOO_LONG", "The video contains more frames than this request supports.");
    }
    for (let i = 0; i < sampleCount; i += 1) durations.push(sampleDuration);
    cursor += 8;
  }

  const offsets = new Array<number>(durations.length).fill(0);
  if (ctts) {
    const cp = ctts.payloadStart;
    if (ctts.end - cp < 8) {
      throw new VideoSegmentError(422, "INVALID_VIDEO", "The video presentation table is incomplete.");
    }
    const cttsCount = uint32(bytes, cp + 4);
    if (cttsCount > MAX_VIDEO_FRAMES) {
      throw new VideoSegmentError(413, "VIDEO_TOO_LARGE", "The video presentation table exceeds the supported entry limit.");
    }
    if (ctts.end - (cp + 8) !== cttsCount * 8) {
      throw new VideoSegmentError(422, "INVALID_VIDEO", "The video presentation table is corrupt.");
    }
    const signed = bytes[cp]! === 1;
    let offsetCursor = cp + 8;
    let sampleIndex = 0;
    for (let entry = 0; entry < cttsCount; entry += 1) {
      const sampleCount = uint32(bytes, offsetCursor);
      const compositionOffset = signed ? int32(bytes, offsetCursor + 4) : uint32(bytes, offsetCursor + 4);
      if (sampleIndex + sampleCount > offsets.length) {
        throw new VideoSegmentError(422, "INVALID_VIDEO", "The video presentation table is corrupt.");
      }
      for (let i = 0; i < sampleCount; i += 1) offsets[sampleIndex++] = compositionOffset;
      offsetCursor += 8;
    }
    if (sampleIndex !== offsets.length) {
      throw new VideoSegmentError(422, "INVALID_VIDEO", "The video presentation table is corrupt.");
    }
  }
  return { durations, offsets };
}

function parseVideoTrack(bytes: Uint8Array, moov: Box): {
  frameTimestampsMs?: readonly number[];
  durationMs?: number;
} | undefined {
  for (const trak of childBoxes(bytes, moov).filter((box) => box.type === "trak")) {
    const mdia = findChild(bytes, trak, "mdia");
    if (!mdia) continue;
    const hdlr = findChild(bytes, mdia, "hdlr");
    if (!hdlr || hdlr.end - hdlr.payloadStart < 12 || fourcc(bytes, hdlr.payloadStart + 8) !== "vide") continue;

    const mdhd = findChild(bytes, mdia, "mdhd");
    const minf = findChild(bytes, mdia, "minf");
    const stbl = minf && findChild(bytes, minf, "stbl");
    const stsd = stbl && findChild(bytes, stbl, "stsd");
    if (!stsd || !sampleEntryTypes(bytes, stsd).some((entry) => SUPPORTED_VIDEO_SAMPLE_ENTRIES.has(entry))) {
      throw new VideoSegmentError(415, "UNSUPPORTED_VIDEO", "Use an MP4 or MOV with H.264, H.265, or MPEG-4 video.");
    }
    if (!mdhd || !stbl) {
      throw new VideoSegmentError(422, "INVALID_VIDEO", "The video timing metadata could not be validated.");
    }
    const timescale = readTimescale(bytes, mdhd);
    const stts = findChild(bytes, stbl, "stts");
    const ctts = findChild(bytes, stbl, "ctts");
    if (!timescale || !stts) {
      throw new VideoSegmentError(422, "INVALID_VIDEO", "The video timing metadata could not be validated.");
    }
    const timing = readTimingTable(bytes, stts, ctts);

    let decodeTimestamp = 0;
    const presentationTimestamps = timing.durations.map((duration, index) => {
      const timestamp = decodeTimestamp + timing.offsets[index]!;
      decodeTimestamp += duration;
      return { timestamp, sampleIndex: index };
    });
    // stts/ctts are stored in decode/sample order. SAM frameIndex and FFmpeg's
    // decoded frame number are presentation ordered, so keep those identities
    // aligned by sorting on PTS with sample index as a deterministic tie-break.
    presentationTimestamps.sort((left, right) => left.timestamp - right.timestamp || left.sampleIndex - right.sampleIndex);
    if (presentationTimestamps.some(({ timestamp }, index) =>
      timestamp < 0 || (index > 0 && timestamp <= presentationTimestamps[index - 1]!.timestamp)
    )) {
      throw new VideoSegmentError(422, "INVALID_VIDEO", "The video has ambiguous or invalid presentation timestamps.");
    }
    const timestamps = presentationTimestamps.map(({ timestamp }) => Math.round((timestamp * 1000) / timescale));
    if (timestamps.some((timestamp, index) => index > 0 && timestamp <= timestamps[index - 1]!)) {
      throw new VideoSegmentError(422, "INVALID_VIDEO", "The video frame timestamps are too close to map safely.");
    }
    const durationMs = Math.round((decodeTimestamp * 1000) / timescale);
    if (durationMs > MAX_VIDEO_DURATION_MS) {
      throw new VideoSegmentError(413, "VIDEO_TOO_LONG", "The video must be 30 seconds or shorter.");
    }
    if (timestamps.length === 0 || durationMs <= 0) {
      throw new VideoSegmentError(422, "INVALID_VIDEO", "The video has no valid frame timing data.");
    }
    return { frameTimestampsMs: timestamps, durationMs };
  }
  throw new VideoSegmentError(415, "UNSUPPORTED_VIDEO", "The upload does not contain a supported video track.");
}

/** Validate actual MP4/MOV container bytes and extract frame timestamps when available. */
export function validateVideoBytes(bytes: Uint8Array): VideoMetadata {
  if (bytes.byteLength === 0) {
    throw new VideoSegmentError(422, "INVALID_VIDEO", "Choose a video file with content.");
  }
  if (bytes.byteLength > MAX_VIDEO_BYTES) {
    throw new VideoSegmentError(413, "VIDEO_TOO_LARGE", "The video must be 60 MiB or smaller.");
  }
  if (bytes.byteLength < 8 || fourcc(bytes, 4) !== "ftyp") {
    throw new VideoSegmentError(415, "UNSUPPORTED_VIDEO", "Use an MP4 or MOV video file.");
  }
  if (bytes.byteLength < 24) {
    throw new VideoSegmentError(422, "INVALID_VIDEO", "The video container is corrupt or truncated.");
  }

  const ftypSize = uint32(bytes, 0);
  if (ftypSize < 16 || ftypSize > bytes.byteLength || ftypSize > MAX_FTYP_BOX_BYTES || (ftypSize - 16) % 4 !== 0) {
    throw new VideoSegmentError(422, "INVALID_VIDEO", "The video container is corrupt or truncated.");
  }
  const majorBrand = fourcc(bytes, 8);
  const isMov = majorBrand === QUICKTIME_BRAND;
  const compatibleBrands: string[] = [];
  for (let offset = 16; offset + 4 <= ftypSize; offset += 4) compatibleBrands.push(fourcc(bytes, offset));
  const hasSupportedBrand = isMov || isSupportedMp4Brand(majorBrand) || compatibleBrands.some(isSupportedMp4Brand);
  if (!hasSupportedBrand) {
    throw new VideoSegmentError(415, "UNSUPPORTED_VIDEO", "Use an MP4 or MOV video file.");
  }

  const topLevel = boxes(bytes, 0, bytes.byteLength);
  if (topLevel[0]?.type !== "ftyp" || !topLevel.some((box) => box.type === "moov") || !topLevel.some((box) => box.type === "mdat")) {
    throw new VideoSegmentError(422, "INVALID_VIDEO", "The video container is incomplete or unsupported.");
  }
  const moov = topLevel.find((box) => box.type === "moov")!;
  const track = parseVideoTrack(bytes, moov);
  if (track?.frameTimestampsMs && track.frameTimestampsMs.length > MAX_VIDEO_FRAMES) {
    throw new VideoSegmentError(413, "VIDEO_TOO_LONG", "The video contains more frames than this request supports.");
  }

  if (!track) {
    throw new VideoSegmentError(422, "INVALID_VIDEO", "The video timing metadata could not be validated.");
  }
  return {
    container: isMov ? "mov" : "mp4",
    mimeType: isMov ? "video/quicktime" : "video/mp4",
    ...(track.durationMs === undefined ? {} : { durationMs: track.durationMs }),
    ...(track.frameTimestampsMs ? { frameTimestampsMs: track.frameTimestampsMs } : {}),
  };
}
