import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  handleVideoSegmentRequest,
  makeMuseSampleTimestamps,
  META_UPLOAD_EXPIRY_SECONDS,
  MUSE_BASETEN_MODEL,
  MUSE_VIDEO_MODEL,
  SAM_VIDEO_MODEL,
  VIDEO_PROMPTS,
  type VideoDraftSuggestion,
  type VideoRequestIdentity,
} from "../../../../src/server/video/meta-sam";
import {
  MAX_MULTIPART_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_FRAMES,
  validateVideoBytes,
} from "../../../../src/server/video/validate";
import { MOVE_IN_READY_ELEMENTS, MOVE_IN_READY_ELEMENT_IDS, MOVE_IN_READY_SCHEMA_VERSION } from "../../../../src/domain/move-in-ready";
import { VideoSegmentError } from "../../../../src/server/video/errors";
import { claimVideoProcessing, claimVideoSegmentation } from "../../../../src/server/video/operation-guard";

const ORIGIN = "https://walkthrough.example";
const LIVE_ENV = { APP_ANALYSIS_MODE: "live", META_API_KEY: "server-only-test-key" };
const IDENTITY_BASE = {
  sessionId: "session-demo",
  schemaVersion: String(MOVE_IN_READY_SCHEMA_VERSION),
  videoId: "video-demo",
  videoRevision: "1",
  analysisId: "analysis-attempt-1",
  attempt: "1",
  catalogVersion: "0.3.0-demo.3",
};

function identityFor(label: string, overrides: Partial<typeof IDENTITY_BASE> = {}): Partial<typeof IDENTITY_BASE> {
  return {
    sessionId: `session-${label}`,
    videoId: `video-${label}`,
    analysisId: `analysis-${label}`,
    ...overrides,
  };
}
const PNG_STILL = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/4u0AAAAASUVORK5CYII=",
  "base64",
));
const JPEG_STILL = new Uint8Array(Buffer.from(
  "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzU5LjM3LjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z",
  "base64",
));

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

const SERVER_JPEG_STILL = concat(
  JPEG_STILL.slice(0, 2),
  new Uint8Array([0xff, 0xe1, 0x00, 0x02]),
  JPEG_STILL.slice(2),
);

function u32(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, false);
  return result;
}

function i32(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setInt32(0, value, false);
  return result;
}

function ascii(value: string): Uint8Array {
  return new Uint8Array(Array.from(value, (character) => character.charCodeAt(0)));
}

function box(type: string, payload: Uint8Array): Uint8Array {
  return concat(u32(payload.byteLength + 8), ascii(type), payload);
}

function makeMp4(
  durationMs = 1_000,
  sampleCount = 2,
  brand = "isom",
  compatibleBrand = "mp42",
  compositionOffsetsTicks?: number[],
  sampleEntryType = "avc1",
  handlerType = "vide",
): Uint8Array {
  const ftyp = box("ftyp", concat(ascii(brand), u32(0), ascii(brand), ascii(compatibleBrand)));

  const mdhdPayload = new Uint8Array(24);
  const mdhdView = new DataView(mdhdPayload.buffer);
  mdhdView.setUint32(12, 1_000, false);
  mdhdView.setUint32(16, durationMs, false);
  const mdhd = box("mdhd", mdhdPayload);

  const hdlrPayload = new Uint8Array(12);
  hdlrPayload.set(ascii(handlerType), 8);
  const hdlr = box("hdlr", hdlrPayload);

  const sampleEntry = box(sampleEntryType, new Uint8Array(78));
  const stsd = box("stsd", concat(new Uint8Array(4), u32(1), sampleEntry));
  const stts = box("stts", concat(new Uint8Array(4), u32(1), u32(sampleCount), u32(durationMs / sampleCount)));
  const ctts = compositionOffsetsTicks
    ? box("ctts", concat(
        new Uint8Array([1, 0, 0, 0]),
        u32(compositionOffsetsTicks.length),
        ...compositionOffsetsTicks.flatMap((offset) => [u32(1), i32(offset)]),
      ))
    : undefined;
  const stbl = box("stbl", concat(stsd, stts, ...(ctts ? [ctts] : [])));
  const minf = box("minf", stbl);
  const mdia = box("mdia", concat(mdhd, hdlr, minf));
  const trak = box("trak", mdia);
  const moov = box("moov", trak);
  const mdat = box("mdat", new Uint8Array([0x00]));
  return concat(ftyp, moov, mdat);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function requestFor(
  options: {
    stage?: "segment" | "map";
    room?: string;
    bytes?: Uint8Array;
    origin?: string;
    contentLength?: string;
    expectedHash?: string;
    identity?: Partial<typeof IDENTITY_BASE>;
  } = {},
): Request {
  const stage = options.stage ?? "segment";
  const bytes = options.bytes ?? makeMp4();
  const form = new FormData();
  form.append("stage", stage);
  form.append("room", options.room ?? "kitchen");
  form.append("video", new File([bytes], "client-name.mp4", { type: "video/mp4" }));
  form.append("sessionId", options.identity?.sessionId ?? IDENTITY_BASE.sessionId);
  form.append("schemaVersion", options.identity?.schemaVersion ?? IDENTITY_BASE.schemaVersion);
  form.append("videoId", options.identity?.videoId ?? IDENTITY_BASE.videoId);
  form.append("videoRevision", options.identity?.videoRevision ?? IDENTITY_BASE.videoRevision);
  form.append("analysisId", options.identity?.analysisId ?? IDENTITY_BASE.analysisId);
  form.append("attempt", options.identity?.attempt ?? IDENTITY_BASE.attempt);
  form.append("catalogVersion", options.identity?.catalogVersion ?? IDENTITY_BASE.catalogVersion);
  form.append("expectedVideoSha256", options.expectedHash ?? sha256(bytes));
  const headers = new Headers({ origin: options.origin ?? ORIGIN });
  headers.set("content-length", options.contentLength ?? "65536");
  return new Request(`${ORIGIN}/api/video/segment?stage=${stage}`, { method: "POST", headers, body: form });
}

function mappingRequest(
  segment: Record<string, unknown>,
  options: {
    origin?: string;
    changedAnalysisId?: string;
    schemaVersion?: string;
    omitSchemaVersion?: boolean;
    catalogVersion?: string;
    omitCatalogVersion?: boolean;
    candidateToken?: string;
    tamperedCandidateStill?: boolean;
    tamperedSampleStill?: boolean;
  } = {},
): Request {
  const identity = segment.identity as VideoRequestIdentity;
  const form = new FormData();
  form.append("stage", "map");
  form.append("room", String(segment.room));
  form.append("sessionId", identity.sessionId);
  if (!options.omitSchemaVersion) form.append("schemaVersion", options.schemaVersion ?? String(identity.schemaVersion));
  form.append("videoId", identity.videoId);
  form.append("videoRevision", String(identity.videoRevision));
  form.append("analysisId", options.changedAnalysisId ?? identity.analysisId);
  form.append("attempt", String(identity.attempt));
  if (!options.omitCatalogVersion) form.append("catalogVersion", options.catalogVersion ?? identity.catalogVersion);
  form.append("expectedVideoSha256", identity.expectedVideoSha256);
  form.append("candidateToken", options.candidateToken ?? String(segment.candidateToken));
  if (options.tamperedCandidateStill) form.append("still", new File([PNG_STILL], "cand-0001.png", { type: "image/png" }));
  if (options.tamperedSampleStill) form.append("sampleStill", new File([JPEG_STILL], "sample-00.jpg", { type: "image/jpeg" }));
  const headers = new Headers({ origin: options.origin ?? ORIGIN, "content-length": "65536" });
  return new Request(`${ORIGIN}/api/video/segment?stage=map`, { method: "POST", headers, body: form });
}

function candidateTokenWithVersion(
  candidateToken: string,
  key: "schemaVersion" | "catalogVersion",
  value: number | string | undefined,
): string {
  const [encoded] = candidateToken.split(".");
  if (!encoded) throw new Error("Candidate token had no payload.");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
    identity: Record<string, unknown>;
  };
  if (value === undefined) delete payload.identity[key];
  else payload.identity[key] = value;
  const nextEncoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", LIVE_ENV.META_API_KEY)
    .update(`video-candidate-v2.${nextEncoded}`)
    .digest("base64url");
  return `${nextEncoded}.${signature}`;
}

function cancellationRequest(
  segment: Record<string, unknown>,
  overrides: { origin?: string; candidateToken?: string } = {},
): Request {
  const identity = segment.identity as VideoRequestIdentity;
  const form = new FormData();
  form.append("stage", "cancel");
  form.append("sessionId", identity.sessionId);
  form.append("schemaVersion", String(identity.schemaVersion));
  form.append("videoId", identity.videoId);
  form.append("videoRevision", String(identity.videoRevision));
  form.append("analysisId", identity.analysisId);
  form.append("attempt", String(identity.attempt));
  form.append("catalogVersion", identity.catalogVersion);
  form.append("expectedVideoSha256", identity.expectedVideoSha256);
  form.append("candidateToken", overrides.candidateToken ?? String(segment.candidateToken));
  const headers = new Headers({ origin: overrides.origin ?? ORIGIN, "content-length": "65536" });
  return new Request(`${ORIGIN}/api/video/segment?stage=cancel`, { method: "POST", headers, body: form });
}

function identityOnlyCancellationRequest(
  segment: Record<string, unknown>,
  overrides: { origin?: string; videoId?: string } = {},
): Request {
  const identity = segment.identity as VideoRequestIdentity;
  const form = new FormData();
  form.append("stage", "cancel");
  form.append("sessionId", identity.sessionId);
  form.append("schemaVersion", String(identity.schemaVersion));
  form.append("videoId", overrides.videoId ?? identity.videoId);
  form.append("videoRevision", String(identity.videoRevision));
  form.append("analysisId", identity.analysisId);
  form.append("attempt", String(identity.attempt));
  form.append("catalogVersion", identity.catalogVersion);
  form.append("expectedVideoSha256", identity.expectedVideoSha256);
  const headers = new Headers({ origin: overrides.origin ?? ORIGIN, "content-length": "65536" });
  return new Request(`${ORIGIN}/api/video/segment?stage=cancel`, { method: "POST", headers, body: form });
}

function proxiedCancellationRequest(segment: Record<string, unknown>, origin: string): Request {
  const identity = segment.identity as VideoRequestIdentity;
  const form = new FormData();
  form.append("stage", "cancel");
  form.append("sessionId", identity.sessionId);
  form.append("schemaVersion", String(identity.schemaVersion));
  form.append("videoId", identity.videoId);
  form.append("videoRevision", String(identity.videoRevision));
  form.append("analysisId", identity.analysisId);
  form.append("attempt", String(identity.attempt));
  form.append("catalogVersion", identity.catalogVersion);
  form.append("expectedVideoSha256", identity.expectedVideoSha256);
  return new Request("http://127.0.0.1:3100/api/video/segment?stage=cancel", {
    method: "POST",
    headers: { origin, "content-length": "65536" },
    body: form,
  });
}

const samOutput =
  "<0f>3<|box;x1=10;y1=20;x2=30;y2=40;w=320;h=334|>" +
  "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>";
const samOutputWithTwoDetections = samOutput +
  ",4<|box;x1=40;y1=50;x2=90;y2=100;w=320;h=334|>" +
  "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>";

function streamResponse(text = samOutput): Response {
  const lane = { item_id: "provider-item-id", output_index: 0, content_index: 0 };
  const events = [
    { type: "response.output_text.delta", ...lane, delta: text },
    { type: "response.content_part.done", ...lane, part: { type: "output_text", text } },
    { type: "response.completed" },
  ];
  const sse = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function mockMetaFetch(options: { fileId?: string; stream?: Response | (() => Response); museText?: string } = {}) {
  const calls: Array<{ url: string; init?: RequestInit; payload?: Record<string, unknown> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    let payload: Record<string, unknown> | undefined;
    if (typeof init?.body === "string") payload = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ url, init, payload });
    if (url.endsWith("/files")) {
      if (!(init?.body instanceof FormData)) throw new Error("expected upload form");
      return Response.json({ id: options.fileId ?? "file-provider-secret-987" });
    }
    if (url.endsWith("/responses") && payload?.model === SAM_VIDEO_MODEL) {
      return typeof options.stream === "function" ? options.stream() : options.stream ?? streamResponse();
    }
    if (url.endsWith("/responses") && payload?.model === MUSE_VIDEO_MODEL) {
      const defaultOutput = {
        proposals: [{
          elementId: "demo-water-supply",
          modelSuggestion: "A",
          observation: "A faucet is visible in the selected frames.",
          confidence: 74,
          evidenceCandidateIds: ["cand-0001"],
          deficiencySuggestion: null,
        }],
      };
      return Response.json({ status: "completed", output_text: options.museText ?? JSON.stringify(defaultOutput) });
    }
    throw new Error("unexpected endpoint");
  };
  return { calls, fetchImpl };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

type VideoHandlerDependencies = NonNullable<Parameters<typeof handleVideoSegmentRequest>[1]>;
const testSourceFrameDecoder: NonNullable<VideoHandlerDependencies["decodeSourceFrames"]> = async (
  _videoBytes,
  frameIndexes,
  _timestampsMs,
  signal,
) => {
  if (signal.aborted) throw new Error("aborted");
  return frameIndexes.map(() => new Uint8Array(SERVER_JPEG_STILL));
};

function handleMap(
  segmentBody: Record<string, unknown>,
  deps: VideoHandlerDependencies = {},
): Promise<Response> {
  return handleVideoSegmentRequest(mappingRequest(segmentBody), {
    ...deps,
    decodeSourceFrames: deps.decodeSourceFrames ?? testSourceFrameDecoder,
  });
}

async function segment(
  options: Parameters<typeof requestFor>[0] = {},
  fetchImpl: typeof fetch,
  decodeSourceFrames: NonNullable<VideoHandlerDependencies["decodeSourceFrames"]> = testSourceFrameDecoder,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await handleVideoSegmentRequest(requestFor(options), {
    env: LIVE_ENV,
    fetch: fetchImpl,
    decodeSourceFrames,
  });
  return { response, body: await json(response) };
}

describe("SAM video upload validation", () => {
  it("keeps every stable checklist element reachable from its fixed room prompts", () => {
    const reachableIds = new Set(Object.values(VIDEO_PROMPTS).flat().map(({ elementId }) => elementId));

    expect(MOVE_IN_READY_ELEMENT_IDS).toHaveLength(11);
    expect([...reachableIds].sort()).toEqual([...MOVE_IN_READY_ELEMENT_IDS].sort());
    for (const element of MOVE_IN_READY_ELEMENTS) {
      expect(element.roomIds.some((room) => VIDEO_PROMPTS[room].some((prompt) => prompt.elementId === element.id))).toBe(true);
    }

    expect(VIDEO_PROMPTS.kitchen.filter(({ elementId }) => elementId === "demo-item-05" || elementId === "demo-item-11"))
      .toEqual([
        { elementId: "demo-item-05", concept: "wall surface" },
        { elementId: "demo-item-11", concept: "countertop" },
      ]);
  });

  it("gives each room concept a bounded candidate before sampling second detections", async () => {
    const { fetchImpl } = mockMetaFetch({ stream: () => streamResponse(samOutputWithTwoDetections) });
    const { response, body } = await segment(
      { room: "kitchen", identity: identityFor("candidate-concept-coverage") },
      fetchImpl,
    );
    const candidates = body.candidates as VideoDraftSuggestion[];

    expect(response.status).toBe(200);
    expect(candidates).toHaveLength(12);
    for (const prompt of VIDEO_PROMPTS.kitchen) {
      const matchingCandidates = candidates.filter((candidate) =>
        candidate.elementId === prompt.elementId && candidate.concept === prompt.concept,
      );
      expect(matchingCandidates.length).toBeGreaterThan(0);
      expect(matchingCandidates.length).toBeLessThanOrEqual(2);
    }
  });

  it("accepts structurally valid MP4 and MOV and derives source frame timestamps", () => {
    const mp4 = validateVideoBytes(makeMp4());
    expect(mp4).toMatchObject({ container: "mp4", mimeType: "video/mp4", durationMs: 1_000 });
    expect(mp4.frameTimestampsMs).toEqual([0, 500]);

    const mov = validateVideoBytes(makeMp4(1_000, 2, "qt  "));
    expect(mov).toMatchObject({ container: "mov", mimeType: "video/quicktime" });

    const phoneCompatibleMp4 = validateVideoBytes(makeMp4(1_000, 2, "mif1", "cmfc"));
    expect(phoneCompatibleMp4).toMatchObject({ container: "mp4", mimeType: "video/mp4" });
  });

  it("orders B-frame timestamps by presentation time and rejects ambiguous PTS", () => {
    // Decode-order DTS is 0, 250, 500, 750ms; signed ctts offsets yield
    // presentation order 0, 250, 500, 750ms from decode order 0, 750, 250, 500.
    const reordered = validateVideoBytes(makeMp4(1_000, 4, "isom", "mp42", [0, 500, -250, -250]));
    expect(reordered.frameTimestampsMs).toEqual([0, 250, 500, 750]);

    const duplicatePts = makeMp4(1_000, 2, "isom", "mp42", [500, 0]);
    expect(() => validateVideoBytes(duplicatePts)).toThrow(/ambiguous|invalid presentation/i);
  });

  it("caps composition-offset entries and still accepts ordinary timing tables", () => {
    const normalCtts = makeMp4(1_000, 4, "isom", "mp42", [0, 500, -250, -250]);
    expect(validateVideoBytes(normalCtts).frameTimestampsMs).toEqual([0, 250, 500, 750]);

    // Zero-sample runs are malformed/unnecessary but fit the byte limit; the
    // parser must reject them by entry count before walking the table.
    const excessiveCtts = makeMp4(
      1_000,
      2,
      "isom",
      "mp42",
      Array.from({ length: MAX_VIDEO_FRAMES + 1 }, () => 0),
    );
    let caught: unknown;
    try {
      validateVideoBytes(excessiveCtts);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ status: 413, code: "VIDEO_TOO_LARGE" });
  });

  it("rejects unsupported signatures, malformed atoms, and clips longer than 30 seconds", () => {
    expect(() => validateVideoBytes(ascii("webm bytes"))).toThrow(/MP4 or MOV/);
    expect(() => validateVideoBytes(makeMp4().slice(0, 20))).toThrow(/incomplete|corrupt|truncated/i);
    expect(() => validateVideoBytes(makeMp4(31_000, 2))).toThrow(/30 seconds/);
    expect(MAX_VIDEO_BYTES).toBe(60 * 1024 * 1024);
    expect(MAX_MULTIPART_BYTES).toBeGreaterThan(MAX_VIDEO_BYTES);
  });

  it("rejects unsupported video codecs and audio-only tracks with a 415 before provider work", () => {
    const vp09 = makeMp4(1_000, 2, "isom", "mp42", undefined, "vp09");
    let codecError: unknown;
    try {
      validateVideoBytes(vp09);
    } catch (error) {
      codecError = error;
    }
    expect(codecError).toMatchObject({ status: 415, code: "UNSUPPORTED_VIDEO" });

    const audioOnly = makeMp4(1_000, 2, "isom", "mp42", undefined, "avc1", "soun");
    let trackError: unknown;
    try {
      validateVideoBytes(audioOnly);
    } catch (error) {
      trackError = error;
    }
    expect(trackError).toMatchObject({ status: 415, code: "UNSUPPORTED_VIDEO" });
  });
});

describe("POST /api/video/segment", () => {
  it("keeps PDF-supported visual concepts fixed and within the per-room candidate bound", () => {
    expect(Object.values(VIDEO_PROMPTS).every((prompts) => prompts.length <= 6)).toBe(true);
    expect(VIDEO_PROMPTS.kitchen).toEqual(expect.arrayContaining([
      { elementId: "demo-item-10", concept: "refuse bin" },
      { elementId: "demo-smoke-co", concept: "carbon monoxide detector" },
    ]));
    expect(VIDEO_PROMPTS.bathroom).toContainEqual({ elementId: "demo-smoke-co", concept: "carbon monoxide detector" });
    expect(VIDEO_PROMPTS["bedroom-living"]).toEqual(expect.arrayContaining([
      { elementId: "demo-item-09", concept: "heating equipment" },
      { elementId: "demo-item-09", concept: "air conditioning unit" },
      { elementId: "demo-smoke-co", concept: "carbon monoxide detector" },
    ]));
    expect(VIDEO_PROMPTS.hallway).toEqual(expect.arrayContaining([
      { elementId: "demo-item-06", concept: "secondary exit" },
      { elementId: "demo-item-06", concept: "fire escape window" },
      { elementId: "demo-smoke-co", concept: "carbon monoxide detector" },
    ]));
  });

  it("rejects excess segment and map requests before parsing their multipart bodies", async () => {
    const first = claimVideoProcessing();
    const second = claimVideoProcessing();
    try {
      for (const stage of ["segment", "map"] as const) {
        const request = requestFor({ stage });
        const formData = vi.spyOn(request, "formData");
        const response = await handleVideoSegmentRequest(request, { env: LIVE_ENV });

        expect(response.status).toBe(429);
        expect(await json(response)).toMatchObject({
          ok: false,
          error: {
            code: "PROCESSING_BUSY",
            message: "Video processing is busy. Wait briefly and try again.",
          },
        });
        expect(formData).not.toHaveBeenCalled();
      }
    } finally {
      first.release();
      second.release();
    }
  });

  it("rejects oversized streamed multipart bytes even when Content-Length is understated", async () => {
    const form = new FormData();
    form.append("stage", "map");
    form.append("oversized", new File([new Uint8Array(512 * 1024)], "oversized.bin"));
    const request = new Request(`${ORIGIN}/api/video/segment?stage=map`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-length": "1" },
      body: form,
    });
    const { calls, fetchImpl } = mockMetaFetch();

    const response = await handleVideoSegmentRequest(request, { env: LIVE_ENV, fetch: fetchImpl });

    expect(response.status).toBe(413);
    expect(await json(response)).toMatchObject({
      ok: false,
      error: { code: "VIDEO_TOO_LARGE" },
    });
    expect(calls).toHaveLength(0);
  });

  it("aborts a stalled multipart body and releases its global admission slot", async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    const request = new Request(`${ORIGIN}/api/video/segment?stage=map`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "multipart/form-data; boundary=slow-upload",
        "content-length": "1",
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("--slow-upload\r\n"));
        },
        cancel() {
          cancelled = true;
        },
      }),
      duplex: "half",
    } as RequestInit);
    const fetchImpl = vi.fn<typeof fetch>();

    const response = await handleVideoSegmentRequest(request, {
      env: LIVE_ENV,
      fetch: fetchImpl,
      requestTimeoutMs: 20,
    });

    expect(response.status).toBe(504);
    expect(await json(response)).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_TIMEOUT" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(cancelled).toBe(true);

    const first = claimVideoProcessing();
    const second = claimVideoProcessing();
    try {
      expect(() => claimVideoProcessing()).toThrowError(/processing is busy/i);
    } finally {
      first.release();
      second.release();
    }
  });

  it("does not retain a segmentation or mapping lease when the full request times out", async () => {
    const bytes = makeMp4();
    const operationIdentity = {
      sessionId: "session-timeout-cleanup",
      schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
      videoId: "video-timeout-cleanup",
      videoRevision: 1,
      analysisId: "analysis-timeout-cleanup",
      attempt: 1,
      catalogVersion: IDENTITY_BASE.catalogVersion,
      expectedVideoSha256: sha256(bytes),
    };
    let decoderCalls = 0;
    const slowDecoder: NonNullable<VideoHandlerDependencies["decodeSourceFrames"]> = async (
      _videoBytes,
      frameIndexes,
      timestampsMs,
      signal,
    ) => {
      expect(timestampsMs).toHaveLength(frameIndexes.length);
      expect(signal).toBeInstanceOf(AbortSignal);
      decoderCalls += 1;
      if (decoderCalls === 2) await new Promise((resolve) => setTimeout(resolve, 600));
      return frameIndexes.map(() => new Uint8Array(SERVER_JPEG_STILL));
    };
    const { fetchImpl } = mockMetaFetch();
    const response = await handleVideoSegmentRequest(requestFor({
      bytes,
      identity: {
        sessionId: operationIdentity.sessionId,
        videoId: operationIdentity.videoId,
        analysisId: operationIdentity.analysisId,
        attempt: String(operationIdentity.attempt),
      },
    }), {
      env: LIVE_ENV,
      fetch: fetchImpl,
      decodeSourceFrames: slowDecoder,
      requestTimeoutMs: 500,
    });

    expect(response.status).toBe(504);
    expect(await json(response)).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_TIMEOUT" },
    });
    expect(decoderCalls).toBeGreaterThanOrEqual(1);

    const retry = claimVideoSegmentation({ ...operationIdentity, attempt: 2 });
    retry.complete();
  });

  it("creates a bounded one-frame-per-second source sample schedule", () => {
    expect(makeMuseSampleTimestamps(1_000)).toEqual([500]);
    expect(makeMuseSampleTimestamps(2_500)).toEqual([500, 1_500, 2_250]);
    expect(makeMuseSampleTimestamps(30_000)).toHaveLength(30);
    expect(makeMuseSampleTimestamps(30_001)).toEqual([]);
  });

  it("uploads an MP4 once and segments it with one fixed-concept request per room prompt", async () => {
    const { calls, fetchImpl } = mockMetaFetch();
    const mp4Bytes = makeMp4();
    const { response, body } = await segment({ bytes: mp4Bytes, identity: identityFor("sam-mp4") }, fetchImpl);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      stage: "segmented",
      room: "kitchen",
      mappingRequired: true,
      humanReviewRequired: true,
      conditionAssessment: "not_assessed",
      media: { container: "mp4", sourceVideoSha256: sha256(mp4Bytes) },
    });
    expect(body.sampleTimestampsMs).toEqual([500]);
    expect(body.identity).toMatchObject({
      sessionId: "session-sam-mp4",
      videoId: "video-sam-mp4",
      videoRevision: 1,
      analysisId: "analysis-sam-mp4",
      attempt: 1,
      catalogVersion: IDENTITY_BASE.catalogVersion,
      expectedVideoSha256: sha256(mp4Bytes),
    });
    expect(calls).toHaveLength(1 + VIDEO_PROMPTS.kitchen.length);
    expect(calls[0]?.url).toBe("https://api.meta.ai/v1/files");
    const form = calls[0]?.init?.body as FormData;
    expect(form.get("purpose")).toBe("user_data");
    expect(form.get("expires_after[anchor]")).toBe("created_at");
    expect(form.get("expires_after[seconds]")).toBe(String(META_UPLOAD_EXPIRY_SECONDS));
    expect((form.get("file") as File).type).toBe("video/mp4");

    for (const [index, call] of calls.slice(1).entries()) {
      expect(call.url).toBe("https://api.meta.ai/v1/responses");
      const payload = call.payload as {
        model: string;
        stream: boolean;
        store: boolean;
        input: Array<{ content: Array<{ type: string; text?: string; file_id?: string }> }>;
      };
      expect(payload.model).toBe("sam-3.1");
      expect(payload.stream).toBe(true);
      expect(payload.store).toBe(false);
      expect(payload.input[0]?.content).toEqual([
        { type: "input_text", text: VIDEO_PROMPTS.kitchen[index]?.concept },
        { type: "input_video", file_id: "file-provider-secret-987" },
      ]);
      const serializedPayload = JSON.stringify(payload);
      expect(serializedPayload).not.toContain(IDENTITY_BASE.sessionId);
      expect(serializedPayload).not.toContain(IDENTITY_BASE.videoId);
      expect(serializedPayload).not.toContain(IDENTITY_BASE.analysisId);
    }

    const responseText = JSON.stringify(body);
    expect(responseText).not.toContain("server-only-test-key");
    expect(responseText).not.toContain("file-provider-secret-987");
    expect(responseText).not.toContain("provider-item-id");
    const candidates = body.candidates as VideoDraftSuggestion[];
    expect(candidates).toHaveLength(VIDEO_PROMPTS.kitchen.length);
    expect(candidates[0]).toMatchObject({
      candidateId: "cand-0001",
      elementId: "demo-water-supply",
      evidence: { frameIndex: 0, timestampMs: 0 },
    });
    expect(body.candidateToken).toEqual(expect.any(String));
  });

  it("preflights the first source frame before Meta and reuses it for mapped evidence", async () => {
    const { calls, fetchImpl: metaFetch } = mockMetaFetch();
    const events: string[] = [];
    const frameSelections: number[][] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      events.push("provider");
      return metaFetch(input, init);
    };
    const decodeSourceFrames: NonNullable<VideoHandlerDependencies["decodeSourceFrames"]> = async (
      _videoBytes,
      frameIndexes,
      _timestamps,
      signal,
    ) => {
      if (signal.aborted) throw new Error("aborted");
      events.push("decode");
      frameSelections.push([...frameIndexes]);
      return frameIndexes.map(() => new Uint8Array(SERVER_JPEG_STILL));
    };

    const { response } = await segment(
      { identity: identityFor("ffmpeg-preflight-order") },
      fetchImpl,
      decodeSourceFrames,
    );

    expect(response.status).toBe(200);
    expect(events[0]).toBe("decode");
    expect(frameSelections).toEqual([[0], [1]]);
    expect(calls).toHaveLength(1 + VIDEO_PROMPTS.kitchen.length);
  });

  it("does not contact Meta when the FFmpeg executable is unavailable", async () => {
    const { calls, fetchImpl } = mockMetaFetch();
    const { response, body } = await segment(
      { identity: identityFor("ffmpeg-preflight-missing") },
      fetchImpl,
      async () => {
        throw new VideoSegmentError(
          503,
          "SETUP_REQUIRED",
          "Server-side video frame verification is unavailable.",
        );
      },
    );

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ ok: false, error: { code: "SETUP_REQUIRED" } });
    expect(calls).toHaveLength(0);
  });

  it("does not contact Meta when FFmpeg cannot decode the uploaded source frame", async () => {
    const { calls, fetchImpl } = mockMetaFetch();
    const { response, body } = await segment(
      { identity: identityFor("ffmpeg-preflight-decode-failure") },
      fetchImpl,
      async () => {
        throw new VideoSegmentError(422, "INVALID_VIDEO", "The source video could not be decoded.");
      },
    );

    expect(response.status).toBe(422);
    expect(body).toMatchObject({ ok: false, error: { code: "INVALID_VIDEO" } });
    expect(calls).toHaveLength(0);
  });

  it("completes a no-detection review without creating a mapping lease or a Muse call", async () => {
    const { fetchImpl: segmentFetch } = mockMetaFetch({ stream: () => streamResponse("No detections.") });
    const segmented = await segment({ identity: identityFor("no-detections") }, segmentFetch);
    expect(segmented.response.status).toBe(200);
    expect(segmented.body.candidates).toEqual([]);
    expect(segmented.body).toMatchObject({ mappingRequired: false });
    expect(segmented.body.candidateToken).toBeUndefined();
    expect(segmented.body.mappingExpiresAt).toBeUndefined();

    const cancelled = await handleVideoSegmentRequest(identityOnlyCancellationRequest(segmented.body));
    expect(cancelled.status).toBe(200);
    expect(await json(cancelled)).toMatchObject({ ok: true, stage: "cancelled", released: false });
  });

  it("rejects a QuickTime MOV before making a provider request", async () => {
    const { calls, fetchImpl } = mockMetaFetch();
    const movBytes = makeMp4(1_000, 2, "qt  ");
    const { response, body } = await segment({ bytes: movBytes, identity: identityFor("sam-mov") }, fetchImpl);

    expect(response.status).toBe(415);
    expect(body).toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_VIDEO",
        message: "Meta's current video upload API accepts MP4 only. Convert this MOV to MP4 before live analysis.",
      },
    });
    expect(calls).toHaveLength(0);
  });

  it("maps only signed SAM candidates with one Muse request using exact-seek still images", async () => {
    const { calls: segmentCalls, fetchImpl: segmentFetch } = mockMetaFetch();
    const segmented = await segment({ identity: identityFor("mapping") }, segmentFetch);
    expect(segmented.response.status).toBe(200);
    expect(segmented.response.headers.get("cache-control")).toContain("no-store");
    const candidate = (segmented.body.candidates as VideoDraftSuggestion[])[0]!;
    const { calls: mappingCalls, fetchImpl: mappingFetch } = mockMetaFetch();
    const mappedResponse = await handleMap(segmented.body, { env: LIVE_ENV, fetch: mappingFetch });
    const mapped = await json(mappedResponse);

    expect(segmentCalls).toHaveLength(1 + VIDEO_PROMPTS.kitchen.length);
    expect(mappedResponse.status).toBe(200);
    expect(mappedResponse.headers.get("cache-control")).toContain("no-store");
    expect(mappedResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mapped).toMatchObject({
      ok: true,
      stage: "mapped",
      models: { segmentation: SAM_VIDEO_MODEL, mapping: MUSE_VIDEO_MODEL },
      room: "kitchen",
      identity: segmented.body.identity,
      media: segmented.body.media,
      humanReviewRequired: true,
      conditionAssessment: "not_assessed",
    });
    expect(mappingCalls).toHaveLength(1);
    expect(mappingCalls[0]?.url).toBe("https://api.meta.ai/v1/responses");
    const payload = mappingCalls[0]?.payload as {
      model: string;
      input: Array<{ content: Array<{ type: string; text?: string; image_url?: string; file_id?: string }> }>;
      text: { format: { type: string; strict: boolean; schema: { additionalProperties: boolean } } };
      store: boolean;
    };
    expect(payload.model).toBe(MUSE_VIDEO_MODEL);
    expect(payload.store).toBe(false);
    expect(payload.text.format).toMatchObject({ type: "json_schema", strict: true, schema: { additionalProperties: false } });
    const content = payload.input[0]?.content ?? [];
    expect(content[0]?.type).toBe("input_text");
    const candidateCount = (segmented.body.candidates as VideoDraftSuggestion[]).length;
    expect(content.slice(1)).toHaveLength(candidateCount + (segmented.body.sampleTimestampsMs as number[]).length);
    expect(content.slice(1, candidateCount + 1).every((part) => part.type === "input_image" && part.image_url?.startsWith("data:image/jpeg;base64,"))).toBe(true);
    expect(content.slice(candidateCount + 1).every((part) => part.type === "input_image" && part.image_url?.startsWith("data:image/jpeg;base64,"))).toBe(true);
    expect(content.some((part) => part.file_id !== undefined)).toBe(false);
    const text = JSON.parse(content[0]?.text ?? "{}") as { room: string; currentDate: string; imageOrder: string[]; sampleImageOrder: unknown[]; samCandidates: unknown[]; catalog: unknown[] };
    expect(text.room).toBe("kitchen");
    expect(text.currentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(text.imageOrder[0]).toBe(candidate.candidateId);
    expect(text.sampleImageOrder).toHaveLength((segmented.body.sampleTimestampsMs as number[]).length);
    expect(text.samCandidates).toHaveLength((segmented.body.candidates as VideoDraftSuggestion[]).length);
    expect(text.catalog).toHaveLength(11);
    const serializedMusePayload = JSON.stringify(payload);
    expect(serializedMusePayload).not.toContain(IDENTITY_BASE.sessionId);
    expect(serializedMusePayload).not.toContain(IDENTITY_BASE.videoId);
    expect(serializedMusePayload).not.toContain(IDENTITY_BASE.analysisId);

    const proposals = mapped.proposals as Array<Record<string, unknown>>;
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      elementId: "demo-water-supply",
      state: "draft-proposal",
      modelSuggestion: "A",
      evidenceCandidateIds: [candidate.candidateId],
      evidence: [{ candidateId: candidate.candidateId, still: { mimeType: "image/jpeg", width: 8, height: 8 } }],
    });
    const evidence = (proposals[0]?.evidence as Array<{ still: { sha256: string; base64: string } }>)[0]!;
    expect(evidence.still.sha256).toBe(sha256(SERVER_JPEG_STILL));
    expect(Buffer.from(evidence.still.base64, "base64")).toEqual(Buffer.from(SERVER_JPEG_STILL));
    expect(Buffer.from(content[1]?.image_url?.split(",")[1] ?? "", "base64")).toEqual(Buffer.from(SERVER_JPEG_STILL));
    expect(JSON.stringify(mapped)).not.toContain("file-provider-secret-987");
    expect(JSON.stringify(mapped)).not.toContain("server-only-test-key");
  });

  it("rejects client-supplied candidate stills before Muse mapping", async () => {
    const { fetchImpl: segmentFetch } = mockMetaFetch();
    const segmented = await segment({ identity: identityFor("tampered-candidate-still") }, segmentFetch);
    const { calls, fetchImpl } = mockMetaFetch();
    const response = await handleVideoSegmentRequest(
      mappingRequest(segmented.body, { tamperedCandidateStill: true }),
      { env: LIVE_ENV, fetch: fetchImpl, decodeSourceFrames: testSourceFrameDecoder },
    );
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(calls).toHaveLength(0);
  });

  it("rejects client-supplied sample context stills before Muse mapping", async () => {
    const { fetchImpl: segmentFetch } = mockMetaFetch();
    const segmented = await segment({ identity: identityFor("tampered-sample-still") }, segmentFetch);
    const { calls, fetchImpl } = mockMetaFetch();
    const response = await handleVideoSegmentRequest(
      mappingRequest(segmented.body, { tamperedSampleStill: true }),
      { env: LIVE_ENV, fetch: fetchImpl, decodeSourceFrames: testSourceFrameDecoder },
    );
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(calls).toHaveLength(0);
  });

  it("uses Baseten Muse Spark Open only when Meta Muse is unavailable and validates the same schema", async () => {
    const { fetchImpl: segmentFetch } = mockMetaFetch();
    const segmented = await segment({ identity: identityFor("baseten-fallback") }, segmentFetch);
    const fallbackCalls: Array<{ url: string; authorization: string | null; payload: Record<string, unknown> }> = [];
    const fallbackText = JSON.stringify({ proposals: [{
      elementId: "demo-water-supply",
      modelSuggestion: "A",
      observation: "A faucet is visible in a sampled source frame.",
      confidence: 76,
      evidenceCandidateIds: ["cand-0001"],
      deficiencySuggestion: null,
    }] });
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://api.meta.ai/v1/responses") return new Response("provider unavailable", { status: 503 });
      const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      fallbackCalls.push({ url, authorization: new Headers(init?.headers).get("authorization"), payload });
      return Response.json({ choices: [{ message: { role: "assistant", content: fallbackText } }] });
    };
    const response = await handleMap(segmented.body, {
      env: { ...LIVE_ENV, BASETEN_API_KEY: "baseten-test-key" },
      fetch: fetchImpl,
    });
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ models: { segmentation: SAM_VIDEO_MODEL, mapping: MUSE_BASETEN_MODEL } });
    expect(fallbackCalls).toHaveLength(1);
    expect(fallbackCalls[0]?.url).toBe("https://inference.baseten.co/v1/chat/completions");
    expect(fallbackCalls[0]?.authorization).toBe("Bearer baseten-test-key");
    expect(fallbackCalls[0]?.payload.model).toBe("meta-models/muse-spark-open");
    expect(JSON.stringify(body)).not.toContain("baseten-test-key");
    expect(body.proposals).toMatchObject([{ elementId: "demo-water-supply", state: "draft-proposal", evidenceCandidateIds: ["cand-0001"] }]);
  });

  it("does not invoke the Baseten fallback for invalid Meta model output", async () => {
    const { fetchImpl: segmentFetch } = mockMetaFetch();
    const segmented = await segment({ identity: identityFor("no-invalid-output-fallback") }, segmentFetch);
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url === "https://api.meta.ai/v1/responses") {
        return Response.json({ status: "completed", output_text: "not-json" });
      }
      throw new Error("unexpected fallback request");
    };
    const response = await handleMap(segmented.body, {
      env: { ...LIVE_ENV, BASETEN_API_KEY: "baseten-test-key" },
      fetch: fetchImpl,
    });
    expect(response.status).toBe(502);
    expect(urls).toEqual(["https://api.meta.ai/v1/responses"]);
  });

  it("does not invoke Baseten when Meta returns a malformed JSON response body", async () => {
    const { fetchImpl: segmentFetch } = mockMetaFetch();
    const segmented = await segment({ identity: identityFor("no-malformed-response-fallback") }, segmentFetch);
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url === "https://api.meta.ai/v1/responses") return new Response("not-json");
      throw new Error("unexpected fallback request");
    };
    const response = await handleMap(segmented.body, {
      env: { ...LIVE_ENV, BASETEN_API_KEY: "baseten-test-key" },
      fetch: fetchImpl,
    });
    expect(response.status).toBe(502);
    expect(await json(response)).toMatchObject({ ok: false, error: { code: "INVALID_MODEL_OUTPUT" } });
    expect(urls).toEqual(["https://api.meta.ai/v1/responses"]);
  });

  it("does not invoke Baseten when Meta rejects the Muse request with a client error", async () => {
    const { fetchImpl: segmentFetch } = mockMetaFetch();
    const segmented = await segment({ identity: identityFor("no-client-error-fallback") }, segmentFetch);
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url === "https://api.meta.ai/v1/responses") return new Response("bad request", { status: 400 });
      throw new Error("unexpected fallback request");
    };
    const response = await handleMap(segmented.body, {
      env: { ...LIVE_ENV, BASETEN_API_KEY: "baseten-test-key" },
      fetch: fetchImpl,
    });
    expect(response.status).toBe(503);
    expect(await json(response)).toMatchObject({ ok: false, error: { code: "SETUP_REQUIRED" } });
    expect(urls).toEqual(["https://api.meta.ai/v1/responses"]);
  });

  it("returns a tentative correction plan only for a D suggestion", async () => {
    const museText = JSON.stringify({ proposals: [{
      elementId: "demo-water-supply",
      modelSuggestion: "D",
      observation: "The drain fitting appears loose in the selected frame.",
      confidence: 81,
      evidenceCandidateIds: ["cand-0001"],
      deficiencySuggestion: {
        deficientArea: "Kitchen sink drain",
        correction: "Secure the drain fitting and verify water drains freely.",
        completionDate: "2026-11-12",
        reinspectionDate: "2026-11-15",
      },
    }] });
    const { fetchImpl: segmentFetch } = mockMetaFetch();
    const segmented = await segment({ identity: identityFor("deficiency-plan") }, segmentFetch);
    const { fetchImpl } = mockMetaFetch({ museText });
    const response = await handleMap(segmented.body, { env: LIVE_ENV, fetch: fetchImpl });
    const body = await response.json() as { proposals: Array<Record<string, unknown>> };
    expect(response.status).toBe(200);
    expect(body.proposals[0]).toMatchObject({ modelSuggestion: "D", deficiencySuggestion: {
      deficientArea: "Kitchen sink drain",
      completionDate: "2026-11-12",
      reinspectionDate: "2026-11-15",
    } });
  });

  it("rejects cross-origin, unsupported room, oversized requests, and mismatched hashes before provider calls", async () => {
    const { calls, fetchImpl } = mockMetaFetch();
    const crossOrigin = await handleVideoSegmentRequest(requestFor({ origin: "https://attacker.example" }), { env: LIVE_ENV, fetch: fetchImpl });
    expect(crossOrigin.status).toBe(400);

    const invalidRoom = await handleVideoSegmentRequest(requestFor({ room: "penthouse" }), { env: LIVE_ENV, fetch: fetchImpl });
    expect(invalidRoom.status).toBe(400);

    const tooLarge = await handleVideoSegmentRequest(
      requestFor({ contentLength: String(MAX_MULTIPART_BYTES + 1) }), { env: LIVE_ENV, fetch: fetchImpl },
    );
    expect(tooLarge.status).toBe(413);

    const mismatchedHash = await handleVideoSegmentRequest(
      requestFor({ expectedHash: "0".repeat(64) }), { env: LIVE_ENV, fetch: fetchImpl },
    );
    expect(mismatchedHash.status).toBe(409);

    const staleCatalog = await handleVideoSegmentRequest(
      requestFor({ identity: { catalogVersion: "old-catalog" } }), { env: LIVE_ENV, fetch: fetchImpl },
    );
    expect(staleCatalog.status).toBe(409);
    const staleSchema = await handleVideoSegmentRequest(
      requestFor({ identity: { schemaVersion: String(MOVE_IN_READY_SCHEMA_VERSION - 1) } }), { env: LIVE_ENV, fetch: fetchImpl },
    );
    expect(staleSchema.status).toBe(409);
    expect(calls).toHaveLength(0);
  });

  it("rejects a stale mapping identity before the Muse call", async () => {
    const { fetchImpl: segmentFetch } = mockMetaFetch();
    const segmented = await segment({ identity: identityFor("bad-map") }, segmentFetch);
    const { calls, fetchImpl } = mockMetaFetch();
    const stale = await handleVideoSegmentRequest(mappingRequest(segmented.body, { changedAnalysisId: "analysis-newer" }), { env: LIVE_ENV, fetch: fetchImpl, decodeSourceFrames: testSourceFrameDecoder });
    expect(stale.status).toBe(409);
    expect(calls).toHaveLength(0);
  });

  it("rejects missing or independently stale schema and catalog versions on mapping requests", async () => {
    const { fetchImpl: segmentFetch } = mockMetaFetch();
    const segmented = await segment({ identity: identityFor("map-version-request") }, segmentFetch);
    const { calls, fetchImpl } = mockMetaFetch();
    const invalidRequests = [
      { options: { omitSchemaVersion: true }, status: 400 },
      { options: { schemaVersion: String(MOVE_IN_READY_SCHEMA_VERSION - 1) }, status: 409 },
      { options: { omitCatalogVersion: true }, status: 400 },
      { options: { catalogVersion: "older-catalog" }, status: 409 },
    ] as const;

    for (const invalid of invalidRequests) {
      const response = await handleVideoSegmentRequest(mappingRequest(segmented.body, invalid.options), {
        env: LIVE_ENV,
        fetch: fetchImpl,
        decodeSourceFrames: testSourceFrameDecoder,
      });
      expect(response.status).toBe(invalid.status);
    }
    expect(calls).toHaveLength(0);
  });

  it("rejects missing or independently stale schema and catalog versions inside signed map tokens", async () => {
    const { fetchImpl: segmentFetch } = mockMetaFetch();
    const segmented = await segment({ identity: identityFor("map-version-token") }, segmentFetch);
    const candidateToken = String(segmented.body.candidateToken);
    const invalidTokens = [
      candidateTokenWithVersion(candidateToken, "schemaVersion", undefined),
      candidateTokenWithVersion(candidateToken, "schemaVersion", MOVE_IN_READY_SCHEMA_VERSION - 1),
      candidateTokenWithVersion(candidateToken, "catalogVersion", undefined),
      candidateTokenWithVersion(candidateToken, "catalogVersion", "older-catalog"),
    ];
    const { calls, fetchImpl } = mockMetaFetch();

    for (const token of invalidTokens) {
      const response = await handleVideoSegmentRequest(mappingRequest(segmented.body, { candidateToken: token }), {
        env: LIVE_ENV,
        fetch: fetchImpl,
        decodeSourceFrames: testSourceFrameDecoder,
      });
      expect(response.status).toBe(409);
    }
    expect(calls).toHaveLength(0);
  });

  it("releases only the exact pending segmentation token and keeps replay protection", async () => {
    const { fetchImpl: segmentFetch } = mockMetaFetch();
    const segmented = await segment({ identity: identityFor("cancel-exact") }, segmentFetch);
    const cancelled = await handleVideoSegmentRequest(cancellationRequest(segmented.body));
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ ok: true, stage: "cancelled", released: true });

    const { calls, fetchImpl } = mockMetaFetch();
    const staleMap = await handleMap(segmented.body, { env: LIVE_ENV, fetch: fetchImpl });
    expect(staleMap.status).toBe(409);
    expect(calls).toHaveLength(0);

    const { fetchImpl: secondSegmentFetch } = mockMetaFetch();
    const stillPending = await segment({ identity: identityFor("cancel-mismatch") }, secondSegmentFetch);
    const mismatch = await handleVideoSegmentRequest(cancellationRequest(stillPending.body, { candidateToken: "not-the-segment-token" }));
    expect(mismatch.status).toBe(200);
    expect(await mismatch.json()).toMatchObject({ ok: true, stage: "cancelled", released: false });

    const { calls: mappingCalls, fetchImpl: mappingFetch } = mockMetaFetch();
    const validMap = await handleMap(stillPending.body, { env: LIVE_ENV, fetch: mappingFetch });
    expect(validMap.status).toBe(200);
    expect(mappingCalls).toHaveLength(1);
  });

  it("cancels a pending map by exact identity when the client never received its token", async () => {
    const { fetchImpl: segmentFetch } = mockMetaFetch();
    const segmented = await segment({ identity: identityFor("cancel-lost-token") }, segmentFetch);
    const identity = segmented.body.identity as VideoRequestIdentity;

    const wrongIdentity = await handleVideoSegmentRequest(
      identityOnlyCancellationRequest(segmented.body, { videoId: `${identity.videoId}-other` }),
    );
    expect(wrongIdentity.status).toBe(200);
    expect(await json(wrongIdentity)).toMatchObject({ ok: true, stage: "cancelled", released: false });

    const cancelled = await handleVideoSegmentRequest(identityOnlyCancellationRequest(segmented.body));
    expect(cancelled.status).toBe(200);
    expect(await json(cancelled)).toMatchObject({ ok: true, stage: "cancelled", released: true });

    const replayFetch = mockMetaFetch();
    const replayIdentity = {
      sessionId: identity.sessionId,
      videoId: identity.videoId,
      videoRevision: String(identity.videoRevision),
      analysisId: identity.analysisId,
      attempt: String(identity.attempt),
      catalogVersion: identity.catalogVersion,
    };
    const replay = await handleVideoSegmentRequest(requestFor({ identity: replayIdentity }), {
      env: LIVE_ENV,
      fetch: replayFetch.fetchImpl,
      decodeSourceFrames: testSourceFrameDecoder,
    });
    expect(replay.status).toBe(409);
    expect(await json(replay)).toMatchObject({ ok: false, error: { code: "STALE_REQUEST" } });
    expect(replayFetch.calls).toHaveLength(0);

    const nextAttemptFetch = mockMetaFetch();
    const nextAttempt = await handleVideoSegmentRequest(requestFor({
      identity: {
        ...replayIdentity,
        analysisId: `${identity.analysisId}-next`,
        attempt: String(identity.attempt + 1),
      },
    }), { env: LIVE_ENV, fetch: nextAttemptFetch.fetchImpl, decodeSourceFrames: testSourceFrameDecoder });
    expect(nextAttempt.status).toBe(200);
    expect(nextAttemptFetch.calls.length).toBeGreaterThan(0);
  });

  it("accepts only a configured public origin when a trusted proxy rewrites the request origin", async () => {
    const { fetchImpl } = mockMetaFetch();
    const segmented = await segment({ identity: identityFor("proxy-origin") }, fetchImpl);
    const proxied = await handleVideoSegmentRequest(
      proxiedCancellationRequest(segmented.body, "https://preview.tailnet.example:3100"),
      { publicOrigin: "https://preview.tailnet.example:3100" },
    );
    expect(proxied.status).toBe(200);
    expect(await json(proxied)).toMatchObject({ ok: true, stage: "cancelled", released: true });

    const otherSegment = await segment({ identity: identityFor("proxy-origin-mismatch") }, fetchImpl);
    const rejected = await handleVideoSegmentRequest(
      proxiedCancellationRequest(otherSegment.body, "https://attacker.example"),
      { publicOrigin: "https://preview.tailnet.example:3100" },
    );
    expect(rejected.status).toBe(400);
    expect(await json(rejected)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await handleVideoSegmentRequest(cancellationRequest(otherSegment.body));
  });

  it("fails closed on a Muse proposal that cites a non-SAM candidate or adds a verdict field", async () => {
    const badOutputs = [
      JSON.stringify({ proposals: [{ elementId: "demo-water-supply", modelSuggestion: "A", observation: "A faucet is visible.", confidence: 80, evidenceCandidateIds: ["cand-made-up"], deficiencySuggestion: null }] }),
      JSON.stringify({ proposals: [{ elementId: "demo-water-supply", modelSuggestion: "D", observation: "A faucet is visible.", confidence: 80, evidenceCandidateIds: ["cand-0001"], deficiencySuggestion: { deficientArea: "Kitchen sink", correction: "Repair the drain.", completionDate: "2026-11-15", reinspectionDate: "2026-11-12" } }] }),
      JSON.stringify({ proposals: [{ elementId: "demo-water-supply", modelSuggestion: "A", observation: "A faucet is visible.", confidence: 80, evidenceCandidateIds: ["cand-0001"], deficiencySuggestion: { deficientArea: "Kitchen sink", correction: "Repair the drain.", completionDate: "2026-11-12", reinspectionDate: "2026-11-15" } }] }),
      JSON.stringify({ proposals: [], verdict: "approved" }),
    ];
    for (const [index, museText] of badOutputs.entries()) {
      const { fetchImpl: segmentFetch } = mockMetaFetch();
      const segmented = await segment({ identity: identityFor(`bad-output-${index}`) }, segmentFetch);
      const { calls, fetchImpl } = mockMetaFetch({ museText });
      const response = await handleMap(segmented.body, { env: LIVE_ENV, fetch: fetchImpl });
      const bodyText = await response.text();
      expect(response.status).toBe(502);
      expect(bodyText).not.toContain("cand-made-up");
      expect(bodyText).not.toContain("approved");
      expect(calls).toHaveLength(1);
    }
  });

  it("fails closed when live mode or credentials are unavailable", async () => {
    const { calls, fetchImpl } = mockMetaFetch();
    const fixture = await handleVideoSegmentRequest(requestFor(), { env: { APP_ANALYSIS_MODE: "fixture" }, fetch: fetchImpl });
    expect(fixture.status).toBe(503);

    const keyless = await handleVideoSegmentRequest(requestFor(), { env: { APP_ANALYSIS_MODE: "live" }, fetch: fetchImpl });
    expect(keyless.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it("does not echo provider error bodies or return a partial result", async () => {
    let responses = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/files")) return Response.json({ id: "file-provider-secret-987" });
      responses += 1;
      if (responses === 1) return streamResponse();
      return new Response(JSON.stringify({ error: { message: "secret provider payload" } }), { status: 400 });
    };
    const response = await handleVideoSegmentRequest(requestFor({ identity: identityFor("provider-error") }), {
      env: LIVE_ENV,
      fetch: fetchImpl,
      decodeSourceFrames: testSourceFrameDecoder,
    });
    const text = await response.text();
    expect(response.status).toBe(502);
    expect(text).not.toContain("secret provider payload");
    expect(text).not.toContain("file-provider-secret-987");
  });

  it("allows at most two exact-seek candidates per concept and twelve for the six-concept room", async () => {
    const boxLine = (frame: number) =>
      `<${frame}f>3<|box;x1=${10 + frame};y1=20;x2=${30 + frame};y2=40;w=320;h=334|>` +
      "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>\n";
    const multiFrameOutput = [0, 1, 2, 3, 4].map(boxLine).join("");
    const { fetchImpl } = mockMetaFetch({ stream: () => streamResponse(multiFrameOutput) });
    const { response, body } = await segment({
      room: "bathroom",
      bytes: makeMp4(1_000, 10),
      identity: identityFor("bounded-candidates"),
    }, fetchImpl);

    expect({ status: response.status, body }).toMatchObject({ status: 200 });
    const candidates = body.candidates as VideoDraftSuggestion[];
    expect(candidates).toHaveLength(12);
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
      const key = `${candidate.elementId}\0${candidate.concept}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect([...counts.values()].every((count) => count <= 2)).toBe(true);
  });

  it("locks one active session operation and consumes duplicate analysis attempts", async () => {
    const identity = identityFor("segment-lock");
    let enteredUpload!: () => void;
    const firstUploadEntered = new Promise<void>((resolve) => { enteredUpload = resolve; });
    let releaseUpload!: (response: Response) => void;
    const uploadGate = new Promise<Response>((resolve) => { releaseUpload = resolve; });
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/files")) {
        enteredUpload();
        return uploadGate;
      }
      return streamResponse();
    };

    const firstRequest = handleVideoSegmentRequest(requestFor({ identity }), { env: LIVE_ENV, fetch: fetchImpl, decodeSourceFrames: testSourceFrameDecoder });
    await firstUploadEntered;
    const duplicateWhileActive = await handleVideoSegmentRequest(requestFor({ identity }), { env: LIVE_ENV, fetch: fetchImpl, decodeSourceFrames: testSourceFrameDecoder });
    expect(duplicateWhileActive.status).toBe(409);
    expect(await json(duplicateWhileActive)).toMatchObject({ ok: false, error: { code: "OPERATION_BUSY" } });
    expect(calls).toHaveLength(1);

    releaseUpload(Response.json({ id: "file-provider-secret-987" }));
    const firstResponse = await firstRequest;
    expect(firstResponse.status).toBe(200);
    const replay = await handleVideoSegmentRequest(requestFor({ identity }), { env: LIVE_ENV, fetch: fetchImpl, decodeSourceFrames: testSourceFrameDecoder });
    expect(replay.status).toBe(409);
    expect(await json(replay)).toMatchObject({ ok: false, error: { code: "OPERATION_BUSY" } });
    expect(calls).toHaveLength(1 + VIDEO_PROMPTS.kitchen.length);
  });

  it("rejects concurrent and replayed Muse mapping requests before an extra paid call", async () => {
    const { fetchImpl: segmentFetch } = mockMetaFetch();
    const segmented = await segment({ identity: identityFor("mapping-lock") }, segmentFetch);
    let enteredMuse!: () => void;
    const museEntered = new Promise<void>((resolve) => { enteredMuse = resolve; });
    let releaseMuse!: (response: Response) => void;
    const museGate = new Promise<Response>((resolve) => { releaseMuse = resolve; });
    let museCalls = 0;
    const mappingFetch: typeof fetch = async () => {
      museCalls += 1;
      enteredMuse();
      return museGate;
    };

    const firstMapping = handleMap(segmented.body, { env: LIVE_ENV, fetch: mappingFetch });
    await museEntered;
    const duplicateWhileActive = await handleMap(segmented.body, { env: LIVE_ENV, fetch: mappingFetch });
    expect(duplicateWhileActive.status).toBe(409);
    expect(await json(duplicateWhileActive)).toMatchObject({ ok: false, error: { code: "OPERATION_BUSY" } });
    expect(museCalls).toBe(1);

    releaseMuse(Response.json({
      status: "completed",
      output_text: JSON.stringify({ proposals: [] }),
    }));
    const mapped = await firstMapping;
    expect(mapped.status).toBe(200);
    const replay = await handleMap(segmented.body, { env: LIVE_ENV, fetch: mappingFetch });
    expect(replay.status).toBe(409);
    expect(await json(replay)).toMatchObject({ ok: false, error: { code: "STALE_REQUEST" } });
    expect(museCalls).toBe(1);
  });
});
