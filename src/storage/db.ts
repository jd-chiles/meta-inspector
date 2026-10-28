/**
 * Local persistence for mock sessions and normalized media (REQ-006, REQ-007).
 *
 * What this module owns:
 * - IndexedDB storage of session rows (domain `SessionState`) and media
 *   blobs (canonical bytes as `Uint8Array` + MIME), with explicit schema
 *   versions so incompatible or corrupt data surfaces a recovery state
 *   instead of being trusted.
 * - Transactional deletion: deleting a session removes its media blobs in
 *   the same transaction; clearing removes everything.
 * - Deletion tombstones are honored in memory: `mergePreservingDeletion`
 *   guarantees a storage write can never resurrect a deleted session or a
 *   deleted item record (REQ-006 "storage operations do not restore deleted
 *   records").
 * - Quota/private-mode failures are classified (`isQuotaError`) so callers
 *   can offer the explicit in-memory session fallback with a warning
 *   (REQ-007). No server database, cloud storage, analytics, or
 *   media service-worker cache is used here.
 * - Local deletion only removes local records; it never claims to revoke
 *   provider submissions or downloaded exports (REQ-007).
 *
 * Dependency-free and framework-free: works in the browser and in unit
 * tests (via `MemorySessionStore` or an injected `IDBFactory`). Object URLs
 * are NOT managed here — the session manager owns URL lifecycle and
 * revocation (delete/replace revokes synchronously).
 */
import {
  EVIDENCE_SCHEMA_VERSION,
  type SessionState,
} from "../domain/evidence";

/** IndexedDB database name for mock-unit walkthrough data. */
export const STORAGE_DB_NAME = "habitability-walkthrough";

/** IndexedDB structural version (object-store layout), not evidence schema. */
export const STORAGE_DB_VERSION = 1;

/** Expected evidence schema version inside stored rows. */
export const STORAGE_SCHEMA_VERSION = EVIDENCE_SCHEMA_VERSION;

export const SESSIONS_STORE = "sessions";
export const MEDIA_STORE = "media";

/** Canonical media bytes kept alongside the session row's media reference. */
export interface MediaRecord {
  mediaId: string;
  sessionId: string;
  itemId: string;
  /** Canonical (server-normalized) bytes. Never a remote URL. */
  bytes: Uint8Array;
  mime: string;
  createdAt: string;
}

export type LoadKind = "found" | "missing" | "needs-reset" | "corrupt";

export interface LoadFound {
  kind: "found";
  state: SessionState;
}

export interface LoadMissing {
  kind: "missing";
  sessionId: string;
}

export interface LoadNeedsReset {
  kind: "needs-reset";
  sessionId: string;
  /** Stored schema version (or null when unreadable). */
  storedSchemaVersion: number | null;
  expectedSchemaVersion: number;
  detail: string;
}

export interface LoadCorrupt {
  kind: "corrupt";
  sessionId: string;
  detail: string;
}

export type LoadResult = LoadFound | LoadMissing | LoadNeedsReset | LoadCorrupt;

export type StorageCode =
  | "QUOTA_EXCEEDED"
  | "UNAVAILABLE"
  | "SCHEMA_MISMATCH"
  | "CORRUPT"
  | "IO";

/** Safe storage failure. Never carries media bytes, keys, or provider data. */
export class StorageError extends Error {
  readonly code: StorageCode;
  /** True when the worker may retry the operation explicitly. */
  readonly retryable: boolean;

  constructor(code: StorageCode, message: string, retryable: boolean) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface SessionStore {
  saveSession(state: SessionState): Promise<void>;
  loadSession(sessionId: string): Promise<LoadResult>;
  listSessionIds(): Promise<string[]>;
  deleteSession(sessionId: string): Promise<void>;
  saveMedia(record: MediaRecord): Promise<void>;
  loadMedia(mediaId: string): Promise<MediaRecord | null>;
  deleteMedia(mediaId: string): Promise<void>;
  deleteSessionMedia(sessionId: string): Promise<void>;
  clearAll(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Pure helpers (deterministic, no browser APIs).                       */
/* ------------------------------------------------------------------ */

/** True for quota-shaped DOMExceptions / errors from IndexedDB writes. */
export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "";
  const code = typeof record.code === "number" ? record.code : -1;
  return (
    name === "QuotaExceededError" ||
    // Legacy IE/Edge numeric code for quota exceeded.
    code === 22 ||
    // Firefox private-mode historically surfaces NS_ERROR_DOM_QUOTA_REACHED.
    name === "NS_ERROR_DOM_QUOTA_REACHED"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural check for a stored session row. Rejects anything that is not
 * shaped like a `SessionState`; callers surface `corrupt` with a recovery
 * (reset) action instead of trusting it (REQ-006/REQ-007).
 */
export function validateStoredSession(value: unknown): {
  ok: true;
  state: SessionState;
} | { ok: false; detail: string } {
  if (!isRecord(value)) return { ok: false, detail: "stored session is not an object" };
  const { sessionId, schemaVersion, items } = value;
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return { ok: false, detail: "stored session has no sessionId" };
  }
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    return { ok: false, detail: "stored session has no integer schemaVersion" };
  }
  if (!isRecord(items)) {
    return { ok: false, detail: "stored session has no items record" };
  }
  for (const [itemId, item] of Object.entries(items)) {
    if (!isRecord(item)) {
      return { ok: false, detail: `stored item "${itemId}" is not an object` };
    }
    if (item.itemId !== itemId) {
      return { ok: false, detail: `stored item key "${itemId}" mismatches its itemId` };
    }
    if (typeof item.attempt !== "number" || typeof item.revision !== "number") {
      return { ok: false, detail: `stored item "${itemId}" has non-numeric attempt/revision` };
    }
  }
  return { ok: true, state: value as unknown as SessionState };
}

/**
 * Merge an incoming session write over the stored row without ever
 * resurrecting deleted records and without letting a stale write overwrite
 * newer evidence (REQ-006/REQ-007):
 * - A deleted session stays deleted even if the incoming copy says otherwise.
 * - A deleted item stays deleted even if the incoming copy carries live
 *   evidence for it. Late or replayed writes can therefore never restore
 *   removed records; only an explicit new session starts fresh.
 * - For two live copies of the same item, the newer revision wins: a delayed
 *   persist of an older attempt can never overwrite the replacement photo
 *   that superseded it. Ties keep the incoming shape (the manager only ever
 *   persists its current state, so equal revisions are identical).
 * - A live incoming deletion of an item or session is adopted: deletion is
 *   authoritative and newer than the live record it replaces.
 */
export function mergePreservingDeletion(
  existing: SessionState | null,
  incoming: SessionState,
): SessionState {
  if (!existing) return incoming;
  if (existing.deleted) {
    // Keep the tombstone; still adopt harmless metadata freshness.
    return { ...incoming, deleted: true };
  }
  if (incoming.deleted) {
    // Deletion is terminal and authoritative: nothing legitimate writes
    // after it, so the incoming tombstone wins over the live row.
    return incoming;
  }
  let changed = false;
  const items: SessionState["items"] = { ...incoming.items };
  for (const [itemId, stored] of Object.entries(existing.items)) {
    const next = incoming.items[itemId];
    if (stored.deleted) {
      if (next && !next.deleted) {
        items[itemId] = stored;
        changed = true;
      }
      continue;
    }
    if (!next || next.deleted) {
      // Adopted as-is from the incoming shape: deletions win, and items the
      // stored row never knew are kept.
      continue;
    }
    if (stored.revision > next.revision) {
      // The stored copy is newer (a replacement already committed): keep the
      // newer photo and never let the stale write overwrite it.
      items[itemId] = stored;
      changed = true;
    }
  }
  // Drop items the stored row never knew only when the incoming row deleted
  // the whole session — otherwise keep the incoming shape as-is.
  if (!changed) return incoming;
  return { ...incoming, items };
}

/* ------------------------------------------------------------------ */
/* In-memory store (explicit fallback + deterministic unit tests).      */
/* ------------------------------------------------------------------ */

export interface MemoryStoreOptions {
  /**
   * Simulated byte budget for media writes. When the stored media bytes
   * would exceed it, `saveMedia` throws a quota-shaped error so callers
   * (and tests) exercise the explicit quota path. Defaults to Infinity.
   */
  quotaBytes?: number;
  /** When true, the next write throws a quota-shaped error once. */
  failNextWriteWithQuota?: boolean;
}

function quotaShapedError(): Error {
  const error = new Error(
    "Storage quota exceeded. Free space or continue in memory without persistence.",
  );
  error.name = "QuotaExceededError";
  return error;
}

/**
 * Explicit in-memory session store. Used when IndexedDB is unavailable
 * (private mode / storage blocked) with a visible warning, and by unit
 * tests for deterministic refresh-recovery, schema, quota, and deletion
 * behavior. Each instance is isolated.
 */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, unknown>();
  private readonly media = new Map<string, MediaRecord>();
  private failOnce: boolean;
  private readonly quotaBytes: number;

  constructor(options: MemoryStoreOptions = {}) {
    this.failOnce = options.failNextWriteWithQuota ?? false;
    this.quotaBytes = options.quotaBytes ?? Number.POSITIVE_INFINITY;
  }

  private maybeThrowQuota(incomingBytes = 0): void {
    if (this.failOnce) {
      this.failOnce = false;
      throw quotaShapedError();
    }
    if (incomingBytes > this.quotaBytes) throw quotaShapedError();
  }

  async saveSession(state: SessionState): Promise<void> {
    this.maybeThrowQuota();
    const previousRaw = this.sessions.get(state.sessionId);
    const previous =
      previousRaw !== undefined
        ? validateStoredSession(previousRaw)
        : null;
    const merged = mergePreservingDeletion(
      previous && previous.ok ? previous.state : null,
      state,
    );
    // Structured snapshot so later mutations of the caller's object cannot
    // rewrite stored history.
    this.sessions.set(state.sessionId, JSON.parse(JSON.stringify(merged)) as unknown);
  }

  async loadSession(sessionId: string): Promise<LoadResult> {
    const raw = this.sessions.get(sessionId);
    if (raw === undefined) return { kind: "missing", sessionId };
    const parsed = validateStoredSession(raw);
    if (!parsed.ok) {
      return { kind: "corrupt", sessionId, detail: parsed.detail };
    }
    if (parsed.state.schemaVersion !== STORAGE_SCHEMA_VERSION) {
      return {
        kind: "needs-reset",
        sessionId,
        storedSchemaVersion: parsed.state.schemaVersion,
        expectedSchemaVersion: STORAGE_SCHEMA_VERSION,
        detail:
          `Stored schema v${parsed.state.schemaVersion} does not match ` +
          `expected v${STORAGE_SCHEMA_VERSION}. Reset to start a fresh mock session.`,
      };
    }
    return { kind: "found", state: parsed.state };
  }

  async listSessionIds(): Promise<string[]> {
    return [...this.sessions.keys()];
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.maybeThrowQuota();
    this.sessions.delete(sessionId);
    await this.deleteSessionMedia(sessionId);
  }

  async saveMedia(record: MediaRecord): Promise<void> {
    this.maybeThrowQuota(record.bytes.length);
    this.media.set(record.mediaId, {
      ...record,
      bytes: record.bytes.slice(),
    });
  }

  async loadMedia(mediaId: string): Promise<MediaRecord | null> {
    const found = this.media.get(mediaId);
    return found ? { ...found, bytes: found.bytes.slice() } : null;
  }

  async deleteMedia(mediaId: string): Promise<void> {
    this.media.delete(mediaId);
  }

  async deleteSessionMedia(sessionId: string): Promise<void> {
    for (const [mediaId, record] of this.media) {
      if (record.sessionId === sessionId) this.media.delete(mediaId);
    }
  }

  async clearAll(): Promise<void> {
    this.maybeThrowQuota();
    this.sessions.clear();
    this.media.clear();
  }

  /** Test helper: raw media IDs currently held. */
  mediaIds(): string[] {
    return [...this.media.keys()];
  }
}

/* ------------------------------------------------------------------ */
/* IndexedDB store (browser persistence with explicit failure states).  */
/* ------------------------------------------------------------------ */

export type IDBFactoryLike = {
  open(name: string, version?: number): IDBOpenDBRequest;
  deleteDatabase(name: string): IDBOpenDBRequest;
};

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ??
          new Error("IndexedDB request failed without error detail."),
      );
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB transaction failed."));
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted."));
  });
}

/**
 * IndexedDB-backed session store. Schema mismatches and corrupt rows are
 * reported as `needs-reset` / `corrupt` load results (never trusted);
 * quota errors propagate so the caller can switch to the explicit
 * in-memory fallback with a warning.
 */
export class IndexedDBSessionStore implements SessionStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactoryLike) {}

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        let request: IDBOpenDBRequest;
        try {
          request = this.factory.open(STORAGE_DB_NAME, STORAGE_DB_VERSION);
        } catch (error) {
          reject(error);
          return;
        }
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
            db.createObjectStore(SESSIONS_STORE, { keyPath: "sessionId" });
          }
          if (!db.objectStoreNames.contains(MEDIA_STORE)) {
            const media = db.createObjectStore(MEDIA_STORE, {
              keyPath: "mediaId",
            });
            media.createIndex("by-session", "sessionId", { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(
            request.error ?? new Error("Could not open local storage."),
          );
        request.onblocked = () =>
          reject(
            new StorageError(
              "UNAVAILABLE",
              "Local storage is blocked by another open tab. Close other tabs or continue in memory.",
              true,
            ),
          );
      });
    }
    return this.dbPromise;
  }

  private async put(
    store: string,
    value: unknown,
    key?: string,
  ): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(store, "readwrite");
    const objectStore = tx.objectStore(store);
    const request =
      key === undefined
        ? objectStore.put(value)
        : objectStore.put(value, key);
    try {
      await idbRequest(request);
      await transactionDone(tx);
    } catch (error) {
      if (isQuotaError(error)) throw error;
      throw error;
    }
  }

  private async get<T>(store: string, key: string): Promise<T | undefined> {
    const db = await this.open();
    const tx = db.transaction(store, "readonly");
    const request = tx.objectStore(store).get(key);
    const result = await idbRequest<T | undefined>(request);
    await transactionDone(tx).catch(() => undefined);
    return result ?? undefined;
  }

  async saveSession(state: SessionState): Promise<void> {
    const existing = await this.loadSession(state.sessionId);
    const merged = mergePreservingDeletion(
      existing.kind === "found" ? existing.state : null,
      state,
    );
    const row = {
      sessionId: merged.sessionId,
      schemaVersion: merged.schemaVersion,
      state: JSON.parse(JSON.stringify(merged)) as unknown,
      updatedAt: merged.updatedAt,
    };
    try {
      await this.put(SESSIONS_STORE, row);
    } catch (error) {
      if (isQuotaError(error)) throw error;
      throw new StorageError(
        "IO",
        "Could not save the session locally. Retry or continue in memory.",
        true,
      );
    }
  }

  async loadSession(sessionId: string): Promise<LoadResult> {
    let row: unknown;
    try {
      row = await this.get<unknown>(SESSIONS_STORE, sessionId);
    } catch (error) {
      if (isQuotaError(error)) throw error;
      throw new StorageError(
        "UNAVAILABLE",
        "Local storage is unavailable in this browser. Continue in memory or reset storage.",
        true,
      );
    }
    if (row === undefined) return { kind: "missing", sessionId };
    if (!isRecord(row) || !("state" in row)) {
      return {
        kind: "corrupt",
        sessionId,
        detail: "Stored session row is malformed. Reset storage to recover.",
      };
    }
    const parsed = validateStoredSession(row.state);
    if (!parsed.ok) {
      return { kind: "corrupt", sessionId, detail: parsed.detail };
    }
    if (parsed.state.schemaVersion !== STORAGE_SCHEMA_VERSION) {
      return {
        kind: "needs-reset",
        sessionId,
        storedSchemaVersion: parsed.state.schemaVersion,
        expectedSchemaVersion: STORAGE_SCHEMA_VERSION,
        detail:
          `Stored schema v${parsed.state.schemaVersion} does not match ` +
          `expected v${STORAGE_SCHEMA_VERSION}. Reset to start a fresh mock session.`,
      };
    }
    return { kind: "found", state: parsed.state };
  }

  async listSessionIds(): Promise<string[]> {
    const db = await this.open();
    const tx = db.transaction(SESSIONS_STORE, "readonly");
    const request = tx.objectStore(SESSIONS_STORE).getAllKeys();
    const keys = await idbRequest(request);
    await transactionDone(tx).catch(() => undefined);
    return keys.map((key) => String(key));
  }

  async deleteSession(sessionId: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([SESSIONS_STORE, MEDIA_STORE], "readwrite");
    tx.objectStore(SESSIONS_STORE).delete(sessionId);
    const mediaStore = tx.objectStore(MEDIA_STORE);
    const index = mediaStore.index("by-session");
    const keyRequest = index.getAllKeys(sessionId);
    keyRequest.onsuccess = () => {
      for (const key of keyRequest.result) {
        mediaStore.delete(key);
      }
    };
    await transactionDone(tx);
  }

  async saveMedia(record: MediaRecord): Promise<void> {
    try {
      // Store a plain clone; Blob and Uint8Array both survive structured
      // clone, but Uint8Array keeps unit-test and rehydration behavior equal.
      await this.put(MEDIA_STORE, {
        ...record,
        bytes: record.bytes.slice(),
      });
    } catch (error) {
      if (isQuotaError(error)) throw error;
      throw new StorageError(
        "IO",
        "Could not save the photo locally. Retry or continue in memory.",
        true,
      );
    }
  }

  async loadMedia(mediaId: string): Promise<MediaRecord | null> {
    const row = await this.get<MediaRecord>(MEDIA_STORE, mediaId);
    return row ?? null;
  }

  async deleteMedia(mediaId: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(MEDIA_STORE, "readwrite");
    tx.objectStore(MEDIA_STORE).delete(mediaId);
    await transactionDone(tx);
  }

  async deleteSessionMedia(sessionId: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(MEDIA_STORE, "readwrite");
    const mediaStore = tx.objectStore(MEDIA_STORE);
    const index = mediaStore.index("by-session");
    const keyRequest = index.getAllKeys(sessionId);
    const keys = await idbRequest(keyRequest);
    for (const key of keys) mediaStore.delete(key);
    await transactionDone(tx);
  }

  async clearAll(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([SESSIONS_STORE, MEDIA_STORE], "readwrite");
    tx.objectStore(SESSIONS_STORE).clear();
    tx.objectStore(MEDIA_STORE).clear();
    await transactionDone(tx);
  }
}

export interface CreateStoreOptions {
  /** Injected factory for tests; defaults to global indexedDB when present. */
  idbFactory?: IDBFactoryLike;
  /** Force the in-memory implementation (tests, SSR, or explicit fallback). */
  forceMemory?: boolean;
  memoryOptions?: MemoryStoreOptions;
}

function globalFactory(): IDBFactoryLike | null {
  if (typeof indexedDB === "undefined") return null;
  return indexedDB;
}

/**
 * Resolve the session store: IndexedDB when available, otherwise the
 * explicit in-memory store. Callers MUST surface `inMemory: true` with a
 * warning ("stored only for this page load") per REQ-007.
 */
export function createSessionStore(
  options: CreateStoreOptions = {},
): { store: SessionStore; inMemory: boolean } {
  if (options.forceMemory) {
    return {
      store: new MemorySessionStore(options.memoryOptions),
      inMemory: true,
    };
  }
  const factory = options.idbFactory ?? globalFactory();
  if (!factory) {
    return {
      store: new MemorySessionStore(options.memoryOptions),
      inMemory: true,
    };
  }
  return { store: new IndexedDBSessionStore(factory), inMemory: false };
}
