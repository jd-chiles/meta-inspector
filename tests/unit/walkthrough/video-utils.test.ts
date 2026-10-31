import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mediaPlayer = vi.hoisted(() => ({
  currentFrameIndex: 0,
  duration: 10,
  open: vi.fn<() => Promise<void>>(),
  seek: vi.fn<(time: number) => Promise<void>>(),
  getCurrentFrame: vi.fn<() => { width: number; height: number } | null>(),
  getTimeAtFrameIndexExact: vi.fn<(frameIndex: number) => number>(),
  dispose: vi.fn(),
}));

const remux = vi.hoisted(() => ({
  includeAudio: false,
  dropVideo: false,
  dropAudio: false,
  durationSeconds: 10,
  codedWidth: 640,
  codedHeight: 360,
  trackInspectionError: null as Error | null,
  executeImpl: null as ((target: unknown) => Promise<void>) | null,
  cancelExecute: null as (() => void) | null,
  conversionOptions: null as unknown,
  conversion: null as { cancel: () => Promise<void> } | null,
  cancelCount: 0,
  outputCancelCount: 0,
  target: null as unknown,
  videoTrack: null as unknown,
  audioTrack: null as unknown,
}));

type TestStreamTarget = {
  writeChunk(data: Uint8Array<ArrayBuffer>, position: number): Promise<void>;
  finalize(): Promise<void>;
};

vi.mock("@meta-sam/video", () => ({
  createMediaPlayer: vi.fn(() => ({
    get currentFrameIndex() {
      return mediaPlayer.currentFrameIndex;
    },
    get duration() {
      return mediaPlayer.duration;
    },
    open: mediaPlayer.open,
    seek: mediaPlayer.seek,
    getCurrentFrame: mediaPlayer.getCurrentFrame,
    getTimeAtFrameIndexExact: mediaPlayer.getTimeAtFrameIndexExact,
    dispose: mediaPlayer.dispose,
  })),
}));

vi.mock("mediabunny", () => {
  const videoTrack = {
    kind: "video",
    getCodedWidth: async () => remux.codedWidth,
    getCodedHeight: async () => remux.codedHeight,
  };
  const audioTrack = { kind: "audio" };
  remux.videoTrack = videoTrack;
  remux.audioTrack = audioTrack;

  class StreamTarget {
    private readonly writer: WritableStreamDefaultWriter<import("mediabunny").StreamTargetChunk>;

    constructor(
      readonly writable: WritableStream<import("mediabunny").StreamTargetChunk>,
    ) {
      this.writer = writable.getWriter();
    }

    async writeChunk(data: Uint8Array<ArrayBuffer>, position: number): Promise<void> {
      await this.writer.write({ type: "write", data, position });
    }

    async finalize(): Promise<void> {
      await this.writer.close();
    }

    async cancel(): Promise<void> {
      await this.writer.abort();
    }
  }
  class BlobSource {
    constructor(readonly blob: Blob) {}
  }
  class Input {
    disposed = false;
    constructor(readonly options: { source: BlobSource }) {}
    async getPrimaryVideoTrack(): Promise<typeof videoTrack> {
      if (remux.trackInspectionError) throw remux.trackInspectionError;
      return videoTrack;
    }
    async getPrimaryAudioTrack(): Promise<typeof audioTrack | null> { return remux.includeAudio ? audioTrack : null; }
    async computeDuration(): Promise<number> { return remux.durationSeconds; }
    async getVideoTracks(): Promise<typeof videoTrack[]> { return [videoTrack]; }
    async getAudioTracks(): Promise<typeof audioTrack[]> { return remux.includeAudio ? [audioTrack] : []; }
    dispose(): void { this.disposed = true; }
  }
  class Mp4OutputFormat {}
  class Output {
    constructor(readonly options: { target: StreamTarget }) {
      remux.target = options.target;
    }
    async cancel(): Promise<void> {
      remux.outputCancelCount += 1;
      await this.options.target.cancel();
    }
  }
  class ConversionCanceledError extends Error {}
  class Conversion {
    readonly isValid = true;
    readonly discardedTracks: Array<{ track: unknown }> = [];
    readonly utilizedTracks: unknown[];
    constructor(readonly options: { input: Input; output: Output }) {
      this.utilizedTracks = [
        ...(!remux.dropVideo ? [videoTrack] : []),
        ...(remux.includeAudio && !remux.dropAudio ? [audioTrack] : []),
      ];
    }
    static async init(options: { input: Input; output: Output }): Promise<Conversion> {
      remux.conversionOptions = options;
      const conversion = new Conversion(options);
      remux.conversion = conversion;
      return conversion;
    }
    async execute(): Promise<void> {
      if (remux.executeImpl) return remux.executeImpl(remux.target);
      const target = remux.target as TestStreamTarget;
      await target.writeChunk(new Uint8Array([
        0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 109, 112, 52, 50,
      ]), 0);
      await target.finalize();
    }
    async cancel(): Promise<void> {
      remux.cancelCount += 1;
      remux.cancelExecute?.();
      await this.options.output.cancel();
    }
  }
  return {
    ALL_FORMATS: [],
    BlobSource,
    Conversion,
    ConversionCanceledError,
    Input,
    Mp4OutputFormat,
    Output,
    StreamTarget,
  };
});

import {
  normalizeVideoForCapture,
  prepareVideoReview,
  validateVideoContainer,
} from "../../../src/features/walkthrough/video-utils";
import { MOVE_IN_READY_ROOM_PROMPT_IDS } from "../../../src/domain/move-in-ready";
import { DEFAULT_ROOM_PROMPTS } from "../../../src/features/walkthrough/video-capture";

describe("walkthrough MP4/MOV header validation", () => {
  it("accepts a supported compatible brand even when it is not the major brand", async () => {
    const result = await validateVideoContainer(makeFtyp("mif1", ["cmfc"]));
    expect(result).toEqual({ ok: true, mime: "video/mp4" });
  });

  it("rejects oversized or incomplete file-type boxes before decoding", async () => {
    const oversized = makeFtyp("isom", ["mp42"], 5 * 1024);
    const incomplete = new Blob([new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112])]);
    await expect(validateVideoContainer(oversized)).resolves.toMatchObject({ ok: false, code: "INVALID_CONTAINER" });
    await expect(validateVideoContainer(incomplete)).resolves.toMatchObject({ ok: false, code: "INVALID_CONTAINER" });
  });
});

describe("walkthrough video still timestamps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    remux.includeAudio = false;
    remux.dropVideo = false;
    remux.dropAudio = false;
    remux.durationSeconds = 10;
    remux.codedWidth = 640;
    remux.codedHeight = 360;
    remux.trackInspectionError = null;
    remux.executeImpl = null;
    remux.cancelExecute = null;
    remux.conversionOptions = null;
    remux.conversion = null;
    remux.cancelCount = 0;
    remux.outputCancelCount = 0;
    remux.target = null;
    mediaPlayer.currentFrameIndex = 0;
    mediaPlayer.duration = 10;
    mediaPlayer.open.mockResolvedValue();
    mediaPlayer.seek.mockImplementation(async () => {
      mediaPlayer.currentFrameIndex = 7;
    });
    mediaPlayer.getCurrentFrame.mockReturnValue({ width: 640, height: 360 });
    mediaPlayer.getTimeAtFrameIndexExact.mockImplementation((frameIndex) => frameIndex / 30);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stores the exact-seek frame's presentation timestamp", async () => {
    vi.stubGlobal("VideoDecoder", class VideoDecoderStub {});
    vi.stubGlobal("document", {
      createElement: () => createFakeCanvas(),
    });

    const prepared = await prepareVideoReview(new Blob(["clip"]), {
      timestampsSeconds: [0.31],
    });

    expect(mediaPlayer.seek).toHaveBeenCalledWith(0.31);
    expect(mediaPlayer.getTimeAtFrameIndexExact).toHaveBeenCalledWith(7);
    expect(prepared.stills[0]?.timestampSeconds).toBeCloseTo(7 / 30);
    expect(mediaPlayer.dispose).toHaveBeenCalledOnce();
  });

  it("cancels local still extraction and disposes its decoder when the room changes", async () => {
    vi.stubGlobal("VideoDecoder", class VideoDecoderStub {});
    vi.stubGlobal("document", {
      createElement: () => createFakeCanvas(),
    });
    let cancelPendingSeek: ((reason: Error) => void) | undefined;
    mediaPlayer.seek.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      cancelPendingSeek = reject;
    }));
    mediaPlayer.dispose.mockImplementationOnce(() => cancelPendingSeek?.(new Error("player disposed")));
    const controller = new AbortController();

    const pending = prepareVideoReview(new Blob(["clip"]), {
      timestampsSeconds: [0.31],
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mediaPlayer.seek).toHaveBeenCalledWith(0.31));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mediaPlayer.dispose).toHaveBeenCalledOnce();
  });

  it("rejects high-resolution source frames before opening the mobile decoder", async () => {
    remux.codedWidth = 8000;
    remux.codedHeight = 6000;
    vi.stubGlobal("VideoDecoder", class VideoDecoderStub {});
    vi.stubGlobal("document", {
      createElement: () => createFakeCanvas(),
    });

    await expect(prepareVideoReview(new Blob(["clip"]), {
      timestampsSeconds: [],
    })).rejects.toThrow(/up to 9 megapixels/);

    expect(mediaPlayer.open).not.toHaveBeenCalled();
  });

  it("accepts a clip at exactly the 30-second maximum", async () => {
    mediaPlayer.duration = 30;
    vi.stubGlobal("VideoDecoder", class VideoDecoderStub {});
    vi.stubGlobal("document", {
      createElement: () => createFakeCanvas(),
    });

    const prepared = await prepareVideoReview(new Blob(["clip"]), {
      maxDurationSeconds: 30,
      timestampsSeconds: [],
    });

    expect(prepared.metadata.durationSeconds).toBe(30);
    expect(prepared.stills).toEqual([]);
  });

  it("rejects any clip longer than the 30-second maximum", async () => {
    mediaPlayer.duration = 30.001;
    vi.stubGlobal("VideoDecoder", class VideoDecoderStub {});
    vi.stubGlobal("document", {
      createElement: () => createFakeCanvas(),
    });

    await expect(prepareVideoReview(new Blob(["clip"]), {
      maxDurationSeconds: 30,
      timestampsSeconds: [],
    })).rejects.toThrow(/30 seconds or less/);
  });

  it("stores the browser-presented frame timestamp after a native video seek", async () => {
    vi.stubGlobal("VideoDecoder", undefined);
    vi.stubGlobal("document", {
      createElement: (tagName: string) => tagName === "canvas" ? createFakeCanvas() : new FakeVideo(),
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video-test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const prepared = await prepareVideoReview(new Blob(["clip"]), {
      timestampsSeconds: [1.24],
    });

    expect(prepared.stills[0]?.timestampSeconds).toBeCloseTo(37 / 30);
    expect(mediaPlayer.open).not.toHaveBeenCalled();
  });

  it("falls back to native video when WebCodecs cannot decode a supported phone codec", async () => {
    const error = new Error("The browser cannot decode the video track.");
    error.name = "MediaPlayerSourceError";
    mediaPlayer.open.mockRejectedValueOnce(error);
    vi.stubGlobal("VideoDecoder", class VideoDecoderStub {});
    vi.stubGlobal("document", {
      createElement: (tagName: string) => tagName === "canvas" ? createFakeCanvas() : new FakeVideo(),
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video-test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const prepared = await prepareVideoReview(new Blob(["clip"]), {
      timestampsSeconds: [1.24],
    });

    expect(prepared.stills).toHaveLength(1);
    expect(prepared.stills[0]?.timestampSeconds).toBeCloseTo(37 / 30);
    expect(mediaPlayer.dispose).toHaveBeenCalledOnce();
  });

  it("falls back to bounded native extraction when Mediabunny cannot inspect the video track", async () => {
    remux.trackInspectionError = new Error("Mediabunny could not inspect the primary video track.");
    vi.stubGlobal("VideoDecoder", class VideoDecoderStub {});
    vi.stubGlobal("document", {
      createElement: (tagName: string) => tagName === "canvas" ? createFakeCanvas() : new FakeVideo(),
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video-test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const prepared = await prepareVideoReview(new Blob(["clip"]), {
      timestampsSeconds: [1.24],
    });

    expect(prepared.metadata).toMatchObject({ width: 320, height: 240, durationSeconds: 5 });
    expect(prepared.stills).toHaveLength(1);
    expect(prepared.stills[0]?.timestampSeconds).toBeCloseTo(37 / 30);
    expect(mediaPlayer.open).not.toHaveBeenCalled();
  });

  it("does not label a seek target as an exact source timestamp when the browser lacks frame callbacks", async () => {
    vi.stubGlobal("VideoDecoder", undefined);
    const video = new FakeVideo();
    Object.defineProperty(video, "requestVideoFrameCallback", { value: undefined });
    vi.stubGlobal("document", {
      createElement: (tagName: string) => tagName === "canvas" ? createFakeCanvas() : video,
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video-test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    await expect(prepareVideoReview(new Blob(["clip"]), {
      timestampsSeconds: [1.24],
    })).rejects.toThrow(/cannot report exact video-frame timestamps/i);
  });
});

describe("MOV packet-copy normalization", () => {
  beforeEach(() => {
    remux.includeAudio = false;
    remux.dropVideo = false;
    remux.dropAudio = false;
    remux.durationSeconds = 10;
    remux.trackInspectionError = null;
    remux.executeImpl = null;
    remux.cancelExecute = null;
    remux.conversionOptions = null;
    remux.conversion = null;
    remux.cancelCount = 0;
    remux.outputCancelCount = 0;
    remux.target = null;
  });

  it("keeps the existing MP4 bytes and bypasses conversion", async () => {
    const mp4 = new Blob(["already mp4"], { type: "video/mp4" });
    const normalized = await normalizeVideoForCapture(mp4, "video/mp4");
    expect(normalized).toEqual({ video: mp4, mime: "video/mp4", converted: false });
    expect(remux.conversionOptions).toBeNull();
  });

  it("remuxes MOV with forced packet copy and returns a validated MP4 blob", async () => {
    const mov = new Blob(["quicktime"], { type: "video/quicktime" });
    const normalized = await normalizeVideoForCapture(mov, "video/quicktime", { maxDurationSeconds: 30 });
    expect(normalized.mime).toBe("video/mp4");
    expect(normalized.converted).toBe(true);
    expect(normalized.video.type).toBe("video/mp4");
    expect([...new Uint8Array(await normalized.video.arrayBuffer()).slice(4, 12)]).toEqual([102, 116, 121, 112, 105, 115, 111, 109]);
    expect(remux.conversionOptions).toMatchObject({ tracks: "primary", copy: { mode: "forced" }, showWarnings: false });
  });

  it("keeps a primary audio track when the MOV contains one", async () => {
    remux.includeAudio = true;
    const normalized = await normalizeVideoForCapture(
      new Blob(["quicktime"], { type: "video/quicktime" }),
      "video/quicktime",
    );
    expect(normalized.converted).toBe(true);
    expect(normalized.mime).toBe("video/mp4");
  });

  it("rejects a conversion that drops a primary track instead of transcoding or silently losing it", async () => {
    remux.includeAudio = true;
    remux.dropAudio = true;
    await expect(normalizeVideoForCapture(
      new Blob(["quicktime"], { type: "video/quicktime" }),
      "video/quicktime",
    )).rejects.toThrow(/keeping its primary video and audio tracks/);
    expect(remux.cancelCount).toBe(1);
  });

  it("rejects output above the byte limit in the bounded stream sink", async () => {
    const limit = 64 * 1024;
    remux.executeImpl = async (rawTarget) => {
      const target = rawTarget as TestStreamTarget;
      await target.writeChunk(new Uint8Array(limit + 1), 0);
    };

    await expect(normalizeVideoForCapture(
      new Blob(["quicktime"], { type: "video/quicktime" }),
      "video/quicktime",
      { maxBytes: limit },
    )).rejects.toThrow(/converted MP4 is larger than/i);
    expect(remux.cancelCount).toBe(1);
  });

  it("cancels an in-flight conversion when its AbortSignal fires", async () => {
    remux.executeImpl = () => new Promise<void>((_resolve, reject) => {
      remux.cancelExecute = () => reject(new Error("conversion canceled"));
    });
    const controller = new AbortController();
    const pending = normalizeVideoForCapture(
      new Blob(["quicktime"], { type: "video/quicktime" }),
      "video/quicktime",
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(remux.conversion).not.toBeNull());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(remux.cancelCount).toBe(1);
    expect(remux.outputCancelCount).toBe(1);
  });

  it("rejects overlong MOV before starting conversion", async () => {
    remux.durationSeconds = 30.1;
    await expect(normalizeVideoForCapture(
      new Blob(["quicktime"], { type: "video/quicktime" }),
      "video/quicktime",
      { maxDurationSeconds: 30 },
    )).rejects.toThrow(/30 seconds or less/);
    expect(remux.conversionOptions).toBeNull();
  });

  it("covers faucet, fan, lock, and detector within kitchen and bathroom prompts", () => {
    for (const roomId of ["kitchen", "bathroom"] as const) {
      const prompts = DEFAULT_ROOM_PROMPTS[roomId].join(" ").toLowerCase();
      expect(prompts).toMatch(/faucet/);
      expect(prompts).toMatch(/fan/);
      expect(prompts).toMatch(/lock/);
      expect(prompts).toMatch(/detector/);
      expect(MOVE_IN_READY_ROOM_PROMPT_IDS[roomId]).toHaveLength(DEFAULT_ROOM_PROMPTS[roomId].length);
    }
    expect(DEFAULT_ROOM_PROMPTS.hallway.join(" ").toLowerCase()).toMatch(/(?:public|common)[ -]area/);
  });
});

function createFakeCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: vi.fn() }),
    toBlob: (callback: BlobCallback) => callback(new Blob(["still"], { type: "image/jpeg" })),
  } as unknown as HTMLCanvasElement;
}

class FakeVideo extends EventTarget {
  preload = "";
  muted = false;
  playsInline = false;
  videoWidth = 320;
  videoHeight = 240;
  duration = 5;
  src = "";
  private position = 0;

  get currentTime(): number {
    return this.position;
  }

  set currentTime(value: number) {
    this.position = value;
    queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
  }

  requestVideoFrameCallback(callback: VideoFrameRequestCallback): number {
    const callbackId = 1;
    queueMicrotask(() => callback(0, {
      mediaTime: Math.floor(this.position * 30) / 30,
    } as VideoFrameCallbackMetadata));
    return callbackId;
  }

  cancelVideoFrameCallback(): void {}

  load(): void {
    if (this.src) queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
  }

  pause(): void {}

  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }
}

function makeFtyp(majorBrand: string, compatibleBrands: string[], sizeOverride?: number): Blob {
  const size = sizeOverride ?? 16 + compatibleBrands.length * 4;
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size, false);
  writeAscii(bytes, 4, "ftyp");
  writeAscii(bytes, 8, majorBrand);
  for (let index = 0; index < compatibleBrands.length; index += 1) {
    writeAscii(bytes, 16 + index * 4, compatibleBrands[index]!);
  }
  return new Blob([bytes]);
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}
