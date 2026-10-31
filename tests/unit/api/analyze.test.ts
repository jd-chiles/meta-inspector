/**
 * Behavioral boundary tests for TASK-004 (REQ-002, REQ-003, REQ-004, REQ-010).
 *
 * Deterministic and fixture-only: mocked HTTP, synthetic mock-unit bytes, no
 * provider keys, no network, no browser. Every image below is generated in
 * code (1x1 or header-only structures); no rights-cleared media is needed.
 * Mocked digests are synthetic SHA-256 values of synthetic bytes — never
 * live inference. The separate live smoke (`npm run test:live`, TASK-002
 * script) must fail clearly without credentials; nothing here proves it.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import fixtureJson from "../../../fixtures/responses/fixture-draft.json";
import { validateAnalysisDraft } from "../../../src/domain/evidence";
import {
  handleAnalyzeRequest,
  InflightTracker,
} from "../../../src/server/analyze";
import {
  buildChatCompletionsPayload,
  callMetaDraft,
  describeConfigForLog,
  parseAnalysisMode,
  requireLiveConfig,
  resolveMetaConfig,
  runFixtureDraft,
  type FetchImpl,
} from "../../../src/server/meta/adapter";
import {
  computeDownscaleTarget,
  crc32,
  detectImageKind,
  encodeNormalizedMedia,
  readExifOrientation,
  readImageDimensions,
  sha256Hex,
  validateAndNormalizeImage,
  MAX_ENCODED_RESPONSE_BYTES,
  MAX_IMAGE_BYTES,
} from "../../../src/server/media/validate";

/* ------------------------------------------------------------------ */
/* Synthetic image builders (mock-unit bytes generated in code).       */
/* ------------------------------------------------------------------ */

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(out.subarray(4, 8), 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i);
  return out;
}

function buildPng(
  width: number,
  height: number,
  options: { textChunk?: boolean; idatPayload?: Uint8Array } = {},
): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const parts: Uint8Array[] = [signature, pngChunk("IHDR", ihdr)];
  if (options.textChunk) {
    parts.push(pngChunk("tEXt", asciiBytes("Comment\0mock-unit only")));
  }
  const idat = options.idatPayload ??
    new Uint8Array(deflateSync(new Uint8Array(height * (1 + width * 3))));
  parts.push(pngChunk("IDAT", idat));
  parts.push(pngChunk("IEND", new Uint8Array(0)));
  return concatBytes(parts);
}

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = ((payload.length + 2) >> 8) & 0xff;
  out[3] = (payload.length + 2) & 0xff;
  out.set(payload, 4);
  return out;
}

function exifApp1Payload(orientation: number): Uint8Array {
  const header = asciiBytes("Exif\0\0");
  // Little-endian TIFF: "II", 42, IFD offset 8, one SHORT entry (tag 0x0112).
  const tiff = new Uint8Array([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00,
    0x00, 0x00, orientation & 0xff, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  return concatBytes([header, tiff]);
}

function buildJpeg(options: {
  width: number;
  height: number;
  app0?: boolean;
  exifOrientation?: number;
  comment?: boolean;
}): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])]; // SOI
  if (options.app0) {
    parts.push(jpegSegment(0xe0, asciiBytes("JFIF\0mock-unit")));
  }
  if (options.exifOrientation !== undefined) {
    parts.push(jpegSegment(0xe1, exifApp1Payload(options.exifOrientation)));
  }
  if (options.comment) {
    parts.push(jpegSegment(0xfe, asciiBytes("mock-unit comment")));
  }
  parts.push(jpegSegment(0xdb, new Uint8Array(65))); // DQT
  const w = options.width;
  const h = options.height;
  parts.push(
    jpegSegment(
      0xc0,
      new Uint8Array([
        0x08, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, 0x03,
        0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      ]),
    ),
  );
  parts.push(jpegSegment(0xc4, new Uint8Array([0x00, 0x01, 0x02, 0x03]))); // DHT
  parts.push(jpegSegment(0xda, new Uint8Array([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]))); // SOS
  parts.push(new Uint8Array([0x00, 0x11, 0x22, 0x33, 0xff, 0xd9])); // entropy + EOI
  return concatBytes(parts);
}

function webpChunkRecord(type: string, data: Uint8Array): { type: string; data: Uint8Array } {
  return { type, data };
}

function buildWebp(chunks: Array<{ type: string; data: Uint8Array }>): Uint8Array {
  let payloadLength = 4; // "WEBP"
  for (const chunk of chunks) {
    payloadLength += 8 + chunk.data.length + (chunk.data.length % 2);
  }
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46], 0);
  header[4] = payloadLength & 0xff;
  header[5] = (payloadLength >> 8) & 0xff;
  header[6] = (payloadLength >> 16) & 0xff;
  header[7] = (payloadLength >> 24) & 0xff;
  header.set([0x57, 0x45, 0x42, 0x50], 8);
  const parts: Uint8Array[] = [header];
  for (const chunk of chunks) {
    const head = new Uint8Array(8);
    for (let i = 0; i < 4; i += 1) head[i] = chunk.type.charCodeAt(i);
    head[4] = chunk.data.length & 0xff;
    head[5] = (chunk.data.length >> 8) & 0xff;
    head[6] = (chunk.data.length >> 16) & 0xff;
    head[7] = (chunk.data.length >> 24) & 0xff;
    parts.push(head, chunk.data);
    if (chunk.data.length % 2 === 1) parts.push(new Uint8Array([0]));
  }
  return concatBytes(parts);
}

function vp8LossyData(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a,
    width & 0xff, (width >> 8) & 0x3f, height & 0xff, (height >> 8) & 0x3f,
    0x00, 0x00,
  ]);
}

function vp8LosslessData(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return new Uint8Array([
    0x2f,
    w & 0xff,
    ((w >> 8) & 0x3f) | ((h & 0x03) << 6),
    (h >> 2) & 0xff,
    (h >> 10) & 0x0f,
  ]);
}

function vp8xData(width: number, height: number, flags: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return new Uint8Array([
    flags & 0xff, 0x00, 0x00, 0x00,
    w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff,
    h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff,
  ]);
}

function validDraftFixture() {
  return {
    observation: "The mock-unit sink basin looks intact in this frame.",
    visibleEvidence: ["basin without visible cracks"],
    unknowns: ["water flow cannot be told from the photo"],
    suggestedManualChecks: ["Run the taps and watch drainage."],
  };
}

function mockJsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
} {
  const lowered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) lowered[key.toLowerCase()] = value;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lowered[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  };
}

function successFetch(
  seen: { url?: string; init?: Parameters<FetchImpl>[1] },
  draft: unknown = validDraftFixture(),
): FetchImpl {
  return (url, init) => {
    seen.url = url;
    seen.init = init;
    return Promise.resolve(
      mockJsonResponse(
        200,
        {
          id: "chatcmpl-test-1",
          model: "muse-spark-1.3",
          choices: [{ message: { content: JSON.stringify(draft) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        },
        { "x-request-id": "req-test-1" },
      ),
    );
  };
}

const LIVE_ENV = {
  APP_ANALYSIS_MODE: "live",
  META_API_KEY: "test-key-SECRET-VALUE-9",
  META_MODEL: "muse-spark-1.3",
  META_API_BASE_URL: "https://api.meta.ai/v1",
};

function analyzeForm(fields: {
  sessionId?: string;
  itemId?: string;
  catalogVersion?: string;
  analysisId?: string;
  image?: { bytes: Uint8Array; name: string; type: string };
  extra?: Record<string, string>;
}): FormData {
  const form = new FormData();
  if (fields.sessionId !== undefined) form.set("sessionId", fields.sessionId);
  if (fields.itemId !== undefined) form.set("itemId", fields.itemId);
  if (fields.catalogVersion !== undefined) form.set("catalogVersion", fields.catalogVersion);
  if (fields.analysisId !== undefined) form.set("analysisId", fields.analysisId);
  if (fields.image) {
    form.set("image", new File([fields.image.bytes], fields.image.name, { type: fields.image.type }));
  }
  for (const [key, value] of Object.entries(fields.extra ?? {})) form.set(key, value);
  return form;
}

function analyzeRequest(form: FormData, origin?: string): Request {
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers.origin = origin;
  return new Request("http://localhost/api/analyze", { method: "POST", headers, body: form });
}

const TINY_PNG = () => buildPng(1, 1);
const GOOD_FIELDS = () => ({
  sessionId: "session-1",
  itemId: "demo-water-supply",
  catalogVersion: "0.3.0-demo.3",
  analysisId: "analysis-1",
  image: { bytes: TINY_PNG(), name: "photo.png", type: "image/png" },
});

/* ------------------------------------------------------------------ */
/* Media validation and normalization.                                 */
/* ------------------------------------------------------------------ */

describe("media validation and normalization (REQ-002, REQ-010)", () => {
  it("accepts JPEG, PNG, and WebP by sniffed bytes", () => {
    expect(detectImageKind(buildJpeg({ width: 4, height: 2 }))).toBe("jpeg");
    expect(detectImageKind(buildPng(4, 2))).toBe("png");
    expect(detectImageKind(buildWebp([webpChunkRecord("VP8 ", vp8LossyData(4, 2))]))) .toBe("webp");
    expect(detectImageKind(buildWebp([webpChunkRecord("VP8L", vp8LosslessData(4, 2))]))) .toBe("webp");
    expect(readImageDimensions(buildPng(4, 2))).toMatchObject({ mime: "image/png", width: 4, height: 2 });
    expect(readImageDimensions(buildJpeg({ width: 4, height: 2 }))).toMatchObject({
      mime: "image/jpeg",
      width: 4,
      height: 2,
    });
    expect(
      readImageDimensions(buildWebp([webpChunkRecord("VP8 ", vp8LossyData(4, 2))])),
    ).toMatchObject({ mime: "image/webp", width: 4, height: 2 });
    expect(
      readImageDimensions(buildWebp([webpChunkRecord("VP8L", vp8LosslessData(4, 2))])),
    ).toMatchObject({ mime: "image/webp", width: 4, height: 2 });
    expect(
      readImageDimensions(
        buildWebp([
          webpChunkRecord("VP8X", vp8xData(6, 3, 0x10)),
          webpChunkRecord("VP8 ", vp8LossyData(6, 3)),
        ]),
      ),
    ).toMatchObject({ mime: "image/webp", width: 6, height: 3 });
  });

  it("rejects empty, unsupported, and corrupt bytes with distinct statuses", () => {
    expect(() => validateAndNormalizeImage(new Uint8Array(0))).toThrowError(/Empty image/);
    try {
      validateAndNormalizeImage(new Uint8Array(0));
      expect.unreachable();
    } catch (error) {
      expect((error as { status?: unknown }).status).toBe(400);
    }
    expect(() => validateAndNormalizeImage(asciiBytes("GIF89a-mock"))).toThrowError(/Unsupported image type/);
    try {
      validateAndNormalizeImage(asciiBytes("GIF89a-mock"));
      expect.unreachable();
    } catch (error) {
      expect((error as { status?: unknown }).status).toBe(415);
    }
    // Truncated JPEG (SOI only): no frame header survives.
    expect(() => validateAndNormalizeImage(new Uint8Array([0xff, 0xd8, 0xff]))).toThrowError(
      /corrupt or truncated/,
    );
    // PNG signature without an IHDR is corrupt.
    expect(() =>
      validateAndNormalizeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toThrowError(/corrupt or truncated/);
  });

  it("rejects claimed-MIME mismatches (declared type must equal sniffed bytes)", () => {
    try {
      validateAndNormalizeImage(buildPng(2, 2), { claimedMime: "image/jpeg" });
      expect.unreachable();
    } catch (error) {
      expect((error as { status?: unknown }).status).toBe(422);
      expect(String((error as Error).message)).toMatch(/does not match/);
    }
  });

  it("rejects oversize uploads (413) and over-megapixel images (422) before expensive work", () => {
    const oversize = new Uint8Array(MAX_IMAGE_BYTES + 1);
    oversize[0] = 0xff;
    oversize[1] = 0xd8;
    oversize[2] = 0xff;
    try {
      validateAndNormalizeImage(oversize);
      expect.unreachable();
    } catch (error) {
      expect((error as { status?: unknown }).status).toBe(413);
    }
    // Declared 5000x5000 = 25 MP: IHDR parsing alone must reject it (422).
    const huge = buildPng(5000, 5000, { idatPayload: new Uint8Array([0]) });
    try {
      validateAndNormalizeImage(huge);
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).toMatch(/20 megapixel/);
      expect((error as { status?: unknown }).status).toBe(422);
    }
  });

  it("strips JPEG APPn/COM metadata and reports EXIF orientation without fetching", () => {
    const bytes = buildJpeg({ width: 4, height: 2, app0: true, exifOrientation: 6, comment: true });
    expect(readExifOrientation(bytes)).toBe(6);
    const normalized = validateAndNormalizeImage(bytes, { mediaId: "media-1" });
    // Orientation 6 transposes the display dimensions; the seam flag stays visible.
    expect(normalized.storedWidth).toBe(4);
    expect(normalized.storedHeight).toBe(2);
    expect(normalized.width).toBe(2);
    expect(normalized.height).toBe(4);
    expect(normalized.pixelTransposeRequired).toBe(true);
    const text = Buffer.from(normalized.bytes).toString("latin1");
    expect(text).not.toContain("JFIF");
    expect(text).not.toContain("Exif");
    expect(text).not.toContain("mock-unit comment");
    expect(detectImageKind(normalized.bytes)).toBe("jpeg");
    expect(normalized.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(normalized.digest).toBe(sha256Hex(normalized.bytes));
  });

  it("strips PNG ancillary chunks and keeps critical data with valid CRCs", () => {
    const bytes = buildPng(2, 2, { textChunk: true });
    const normalized = validateAndNormalizeImage(bytes, { mediaId: "media-png" });
    const text = Buffer.from(normalized.bytes).toString("latin1");
    expect(text).toContain("IDAT");
    expect(text).not.toContain("tEXt");
    expect(detectImageKind(normalized.bytes)).toBe("png");
    // Canonical bytes still parse to the same dimensions.
    expect(readImageDimensions(normalized.bytes)).toMatchObject({ width: 2, height: 2 });
  });

  it("strips WebP EXIF/XMP metadata and clears the VP8X presence flags", () => {
    const bytes = buildWebp([
      webpChunkRecord("VP8X", vp8xData(6, 4, 0x10 | 0x08 | 0x04)),
      webpChunkRecord("VP8 ", vp8LossyData(6, 4)),
      webpChunkRecord("EXIF", new Uint8Array([1, 2, 3, 4])),
      webpChunkRecord("XMP ", new Uint8Array([5, 6, 7, 8])),
    ]);
    const normalized = validateAndNormalizeImage(bytes, { mediaId: "media-webp" });
    const text = Buffer.from(normalized.bytes).toString("latin1");
    expect(text).not.toContain("EXIF");
    expect(text).not.toContain("XMP ");
    expect(readImageDimensions(normalized.bytes)).toMatchObject({ width: 6, height: 4 });
  });

  it("assigns a fresh media ID and digest per upload (deterministic bytes, unique identity)", () => {
    const bytes = buildPng(2, 2);
    const first = validateAndNormalizeImage(bytes);
    const second = validateAndNormalizeImage(bytes);
    expect(first.digest).toBe(second.digest);
    expect(first.mediaId).not.toBe(second.mediaId);
  });

  it("computes the exact 1600px longest-edge target and flags resampling", () => {
    expect(computeDownscaleTarget(800, 600)).toEqual({ width: 800, height: 600, resized: false });
    expect(computeDownscaleTarget(3200, 2000)).toEqual({ width: 1600, height: 1000, resized: true });
    expect(computeDownscaleTarget(1000, 4000)).toEqual({ width: 400, height: 1600, resized: true });
    const wide = validateAndNormalizeImage(buildPng(3200, 2000, { idatPayload: new Uint8Array([0]) }), {
      mediaId: "media-wide",
    });
    expect(wide.targetWidth).toBe(1600);
    expect(wide.targetHeight).toBe(1000);
    expect(wide.resampleRequired).toBe(true);
    const small = validateAndNormalizeImage(buildPng(800, 600), { mediaId: "media-small" });
    expect(small.resampleRequired).toBe(false);
  });

  it("bounds the encoded transport payload at 2 MiB of base64", () => {
    expect(encodeNormalizedMedia(new Uint8Array([1, 2, 3])).length).toBeGreaterThan(0);
    expect(() => encodeNormalizedMedia(new Uint8Array(1_600_000))).toThrowError(/2 MiB/);
    expect(MAX_ENCODED_RESPONSE_BYTES).toBe(2 * 1024 * 1024);
  });
});

/* ------------------------------------------------------------------ */
/* Meta adapter: real configured path and explicit fixture path.       */
/* ------------------------------------------------------------------ */

describe("meta adapter configuration (REQ-003, REQ-010)", () => {
  it("defaults to explicit fixture mode and the allowlisted endpoint", () => {
    const config = resolveMetaConfig({});
    expect(config.mode).toBe("fixture");
    expect(config.baseUrl).toBe("https://api.meta.ai/v1");
    expect(config.model).toBe("muse-spark-1.3");
    expect(config.apiKey).toBeNull();
  });

  it("rejects non-allowlisted base URLs and unknown modes without fallback", () => {
    expect(() => resolveMetaConfig({ META_API_BASE_URL: "https://evil.example/v1" })).toThrowError(
      /allowlisted/,
    );
    expect(parseAnalysisMode("bogus")).toBeNull();
    expect(() => resolveMetaConfig({ APP_ANALYSIS_MODE: "bogus" })).toThrowError(/analysis mode/);
  });

  it("rejects Contributor (training opt-in) model IDs for walkthrough data", () => {
    expect(() => resolveMetaConfig({ META_MODEL: "muse-spark-1.3-contributor" })).toThrowError(
      /Contributor/,
    );
  });

  it("accepts the official MODEL_API_KEY value as a documented alias", () => {
    const config = resolveMetaConfig({ APP_ANALYSIS_MODE: "live", MODEL_API_KEY: "alias-key" });
    expect(config.apiKey).toBe("alias-key");
    expect(config.keySource).toBe("MODEL_API_KEY");
  });

  it("fails closed without credentials in live mode and never logs the key", () => {
    const config = resolveMetaConfig({ APP_ANALYSIS_MODE: "live" });
    expect(() => requireLiveConfig(config)).toThrowError(/missing Meta credentials/);
    const live = resolveMetaConfig({ APP_ANALYSIS_MODE: "live", META_API_KEY: "k" });
    requireLiveConfig(live);
    expect(JSON.stringify(describeConfigForLog(live))).not.toContain("k");
  });
});

describe("meta live adapter over mocked HTTP (REQ-003, REQ-010)", () => {
  it("posts to the allowlisted endpoint with bearer auth and a data-URL image", async () => {
    const seen: { url?: string; init?: Parameters<FetchImpl>[1] } = {};
    const config = resolveMetaConfig({ ...LIVE_ENV });
    requireLiveConfig(config);
    const outcome = await callMetaDraft({
      config,
      itemLabel: "Kitchen sink",
      captureGuidance: "Stand back.",
      imageMime: "image/png",
      imageBase64: "aGVsbG8=",
      fetchImpl: successFetch(seen),
      now: () => 1000,
    });
    expect(seen.url).toBe("https://api.meta.ai/v1/chat/completions");
    expect(seen.init?.headers?.Authorization).toBe("Bearer test-key-SECRET-VALUE-9");
    const payload = JSON.parse(seen.init?.body as string) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
      response_format: { json_schema: { name: string } };
    };
    expect(payload.model).toBe("muse-spark-1.3");
    const userMessage = payload.messages.find((message) => message.role === "user");
    expect(JSON.stringify(userMessage)).toContain("data:image/png;base64,aGVsbG8=");
    expect(payload.response_format.json_schema.name).toBe("AnalysisDraft");
    expect(outcome).toMatchObject({ mode: "live", model: "muse-spark-1.3", requestId: "req-test-1" });
    expect(outcome.draft.observation).toContain("mock-unit sink");
  });

  it("builds a strict neutral-draft payload with no verdict fields", () => {
    const payload = buildChatCompletionsPayload({
      model: "muse-spark-1.3",
      itemLabel: "Window",
      captureGuidance: "Daylight.",
      imageMime: "image/jpeg",
      imageBase64: "eA==",
    });
    const text = JSON.stringify(payload);
    for (const forbidden of ["verdict", "habitability", "pass", "confidence"]) {
      expect(text).not.toMatch(new RegExp(`"${forbidden}"`));
    }
  });

  it("maps provider outcomes to safe codes without leaking bodies", async () => {
    const config = resolveMetaConfig({ ...LIVE_ENV });
    requireLiveConfig(config);
    const failing = async (status: number, body: unknown, key: string, expectedStatus: number) => {
      try {
        await callMetaDraft({
          config,
          itemLabel: "Sink",
          captureGuidance: "Stand back.",
          imageMime: "image/png",
          imageBase64: "eA==",
          fetchImpl: () => Promise.resolve(mockJsonResponse(status, body)),
        });
        expect.unreachable(`expected ${key}`);
      } catch (error) {
        const failure = error as { code?: unknown; status?: unknown; message?: string };
        expect(failure.code).toBe(key);
        expect(failure.status).toBe(expectedStatus);
        expect(String(failure.message)).not.toContain("test-key-SECRET-VALUE-9");
      }
    };
    await failing(429, { error: "slow down" }, "PROVIDER_RATE_LIMIT", 429);
    await failing(500, { error: "boom", secret: "test-key-SECRET-VALUE-9" }, "PROVIDER_UNAVAILABLE", 502);
    await failing(400, { error: "bad image" }, "PROVIDER_UNAVAILABLE", 502);
    await failing(200, { choices: [] }, "INVALID_MODEL_OUTPUT", 502);
    await failing(200, { choices: [{ message: { content: "not json" } }] }, "INVALID_MODEL_OUTPUT", 502);
    await failing(
      200,
      { choices: [{ message: { content: JSON.stringify({ ...validDraftFixture(), verdict: "pass" }) } }] },
      "INVALID_MODEL_OUTPUT",
      502,
    );
  });

  it("surfaces aborts as PROVIDER_TIMEOUT (covers the 45s budget and cancellation)", async () => {
    const config = resolveMetaConfig({ ...LIVE_ENV });
    requireLiveConfig(config);
    const controller = new AbortController();
    const pending = callMetaDraft({
      config,
      itemLabel: "Sink",
      captureGuidance: "Stand back.",
      imageMime: "image/png",
      imageBase64: "eA==",
      signal: controller.signal,
      fetchImpl: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(mockJsonResponse(200, {})), 10_000);
        }),
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT", status: 504 });
  });

  it("uses mocked HTTP deterministically; test:live stays separate and keyless runs fail closed", async () => {
    // This unit path never touches the network: the mock above proves the
    // mapping. The live smoke needs real credentials, so a keyless config
    // must fail closed here exactly as `npm run test:live` must.
    const keyless = resolveMetaConfig({ APP_ANALYSIS_MODE: "live" });
    expect(() => requireLiveConfig(keyless)).toThrowError(/No live call was attempted/);
  });
});

describe("explicit fixture adapter (REQ-003, REQ-011)", () => {
  it("loads the bundled hand-written fixture as labeled non-live output", () => {
    expect(validateAnalysisDraft(fixtureJson.draft).ok).toBe(true);
    const outcome = runFixtureDraft(
      fixtureJson as { mode: string; model?: unknown; draft?: unknown; fixtureNotice?: unknown },
      { requestId: "fixture-test-1" },
    );
    expect(outcome.mode).toBe("fixture");
    expect(outcome.model).toBe("muse-spark-1.3");
    expect(outcome.requestId).toBe("fixture-test-1");
    expect(outcome.fixtureNotice).toMatch(/not live inference/i);
  });

  it("rejects a corrupt fixture as invalid output instead of a live claim", () => {
    expect(() =>
      runFixtureDraft({ mode: "fixture", draft: { verdict: "pass" } }),
    ).toThrowError(/fixture draft failed strict validation/);
  });
});

/* ------------------------------------------------------------------ */
/* Route boundaries: origin, fields, versions, inflight, safe errors.  */
/* ------------------------------------------------------------------ */

describe("analyze route boundaries (REQ-010)", () => {
  it("completes fixture analysis with an envelope and canonical media", async () => {
    const tracker = new InflightTracker();
    const { status, body } = await handleAnalyzeRequest(analyzeRequest(analyzeForm(GOOD_FIELDS())), {
      mode: "fixture",
      tracker,
      generateRequestId: () => "fixture-analysis-1",
    });
    expect(status).toBe(200);
    const success = body as {
      envelope: {
        analysisId: string;
        sessionId: string;
        itemId: string;
        catalogVersion: string;
        mediaId: string;
        mediaHash: string;
        model: string;
        mode: string;
        requestId: string;
        draft: unknown;
      };
      normalizedMedia: {
        mediaId: string;
        mime: string;
        digest: string;
        base64: string;
        width: number;
        height: number;
      };
      mode: string;
      fixtureNotice: string;
    };
    expect(success.mode).toBe("fixture");
    expect(success.fixtureNotice).toMatch(/not live inference/i);
    expect(success.envelope.analysisId).toBe("analysis-1");
    expect(success.envelope.sessionId).toBe("session-1");
    expect(success.envelope.itemId).toBe("demo-water-supply");
    expect(success.envelope.mediaId).toBe(success.normalizedMedia.mediaId);
    expect(success.envelope.mediaHash).toBe(success.normalizedMedia.digest);
    expect(success.envelope.mediaHash).toBe(
      createHash("sha256").update(Buffer.from(success.normalizedMedia.base64, "base64")).digest("hex"),
    );
    expect(success.normalizedMedia.mime).toBe("image/png");
    expect(tracker.has("session-1")).toBe(false);
  });

  it("rejects cross-origin posts (403) and never processes the bytes", async () => {
    const { status, body } = await handleAnalyzeRequest(
      analyzeRequest(analyzeForm(GOOD_FIELDS()), "https://evil.example"),
      { mode: "fixture", tracker: new InflightTracker() },
    );
    expect(status).toBe(403);
    expect(body).toMatchObject({ error: { code: "ORIGIN_FORBIDDEN", retryable: false } });
  });

  it("rejects client URLs, model IDs, and system prompts without fetching", async () => {
    for (const field of ["imageUrl", "url", "model", "systemPrompt"]) {
      const { status, body } = await handleAnalyzeRequest(
        analyzeRequest(analyzeForm({ ...GOOD_FIELDS(), extra: { [field]: "https://evil.example/x" } })),
        { mode: "fixture", tracker: new InflightTracker() },
      );
      expect(status).toBe(400);
      expect(body).toMatchObject({ error: { code: "INVALID_MEDIA" } });
      expect(JSON.stringify(body)).toMatch(/never accepted/);
    }
  });

  it("rejects case-variant smuggled fields (MODEL, ImageURL, SYSTEMPROMPT)", async () => {
    for (const field of ["MODEL", "ModelId", "ImageURL", "IMAGE_URL", "URL", "SYSTEMPROMPT", "Prompt"]) {
      const { status, body } = await handleAnalyzeRequest(
        analyzeRequest(analyzeForm({ ...GOOD_FIELDS(), extra: { [field]: "https://evil.example/x" } })),
        { mode: "fixture", tracker: new InflightTracker() },
      );
      expect(status).toBe(400);
      expect(body).toMatchObject({ error: { code: "INVALID_MEDIA" } });
    }
  });

  it("rejects non-multipart posts", async () => {
    const { status } = await handleAnalyzeRequest(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageUrl: "https://evil.example/x" }),
      }),
      { mode: "fixture", tracker: new InflightTracker() },
    );
    expect(status).toBe(400);
  });

  it("rejects unknown items and catalog version mismatches (409)", async () => {
    const unknown = await handleAnalyzeRequest(
      analyzeRequest(analyzeForm({ ...GOOD_FIELDS(), itemId: "nope" })),
      { mode: "fixture", tracker: new InflightTracker() },
    );
    expect(unknown.status).toBe(409);
    expect(unknown.body).toMatchObject({ error: { code: "ITEM_MISMATCH" }, analysisId: "analysis-1" });
    const stale = await handleAnalyzeRequest(
      analyzeRequest(analyzeForm({ ...GOOD_FIELDS(), catalogVersion: "9.9.9" })),
      { mode: "fixture", tracker: new InflightTracker() },
    );
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: "ITEM_MISMATCH" } });
  });

  it("rejects corrupt/unsupported bytes and oversize uploads with the photo kept", async () => {
    const corrupt = await handleAnalyzeRequest(
      analyzeRequest(
        analyzeForm({ ...GOOD_FIELDS(), image: { bytes: asciiBytes("not-an-image"), name: "x.png", type: "image/png" } }),
      ),
      { mode: "fixture", tracker: new InflightTracker() },
    );
    expect(corrupt.status).toBe(415);
    expect(corrupt.body).toMatchObject({ error: { code: "INVALID_MEDIA", retryable: false } });
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    const oversize = await handleAnalyzeRequest(
      analyzeRequest(
        analyzeForm({ ...GOOD_FIELDS(), image: { bytes: big, name: "big.png", type: "image/png" } }),
      ),
      { mode: "fixture", tracker: new InflightTracker() },
    );
    expect(oversize.status).toBe(413);
  });

  it("enforces one active analysis per session (409) and releases the guard", async () => {
    const tracker = new InflightTracker();
    expect(tracker.acquire("session-1", "other-analysis")).toBe(true);
    const busy = await handleAnalyzeRequest(analyzeRequest(analyzeForm(GOOD_FIELDS())), {
      mode: "fixture",
      tracker,
    });
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ error: { code: "REQUEST_IN_PROGRESS", retryable: true } });
    tracker.release("session-1", "other-analysis");
    const freed = await handleAnalyzeRequest(analyzeRequest(analyzeForm(GOOD_FIELDS())), {
      mode: "fixture",
      tracker,
    });
    expect(freed.status).toBe(200);
  });

  it("fails closed in live mode without credentials and never falls back to fixture", async () => {
    const { status, body } = await handleAnalyzeRequest(analyzeRequest(analyzeForm(GOOD_FIELDS())), {
      metaEnv: { APP_ANALYSIS_MODE: "live" },
      tracker: new InflightTracker(),
    });
    expect(status).toBe(503);
    expect(body).toMatchObject({ error: { code: "SETUP_REQUIRED", retryable: false } });
    // No silent fallback: the body carries an error, never a draft.
    expect(JSON.stringify(body)).not.toContain("visibleEvidence");
  });

  it("maps live provider failures to safe errors without leaking the key", async () => {
    const tracker = new InflightTracker();
    const { status, body } = await handleAnalyzeRequest(analyzeRequest(analyzeForm(GOOD_FIELDS())), {
      metaEnv: { ...LIVE_ENV },
      fetchImpl: () => Promise.resolve(mockJsonResponse(500, { error: "boom" })),
      tracker,
    });
    expect(status).toBe(502);
    expect(body).toMatchObject({ error: { code: "PROVIDER_UNAVAILABLE", retryable: true } });
    expect(JSON.stringify(body)).not.toContain("test-key-SECRET-VALUE-9");
    expect(tracker.has("session-1")).toBe(false);
  });

  it("maps live invalid output and timeouts without leaking provider bodies", async () => {
    const invalid = await handleAnalyzeRequest(analyzeRequest(analyzeForm(GOOD_FIELDS())), {
      metaEnv: { ...LIVE_ENV },
      fetchImpl: () =>
        Promise.resolve(
          mockJsonResponse(200, {
            choices: [{ message: { content: JSON.stringify({ verdict: "pass" }) } }],
          }),
        ),
      tracker: new InflightTracker(),
    });
    expect(invalid.status).toBe(502);
    expect(invalid.body).toMatchObject({ error: { code: "INVALID_MODEL_OUTPUT" } });

    const hanging: FetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    const timedOut = await handleAnalyzeRequest(analyzeRequest(analyzeForm(GOOD_FIELDS())), {
      metaEnv: { ...LIVE_ENV },
      fetchImpl: hanging,
      timeoutMs: 50,
      tracker: new InflightTracker(),
    });
    expect(timedOut.status).toBe(504);
    expect(timedOut.body).toMatchObject({ error: { code: "PROVIDER_TIMEOUT", retryable: true } });
  });

  it("rejects misconfigured server mode and corrupt fixtures as safe errors", async () => {
    const badMode = await handleAnalyzeRequest(analyzeRequest(analyzeForm(GOOD_FIELDS())), {
      metaEnv: { APP_ANALYSIS_MODE: "bogus" },
      tracker: new InflightTracker(),
    });
    expect(badMode.status).toBe(503);
    expect(badMode.body).toMatchObject({ error: { code: "SETUP_REQUIRED" } });
    const badFixture = await handleAnalyzeRequest(analyzeRequest(analyzeForm(GOOD_FIELDS())), {
      mode: "fixture",
      tracker: new InflightTracker(),
      fixture: { mode: "fixture", draft: { verdict: "pass" } },
    });
    expect(badFixture.status).toBe(502);
    expect(badFixture.body).toMatchObject({ error: { code: "INVALID_MODEL_OUTPUT" } });
  });

  it("runs the live path end to end over mocked HTTP with provenance from the server", async () => {
    const seen: { url?: string; init?: Parameters<FetchImpl>[1] } = {};
    const { status, body } = await handleAnalyzeRequest(analyzeRequest(analyzeForm(GOOD_FIELDS())), {
      metaEnv: { ...LIVE_ENV },
      fetchImpl: successFetch(seen),
      tracker: new InflightTracker(),
      now: () => 2000,
    });
    expect(status).toBe(200);
    const success = body as { envelope: { mode: string; model: string; requestId: string }; mode: string };
    expect(success.mode).toBe("live");
    expect(success.envelope.mode).toBe("live");
    expect(success.envelope.model).toBe("muse-spark-1.3");
    expect(success.envelope.requestId).toBe("req-test-1");
    expect(seen.url).toBe("https://api.meta.ai/v1/chat/completions");
    expect(JSON.stringify(body)).not.toContain("test-key-SECRET-VALUE-9");
  });
});

describe("same-machine origin aliases (REQ-002, REQ-010)", () => {
  function analyzeRequestTo(target: string, form: FormData, origin?: string): Request {
    const headers: Record<string, string> = {};
    if (origin !== undefined) headers.origin = origin;
    return new Request(target, { method: "POST", headers, body: form });
  }

  it("allows 127.0.0.1<->localhost in either direction with matching scheme and port", async () => {
    const first = await handleAnalyzeRequest(
      analyzeRequestTo(
        "http://localhost:3100/api/analyze",
        analyzeForm(GOOD_FIELDS()),
        "http://127.0.0.1:3100",
      ),
      { mode: "fixture", tracker: new InflightTracker(), generateRequestId: () => "fixture-loopback-1" },
    );
    expect(first.status).toBe(200);
    const second = await handleAnalyzeRequest(
      analyzeRequestTo(
        "http://127.0.0.1:3100/api/analyze",
        analyzeForm(GOOD_FIELDS()),
        "http://localhost:3100",
      ),
      { mode: "fixture", tracker: new InflightTracker(), generateRequestId: () => "fixture-loopback-2" },
    );
    expect(second.status).toBe(200);
  });

  it("allows the ::1 loopback alias with matching scheme and port", async () => {
    const first = await handleAnalyzeRequest(
      analyzeRequestTo("http://localhost:3100/api/analyze", analyzeForm(GOOD_FIELDS()), "http://[::1]:3100"),
      { mode: "fixture", tracker: new InflightTracker(), generateRequestId: () => "fixture-loopback-3" },
    );
    expect(first.status).toBe(200);
    const second = await handleAnalyzeRequest(
      analyzeRequestTo("http://[::1]:3100/api/analyze", analyzeForm(GOOD_FIELDS()), "http://127.0.0.1:3100"),
      { mode: "fixture", tracker: new InflightTracker(), generateRequestId: () => "fixture-loopback-4" },
    );
    expect(second.status).toBe(200);
  });

  it("rejects cross-host, cross-port, and cross-scheme origins (403)", async () => {
    const evil = await handleAnalyzeRequest(
      analyzeRequestTo("http://localhost:3100/api/analyze", analyzeForm(GOOD_FIELDS()), "http://evil.com:3100"),
      { mode: "fixture", tracker: new InflightTracker() },
    );
    expect(evil.status).toBe(403);
    expect(evil.body).toMatchObject({ error: { code: "ORIGIN_FORBIDDEN", retryable: false } });

    const wrongPort = await handleAnalyzeRequest(
      analyzeRequestTo("http://localhost:3100/api/analyze", analyzeForm(GOOD_FIELDS()), "http://127.0.0.1:3101"),
      { mode: "fixture", tracker: new InflightTracker() },
    );
    expect(wrongPort.status).toBe(403);
    expect(wrongPort.body).toMatchObject({ error: { code: "ORIGIN_FORBIDDEN" } });

    const wrongScheme = await handleAnalyzeRequest(
      analyzeRequestTo("http://localhost:3100/api/analyze", analyzeForm(GOOD_FIELDS()), "https://localhost:3100"),
      { mode: "fixture", tracker: new InflightTracker() },
    );
    expect(wrongScheme.status).toBe(403);
    expect(wrongScheme.body).toMatchObject({ error: { code: "ORIGIN_FORBIDDEN" } });
  });

  it("allows requests without an Origin header (non-browser clients)", async () => {
    const { status } = await handleAnalyzeRequest(
      analyzeRequestTo("http://localhost:3100/api/analyze", analyzeForm(GOOD_FIELDS())),
      { mode: "fixture", tracker: new InflightTracker(), generateRequestId: () => "fixture-loopback-5" },
    );
    expect(status).toBe(200);
  });
});
