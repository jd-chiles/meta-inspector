/**
 * Walkthrough session manager: reducer + storage + analysis wiring with
 * async-correctness guards (REQ-002, REQ-006, REQ-007, REQ-009).
 *
 * Correctness rules enforced here (never in the UI layer):
 * - Every analysis request captures its session/item/media/attempt identity
 *   up front. A response is applied only when that identity still matches
 *   current state; a late response after replacement, item change,
 *   cancellation, or deletion is discarded and never overwrites newer
 *   evidence, never attaches to another item/version, and never restores a
 *   deleted record. Cancellation alone is not the guard — identity matching
 *   plus the reducer's own gates is.
 * - Replace and delete abort inflight work, revoke object URLs
 *   synchronously, and delete the superseded media bytes.
 * - Storage writes preserve deletion tombstones (see storage/db) and every
 *   applied reducer action is persisted; storage failures surface an
 *   explicit status with recovery instead of silently dropping evidence.
 * - Analysis failures keep the earlier usable photo (the reducer retains
 *   media on fail-analysis; this manager never clears previews on error).
 * - No secrets, provider bodies, or media bytes are logged.
 *
 * Framework-free so unit tests can drive races deterministically with a
 * fake store, fake fetch, and fake URL helpers. The React capture/review
 * components observe `SessionManagerSnapshot` and call these methods.
 */
import {
  createSession,
  ensureSessionShape,
  reduceSession,
  type ItemRecord,
  type ManualOutcome,
  type SessionState,
} from "../../domain/evidence";
import {
  createSessionStore,
  isQuotaError,
  type MediaRecord,
  type SessionStore,
} from "../../storage/db";

/** Client-side upload bound mirrors the server (authoritative check stays server-side). */
export const CLIENT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const CLIENT_ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type StorageStatusKind =
  | "loading"
  | "ready"
  | "empty"
  | "needs-reset"
  | "corrupt"
  | "in-memory"
  | "error";

export interface StorageStatus {
  kind: StorageStatusKind;
  /** Human-readable, actionable message for the current state. */
  message: string;
  /** True when persistence is best-effort memory only (explicit warning). */
  inMemory: boolean;
}

export interface InflightAnalysis {
  itemId: string;
  analysisId: string;
  attempt: number;
  mediaId: string;
  mediaHash: string;
  startedAt: string;
}

export interface SessionManagerSnapshot {
  state: SessionState | null;
  storage: StorageStatus;
  inflight: InflightAnalysis[];
}

/** Listener invoked with a fresh snapshot on every session/storage transition. */
export type SessionSnapshotListener = (
  snapshot: SessionManagerSnapshot,
) => void;

export type CreateObjectURL = (blob: Blob) => string;
export type RevokeObjectURL = (url: string) => void;

export interface NormalizedMediaPayload {
  mediaId: string;
  mime: string;
  width: number;
  height: number;
  digest: string;
  base64: string;
}

export interface AnalyzeSuccessBody {
  envelope: { draft: unknown; [key: string]: unknown };
  normalizedMedia: NormalizedMediaPayload;
  [key: string]: unknown;
}

export interface AnalyzeErrorBody {
  error: { code: string; message: string; retryable: boolean };
  analysisId: string;
}

export type AnalyzeFetch = (
  form: FormData,
  signal: AbortSignal,
) => Promise<{ status: number; body: AnalyzeSuccessBody | AnalyzeErrorBody }>;

export interface SessionManagerOptions {
  store?: SessionStore;
  /** True when the store is the explicit in-memory fallback (warn in UI). */
  inMemory?: boolean;
  createObjectURL?: CreateObjectURL;
  revokeObjectURL?: RevokeObjectURL;
  analyzeFetch?: AnalyzeFetch;
  generateId?: (prefix: string) => string;
  now?: () => string;
}

export interface CatalogSnapshotInput {
  catalogId: string;
  catalogVersion: string;
  itemIds: string[];
}

const DEFAULT_CAPTURED_AT = "2026-10-27T00:00:00.000Z";

function defaultGenerateId(prefix: string): string {
  const cryptoRef =
    typeof globalThis.crypto !== "undefined" ? globalThis.crypto : null;
  if (cryptoRef && "randomUUID" in cryptoRef) {
    return `${prefix}-${cryptoRef.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function defaultCreateObjectURL(blob: Blob): string {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    return URL.createObjectURL(blob);
  }
  // Non-browser fallback (tests/SSR): stable pseudo-URL, never persisted.
  return `blob:memory:${(blob as Blob & { size?: number }).size ?? 0}-${Date.now().toString(36)}`;
}

function defaultRevokeObjectURL(url: string): void {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Revocation is best-effort; a failed revoke must not break deletion.
    }
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}

export function decodeBase64ToBytes(base64: string): Uint8Array {
  const runtime = globalThis as {
    Buffer?: { from(data: string, encoding: string): Uint8Array };
  };
  if (runtime.Buffer) {
    return new Uint8Array(runtime.Buffer.from(base64, "base64"));
  }
  if (typeof atob !== "undefined") {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  throw new Error("No base64 decoder available in this runtime.");
}

async function defaultAnalyzeFetch(
  form: FormData,
  signal: AbortSignal,
): Promise<{ status: number; body: AnalyzeSuccessBody | AnalyzeErrorBody }> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    body: form,
    signal,
  });
  const body = (await response.json()) as
    | AnalyzeSuccessBody
    | AnalyzeErrorBody;
  return { status: response.status, body };
}

export function validateClientFile(file: {
  size: number;
  type: string;
  name?: string;
}): { ok: true } | { ok: false; code: string; message: string } {
  if (file.size <= 0) {
    return {
      ok: false,
      code: "EMPTY_FILE",
      message: "That file is empty. Choose a photo to continue.",
    };
  }
  if (file.size > CLIENT_MAX_IMAGE_BYTES) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message:
        "That photo exceeds the 8 MiB upload bound. Retake at a lower resolution or choose a smaller file. Any earlier photo is kept.",
    };
  }
  if (
    file.type.length > 0 &&
    !(CLIENT_ALLOWED_MIMES as readonly string[]).includes(file.type)
  ) {
    return {
      ok: false,
      code: "UNSUPPORTED_TYPE",
      message:
        "Only JPEG, PNG, or WebP photos are supported. Choose a matching file. Any earlier photo is kept.",
    };
  }
  return { ok: true };
}

/**
 * Stateful walkthrough session. Owns the reducer state, media bytes in
 * storage, transient preview URLs, and inflight analysis controllers.
 */
export class WalkthroughSessionManager {
  private store: SessionStore;
  private inMemoryFallback: boolean;
  private readonly createObjectURL: CreateObjectURL;
  private readonly revokeObjectURL: RevokeObjectURL;
  private readonly analyzeFetch: AnalyzeFetch;
  private readonly generateId: (prefix: string) => string;
  private readonly now: () => string;

  private session: SessionState | null = null;
  private storage: StorageStatus = {
    kind: "loading",
    message: "Loading the local session…",
    inMemory: false,
  };

  /** mediaId -> live object URL for previews and review display. */
  private readonly objectUrls = new Map<string, string>();
  /** itemId -> inflight request identity + abort controller. */
  private readonly inflight = new Map<string, InflightAnalysis & { controller: AbortController }>();
  /** Bump on every delete/replace so late responses are discarded even if attempt numbers coincide. */
  private generation = 0;
  /** Live subscribers (e.g. React) notified on every state/storage/inflight change. */
  private readonly listeners = new Set<SessionSnapshotListener>();

  constructor(options: SessionManagerOptions = {}) {
    const resolved = options.store
      ? { store: options.store, inMemory: options.inMemory ?? false }
      : createSessionStore();
    this.store = resolved.store;
    this.inMemoryFallback = resolved.inMemory;
    this.createObjectURL = options.createObjectURL ?? defaultCreateObjectURL;
    this.revokeObjectURL = options.revokeObjectURL ?? defaultRevokeObjectURL;
    this.analyzeFetch = options.analyzeFetch ?? defaultAnalyzeFetch;
    this.generateId = options.generateId ?? defaultGenerateId;
    this.now = options.now ?? defaultNow;
  }

  snapshot(): SessionManagerSnapshot {
    return {
      state: this.session,
      storage: { ...this.storage },
      inflight: [...this.inflight.values()].map((entry) => ({
        itemId: entry.itemId,
        analysisId: entry.analysisId,
        attempt: entry.attempt,
        mediaId: entry.mediaId,
        mediaHash: entry.mediaHash,
        startedAt: entry.startedAt,
      })),
    };
  }

  item(itemId: string): ItemRecord | null {
    return this.session?.items[itemId] ?? null;
  }

  /** Live preview/review URL for a media blob (transient, never persisted). */
  previewUrlFor(mediaId: string | null): string | null {
    if (!mediaId) return null;
    return this.objectUrls.get(mediaId) ?? null;
  }

  /**
   * Subscribe to every session/storage/inflight transition: begin-analysis,
   * cancel, fail, success, review, delete, and storage recovery paths all
   * notify, as does each settled outcome. Notification is synchronous with
   * the fresh snapshot (no polling); the subscriber owns cleanup via the
   * returned unsubscribe function. Listeners must not throw.
   */
  subscribe(listener: SessionSnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Broadcast the current snapshot to all subscribers. */
  private notify(): void {
    const snap = this.snapshot();
    for (const listener of Array.from(this.listeners)) {
      listener(snap);
    }
  }

  /* ------------------------------ lifecycle ------------------------------ */

  /** Load the stored session or create a fresh one; recovers media URLs after refresh. */
  async init(
    sessionId: string,
    catalog: CatalogSnapshotInput,
  ): Promise<SessionManagerSnapshot> {
    this.storage = {
      kind: "loading",
      message: "Loading the local session…",
      inMemory: this.inMemoryFallback,
    };
    let loaded: Awaited<ReturnType<SessionStore["loadSession"]>>;
    try {
      loaded = await this.store.loadSession(sessionId);
    } catch (error) {
      if (isQuotaError(error)) {
        this.switchToMemory(
          "Local storage quota was exceeded, so this session keeps going in memory only. Reloading will lose new photos.",
        );
        this.session = createSession(
          sessionId,
          catalog,
          this.now(),
        );
        this.notify();
        return this.snapshot();
      }
      this.storage = {
        kind: "error",
        message:
          "Local storage is unavailable. Retry, reset storage, or continue in memory without persistence.",
        inMemory: this.inMemoryFallback,
      };
      this.session = null;
      this.notify();
      return this.snapshot();
    }

    if (loaded.kind === "missing") {
      this.session = createSession(sessionId, catalog, this.now());
      this.setReadyAfterLoad();
      await this.persist();
      return this.snapshot();
    }
    if (loaded.kind === "needs-reset") {
      this.session = null;
      this.storage = {
        kind: "needs-reset",
        message:
          `This saved session uses schema v${loaded.storedSchemaVersion ?? "?"} but this app expects ` +
          `v${loaded.expectedSchemaVersion}. Reset storage to start a fresh mock session — the old data will be discarded.`,
        inMemory: this.inMemoryFallback,
      };
      this.notify();
      return this.snapshot();
    }
    if (loaded.kind === "corrupt") {
      this.session = null;
      this.storage = {
        kind: "corrupt",
        message:
          `The saved session could not be read (${loaded.detail}). Reset storage to recover with a fresh mock session.`,
        inMemory: this.inMemoryFallback,
      };
      this.notify();
      return this.snapshot();
    }
    this.session = ensureSessionShape(loaded.state);
    this.setReadyAfterLoad();
    // A reload kills every inflight fetch, so a persisted "analyzing" item can
    // never complete and a persisted "captured" item (staged photo, analysis
    // never began) can never start: both would sit in limbo with no recovery
    // path except re-uploading. Normalize them here — before the first render
    // — into an explicit interrupted error with the photo kept, so the worker
    // gets the existing one-click "request fresh analysis" recovery that
    // re-analyzes the kept bytes (REQ-002, REQ-007). Drafts, reviewed work,
    // rejections, and empty items pass through untouched.
    const recovered = this.recoverInterruptedItems();
    // Rehydrate transient preview URLs from persisted canonical bytes so a
    // refresh restores visible evidence (REQ-007). Closing mid-upload — before
    // any server round trip confirmed bytes — still requires recapture.
    await this.rehydrateMediaUrls();
    if (recovered) {
      // Persist the interruption markers (with the kept photo) so the next
      // reload sees the honest error, not the limbo state again.
      await this.persist();
    } else {
      this.notify();
    }
    return this.snapshot();
  }

  /**
   * Normalize items whose analysis cannot survive a reload (called from init
   * before the first render and before URL rehydration, so recovery is
   * atomic from the worker's viewpoint).
   *
   * A reload kills every inflight fetch: a persisted "analyzing" item can
   * never complete, and a persisted "captured" item (photo staged but
   * analysis never began for its attempt) can never start. Left alone, both
   * sit in limbo — the capture panel offers no "analyze this photo" control
   * and review shows "run analysis in the capture step", forcing a re-upload
   * of an already-kept photo. Normalizing to an explicit INTERRUPTED error
   * keeps the photo and unlocks the existing one-click "request fresh
   * analysis" recovery, which re-analyzes the kept bytes. Uses only the
   * existing reducer actions (begin-analysis from captured, then
   * fail-analysis); drafts, reviewed work, rejections, errors, and empty
   * items pass through untouched. Returns true when anything changed.
   */
  private recoverInterruptedItems(): boolean {
    if (!this.session) return false;
    const at = this.now();
    let next = this.session;
    let changed = false;
    for (const item of Object.values(next.items)) {
      if (item.deleted || item.mediaId === null) continue;
      if (item.status === "analyzing") {
        const failed = reduceSession(
          next,
          {
            type: "fail-analysis",
            itemId: item.itemId,
            attempt: item.attempt,
            code: "INTERRUPTED",
            message:
              "The page reloaded during analysis before a draft arrived. The photo is kept — request a fresh analysis below.",
          },
          at,
        );
        if (failed !== next) {
          next = failed;
          changed = true;
        }
      } else if (item.status === "captured") {
        // Staged but never sent: synthesize the begin this attempt never got
        // (legal from captured for the current attempt), then mark it
        // interrupted so the kept photo gets the same recovery path.
        const begun = reduceSession(
          next,
          {
            type: "begin-analysis",
            itemId: item.itemId,
            analysisId: this.generateId("analysis"),
            attempt: item.attempt,
          },
          at,
        );
        if (begun === next) continue;
        const failed = reduceSession(
          begun,
          {
            type: "fail-analysis",
            itemId: item.itemId,
            attempt: item.attempt,
            code: "INTERRUPTED",
            message:
              "The staged photo never reached analysis — the page reloaded first. The photo is kept — request a fresh analysis below.",
          },
          at,
        );
        next = failed;
        changed = true;
      }
    }
    this.session = next;
    if (changed) this.generation += 1;
    return changed;
  }

  private setReadyAfterLoad(): void {
    if (this.inMemoryFallback) {
      this.storage = {
        kind: "in-memory",
        message:
          "Running in memory only: IndexedDB is unavailable (for example, private mode), so reloading will lose new photos. Local deletion still removes local records only.",
        inMemory: true,
      };
      return;
    }
    this.storage = {
      kind: "ready",
      message: "Local session ready.",
      inMemory: false,
    };
  }

  private switchToMemory(message: string): void {
    this.store = createSessionStore({ forceMemory: true }).store;
    this.inMemoryFallback = true;
    this.storage = { kind: "in-memory", message, inMemory: true };
  }

  /** Discard stored data after a schema/corrupt state and start fresh. */
  async resetStorage(
    sessionId: string,
    catalog: CatalogSnapshotInput,
  ): Promise<SessionManagerSnapshot> {
    this.revokeAllUrls();
    this.abortAll();
    try {
      await this.store.clearAll();
    } catch {
      // Reset is best-effort; fall back to memory so the worker can continue.
      this.switchToMemory(
        "Storage could not be cleared, so this session keeps going in memory only. Reloading will lose new photos.",
      );
    }
    this.session = createSession(sessionId, catalog, this.now());
    this.setReadyAfterLoad();
    if (this.storage.kind === "ready" && this.inMemoryFallback) {
      this.storage = {
        kind: "in-memory",
        message:
          "Running in memory only after a storage reset. Reloading will lose new photos.",
        inMemory: true,
      };
    }
    await this.persist();
    return this.snapshot();
  }

  /* ------------------------------ persistence ----------------------------- */

  private async persist(): Promise<void> {
    if (!this.session) return;
    try {
      await this.store.saveSession(this.session);
      if (this.inMemoryFallback && this.storage.kind === "ready") {
        this.storage = {
          kind: "in-memory",
          message:
            "Running in memory only: reloading will lose new photos. Local deletion still removes local records only.",
          inMemory: true,
        };
      }
    } catch (error) {
      if (isQuotaError(error)) {
        this.switchToMemory(
          "Local storage quota was exceeded, so this session keeps going in memory only. Photos already on screen stay visible, but reloading will lose unsaved work.",
        );
        return;
      }
      this.storage = {
        kind: "error",
        message:
          "Could not save locally. Retry, reset storage, or continue — new photos may be lost on reload.",
        inMemory: this.inMemoryFallback,
      };
    }
    // Every persisted mutation (begin/cancel/fail/success/review/delete)
    // broadcasts so live subscribers re-render mid-flight, not just on settle.
    this.notify();
  }

  /* ------------------------------ media URLs ------------------------------ */

  private trackUrl(mediaId: string, blob: Blob): string {
    this.revokeUrlFor(mediaId);
    const url = this.createObjectURL(blob);
    this.objectUrls.set(mediaId, url);
    return url;
  }

  private revokeUrlFor(mediaId: string): void {
    const url = this.objectUrls.get(mediaId);
    if (url) {
      this.objectUrls.delete(mediaId);
      this.revokeObjectURL(url);
    }
  }

  private revokeAllUrls(): void {
    for (const [mediaId, url] of this.objectUrls) {
      this.objectUrls.delete(mediaId);
      this.revokeObjectURL(url);
    }
  }

  private async rehydrateMediaUrls(): Promise<void> {
    if (!this.session) return;
    for (const item of Object.values(this.session.items)) {
      if (!item.mediaId || item.deleted) continue;
      try {
        const record = await this.store.loadMedia(item.mediaId);
        if (record && record.bytes.length > 0) {
          this.trackUrl(
            item.mediaId,
            new Blob([record.bytes as unknown as BlobPart], {
              type: record.mime || "application/octet-stream",
            }),
          );
        }
      } catch {
        // A single missing blob must not fail session recovery; the item
        // keeps its evidence record but shows no preview with recapture help.
      }
    }
  }

  /* ------------------------------ capture --------------------------------- */

  /**
   * Stage a local capture: validate client-side, persist bytes, bump the
   * attempt (invalidating prior reviews/inflight work), and issue a preview
   * URL. Invalid files are rejected WITHOUT touching current evidence, so
   * earlier usable photos survive (REQ-002).
   */
  async captureLocal(
    itemId: string,
    file: Blob & { size: number; type: string; name?: string },
  ): Promise<
    | { ok: true; mediaId: string; previewUrl: string; attempt: number }
    | { ok: false; code: string; message: string }
  > {
    if (!this.session) {
      return {
        ok: false,
        code: "NO_SESSION",
        message: "No local session is loaded yet. Reload and try again.",
      };
    }
    const check = validateClientFile(file);
    if (!check.ok) return check;
    // NOTE: no state changes (and no inflight abort) until the replacement
    // file is actually readable and staged — a bad pick preserves everything.
    const previous = this.session.items[itemId];
    const previousMediaId = previous?.mediaId ?? null;
    const mediaId = this.generateId("media");
    const capturedAt = this.now();
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      return {
        ok: false,
        code: "UNREADABLE_FILE",
        message:
          "That photo could not be read. Choose the file again. Any earlier photo is kept.",
      };
    }
    if (bytes.length === 0 || bytes.length > CLIENT_MAX_IMAGE_BYTES) {
      return {
        ok: false,
        code: "FILE_TOO_LARGE",
        message:
          "That photo exceeds the 8 MiB upload bound. Retake at a lower resolution or choose a smaller file. Any earlier photo is kept.",
      };
    }
    const mime =
      file.type && file.type.length > 0 ? file.type : "application/octet-stream";
    const record: MediaRecord = {
      mediaId,
      sessionId: this.session.sessionId,
      itemId,
      bytes,
      mime,
      createdAt: capturedAt,
    };
    try {
      await this.store.saveMedia(record);
    } catch (error) {
      if (isQuotaError(error)) {
        this.switchToMemory(
          "Local storage quota was exceeded, so this session keeps going in memory only. Reloading will lose new photos.",
        );
      } else {
        return {
          ok: false,
          code: "STORAGE_IO",
          message:
            "Could not save that photo locally. Try again or continue in memory. Any earlier photo is kept.",
        };
      }
    }
    // Local placeholder digest: the server remains authoritative and returns
    // the canonical digest + bytes, which replace this staging record.
    // Replacement commits here: abort inflight work, then bump the attempt so
    // any late response for the older attempt is discarded.
    this.abortInflight(itemId);
    const placeholderHash = placeholderDigest(bytes);
    const at = this.now();
    const next = reduceSession(this.session, {
      type: "capture-media",
      itemId,
      mediaId,
      mediaHash: placeholderHash,
      capturedAt,
    }, at);
    if (next === this.session) {
      // Reducer refused (unknown/deleted item): roll back the staged bytes.
      await this.store.deleteMedia(mediaId).catch(() => undefined);
      return {
        ok: false,
        code: "ITEM_UNAVAILABLE",
        message: "That checklist item is no longer available.",
      };
    }
    this.session = next;
    this.generation += 1;
    const previewUrl = this.trackUrl(mediaId, file as Blob);
    // Durability order (REQ-007): persist the new staging BEFORE deleting the
    // replaced bytes, so a reload in between recovers the new photo (with
    // harmless orphaned old bytes) instead of referencing deleted bytes.
    await this.persist();
    if (previousMediaId && previousMediaId !== mediaId) {
      this.revokeUrlFor(previousMediaId);
      await this.store.deleteMedia(previousMediaId).catch(() => undefined);
    }
    return { ok: true, mediaId, previewUrl, attempt: next.items[itemId].attempt };
  }

  /* ------------------------------ analysis -------------------------------- */

  /**
   * Upload the staged photo and attach the server's canonical result.
   * The server mints fresh media identity, so on success this applies one
   * atomic transaction — replace local bytes with the canonical bytes and
   * attach the draft — ONLY when the captured identity still matches current
   * state (no replace/delete/item-change/cancel since the request started).
   */
  async analyze(
    itemId: string,
    file: Blob & { size: number; type: string; name?: string },
  ): Promise<
    | { ok: true; analysisId: string }
    | { ok: false; code: string; message: string; retryable: boolean }
  > {
    if (!this.session) {
      return {
        ok: false,
        code: "NO_SESSION",
        message: "No local session is loaded yet. Reload and try again.",
        retryable: false,
      };
    }
    const item = this.session.items[itemId];
    if (!item || item.deleted) {
      return {
        ok: false,
        code: "ITEM_UNAVAILABLE",
        message: "That checklist item is no longer available.",
        retryable: false,
      };
    }
    if (this.inflight.has(itemId)) {
      return {
        ok: false,
        code: "REQUEST_IN_PROGRESS",
        message:
          "An analysis is already running for this item. Wait for it or cancel it before retrying.",
        retryable: true,
      };
    }
    const stagedGenerationBefore = this.generation;
    const staged = await this.captureLocal(itemId, file);
    if (!staged.ok) {
      // A concurrent delete/replace won the race while this request was
      // staging: the item existed at entry, so the staging refusal means
      // this request is stale — never resurrect, keep the newer state.
      if (
        staged.code === "ITEM_UNAVAILABLE" &&
        (this.generation !== stagedGenerationBefore ||
          this.session?.items[itemId]?.deleted)
      ) {
        return {
          ok: false,
          code: "STALE_RESPONSE",
          message:
            "A newer photo or deletion replaced this analysis, so it never started. The current state is kept.",
          retryable: false,
        };
      }
      return { ...staged, retryable: staged.code !== "ITEM_UNAVAILABLE" };
    }
    // The request is bound to the evidence THIS call staged. A concurrent
    // retake, delete, or reanalysis commits a newer attempt (or removes the
    // item) and every gate below compares against this identity, so a late
    // response can never adopt newer evidence as its own (REQ-006).
    const requestAttempt = staged.attempt;
    const requestMediaId = staged.mediaId;
    const generationAtStart = this.generation;
    const stagedState = this.session;
    const stagedItem = stagedState?.items[itemId];
    if (!stagedState || !stagedItem || stagedItem.deleted) {
      return {
        ok: false,
        code: "STALE_RESPONSE",
        message:
          "The session changed while the photo was staging, so this analysis never started. The current photo is kept.",
        retryable: false,
      };
    }
    const session = stagedState;
    const analysisId = this.generateId("analysis");
    const controller = new AbortController();
    this.inflight.set(itemId, {
      itemId,
      analysisId,
      attempt: requestAttempt,
      mediaId: requestMediaId,
      mediaHash: stagedItem.mediaHash ?? "",
      startedAt: this.now(),
      controller,
    });
    const began = reduceSession(
      session,
      {
        type: "begin-analysis",
        itemId,
        analysisId,
        attempt: requestAttempt,
      },
      this.now(),
    );
    if (began === session) {
      // A retake, deletion, or reanalysis won the race during staging: this
      // request never started, so settle as discarded and keep the newer
      // photo (REQ-006). This is STALE_RESPONSE, not ITEM_UNAVAILABLE —
      // the item exists, but this request lost the race for it.
      this.inflight.delete(itemId);
      this.notify();
      return {
        ok: false,
        code: "STALE_RESPONSE",
        message:
          "A newer photo or deletion replaced this analysis, so it never started. The current photo is kept.",
        retryable: false,
      };
    }
    this.session = began;
    await this.persist();

    const form = new FormData();
    form.set("sessionId", session.sessionId);
    form.set("itemId", itemId);
    form.set("catalogVersion", session.catalogVersion);
    form.set("analysisId", analysisId);
    form.set("image", file as Blob);

    let outcome: Awaited<ReturnType<AnalyzeFetch>>;
    try {
      outcome = await this.analyzeFetch(form, controller.signal);
    } catch (error) {
      const aborted =
        (error as { name?: string }).name === "AbortError" ||
        controller.signal.aborted;
      this.inflight.delete(itemId);
      this.notify();
      const settled = this.stillCurrent(
        itemId,
        generationAtStart,
        requestAttempt,
        analysisId,
      );
      if (settled) {
        if (aborted) {
          this.session = reduceSession(
            this.session!,
            { type: "cancel-analysis", itemId, attempt: requestAttempt },
            this.now(),
          );
        } else {
          this.session = reduceSession(
            this.session!,
            {
              type: "fail-analysis",
              itemId,
              attempt: requestAttempt,
              code: "PROVIDER_UNAVAILABLE",
              message:
                "The analysis could not reach the service. The photo is kept; retry once if the attempt is still current.",
            },
            this.now(),
          );
        }
        await this.persist();
      }
      if (aborted) {
        // Our own cancel keeps the photo and reports CANCELLED. A retake,
        // delete, or reanalysis that aborted this request mid-flight settles
        // as discarded instead: the newer evidence (or its absence) wins and
        // is never overwritten (REQ-006).
        const item = this.session?.items[itemId] ?? null;
        const superseded =
          !item ||
          item.deleted ||
          item.attempt !== requestAttempt ||
          item.mediaId !== requestMediaId;
        if (superseded) {
          return {
            ok: false,
            code: "STALE_RESPONSE",
            message:
              "A newer photo or deletion replaced this analysis, so its result was discarded. The current photo is kept.",
            retryable: false,
          };
        }
        return {
          ok: false,
          code: "CANCELLED",
          message: "Analysis cancelled. The photo is kept.",
          retryable: true,
        };
      }
      if (!settled) {
        // A late transport failure after a retake, delete, cancel, or
        // reanalysis is discarded — the newer state stands (REQ-006).
        return {
          ok: false,
          code: "STALE_RESPONSE",
          message:
            "A newer photo or deletion replaced this analysis, so its result was discarded. The current photo is kept.",
          retryable: false,
        };
      }
      return {
        ok: false,
        code: "PROVIDER_UNAVAILABLE",
        message:
          "The analysis could not reach the service. The photo is kept; retry once if the attempt is still current.",
        retryable: true,
      };
    }
    this.inflight.delete(itemId);
    this.notify();

    if (outcome.status === 200) {
      const applied = await this.applySuccess(
        itemId,
        analysisId,
        requestAttempt,
        generationAtStart,
        outcome.body as AnalyzeSuccessBody,
      );
      if (!applied) {
        return {
          ok: false,
          code: "STALE_RESPONSE",
          message:
            "A newer photo or deletion replaced this analysis, so its result was discarded. The current photo is kept.",
          retryable: false,
        };
      }
      return { ok: true, analysisId };
    }

    const failure = outcome.body as AnalyzeErrorBody;
    const code = failure?.error?.code ?? "PROVIDER_UNAVAILABLE";
    const message =
      failure?.error?.message ??
      "The analysis failed. The photo is kept; retry once if the attempt is still current.";
    const retryable = failure?.error?.retryable ?? true;
    if (
      !this.stillCurrent(itemId, generationAtStart, requestAttempt, analysisId)
    ) {
      // A late failure after a retake, delete, cancel, or reanalysis is
      // discarded with STALE_RESPONSE — never applied, never resurrected —
      // and the newer photo stands (REQ-006).
      return {
        ok: false,
        code: "STALE_RESPONSE",
        message:
          "A newer photo or deletion replaced this analysis, so its result was discarded. The current photo is kept.",
        retryable: false,
      };
    }
    this.session = reduceSession(
      this.session!,
      { type: "fail-analysis", itemId, attempt: requestAttempt, code, message },
      this.now(),
    );
    await this.persist();
    return { ok: false, code, message, retryable };
  }

  /**
   * Apply a successful server response atomically: replace staged bytes with
   * the canonical bytes, then capture + begin + commit through the reducer
   * so every identity gate is honored. Returns false (discarding the
   * response) when the worker replaced, deleted, or cancelled meanwhile.
   */
  private async applySuccess(
    itemId: string,
    analysisId: string,
    attempt: number,
    generationAtStart: number,
    body: AnalyzeSuccessBody,
  ): Promise<boolean> {
    if (!this.session) return false;
    if (!this.stillCurrent(itemId, generationAtStart, attempt, analysisId)) {
      return false;
    }
    const normalized = body.normalizedMedia;
    if (
      !normalized ||
      typeof normalized.mediaId !== "string" ||
      typeof normalized.digest !== "string" ||
      typeof normalized.base64 !== "string"
    ) {
      this.session = reduceSession(
        this.session,
        {
          type: "fail-analysis",
          itemId,
          attempt,
          code: "INVALID_MODEL_OUTPUT",
          message:
            "The service returned an unusable result. The photo is kept; retry once if the attempt is still current.",
        },
        this.now(),
      );
      await this.persist();
      return true;
    }
    let canonical: Uint8Array;
    try {
      canonical = decodeBase64ToBytes(normalized.base64);
    } catch {
      this.session = reduceSession(
        this.session,
        {
          type: "fail-analysis",
          itemId,
          attempt,
          code: "INVALID_MODEL_OUTPUT",
          message:
            "The service returned an unusable result. The photo is kept; retry once if the attempt is still current.",
        },
        this.now(),
      );
      await this.persist();
      return true;
    }
    const stagedMediaId = this.session.items[itemId]?.mediaId ?? null;
    const capturedAt = this.now();
    try {
      await this.store.saveMedia({
        mediaId: normalized.mediaId,
        sessionId: this.session.sessionId,
        itemId,
        bytes: canonical,
        mime: normalized.mime,
        createdAt: capturedAt,
      });
    } catch (error) {
      if (isQuotaError(error)) {
        this.switchToMemory(
          "Local storage quota was exceeded, so this session keeps going in memory only. Reloading will lose new photos.",
        );
      } else {
        if (
          !this.stillCurrent(itemId, generationAtStart, attempt, analysisId)
        ) {
          // Superseded while the canonical bytes were persisting: discard
          // and never stamp an error onto the newer evidence (REQ-006).
          return false;
        }
        this.session = reduceSession(
          this.session,
          {
            type: "fail-analysis",
            itemId,
            attempt,
            code: "STORAGE_IO",
            message:
              "The analysis succeeded but the photo could not be saved locally. Retry or continue in memory.",
          },
          this.now(),
        );
        await this.persist();
        return true;
      }
    }

    // Atomic local transaction through the pure reducer: capture the
    // canonical media (attempt+1, review cleared), begin the same analysis
    // ID on the fresh attempt, then commit the envelope. Any mismatch with
    // concurrent worker action aborts the sequence and the response is
    // discarded — never attached elsewhere.
    // Re-verify AFTER the async store write above: a replacement may have
    // won while canonical bytes were persisting. Discard its orphan bytes
    // so the newer photo keeps its bytes, URLs, and identity (REQ-006/007).
    if (!this.stillCurrent(itemId, generationAtStart, attempt, analysisId)) {
      await this.store.deleteMedia(normalized.mediaId).catch(() => undefined);
      return false;
    }
    const next = reduceSession(
      this.session,
      {
        type: "capture-media",
        itemId,
        mediaId: normalized.mediaId,
        mediaHash: normalized.digest,
        capturedAt,
      },
      capturedAt,
    );
    if (next === this.session) return false;
    const freshAttempt = next.items[itemId].attempt;
    const begun = reduceSession(
      next,
      { type: "begin-analysis", itemId, analysisId, attempt: freshAttempt },
      capturedAt,
    );
    if (begun === next) return false;
    const committed = reduceSession(
      begun,
      {
        type: "commit-draft",
        itemId,
        analysisId,
        attempt: freshAttempt,
        mediaId: normalized.mediaId,
        mediaHash: normalized.digest,
        envelope: {
          analysisId,
          sessionId: this.session.sessionId,
          itemId,
          catalogVersion: this.session.catalogVersion,
          mediaId: normalized.mediaId,
          mediaHash: normalized.digest,
          model: (body as { model?: unknown }).model ?? "unknown",
          mode: (body as { mode?: unknown }).mode ?? "fixture",
          requestId: (body as { requestId?: unknown }).requestId ?? analysisId,
          latencyMs: (body as { latencyMs?: unknown }).latencyMs ?? 0,
          draft: (body.envelope as { draft?: unknown }).draft,
        },
      },
      capturedAt,
    );
    if (committed === begun) {
      // Strict output rejected the draft: the reducer already moved the item
      // to error and kept the photo. Persist that error state.
      this.session = committed;
      await this.persist();
      if (stagedMediaId && stagedMediaId !== normalized.mediaId) {
        this.revokeUrlFor(stagedMediaId);
        await this.store.deleteMedia(stagedMediaId).catch(() => undefined);
      }
      this.trackUrl(
        normalized.mediaId,
        new Blob([canonical as unknown as BlobPart], {
          type: normalized.mime,
        }),
      );
      return true;
    }
    this.session = committed;
    this.generation += 1;
    this.trackUrl(
      normalized.mediaId,
      new Blob([canonical as unknown as BlobPart], {
        type: normalized.mime,
      }),
    );
    // Durability order (REQ-007): the committed state — which dereferences
    // the canonical bytes saved above — must be durable BEFORE the staged
    // bytes are deleted. Deleting first opens a reload window where the
    // stored state still references the staged mediaId but its bytes are
    // gone, so the photo would vanish on recovery. Orphaned staged bytes
    // (reload between persist and delete) are harmless: keyed, unreferenced.
    await this.persist();
    if (stagedMediaId && stagedMediaId !== normalized.mediaId) {
      this.revokeUrlFor(stagedMediaId);
      await this.store.deleteMedia(stagedMediaId).catch(() => undefined);
    }
    return true;
  }

  private stillCurrent(
    itemId: string,
    generationAtStart: number,
    attempt: number,
    analysisId: string,
  ): boolean {
    if (!this.session || this.session.deleted) return false;
    if (generationAtStart !== this.generation) return false;
    const item = this.session.items[itemId];
    if (!item || item.deleted) return false;
    // After captureLocal the attempt is the request attempt; any worker
    // replace/reanalyze/delete bumps it (or flips deleted), so a mismatch
    // means this response is stale and must be discarded.
    if (item.attempt !== attempt) return false;
    if (item.status === "analyzing" && item.analysisId !== analysisId) {
      return false;
    }
    return true;
  }

  /** Cancel inflight analysis; the photo is kept and late responses are discarded. */
  async cancel(itemId: string): Promise<SessionManagerSnapshot> {
    this.abortInflight(itemId);
    if (!this.session) {
      this.notify();
      return this.snapshot();
    }
    const item = this.session.items[itemId];
    if (!item || item.status !== "analyzing") {
      this.notify();
      return this.snapshot();
    }
    this.generation += 1;
    this.session = reduceSession(
      this.session,
      { type: "cancel-analysis", itemId, attempt: item.attempt },
      this.now(),
    );
    await this.persist();
    return this.snapshot();
  }

  /* --------------------------- worker review ---------------------------- */

  /**
   * Worker review transitions (REQ-005). Every applied transition creates a
   * new revision through the pure reducer and is persisted; ignored
   * transitions (wrong status, empty text, unknown item) return ok:false and
   * change nothing. Accepting text NEVER touches manual-check responses, so
   * accepting a draft cannot mark a physical test performed. Reanalyze and
   * replacement invalidate prior review and manual-check evidence and bump
   * the generation so late responses are discarded (REQ-006).
   */

  /** Accept the current draft verbatim as the worker note. */
  async acceptReview(itemId: string): Promise<
    | { ok: true; snapshot: SessionManagerSnapshot }
    | { ok: false; code: string; message: string }
  > {
    if (!this.session) {
      return {
        ok: false,
        code: "NO_SESSION",
        message: "No local session is loaded yet. Reload and try again.",
      };
    }
    const next = reduceSession(
      this.session,
      { type: "accept", itemId },
      this.now(),
    );
    if (next === this.session) {
      return {
        ok: false,
        code: "NOT_REVIEWABLE",
        message:
          "Only an unreviewed draft can be accepted. Reanalyze the current photo to produce a fresh draft first.",
      };
    }
    this.session = next;
    await this.persist();
    return { ok: true, snapshot: this.snapshot() };
  }

  /** Accept the draft with a worker-edited note; the original draft is preserved. */
  async acceptEditedReview(
    itemId: string,
    revisedText: string,
  ): Promise<
    | { ok: true; snapshot: SessionManagerSnapshot }
    | { ok: false; code: string; message: string }
  > {
    if (!this.session) {
      return {
        ok: false,
        code: "NO_SESSION",
        message: "No local session is loaded yet. Reload and try again.",
      };
    }
    const next = reduceSession(
      this.session,
      { type: "accept-edited", itemId, revisedText },
      this.now(),
    );
    if (next === this.session) {
      return {
        ok: false,
        code: "NOT_REVIEWABLE",
        message:
          "Edited text must be non-empty (up to 2000 characters) and the item must hold an unreviewed draft.",
      };
    }
    this.session = next;
    await this.persist();
    return { ok: true, snapshot: this.snapshot() };
  }

  /** Reject the current draft with a worker reason; rejection is not acceptance. */
  async rejectReview(
    itemId: string,
    reason: string,
  ): Promise<
    | { ok: true; snapshot: SessionManagerSnapshot }
    | { ok: false; code: string; message: string }
  > {
    if (!this.session) {
      return {
        ok: false,
        code: "NO_SESSION",
        message: "No local session is loaded yet. Reload and try again.",
      };
    }
    const next = reduceSession(
      this.session,
      { type: "reject", itemId, reason },
      this.now(),
    );
    if (next === this.session) {
      return {
        ok: false,
        code: "NOT_REVIEWABLE",
        message:
          "A rejection reason is required and the item must hold an unreviewed draft.",
      };
    }
    this.session = next;
    await this.persist();
    return { ok: true, snapshot: this.snapshot() };
  }

  /**
   * Record one manual check. A worker note is required; "not-performed"
   * stays unresolved by design. requiredCheckIds must be the catalog's
   * checks for this item so responses can only attach to known checks.
   */
  async recordManualCheck(
    itemId: string,
    checkId: string,
    outcome: ManualOutcome,
    note: string,
    requiredCheckIds: string[],
  ): Promise<
    | { ok: true; snapshot: SessionManagerSnapshot }
    | { ok: false; code: string; message: string }
  > {
    if (!this.session) {
      return {
        ok: false,
        code: "NO_SESSION",
        message: "No local session is loaded yet. Reload and try again.",
      };
    }
    const next = reduceSession(
      this.session,
      {
        type: "record-manual-check",
        itemId,
        checkId,
        outcome,
        note,
        recordedAt: this.now(),
        requiredCheckIds,
      },
      this.now(),
    );
    if (next === this.session) {
      return {
        ok: false,
        code: "CHECK_NOT_RECORDED",
        message:
          "That check was not recorded. Use a known check, choose performed or not-performed, and include a worker note.",
      };
    }
    this.session = next;
    await this.persist();
    return { ok: true, snapshot: this.snapshot() };
  }

  /**
   * Record (create or edit) the worker deficiency for one item (REQ-005).
   * Worker-only: the finding binds to the item's current photo and starts
   * unflagged; a later photo change flags it needs-confirmation via the
   * reducer, and photo deletion clears it. Re-recording re-binds to the
   * current photo and clears any stale flag. Never populated from model
   * output, never a verdict, never HMIS.
   */
  async recordDeficiency(
    itemId: string,
    input: {
      issueDescription: string;
      correctiveAction: string;
      responsibleParty?: string | null;
      targetDate?: string | null;
    },
  ): Promise<
    | { ok: true; snapshot: SessionManagerSnapshot }
    | { ok: false; code: string; message: string }
  > {
    if (!this.session) {
      return {
        ok: false,
        code: "NO_SESSION",
        message: "No local session is loaded yet. Reload and try again.",
      };
    }
    const at = this.now();
    const next = reduceSession(
      this.session,
      {
        type: "record-deficiency",
        itemId,
        issueDescription: input.issueDescription,
        correctiveAction: input.correctiveAction,
        responsibleParty: input.responsibleParty ?? null,
        targetDate: input.targetDate ?? null,
        recordedAt: at,
      },
      at,
    );
    if (next === this.session) {
      return {
        ok: false,
        code: "DEFICIENCY_NOT_RECORDED",
        message:
          "That finding was not recorded. Describe the issue and corrective action (up to 1000 characters each), keep optional owner/date valid, and capture a photo first.",
      };
    }
    this.session = next;
    await this.persist();
    return { ok: true, snapshot: this.snapshot() };
  }

  /** Clear the worker deficiency for one item; no-op when none is recorded. */
  async clearDeficiency(itemId: string): Promise<
    | { ok: true; snapshot: SessionManagerSnapshot }
    | { ok: false; code: string; message: string }
  > {
    if (!this.session) {
      return {
        ok: false,
        code: "NO_SESSION",
        message: "No local session is loaded yet. Reload and try again.",
      };
    }
    const next = reduceSession(
      this.session,
      { type: "clear-deficiency", itemId },
      this.now(),
    );
    if (next === this.session) {
      return {
        ok: false,
        code: "NO_DEFICIENCY",
        message: "There is no recorded finding on this item to clear.",
      };
    }
    this.session = next;
    await this.persist();
    return { ok: true, snapshot: this.snapshot() };
  }

  /**
   * Set session draft case notes (worker-only, REQ-008). Draft text only:
   * never a verdict, never HMIS, never auto-exported as completed.
   */
  async setCaseNotes(notes: string): Promise<
    | { ok: true; snapshot: SessionManagerSnapshot }
    | { ok: false; code: string; message: string }
  > {
    if (!this.session) {
      return {
        ok: false,
        code: "NO_SESSION",
        message: "No local session is loaded yet. Reload and try again.",
      };
    }
    const next = reduceSession(
      this.session,
      { type: "set-case-notes", notes },
      this.now(),
    );
    if (next === this.session) {
      return {
        ok: false,
        code: "NOTES_NOT_RECORDED",
        message:
          "Case notes were not saved. Enter 1–2000 characters of worker draft text.",
      };
    }
    this.session = next;
    await this.persist();
    return { ok: true, snapshot: this.snapshot() };
  }

  /** Clear session draft case notes; no-op when none are set. */
  async clearCaseNotes(): Promise<
    | { ok: true; snapshot: SessionManagerSnapshot }
    | { ok: false; code: string; message: string }
  > {
    if (!this.session) {
      return {
        ok: false,
        code: "NO_SESSION",
        message: "No local session is loaded yet. Reload and try again.",
      };
    }
    const next = reduceSession(
      this.session,
      { type: "clear-case-notes" },
      this.now(),
    );
    if (next === this.session) {
      return {
        ok: false,
        code: "NO_NOTES",
        message: "There are no case notes to clear.",
      };
    }
    this.session = next;
    await this.persist();
    return { ok: true, snapshot: this.snapshot() };
  }

  /**
   * Request a fresh analysis of the current photo: aborts inflight work,
   * clears the draft/review/manual checks, and bumps the attempt and
   * generation so any late response for the retired attempt is discarded.
   */
  async reanalyzeItem(itemId: string): Promise<
    | { ok: true; snapshot: SessionManagerSnapshot }
    | { ok: false; code: string; message: string }
  > {
    if (!this.session) {
      return {
        ok: false,
        code: "NO_SESSION",
        message: "No local session is loaded yet. Reload and try again.",
      };
    }
    this.abortInflight(itemId);
    const next = reduceSession(
      this.session,
      { type: "reanalyze", itemId },
      this.now(),
    );
    if (next === this.session) {
      return {
        ok: false,
        code: "NOT_REANALYZABLE",
        message:
          "There is no photo to reanalyze yet. Capture a photo first, then run analysis.",
      };
    }
    this.session = next;
    this.generation += 1;
    await this.persist();
    return { ok: true, snapshot: this.snapshot() };
  }

  /** Delete one item's evidence: abort inflight, revoke URLs, drop bytes. Never restores. */
  async deleteItemEvidence(itemId: string): Promise<SessionManagerSnapshot> {
    this.abortInflight(itemId);
    if (!this.session) {
      this.notify();
      return this.snapshot();
    }
    const item = this.session.items[itemId];
    const mediaId = item?.mediaId ?? null;
    if (mediaId) this.revokeUrlFor(mediaId);
    const before = this.session;
    const next = reduceSession(
      this.session,
      { type: "delete-item-evidence", itemId },
      this.now(),
    );
    // Invalidate inflight generations exactly like reanalyze/replace: only
    // when the delete actually retired an attempt, so a late response for
    // the retired attempt is discarded as STALE_RESPONSE and never
    // resurrects bytes, drafts, or reviews.
    if (next !== before) {
      this.session = next;
      this.generation += 1;
      // Durability order (REQ-007): persist the deletion BEFORE dropping the
      // bytes, so a reload in between keeps the worker's explicit delete
      // (with harmless orphaned bytes) instead of resurrecting the photo.
      await this.persist();
      if (mediaId) {
        await this.store.deleteMedia(mediaId).catch(() => undefined);
      }
    }
    this.notify();
    return this.snapshot();
  }

  /** Delete the whole session: abort everything, revoke all URLs, drop all bytes. */
  async deleteSession(): Promise<SessionManagerSnapshot> {
    this.abortAll();
    this.revokeAllUrls();
    this.generation += 1;
    const sessionId = this.session?.sessionId;
    if (this.session) {
      this.session = reduceSession(this.session, { type: "delete-session" }, this.now());
      try {
        await this.store.deleteSession(this.session.sessionId);
        await this.persistSkipDeleted();
      } catch {
        // Deletion is authoritative locally even if storage hiccups; the
        // in-memory tombstone still blocks late writes.
      }
    } else if (sessionId) {
      await this.store.deleteSession(sessionId).catch(() => undefined);
    }
    this.notify();
    return this.snapshot();
  }

  /** Remove every local session and media byte (explicit clear-all recovery). */
  async clearAll(): Promise<SessionManagerSnapshot> {
    this.abortAll();
    this.revokeAllUrls();
    this.generation += 1;
    this.session = null;
    try {
      await this.store.clearAll();
    } catch {
      this.switchToMemory(
        "Storage could not be cleared, so this session keeps going in memory only.",
      );
    }
    this.storage =
      this.storage.kind === "needs-reset" || this.storage.kind === "corrupt"
        ? this.storage
        : {
            kind: "empty",
            message: "All local data was cleared.",
            inMemory: this.inMemoryFallback,
          };
    this.notify();
    return this.snapshot();
  }

  private async persistSkipDeleted(): Promise<void> {
    // A deleted session row must not be re-saved as live: the store's merge
    // keeps the tombstone, but there is nothing left worth persisting after a
    // hard delete, so this is intentionally a no-op beyond the delete above.
  }

  private abortInflight(itemId: string): void {
    const entry = this.inflight.get(itemId);
    if (entry) {
      this.inflight.delete(itemId);
      try {
        entry.controller.abort();
      } catch {
        // Aborting is best-effort; identity matching discards late work.
      }
    }
  }

  private abortAll(): void {
    for (const [itemId, entry] of this.inflight) {
      this.inflight.delete(itemId);
      try {
        entry.controller.abort();
      } catch {
        // See abortInflight.
      }
    }
  }
}

/**
 * Deterministic placeholder digest for staged local bytes. The server is
 * authoritative for canonical digests; this value only lets the reducer
 * track staging identity until the server response replaces it. It is never
 * presented as a verified media hash.
 */
export function placeholderDigest(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i += 1) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 + bytes[i], 0x811c9dc5) >>> 0;
  }
  const word = (n: number): string =>
    (n >>> 0).toString(16).padStart(8, "0");
  return (word(h1) + word(h2) + word(h1 ^ h2) + word(h2 ^ 0x9e3779b9)).repeat(2).slice(0, 64);
}

/** Test helper: synthesize a minimal file-like Blob with size/type. */
export function makeTestFile(
  bytes: Uint8Array,
  mime = "image/jpeg",
  name = "photo.jpg",
): Blob & { size: number; type: string; name: string } {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  return Object.assign(blob, { name });
}

export const __testOnly = { DEFAULT_CAPTURED_AT };
