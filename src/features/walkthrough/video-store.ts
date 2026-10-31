/** Local, versioned IndexedDB persistence for room walkthrough video clips. */

import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";

import {
  sha256Blob,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_DURATION_SECONDS,
  type VideoStill,
} from "./video-utils";

export const VIDEO_CLIP_DB_NAME = "move-in-ready-video-clips";
/** Increment for IndexedDB object-store/index layout changes. */
export const VIDEO_CLIP_DB_VERSION = 1;
/** Increment when the serialized row contract changes. */
export const VIDEO_CLIP_SCHEMA_VERSION = 2;

/** Temporary fallback caps: one session's four rooms, at most 60 MiB of
 * source video and 60 MiB of source stills across the store. */
const MAX_MEMORY_CLIPS = 4;
const MAX_MEMORY_VIDEO_BYTES = VIDEO_MAX_BYTES;
const MAX_MEMORY_STILL_BYTES = VIDEO_MAX_BYTES;
// A room retains up to 30 browser review stills plus up to 12 exact server
// JPEGs cited by Muse. Candidate-time browser stills are usually replaced.
const MAX_MEMORY_STILLS_PER_CLIP = 42;
const MAX_MEMORY_BYTES_PER_STILL = 512 * 1024;
const MAX_REVIEW_STILL_DIMENSION = 1280;
const MAX_REVIEW_STILL_PIXELS = 1_000_000;
const MAX_SOURCE_VIDEO_PIXELS = 9_000_000;

export interface StoredVideoStill {
  timestampSeconds: number;
  blob: Blob;
  width: number;
  height: number;
}

/**
 * A room has at most one current clip. Replacing a clip overwrites this row
 * only after the replacement has passed validation and its stills were read.
 */
export interface StoredVideoClip {
  id: string;
  schemaVersion: typeof VIDEO_CLIP_SCHEMA_VERSION;
  sessionId: string;
  roomId: string;
  roomLabel: string;
  fileName: string;
  mime: "video/mp4" | "video/quicktime";
  sizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
  capturedAt: string;
  /** SHA-256 of the exact original video blob, checked against server upload bytes. */
  sourceSha256: string;
  video: Blob;
  stills: StoredVideoStill[];
}

type StoredVideoClipRow = Omit<StoredVideoClip, "schemaVersion" | "sourceSha256"> & {
  schemaVersion: 1 | typeof VIDEO_CLIP_SCHEMA_VERSION;
  sourceSha256?: string;
};

interface VideoClipDatabase extends DBSchema {
  clips: {
    key: string;
    value: StoredVideoClipRow;
    indexes: { "by-session": string };
  };
}

export type VideoStoreErrorCode = "UNAVAILABLE" | "QUOTA_EXCEEDED" | "SCHEMA_MISMATCH" | "IO";

/** Safe error: never carries a video, still, key, or provider response. */
export class VideoStoreError extends Error {
  readonly code: VideoStoreErrorCode;
  readonly retryable: boolean;

  constructor(code: VideoStoreErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "VideoStoreError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface VideoClipStore {
  /** True when this instance keeps clips only in memory until it is closed. */
  isMemoryOnly(): boolean;
  get(sessionId: string, roomId: string): Promise<StoredVideoClip | null>;
  put(clip: StoredVideoClip): Promise<void>;
  /** Atomically append source stills only while the room still holds this video. */
  addStillsIfSourceMatches(
    sessionId: string,
    roomId: string,
    expectedSourceSha256: string,
    expectedCapturedAt: string,
    stills: readonly StoredVideoStill[],
  ): Promise<boolean>;
  remove(sessionId: string, roomId: string): Promise<void>;
  /** Delete every room clip saved under one inspection session. */
  removeSession(sessionId: string): Promise<void>;
  close(): void;
}

/** Create an IndexedDB clip store. Use one instance per mounted feature owner. */
export function createVideoClipStore(): VideoClipStore {
  let memoryOnly = typeof indexedDB === "undefined";
  // Keep a bounded copy of clips already read or written. If IndexedDB fills
  // during this walkthrough, the loaded rooms remain available in memory.
  const memoryClips = new Map<string, StoredVideoClip>();
  let databasePromise: Promise<IDBPDatabase<VideoClipDatabase>> | null = null;
  let persistentDatabaseWasOpened = false;

  const database = (): Promise<IDBPDatabase<VideoClipDatabase>> => {
    if (typeof indexedDB === "undefined") {
      memoryOnly = true;
      return Promise.reject(new VideoStoreError(
        "UNAVAILABLE",
        "IndexedDB is unavailable. This walkthrough will be kept only in temporary memory for this page.",
        true,
      ));
    }
    if (!databasePromise) {
      databasePromise = openDB<VideoClipDatabase>(VIDEO_CLIP_DB_NAME, VIDEO_CLIP_DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains("clips")) {
            const store = db.createObjectStore("clips", { keyPath: "id" });
            store.createIndex("by-session", "sessionId");
          }
        },
        blocked() {
          databasePromise = null;
        },
        terminated() {
          databasePromise = null;
        },
      }).then((db) => {
        persistentDatabaseWasOpened = true;
        return db;
      }).catch((error: unknown) => {
        databasePromise = null;
        if (isIndexedDbUnavailable(error)) {
          memoryOnly = true;
          throw new VideoStoreError(
            "UNAVAILABLE",
            "IndexedDB is unavailable. This walkthrough will be kept only in temporary memory for this page.",
            true,
          );
        }
        const normalized = normalizeStorageError(error);
        if (normalized.code === "QUOTA_EXCEEDED") memoryOnly = true;
        throw normalized;
      });
    }
    return databasePromise;
  };

  const getFromMemory = (sessionId: string, roomId: string): StoredVideoClip | null => {
    const row = memoryClips.get(makeVideoClipId(sessionId, roomId));
    if (row === undefined) return null;
    const validated = validateStoredVideoClip(row, { sessionId, roomId });
    if (!validated.ok || validated.clip.schemaVersion !== VIDEO_CLIP_SCHEMA_VERSION || !validated.clip.sourceSha256) {
      throw new VideoStoreError(
        "SCHEMA_MISMATCH",
        validated.ok ? "The temporary room clip is missing its source hash." : validated.message,
        false,
      );
    }
    return cloneStoredVideoClip(validated.clip as StoredVideoClip);
  };

  const putInMemory = (clip: StoredVideoClip): void => {
    assertMemoryClipWithinBounds(clip);
    assertMemoryStoreCapacity(memoryClips, clip);
    memoryClips.set(clip.id, cloneStoredVideoClip(clip));
  };

  const rememberClip = (clip: StoredVideoClip): void => {
    try {
      putInMemory(clip);
    } catch {
      // Caching is opportunistic while IndexedDB works. A memory-only
      // transition below still enforces the same strict bounded capacity.
    }
  };

  const activateMemoryFallback = (error: unknown): boolean => {
    // Resource-bound failures come from this store's validation, not from
    // IndexedDB. They must not mark a functioning persistent store as failed.
    if (error instanceof VideoStoreError && error.code !== "UNAVAILABLE" &&
        !(error.code === "QUOTA_EXCEEDED" && memoryOnly)) return false;
    const normalized = normalizeStorageError(error);
    if (normalized.code !== "UNAVAILABLE" && normalized.code !== "QUOTA_EXCEEDED") return false;
    memoryOnly = true;
    return true;
  };

  const addStillsInMemory = (
    sessionId: string,
    roomId: string,
    expectedSourceSha256: string,
    expectedCapturedAt: string,
    stills: readonly StoredVideoStill[],
  ): boolean => {
    const id = makeVideoClipId(sessionId, roomId);
    const current = memoryClips.get(id);
    if (current === undefined) return false;
    const validated = validateStoredVideoClip(current, { sessionId, roomId });
    if (!validated.ok || validated.clip.schemaVersion !== VIDEO_CLIP_SCHEMA_VERSION ||
        validated.clip.sourceSha256 !== expectedSourceSha256 || validated.clip.capturedAt !== expectedCapturedAt) {
      return false;
    }
    const byTimestamp = new Map(validated.clip.stills.map((still) => [Math.round(still.timestampSeconds * 1000), still]));
    for (const still of stills) {
      assertMemoryStillWithinBounds(still, validated.clip.durationSeconds);
      byTimestamp.set(Math.round(still.timestampSeconds * 1000), { ...still });
    }
    const updated = { ...validated.clip, stills: [...byTimestamp.values()] } as StoredVideoClip;
    assertMemoryClipWithinBounds(updated);
    assertMemoryStoreCapacity(memoryClips, updated);
    memoryClips.set(id, cloneStoredVideoClip(updated));
    return true;
  };

  return {
    isMemoryOnly() {
      return memoryOnly;
    },

    async get(sessionId, roomId) {
      const id = makeVideoClipId(sessionId, roomId);
      if (memoryOnly) return getFromMemory(sessionId, roomId);
      try {
        const db = await database();
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const row = await db.get("clips", id);
          if (row === undefined) return null;
          const validated = validateStoredVideoClip(row, { sessionId, roomId });
          if (!validated.ok) {
            throw new VideoStoreError("SCHEMA_MISMATCH", validated.message, false);
          }
          if (validated.clip.schemaVersion === VIDEO_CLIP_SCHEMA_VERSION && validated.clip.sourceSha256) {
            rememberClip(validated.clip as StoredVideoClip);
            return validated.clip as StoredVideoClip;
          }

          const upgraded: StoredVideoClip = {
            ...validated.clip,
            schemaVersion: VIDEO_CLIP_SCHEMA_VERSION,
            sourceSha256: await sha256Blob(validated.clip.video),
          };
          const transaction = db.transaction("clips", "readwrite");
          try {
            const currentRow = await transaction.store.get(id);
            if (currentRow === undefined) {
              await transaction.done;
              return null;
            }
            const current = validateStoredVideoClip(currentRow, { sessionId, roomId });
            if (!current.ok) {
              await transaction.done;
              throw new VideoStoreError("SCHEMA_MISMATCH", current.message, false);
            }
            if (current.clip.schemaVersion === VIDEO_CLIP_SCHEMA_VERSION && current.clip.sourceSha256) {
              await transaction.done;
              rememberClip(current.clip as StoredVideoClip);
              return current.clip as StoredVideoClip;
            }
            if (!sameLegacyClipRevision(validated.clip, current.clip)) {
              await transaction.done;
              continue;
            }
            // Retain the verified, fully hashed row before attempting the
            // legacy-row upgrade, which itself may fail when storage is full.
            rememberClip(upgraded);
            await transaction.store.put(upgraded);
            await transaction.done;
            rememberClip(upgraded);
            return upgraded;
          } catch (error) {
            try { transaction.abort(); } catch { /* already committed or aborted */ }
            throw error;
          }
        }
        throw new VideoStoreError("IO", "The room clip changed while it was being verified. Reopen the room and try again.", true);
      } catch (error) {
        if (activateMemoryFallback(error)) return getFromMemory(sessionId, roomId);
        throw normalizeStorageError(error);
      }
    },

    async put(clip) {
      const validated = validateStoredVideoClip(clip, {
        sessionId: clip.sessionId,
        roomId: clip.roomId,
      });
      if (!validated.ok) {
        throw new VideoStoreError("SCHEMA_MISMATCH", validated.message, false);
      }
      if (memoryOnly) {
        putInMemory(validated.clip as StoredVideoClip);
        return;
      }
      try {
        await (await database()).put("clips", validated.clip);
        rememberClip(validated.clip as StoredVideoClip);
      } catch (error) {
        if (activateMemoryFallback(error)) {
          putInMemory(validated.clip as StoredVideoClip);
          return;
        }
        throw normalizeStorageError(error);
      }
    },

    async addStillsIfSourceMatches(sessionId, roomId, expectedSourceSha256, expectedCapturedAt, stills) {
      if (memoryOnly) return addStillsInMemory(sessionId, roomId, expectedSourceSha256, expectedCapturedAt, stills);
      let db: IDBPDatabase<VideoClipDatabase>;
      try {
        db = await database();
      } catch (error) {
        if (activateMemoryFallback(error)) {
          return addStillsInMemory(sessionId, roomId, expectedSourceSha256, expectedCapturedAt, stills);
        }
        throw normalizeStorageError(error);
      }
      let transaction: IDBPTransaction<VideoClipDatabase, ["clips"], "readwrite"> | null = null;
      try {
        transaction = db.transaction("clips", "readwrite");
        const id = makeVideoClipId(sessionId, roomId);
        const row = await transaction.store.get(id);
        if (row === undefined) {
          await transaction.done;
          return false;
        }
        const validated = validateStoredVideoClip(row, { sessionId, roomId });
        if (!validated.ok || validated.clip.schemaVersion !== VIDEO_CLIP_SCHEMA_VERSION ||
            validated.clip.sourceSha256 !== expectedSourceSha256 || validated.clip.capturedAt !== expectedCapturedAt) {
          await transaction.done;
          return false;
        }
        rememberClip(validated.clip as StoredVideoClip);
        const byTimestamp = new Map(validated.clip.stills.map((still) => [Math.round(still.timestampSeconds * 1000), still]));
        for (const still of stills) byTimestamp.set(Math.round(still.timestampSeconds * 1000), { ...still });
        const updated = { ...validated.clip, stills: [...byTimestamp.values()] } as StoredVideoClip;
        assertMemoryClipWithinBounds(updated);
        await transaction.store.put(updated);
        await transaction.done;
        rememberClip(updated);
        return true;
      } catch (error) {
        try { transaction?.abort(); } catch { /* already committed or aborted */ }
        if (activateMemoryFallback(error)) {
          return addStillsInMemory(sessionId, roomId, expectedSourceSha256, expectedCapturedAt, stills);
        }
        throw normalizeStorageError(error);
      }
    },

    async remove(sessionId, roomId) {
      const id = makeVideoClipId(sessionId, roomId);
      if (memoryOnly && !persistentDatabaseWasOpened) {
        if (typeof indexedDB === "undefined") {
          // This runtime has no IndexedDB API, so no clip could be persisted
          // by this store in this browser context.
          memoryClips.delete(id);
          return;
        }
        // Storage may contain a clip even though access was denied before this
        // store could read it. Do not report a successful persistent deletion.
        throw new VideoStoreError(
          "UNAVAILABLE",
          "Browser storage could not be accessed, so removal from this device could not be confirmed. Restore storage access and try again.",
          true,
        );
      }
      try {
        await (await database()).delete("clips", id);
        memoryClips.delete(id);
      } catch (error) {
        if (activateMemoryFallback(error)) {
          // A failed IndexedDB delete cannot be represented as a successful
          // local deletion. Keep the in-memory copy usable and report failure.
          throw new VideoStoreError(
            "QUOTA_EXCEEDED",
            "Local storage is full. This walkthrough is now memory only, but the saved clip could not be removed from persistent local storage.",
            true,
          );
        }
        throw normalizeStorageError(error);
      }
    },

    async removeSession(sessionId) {
      const prefix = `${encodeURIComponent(sessionId)}::`;
      if (memoryOnly && !persistentDatabaseWasOpened) {
        if (typeof indexedDB === "undefined") {
          for (const key of [...memoryClips.keys()]) {
            if (key.startsWith(prefix)) memoryClips.delete(key);
          }
          return;
        }
        throw new VideoStoreError(
          "UNAVAILABLE",
          "Browser storage could not be accessed, so removal from this device could not be confirmed. Restore storage access and try again.",
          true,
        );
      }
      try {
        const db = await database();
        const transaction = db.transaction("clips", "readwrite");
        try {
          const keys = await transaction.store.index("by-session").getAllKeys(sessionId);
          for (const key of keys) await transaction.store.delete(key);
          await transaction.done;
        } catch (error) {
          try { transaction.abort(); } catch { /* already committed or aborted */ }
          throw error;
        }
        for (const key of [...memoryClips.keys()]) {
          if (key.startsWith(prefix)) memoryClips.delete(key);
        }
      } catch (error) {
        if (activateMemoryFallback(error)) {
          throw new VideoStoreError(
            "QUOTA_EXCEEDED",
            "Local storage is full. This walkthrough is now memory only, but the saved clips could not be removed from persistent local storage.",
            true,
          );
        }
        throw normalizeStorageError(error);
      }
    },

    close() {
      memoryClips.clear();
      if (!databasePromise) return;
      const pendingDatabase = databasePromise;
      databasePromise = null;
      void pendingDatabase.then((db) => db.close()).catch(() => undefined);
    },
  };
}

export function makeVideoClipId(sessionId: string, roomId: string): string {
  return `${encodeURIComponent(sessionId)}::${encodeURIComponent(roomId)}`;
}

export function createStoredVideoClip(input: {
  sessionId: string;
  roomId: string;
  roomLabel: string;
  fileName: string;
  mime: StoredVideoClip["mime"];
  sizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
  video: Blob;
  sourceSha256: string;
  stills: readonly VideoStill[];
  capturedAt?: string;
}): StoredVideoClip {
  return {
    id: makeVideoClipId(input.sessionId, input.roomId),
    schemaVersion: VIDEO_CLIP_SCHEMA_VERSION,
    sessionId: input.sessionId,
    roomId: input.roomId,
    roomLabel: input.roomLabel,
    fileName: input.fileName,
    mime: input.mime,
    sizeBytes: input.sizeBytes,
    durationSeconds: input.durationSeconds,
    width: input.width,
    height: input.height,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    sourceSha256: input.sourceSha256,
    video: input.video,
    stills: input.stills.map((still) => ({ ...still })),
  };
}

export function validateStoredVideoClip(
  input: unknown,
  expected: { sessionId: string; roomId: string },
): { ok: true; clip: StoredVideoClipRow } | { ok: false; message: string } {
  if (!isRecord(input)) return { ok: false, message: "The saved room clip is not a valid record." };
  if (input.schemaVersion !== 1 && input.schemaVersion !== VIDEO_CLIP_SCHEMA_VERSION) {
    return { ok: false, message: "The saved room clip uses an unsupported version. Remove it and choose the video again." };
  }
  if (
    input.sessionId !== expected.sessionId ||
    input.roomId !== expected.roomId ||
    input.id !== makeVideoClipId(expected.sessionId, expected.roomId)
  ) {
    return { ok: false, message: "The saved room clip does not match this walkthrough room." };
  }
  if (
    typeof input.roomLabel !== "string" ||
    input.roomLabel.length > 120 ||
    typeof input.fileName !== "string" ||
    input.fileName.length > 255 ||
    (input.mime !== "video/mp4" && input.mime !== "video/quicktime") ||
    typeof input.sizeBytes !== "number" ||
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > VIDEO_MAX_BYTES ||
    typeof input.durationSeconds !== "number" ||
    !Number.isFinite(input.durationSeconds) ||
    input.durationSeconds <= 0 ||
    input.durationSeconds > VIDEO_MAX_DURATION_SECONDS ||
    !isPositiveSafeInteger(input.width) ||
    !isPositiveSafeInteger(input.height) ||
    input.width * input.height > MAX_SOURCE_VIDEO_PIXELS ||
    typeof input.capturedAt !== "string" ||
    input.capturedAt.length > 64 ||
    !Number.isFinite(Date.parse(input.capturedAt)) ||
    (input.schemaVersion === VIDEO_CLIP_SCHEMA_VERSION && (typeof input.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(input.sourceSha256))) ||
    (input.schemaVersion === 1 && input.sourceSha256 !== undefined && (typeof input.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(input.sourceSha256))) ||
    !isBlobLike(input.video) ||
    !Number.isSafeInteger((input.video as Blob).size) ||
    (input.video as Blob).size !== input.sizeBytes ||
    !Array.isArray(input.stills) ||
    input.stills.length > MAX_MEMORY_STILLS_PER_CLIP
  ) {
    return { ok: false, message: "The saved room clip is incomplete or damaged." };
  }
  for (const still of input.stills) {
    if (!isValidStoredStill(still, input.durationSeconds)) {
      return { ok: false, message: "The saved room clip has an invalid review still." };
    }
  }
  return { ok: true, clip: input as unknown as StoredVideoClipRow };
}

function cloneStoredVideoClip(clip: StoredVideoClip): StoredVideoClip {
  return { ...clip, stills: clip.stills.map((still) => ({ ...still })) };
}

function assertMemoryClipWithinBounds(clip: StoredVideoClip): void {
  if (clip.video.size <= 0 || clip.video.size > VIDEO_MAX_BYTES ||
      clip.sizeBytes !== clip.video.size || clip.stills.length > MAX_MEMORY_STILLS_PER_CLIP) {
    throw memoryLimitError();
  }
  for (const still of clip.stills) assertMemoryStillWithinBounds(still, clip.durationSeconds);
}

function assertMemoryStillWithinBounds(still: StoredVideoStill, durationSeconds: number): void {
  if (!isValidStoredStill(still, durationSeconds)) {
    throw memoryLimitError();
  }
}

function isValidStoredStill(value: unknown, durationSeconds: number): value is StoredVideoStill {
  if (!isRecord(value) || !Number.isFinite(value.timestampSeconds) ||
      (value.timestampSeconds as number) < 0 || (value.timestampSeconds as number) >= durationSeconds ||
      !isPositiveSafeInteger(value.width) || !isPositiveSafeInteger(value.height) ||
      (value.width as number) > MAX_REVIEW_STILL_DIMENSION ||
      (value.height as number) > MAX_REVIEW_STILL_DIMENSION ||
      (value.width as number) * (value.height as number) > MAX_REVIEW_STILL_PIXELS ||
      !isBlobLike(value.blob) || !Number.isSafeInteger(value.blob.size) ||
      value.blob.size <= 0 || value.blob.size > MAX_MEMORY_BYTES_PER_STILL) {
    return false;
  }
  return true;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function assertMemoryStoreCapacity(
  clips: ReadonlyMap<string, StoredVideoClip>,
  replacement: StoredVideoClip,
): void {
  const retained = [...clips.values()].filter((clip) => clip.id !== replacement.id);
  if (retained.length + 1 > MAX_MEMORY_CLIPS) throw memoryLimitError();

  const videoBytes = retained.reduce((total, clip) => total + clip.video.size, replacement.video.size);
  const stillBytes = retained.reduce(
    (total, clip) => total + clip.stills.reduce((sum, still) => sum + still.blob.size, 0),
    replacement.stills.reduce((sum, still) => sum + still.blob.size, 0),
  );
  if (videoBytes > MAX_MEMORY_VIDEO_BYTES || stillBytes > MAX_MEMORY_STILL_BYTES) {
    throw memoryLimitError();
  }
}

function memoryLimitError(): VideoStoreError {
  return new VideoStoreError(
    "QUOTA_EXCEEDED",
    "This walkthrough is memory only and its temporary video limit has been reached. The earlier clip is kept; export your work and choose a smaller video to continue.",
    true,
  );
}

function isIndexedDbUnavailable(error: unknown): boolean {
  if (error instanceof VideoStoreError) return error.code === "UNAVAILABLE";
  const name = (error as { name?: unknown } | null)?.name;
  return name === "SecurityError" ||
    name === "InvalidStateError" ||
    name === "NotAllowedError" ||
    name === "NotSupportedError";
}

/** Return a plain File-like object around the persisted Blob when supported. */
export function storedClipAsFile(clip: StoredVideoClip): File | Blob {
  if (typeof File !== "undefined") {
    return new File([clip.video], clip.fileName, { type: clip.mime, lastModified: Date.parse(clip.capturedAt) });
  }
  return clip.video;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlobLike(value: unknown): value is Blob {
  return typeof value === "object" && value !== null &&
    typeof (value as Blob).slice === "function" &&
    typeof (value as Blob).size === "number";
}

function sameLegacyClipRevision(left: StoredVideoClipRow, right: StoredVideoClipRow): boolean {
  return left.id === right.id &&
    left.sessionId === right.sessionId &&
    left.roomId === right.roomId &&
    left.fileName === right.fileName &&
    left.mime === right.mime &&
    left.sizeBytes === right.sizeBytes &&
    left.durationSeconds === right.durationSeconds &&
    left.width === right.width &&
    left.height === right.height &&
    left.capturedAt === right.capturedAt &&
    left.video.size === right.video.size;
}

function normalizeStorageError(error: unknown): VideoStoreError {
  if (error instanceof VideoStoreError) return error;
  const candidate = error as { name?: unknown } | null;
  if (candidate && typeof candidate === "object" && (
    candidate.name === "QuotaExceededError" || candidate.name === "NS_ERROR_DOM_QUOTA_REACHED"
  )) {
    return new VideoStoreError(
      "QUOTA_EXCEEDED",
      "The browser’s local storage is full.",
      true,
    );
  }
  return new VideoStoreError(
    "IO",
    "The browser could not save this clip locally. The earlier clip is kept; retry or download a copy before leaving this page.",
    true,
  );
}
