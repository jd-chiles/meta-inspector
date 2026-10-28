/**
 * Bounded server-side media validation and normalization (REQ-002, REQ-010).
 *
 * Boundary contract:
 * - Accepts raw image bytes only (Uint8Array). It never accepts URLs and never
 *   fetches anything: there is no network path in this module.
 * - Application limits (stricter than any provider limit): at most
 *   8 MiB per upload, at most 20 megapixels decoded, MIME allowlist
 *   JPEG/PNG/WebP. Oversized input is rejected before expensive work.
 * - Validates structure (magic bytes, required chunks/segments, declared
 *   dimensions), strips metadata (EXIF/APPn/COM, PNG ancillary chunks, WebP
 *   EXIF/XMP/ICCP), reads EXIF orientation, and digests the canonical
 *   stripped bytes with SHA-256.
 *
 * Decoder seam (explicit, not silent): this module is dependency-free so it
 * runs identically in the API route and in unit tests without a native image
 * dependency. It performs byte-level normalization and computes the exact
 * 1600px-longest-edge downscale target, but it does not resample pixels.
 * A decoder-backed `PixelResampler` (for example sharp, pinned by TASK-002
 * dependencies) must be injected by the caller when `resampleRequired` is
 * true to produce downscaled bytes; until then the canonical stripped bytes
 * are authoritative and `resampleRequired` stays visible. Header parsing is
 * real validation (magic, structure, dimensions, truncation), not a pass.
 */
import { createHash, randomUUID } from "node:crypto";

/** Hard upload bound: 8 MiB (REQ-002). Checked before any parsing. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Hard decoded-area bound: 20 megapixels (REQ-002). */
export const MAX_MEGAPIXELS = 20;

/** Longest edge of the canonical display size (REQ-002). */
export const MAX_LONGEST_EDGE = 1600;

/**
 * Transport bound for the success response: normalized media is returned as
 * base64 and must stay within 2 MiB of encoded text (design § Contracts).
 */
export const MAX_ENCODED_RESPONSE_BYTES = 2 * 1024 * 1024;

export const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

export type ImageKind = "jpeg" | "png" | "webp";

const MIME_BY_KIND: Record<ImageKind, AllowedImageMime> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export interface MediaFailure {
  code: "INVALID_MEDIA";
  /** HTTP status the route must use for this failure. */
  status: 400 | 413 | 415 | 422;
  message: string;
}

export class MediaValidationError extends Error {
  readonly code = "INVALID_MEDIA" as const;
  readonly status: MediaFailure["status"];

  constructor(status: MediaFailure["status"], message: string) {
    super(message);
    this.name = "MediaValidationError";
    this.status = status;
  }

  toFailure(): MediaFailure {
    return { code: this.code, status: this.status, message: this.message };
  }
}

export interface DownscaleTarget {
  width: number;
  height: number;
  /** True when the longest edge exceeds MAX_LONGEST_EDGE. */
  resized: boolean;
}

export interface NormalizedImage {
  /** Fresh server-assigned media identity for the canonical bytes. */
  mediaId: string;
  /** SHA-256 hex digest of the canonical (metadata-stripped) bytes. */
  digest: string;
  mime: AllowedImageMime;
  /**
   * Display dimensions with EXIF orientation applied. A decoder-backed
   * resampler must also apply the pixel transposition when
   * `pixelTransposeRequired` is true.
   */
  width: number;
  height: number;
  /** Dimensions exactly as stored in the bitstream (pre-orientation). */
  storedWidth: number;
  storedHeight: number;
  /** EXIF orientation 1–8 (1 when absent or not a JPEG). */
  exifOrientation: number;
  /** Canonical metadata-stripped bytes. Authoritative for digest/export. */
  bytes: Uint8Array;
  /** Exact downscale target for a 1600px longest edge. */
  targetWidth: number;
  targetHeight: number;
  /** True when pixel resampling to the target is still required. */
  resampleRequired: boolean;
  /** True when EXIF orientation 5–8 needs a pixel transposition. */
  pixelTransposeRequired: boolean;
}

/** Signature + declared-dimension sniffing. Returns null when unsupported. */
export function detectImageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "webp";
  }
  return null;
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! << 24) |
    (bytes[offset + 1]! << 16) |
    (bytes[offset + 2]! << 8) |
    bytes[offset + 3]!
  );
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function isSofMarker(marker: number): boolean {
  // Start-of-frame markers excluding DHT (0xC4), JPG (0xC8) and DAC (0xCC).
  return (
    (marker >= 0xc0 && marker <= 0xcf) &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  // bytes[0..2] already verified as SOI by detectImageKind.
  let offset = 2;
  let foundSos = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      throw new MediaValidationError(422, "Image bytes are corrupt or truncated (bad JPEG segment).");
    }
    let marker = bytes[offset + 1]!;
    // Skip fill bytes (0xFF padding) and stuffed zero byte.
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1]!;
    }
    if (marker === 0x00) {
      offset += 2;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2; // Standalone markers carry no length.
      continue;
    }
    if (marker === 0xd9) {
      break; // EOI before any SOF/SOS: truncated.
    }
    if (offset + 4 > bytes.length) break;
    const length = readU16BE(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) {
      throw new MediaValidationError(422, "Image bytes are corrupt or truncated (bad JPEG segment).");
    }
    if (isSofMarker(marker)) {
      if (length < 7) {
        throw new MediaValidationError(422, "Image bytes are corrupt or truncated (bad JPEG frame).");
      }
      const height = readU16BE(bytes, offset + 5);
      const width = readU16BE(bytes, offset + 7);
      return { width, height };
    }
    if (marker === 0xda) {
      foundSos = true; // Start of scan: entropy data follows; dims must precede it.
      break;
    }
    offset += 2 + length;
  }
  if (foundSos) {
    throw new MediaValidationError(
      422,
      "Image bytes are corrupt or truncated (JPEG frame header missing).",
    );
  }
  throw new MediaValidationError(
    422,
    "Image bytes are corrupt or truncated (JPEG frame header missing).",
  );
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } {
  // Minimal structural walk: signature + first chunk must be IHDR.
  if (bytes.length < 8 + 8 + 13 + 4) {
    throw new MediaValidationError(422, "Image bytes are corrupt or truncated (bad PNG header).");
  }
  const length = readU32BE(bytes, 8);
  const type =
    String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (type !== "IHDR" || length !== 13) {
    throw new MediaValidationError(422, "Image bytes are corrupt or truncated (bad PNG header).");
  }
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  return { width, height };
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type =
      String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
    const size = bytes[offset + 4]! |
      (bytes[offset + 5]! << 8) |
      (bytes[offset + 6]! << 16) |
      (bytes[offset + 7]! << 24);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) {
      throw new MediaValidationError(422, "Image bytes are corrupt or truncated (bad WebP chunk).");
    }
    if (type === "VP8 " && size >= 10) {
      // Lossy bitstream: 3-byte frame tag, 3-byte start code, 14-bit dims.
      if (bytes[dataStart + 3] === 0x9d && bytes[dataStart + 4] === 0x01 && bytes[dataStart + 5] === 0x2a) {
        const width = readU16LE(bytes, dataStart + 6) & 0x3fff;
        const height = readU16LE(bytes, dataStart + 8) & 0x3fff;
        return { width, height };
      }
      throw new MediaValidationError(422, "Image bytes are corrupt or truncated (bad WebP frame).");
    }
    if (type === "VP8L" && size >= 5) {
      if (bytes[dataStart] !== 0x2f) {
        throw new MediaValidationError(422, "Image bytes are corrupt or truncated (bad WebP frame).");
      }
      const b0 = bytes[dataStart + 1]!;
      const b1 = bytes[dataStart + 2]!;
      const b2 = bytes[dataStart + 3]!;
      const b3 = bytes[dataStart + 4]!;
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height };
    }
    if (type === "VP8X" && size >= 10) {
      const width = 1 + readU24LE(bytes, dataStart + 4);
      const height = 1 + readU24LE(bytes, dataStart + 7);
      return { width, height };
    }
    offset = dataEnd + (size % 2); // Chunks are padded to even sizes.
  }
  throw new MediaValidationError(
    422,
    "Image bytes are corrupt or truncated (WebP image data missing).",
  );
}

/** Declared dimensions from validated structure. Throws INVALID_MEDIA on corrupt input. */
export function readImageDimensions(
  bytes: Uint8Array,
): { mime: AllowedImageMime; width: number; height: number } {
  const kind = detectImageKind(bytes);
  if (kind === null) {
    throw new MediaValidationError(
      415,
      "Unsupported image type. Upload a JPEG, PNG, or WebP photo.",
    );
  }
  const dims =
    kind === "jpeg"
      ? readJpegDimensions(bytes)
      : kind === "png"
        ? readPngDimensions(bytes)
        : readWebpDimensions(bytes);
  if (
    !Number.isInteger(dims.width) ||
    !Number.isInteger(dims.height) ||
    dims.width <= 0 ||
    dims.height <= 0
  ) {
    throw new MediaValidationError(422, "Image bytes declare invalid dimensions.");
  }
  return { mime: MIME_BY_KIND[kind], width: dims.width, height: dims.height };
}

/** Minimal EXIF orientation reader (JPEG APP1 only). Returns 1–8, defaults to 1. */
export function readExifOrientation(bytes: Uint8Array): number {
  try {
    if (detectImageKind(bytes) !== "jpeg") return 1;
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) return 1;
      const marker = bytes[offset + 1]!;
      if (marker === 0xd9 || marker === 0xda) return 1;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        offset += 2;
        continue;
      }
      const length = readU16BE(bytes, offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) return 1;
      if (
        marker === 0xe1 &&
        length > 8 &&
        bytes[offset + 4] === 0x45 && // E
        bytes[offset + 5] === 0x78 && // x
        bytes[offset + 6] === 0x69 && // i
        bytes[offset + 7] === 0x66 // f
      ) {
        const tiffStart = offset + 10;
        const little =
          bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
        const big =
          bytes[tiffStart] === 0x4d && bytes[tiffStart + 1] === 0x4d;
        if (!little && !big) return 1;
        const read16 = (at: number): number =>
          little ? readU16LE(bytes, at) : readU16BE(bytes, at);
        const read32 = (at: number): number =>
          little
            ? bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)
            : readU32BE(bytes, at);
        const ifdOffset = tiffStart + read32(tiffStart + 4);
        if (ifdOffset + 2 > bytes.length) return 1;
        const count = read16(ifdOffset);
        for (let i = 0; i < count; i += 1) {
          const entry = ifdOffset + 2 + i * 12;
          if (entry + 12 > bytes.length) return 1;
          if (read16(entry) === 0x0112) {
            const value = read16(entry + 8);
            if (value >= 1 && value <= 8) return value;
            return 1;
          }
        }
        return 1;
      }
      offset += 2 + length;
    }
  } catch {
    return 1;
  }
  return 1;
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (ISO 3309) used to rebuild PNG chunks after ancillary stripping. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = [bytes.subarray(0, 2)]; // SOI
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]!;
    if (marker === 0xd9) {
      kept.push(bytes.subarray(offset, offset + 2));
      return concat(kept);
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      kept.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const length = readU16BE(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (marker === 0xda) {
      // Start of scan: copy the SOS header plus all remaining entropy data
      // verbatim so the image stays decodable.
      kept.push(bytes.subarray(offset));
      return concat(kept);
    }
    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) {
      kept.push(bytes.subarray(offset, offset + 2 + length));
    }
    offset += 2 + length;
  }
  // No SOS found: keep the structural prefix that parsed cleanly.
  return concat(kept);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out[0] = (data.length >>> 24) & 0xff;
  out[1] = (data.length >>> 16) & 0xff;
  out[2] = (data.length >>> 8) & 0xff;
  out[3] = data.length & 0xff;
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(out.subarray(4, 8), 0);
  crcInput.set(data, 4);
  const crc = crc32(crcInput);
  out[8 + data.length] = (crc >>> 24) & 0xff;
  out[9 + data.length] = (crc >>> 16) & 0xff;
  out[10 + data.length] = (crc >>> 8) & 0xff;
  out[11 + data.length] = crc & 0xff;
  return out;
}

function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  // Keep only critical chunks (IHDR, PLTE, IDAT, IEND); drop every ancillary
  // chunk (tEXt/zTXt/iTXt/eXIf/pHYs/...) that can carry metadata.
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  let seenIend = false;
  while (offset + 8 <= bytes.length) {
    const length = readU32BE(bytes, offset);
    const type =
      String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    if (length > bytes.length || offset + 12 + length > bytes.length) {
      throw new MediaValidationError(422, "Image bytes are corrupt or truncated (bad PNG chunk).");
    }
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR" || type === "PLTE" || type === "IDAT" || type === "IEND") {
      kept.push(pngChunk(type, data));
    }
    offset += 12 + length;
    if (type === "IEND") {
      seenIend = true;
      break;
    }
  }
  if (!seenIend) {
    throw new MediaValidationError(422, "Image bytes are corrupt or truncated (PNG IEND missing).");
  }
  return concat(kept);
}

function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  const chunks: Array<{ type: string; data: Uint8Array }> = [];
  let offset = 12;
  let hasImageData = false;
  while (offset + 8 <= bytes.length) {
    const type =
      String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
    const size = bytes[offset + 4]! |
      (bytes[offset + 5]! << 8) |
      (bytes[offset + 6]! << 16) |
      (bytes[offset + 7]! << 24);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) {
      throw new MediaValidationError(422, "Image bytes are corrupt or truncated (bad WebP chunk).");
    }
    if (type === "VP8 " || type === "VP8L" || type === "VP8X" || type === "ALPH" || type === "ANIM" || type === "ANMF") {
      hasImageData = true;
      chunks.push({ type, data: bytes.subarray(dataStart, dataEnd) });
    }
    // EXIF, XMP , ICCP and any unknown chunk are dropped as metadata.
    offset = dataEnd + (size % 2);
  }
  if (!hasImageData) {
    throw new MediaValidationError(422, "Image bytes are corrupt or truncated (WebP image data missing).");
  }
  // Clear the VP8X metadata-presence flags for the chunks we dropped so the
  // container stays self-consistent (ICC 0x20, EXIF 0x08, XMP 0x04).
  for (const chunk of chunks) {
    if (chunk.type === "VP8X" && chunk.data.length >= 1) {
      const flags = chunk.data[0]! & ~(0x20 | 0x08 | 0x04);
      const patched = new Uint8Array(chunk.data);
      patched[0] = flags;
      chunk.data = patched;
    }
  }
  const parts: Uint8Array[] = [];
  let payloadLength = 4; // "WEBP"
  for (const chunk of chunks) {
    const padded = chunk.data.length + (chunk.data.length % 2);
    payloadLength += 8 + padded;
  }
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  header[4] = payloadLength & 0xff;
  header[5] = (payloadLength >> 8) & 0xff;
  header[6] = (payloadLength >> 16) & 0xff;
  header[7] = (payloadLength >> 24) & 0xff;
  header.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  parts.push(header);
  for (const chunk of chunks) {
    const head = new Uint8Array(8);
    head[0] = chunk.type.charCodeAt(0);
    head[1] = chunk.type.charCodeAt(1);
    head[2] = chunk.type.charCodeAt(2);
    head[3] = chunk.type.charCodeAt(3);
    head[4] = chunk.data.length & 0xff;
    head[5] = (chunk.data.length >> 8) & 0xff;
    head[6] = (chunk.data.length >> 16) & 0xff;
    head[7] = (chunk.data.length >> 24) & 0xff;
    parts.push(head, chunk.data);
    if (chunk.data.length % 2 === 1) parts.push(new Uint8Array([0]));
  }
  return concat(parts);
}

/**
 * Strip container metadata for the detected kind. Throws INVALID_MEDIA when
 * the structure is corrupt mid-strip. Never fetches; bytes only.
 */
export function stripMetadata(bytes: Uint8Array, kind: ImageKind): Uint8Array {
  if (kind === "jpeg") return stripJpegMetadata(bytes);
  if (kind === "png") return stripPngMetadata(bytes);
  return stripWebpMetadata(bytes);
}

/** Exact longest-edge target for MAX_LONGEST_EDGE (no pixel work). */
export function computeDownscaleTarget(width: number, height: number): DownscaleTarget {
  const longest = Math.max(width, height);
  if (longest <= MAX_LONGEST_EDGE) {
    return { width, height, resized: false };
  }
  const scale = MAX_LONGEST_EDGE / longest;
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    resized: true,
  };
}

/** SHA-256 hex digest of the canonical bytes (Node runtime). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Fresh server-assigned media identity for normalized bytes. */
export function generateMediaId(): string {
  return `media-${randomUUID()}`;
}

export interface ValidateMediaOptions {
  /** Declared upload MIME (for example the File type). Must match the sniffed bytes. */
  claimedMime?: string;
  /** Override the fresh media ID (tests/deterministic callers). Defaults to random. */
  mediaId?: string;
}

/**
 * Validate, strip and digest raw image bytes. Throws MediaValidationError
 * (INVALID_MEDIA with a route-ready status) on any boundary violation.
 */
export function validateAndNormalizeImage(
  input: Uint8Array,
  options: ValidateMediaOptions = {},
): NormalizedImage {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length === 0) {
    throw new MediaValidationError(400, "Empty image upload. Capture or select a photo first.");
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new MediaValidationError(
      413,
      "Image exceeds the 8 MiB upload bound. Retake or choose a smaller photo.",
    );
  }
  const kind = detectImageKind(bytes);
  if (kind === null) {
    throw new MediaValidationError(
      415,
      "Unsupported image type. Upload a JPEG, PNG, or WebP photo.",
    );
  }
  const detectedMime = MIME_BY_KIND[kind];
  if (
    typeof options.claimedMime === "string" &&
    options.claimedMime.length > 0 &&
    options.claimedMime !== detectedMime
  ) {
    throw new MediaValidationError(
      422,
      "Upload type does not match the image bytes. Retake or re-select the photo.",
    );
  }
  const dims = readImageDimensions(bytes);
  const megapixels = (dims.width * dims.height) / 1_000_000;
  if (megapixels > MAX_MEGAPIXELS) {
    throw new MediaValidationError(
      422,
      "Image exceeds the 20 megapixel bound. Retake with a lower resolution.",
    );
  }
  const exifOrientation = readExifOrientation(bytes);
  const transpose = exifOrientation >= 5;
  const displayWidth = transpose ? dims.height : dims.width;
  const displayHeight = transpose ? dims.width : dims.height;
  const canonical = stripMetadata(bytes, kind);
  const digest = sha256Hex(canonical);
  const target = computeDownscaleTarget(displayWidth, displayHeight);
  return {
    mediaId: options.mediaId ?? generateMediaId(),
    digest,
    mime: detectedMime,
    width: displayWidth,
    height: displayHeight,
    storedWidth: dims.width,
    storedHeight: dims.height,
    exifOrientation,
    bytes: canonical,
    targetWidth: target.width,
    targetHeight: target.height,
    resampleRequired: target.resized,
    pixelTransposeRequired: transpose,
  };
}

/**
 * Encode canonical bytes for the success response. Throws INVALID_MEDIA/413
 * when the encoded payload would exceed the 2 MiB transport bound; callers
 * with a decoder-backed resampler downscale to the downscale target first.
 */
export function encodeNormalizedMedia(bytes: Uint8Array): string {
  const base64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  if (base64.length > MAX_ENCODED_RESPONSE_BYTES) {
    throw new MediaValidationError(
      413,
      "Normalized image exceeds the 2 MiB response bound. A decoder-backed downscale to the 1600px target is required.",
    );
  }
  return base64;
}
