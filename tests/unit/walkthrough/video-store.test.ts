import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openDBMock } = vi.hoisted(() => ({ openDBMock: vi.fn() }));

vi.mock("idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb")>();
  return { ...actual, openDB: openDBMock as typeof actual.openDB };
});

import {
  createStoredVideoClip,
  createVideoClipStore,
  VIDEO_CLIP_SCHEMA_VERSION,
  makeVideoClipId,
  validateStoredVideoClip,
} from "../../../src/features/walkthrough/video-store";
import { VIDEO_MAX_BYTES } from "../../../src/features/walkthrough/video-utils";

const SESSION_ID = "session-1";
const ROOM_ID = "kitchen";
const CLIP_ID = makeVideoClipId(SESSION_ID, ROOM_ID);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: CLIP_ID,
    schemaVersion: VIDEO_CLIP_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    roomId: ROOM_ID,
    roomLabel: "Kitchen",
    fileName: "mock-unit.mp4",
    mime: "video/mp4",
    sizeBytes: 4,
    durationSeconds: 1,
    width: 1,
    height: 1,
    capturedAt: "2026-10-29T09:15:00.000Z",
    sourceSha256: "a".repeat(64),
    video: new Blob([new Uint8Array([0, 0, 0, 4])], { type: "video/mp4" }),
    stills: [],
    ...overrides,
  };
}

describe("stored room video validation", () => {
  it("accepts a current clip only with a shaped source hash", () => {
    expect(validateStoredVideoClip(row(), { sessionId: SESSION_ID, roomId: ROOM_ID }).ok).toBe(true);
    expect(validateStoredVideoClip(row({ sourceSha256: "not-a-hash" }), { sessionId: SESSION_ID, roomId: ROOM_ID }).ok).toBe(false);
  });

  it("accepts the prior local schema so the store can hash and upgrade it on read", () => {
    const previous = row({ schemaVersion: 1, sourceSha256: undefined });
    const result = validateStoredVideoClip(previous, { sessionId: SESSION_ID, roomId: ROOM_ID });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.clip.schemaVersion).toBe(1);
  });

  it("rejects persisted clips outside the capture resource limits or with inconsistent blob metadata", () => {
    expect(validateStoredVideoClip(row({ sizeBytes: VIDEO_MAX_BYTES + 1, video: sizedBlob(VIDEO_MAX_BYTES + 1) }), { sessionId: SESSION_ID, roomId: ROOM_ID }).ok).toBe(false);
    expect(validateStoredVideoClip(row({ sizeBytes: 3 }), { sessionId: SESSION_ID, roomId: ROOM_ID }).ok).toBe(false);
    expect(validateStoredVideoClip(row({ durationSeconds: 31 }), { sessionId: SESSION_ID, roomId: ROOM_ID }).ok).toBe(false);
    expect(validateStoredVideoClip(row({ width: 4096, height: 4096 }), { sessionId: SESSION_ID, roomId: ROOM_ID }).ok).toBe(false);
    expect(validateStoredVideoClip(row({ stills: [still(1, new Blob(["late frame"], { type: "image/jpeg" }))] }), { sessionId: SESSION_ID, roomId: ROOM_ID }).ok).toBe(false);
    expect(validateStoredVideoClip(row({ stills: [still(0.5, sizedBlob(512 * 1024 + 1))] }), { sessionId: SESSION_ID, roomId: ROOM_ID }).ok).toBe(false);
  });

  it("rejects a clip stored under another walkthrough or room", () => {
    expect(validateStoredVideoClip(row(), { sessionId: "different-session", roomId: ROOM_ID }).ok).toBe(false);
    expect(validateStoredVideoClip(row(), { sessionId: SESSION_ID, roomId: "bathroom" }).ok).toBe(false);
  });
});

describe("temporary in-memory room video store", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", undefined);
    openDBMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("supports get, put, source-matched still additions, and remove without IndexedDB", async () => {
    const store = createVideoClipStore();
    const source = clip();
    const firstStill = still(0.25, new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }));
    const replacementStill = still(0.2504, new Blob([new Uint8Array([4, 5])], { type: "image/jpeg" }));

    expect(store.isMemoryOnly()).toBe(true);
    expect(await store.get(SESSION_ID, ROOM_ID)).toBeNull();
    await store.put(source);
    expect(await store.get(SESSION_ID, ROOM_ID)).toEqual(source);

    expect(await store.addStillsIfSourceMatches(
      SESSION_ID,
      ROOM_ID,
      source.sourceSha256,
      source.capturedAt,
      [firstStill],
    )).toBe(true);
    expect(await store.addStillsIfSourceMatches(
      SESSION_ID,
      ROOM_ID,
      "b".repeat(64),
      source.capturedAt,
      [still(2, new Blob(["mismatch"]))],
    )).toBe(false);
    expect(await store.addStillsIfSourceMatches(
      SESSION_ID,
      ROOM_ID,
      source.sourceSha256,
      "different-capture",
      [],
    )).toBe(false);
    expect((await store.get(SESSION_ID, ROOM_ID))?.stills).toHaveLength(1);

    expect(await store.addStillsIfSourceMatches(
      SESSION_ID,
      ROOM_ID,
      source.sourceSha256,
      source.capturedAt,
      [replacementStill],
    )).toBe(true);
    const updated = await store.get(SESSION_ID, ROOM_ID);
    expect(updated?.stills).toHaveLength(1);
    expect(updated?.stills[0]?.blob.size).toBe(replacementStill.blob.size);

    await expect(store.remove(SESSION_ID, ROOM_ID)).resolves.toBeUndefined();
    expect(await store.get(SESSION_ID, ROOM_ID)).toBeNull();
    store.close();
  });

  it("keeps clips scoped to one store instance and releases them on close", async () => {
    const firstStore = createVideoClipStore();
    const secondStore = createVideoClipStore();
    const firstClip = clip();
    const secondClip = clip({ sessionId: "session-2", roomId: "bathroom" });

    await firstStore.put(firstClip);
    expect(await secondStore.get(SESSION_ID, ROOM_ID)).toBeNull();
    await secondStore.put(secondClip);
    firstStore.close();

    expect(await firstStore.get(SESSION_ID, ROOM_ID)).toBeNull();
    expect(await secondStore.get("session-2", "bathroom")).toEqual(secondClip);
    expect(await createVideoClipStore().get("session-2", "bathroom")).toBeNull();
    secondStore.close();
  });

  it("rejects clips beyond the existing per-video limit and keeps the previous clip", async () => {
    const store = createVideoClipStore();
    const original = clip({
      video: sizedBlob(VIDEO_MAX_BYTES),
      sizeBytes: VIDEO_MAX_BYTES,
    });
    const oversizedReplacement = clip({
      video: sizedBlob(VIDEO_MAX_BYTES + 1),
      sizeBytes: VIDEO_MAX_BYTES + 1,
    });

    await store.put(original);
    await expect(store.put(oversizedReplacement)).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
    expect(await store.get(SESSION_ID, ROOM_ID)).toEqual(original);
    const anotherRoom = clip({ roomId: "bathroom" });
    await expect(store.put(anotherRoom)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(await store.get(SESSION_ID, "bathroom")).toBeNull();
    store.close();
  });

  it("applies still count and byte limits before writing to persistent storage", async () => {
    vi.stubGlobal("indexedDB", {});
    const saved = clip();
    const transaction = {
      store: {
        get: vi.fn(async () => saved),
        put: vi.fn(async () => undefined),
      },
      done: Promise.resolve(),
      abort: vi.fn(),
    };
    openDBMock.mockResolvedValue({ transaction: vi.fn(() => transaction) });
    const store = createVideoClipStore();

    await expect(store.addStillsIfSourceMatches(
      SESSION_ID,
      ROOM_ID,
      saved.sourceSha256,
      saved.capturedAt,
      [still(0.5, sizedBlob(512 * 1024 + 1))],
    )).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });

    expect(transaction.store.put).not.toHaveBeenCalled();
    expect(store.isMemoryOnly()).toBe(false);
    store.close();
  });

  it("switches to temporary memory when IndexedDB denies opening and keeps the status visible", async () => {
    vi.stubGlobal("indexedDB", {});
    openDBMock.mockRejectedValue(Object.assign(new Error("Storage access is denied."), { name: "SecurityError" }));
    const store = createVideoClipStore();
    const source = clip();

    expect(store.isMemoryOnly()).toBe(false);
    expect(await store.get(SESSION_ID, ROOM_ID)).toBeNull();
    expect(store.isMemoryOnly()).toBe(true);
    await store.put(source);
    expect(await store.get(SESSION_ID, ROOM_ID)).toEqual(source);
    expect(await store.addStillsIfSourceMatches(
      SESSION_ID,
      ROOM_ID,
      source.sourceSha256,
      source.capturedAt,
      [still(0.5, new Blob(["source frame"], { type: "image/jpeg" }))],
    )).toBe(true);
    expect((await store.get(SESSION_ID, ROOM_ID))?.stills).toHaveLength(1);
    await expect(store.remove(SESSION_ID, ROOM_ID)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringContaining("removal from this device could not be confirmed"),
    });
    const retained = await store.get(SESSION_ID, ROOM_ID);
    expect(retained?.sourceSha256).toBe(source.sourceSha256);
    expect(retained?.video.size).toBe(source.video.size);
    expect(retained?.stills).toHaveLength(1);
    store.close();
  });

  it("keeps loaded clips and accepts a new clip in memory after an IndexedDB quota failure", async () => {
    vi.stubGlobal("indexedDB", {});
    const savedBathroomClip = clip({
      roomId: "bathroom",
      roomLabel: "Bathroom",
    });
    const database = {
      get: vi.fn(async (_store: string, id: string) => id === savedBathroomClip.id ? savedBathroomClip : undefined),
      put: vi.fn().mockRejectedValue(Object.assign(new Error("Storage quota is exhausted."), { name: "QuotaExceededError" })),
    };
    openDBMock.mockResolvedValue(database);
    const store = createVideoClipStore();

    expect(await store.get(SESSION_ID, "bathroom")).toEqual(savedBathroomClip);
    expect(store.isMemoryOnly()).toBe(false);
    const newKitchenClip = clip();
    await store.put(newKitchenClip);

    expect(store.isMemoryOnly()).toBe(true);
    expect(await store.get(SESSION_ID, ROOM_ID)).toEqual(newKitchenClip);
    expect(await store.get(SESSION_ID, "bathroom")).toEqual(savedBathroomClip);
    expect(await store.addStillsIfSourceMatches(
      SESSION_ID,
      "bathroom",
      savedBathroomClip.sourceSha256,
      savedBathroomClip.capturedAt,
      [still(0.5, new Blob(["mock frame"], { type: "image/jpeg" }))],
    )).toBe(true);
    expect((await store.get(SESSION_ID, "bathroom"))?.stills).toHaveLength(1);
    store.close();
  });

  it("deletes the stale persistent clip after quota fallback so a fresh store cannot restore it", async () => {
    vi.stubGlobal("indexedDB", {});
    const savedClip = clip();
    const persistentClips = new Map([[savedClip.id, savedClip]]);
    const database = {
      get: vi.fn(async (_store: string, id: string) => persistentClips.get(id)),
      put: vi.fn().mockRejectedValue(Object.assign(new Error("Storage quota is exhausted."), { name: "QuotaExceededError" })),
      delete: vi.fn(async (_store: string, id: string) => { persistentClips.delete(id); }),
    };
    openDBMock.mockResolvedValue(database);
    const store = createVideoClipStore();

    expect(await store.get(SESSION_ID, ROOM_ID)).toEqual(savedClip);
    const replacement = clip({ capturedAt: "2026-10-29T10:15:00.000Z" });
    await store.put(replacement);
    expect(store.isMemoryOnly()).toBe(true);
    expect(persistentClips.get(CLIP_ID)).toEqual(savedClip);

    await store.remove(SESSION_ID, ROOM_ID);
    expect(database.delete).toHaveBeenCalledWith("clips", CLIP_ID);
    expect(persistentClips.has(CLIP_ID)).toBe(false);
    store.close();

    const reloadedStore = createVideoClipStore();
    expect(await reloadedStore.get(SESSION_ID, ROOM_ID)).toBeNull();
    reloadedStore.close();
  });

  it("reports failed persistent deletion after quota fallback and keeps the clip available", async () => {
    vi.stubGlobal("indexedDB", {});
    const savedClip = clip();
    const persistentClips = new Map([[savedClip.id, savedClip]]);
    const database = {
      get: vi.fn(async (_store: string, id: string) => persistentClips.get(id)),
      put: vi.fn().mockRejectedValue(Object.assign(new Error("Storage quota is exhausted."), { name: "QuotaExceededError" })),
      delete: vi.fn().mockRejectedValue(Object.assign(new Error("Storage quota is exhausted."), { name: "QuotaExceededError" })),
    };
    openDBMock.mockResolvedValue(database);
    const store = createVideoClipStore();

    expect(await store.get(SESSION_ID, ROOM_ID)).toEqual(savedClip);
    const replacement = clip({ capturedAt: "2026-10-29T10:15:00.000Z" });
    await store.put(replacement);
    await expect(store.remove(SESSION_ID, ROOM_ID)).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
      message: expect.stringContaining("could not be removed from persistent local storage"),
    });
    expect(await store.get(SESSION_ID, ROOM_ID)).toEqual(replacement);
    expect(persistentClips.get(CLIP_ID)).toEqual(savedClip);
    store.close();
  });

  it("continues with an empty in-memory store when opening IndexedDB fails from quota", async () => {
    vi.stubGlobal("indexedDB", {});
    openDBMock.mockRejectedValue(Object.assign(new Error("Storage quota is exhausted."), { name: "QuotaExceededError" }));
    const store = createVideoClipStore();

    await expect(store.get(SESSION_ID, ROOM_ID)).resolves.toBeNull();
    expect(store.isMemoryOnly()).toBe(true);
    const source = clip();
    await store.put(source);
    expect(await store.get(SESSION_ID, ROOM_ID)).toEqual(source);
    store.close();
  });

  it("does not claim persistent removal when browser storage access was denied", async () => {
    vi.stubGlobal("indexedDB", {});
    openDBMock.mockRejectedValue(Object.assign(new Error("Storage access is denied."), { name: "SecurityError" }));
    const store = createVideoClipStore();
    const source = clip();

    await expect(store.get(SESSION_ID, ROOM_ID)).resolves.toBeNull();
    await store.put(source);
    await expect(store.remove(SESSION_ID, ROOM_ID)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringContaining("removal from this device could not be confirmed"),
    });
    expect(await store.get(SESSION_ID, ROOM_ID)).toEqual(source);
    store.close();
  });
});

function clip(overrides: Partial<Parameters<typeof createStoredVideoClip>[0]> = {}) {
  const video = overrides.video ?? new Blob([new Uint8Array([0, 0, 0, 4])], { type: "video/mp4" });
  return createStoredVideoClip({
    sessionId: SESSION_ID,
    roomId: ROOM_ID,
    roomLabel: "Kitchen",
    fileName: "mock-unit.mp4",
    mime: "video/mp4",
    sizeBytes: video.size,
    durationSeconds: 1,
    width: 1,
    height: 1,
    video,
    sourceSha256: "a".repeat(64),
    stills: [],
    capturedAt: "2026-10-29T09:15:00.000Z",
    ...overrides,
  });
}

function still(timestampSeconds: number, blob: Blob) {
  return { timestampSeconds, blob, width: 1, height: 1 };
}

function sizedBlob(size: number): Blob {
  return {
    size,
    slice: () => new Blob(),
  } as unknown as Blob;
}
