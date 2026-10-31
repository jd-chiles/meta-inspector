/**
 * Offline analysis queue + PWA install affordance (REQ-007, REQ-009, REQ-013).
 *
 * Framework-free so unit tests can drive queue semantics deterministically
 * without a browser. Browser APIs are only touched inside functions and
 * behind `typeof` guards, never at import time.
 *
 * Pending-only semantics (never auto-verdict):
 * - Losing connectivity never synthesizes a draft and never implies a
 *   verdict. A staged photo that cannot reach `/api/analyze` is recorded as
 *   a pending `QueuedAnalysisIntent` with its session/item/attempt/media
 *   identity preserved.
 * - On reconnect nothing runs automatically. Each queued item requires an
 *   explicit worker action (retry the item's analysis, edit, or delete) and
 *   the attempt identity resumes without colliding with pre-offline attempts:
 *   the reconnect race guards in `WalkthroughSessionManager` treat a queued
 *   retry exactly like a replace/cancel race.
 * - Deleting session evidence or clearing all data drops the matching queued
 *   intents too, so a deleted photo can never be analyzed later by a stale
 *   queue entry.
 *
 * The service worker (`public/sw.js`) caches the app shell and static assets
 * only. It never caches evidence bytes, provider payloads, keys, or media,
 * and this module never stores media bytes either — the queue carries
 * identities (session/item/attempt/mediaId), while bytes stay in IndexedDB
 * under the session manager's ownership.
 */

/** Storage key for the persisted offline-analysis intent list. */
export const OFFLINE_QUEUE_STORAGE_KEY =
  "habitability-walkthrough:offline-queue:v1";

/** App-shell cache name. Mirrors `SHELL_CACHE` in `public/sw.js`. */
export const APP_SHELL_CACHE_NAME = "habitability-walkthrough-shell-v3";

/** Service-worker script URL (served from the web root). */
export const SERVICE_WORKER_URL = "/sw.js";

/** Web app manifest URL (served from the web root). */
export const WEB_MANIFEST_URL = "/manifest.webmanifest";

/**
 * A pending analysis intent queued while offline. Pending ONLY: no draft,
 * no verdict, no result. The worker retries each item explicitly on
 * reconnect and the stored attempt keeps identity stable across the
 * offline/online boundary.
 */
export interface QueuedAnalysisIntent {
  /** Stable key: `${sessionId}:${itemId}` (one pending intent per item). */
  key: string;
  sessionId: string;
  itemId: string;
  /** Session-manager attempt at queue time; reconnect retries resume it. */
  attempt: number;
  /** Staged media identity (bytes live in IndexedDB, never in the queue). */
  mediaId: string | null;
  stagedAt: string;
  status: "pending";
  origin: "offline-queue";
}

export type OfflineQueue = QueuedAnalysisIntent[];

export interface QueueFailure {
  ok: false;
  code: string;
  message: string;
}

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/* ------------------------------------------------------------------ */
/* Pure queue operations (no browser APIs).                             */
/* ------------------------------------------------------------------ */

function queueKey(sessionId: string, itemId: string): string {
  return `${sessionId}:${itemId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural check for one persisted intent. Rejects anything misshapen
 * instead of trusting it: corrupt rows are dropped with a recovery (empty
 * queue), never applied.
 */
export function validateQueuedIntent(value: unknown): {
  ok: true;
  intent: QueuedAnalysisIntent;
} | { ok: false; detail: string } {
  if (!isRecord(value)) return { ok: false, detail: "queue row is not an object" };
  const { sessionId, itemId, attempt, mediaId, stagedAt, status, origin } = value;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { ok: false, detail: "queue row has no sessionId" };
  }
  if (typeof itemId !== "string" || itemId.length === 0) {
    return { ok: false, detail: "queue row has no itemId" };
  }
  if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 0) {
    return { ok: false, detail: "queue row has a non-integer attempt" };
  }
  if (mediaId !== null && (typeof mediaId !== "string" || mediaId.length === 0)) {
    return { ok: false, detail: "queue row has an invalid mediaId" };
  }
  if (typeof stagedAt !== "string" || stagedAt.length === 0) {
    return { ok: false, detail: "queue row has no stagedAt" };
  }
  if (status !== "pending") {
    return { ok: false, detail: "queue row is not pending-only" };
  }
  if (origin !== "offline-queue") {
    return { ok: false, detail: "queue row has an unknown origin" };
  }
  const key = queueKey(sessionId, itemId);
  return {
    ok: true,
    intent: {
      key,
      sessionId,
      itemId,
      attempt,
      mediaId,
      stagedAt,
      status: "pending",
      origin: "offline-queue",
    },
  };
}

/**
 * Build a pending intent for a staged photo that could not be analyzed
 * (offline transport failure). Carries identity only — never bytes, never
 * a draft, never a verdict.
 */
export function createQueuedIntent(input: {
  sessionId: string;
  itemId: string;
  attempt: number;
  mediaId: string | null;
  stagedAt: string;
}): QueuedAnalysisIntent {
  return {
    key: queueKey(input.sessionId, input.itemId),
    sessionId: input.sessionId,
    itemId: input.itemId,
    attempt: input.attempt,
    mediaId: input.mediaId,
    stagedAt: input.stagedAt,
    status: "pending",
    origin: "offline-queue",
  };
}

/**
 * Enqueue a pending intent. At most one pending intent exists per
 * (session, item): a newer staging for the same item replaces the older
 * one (higher attempt wins; ties keep the newer `stagedAt`), so a retake
 * while offline can never fork two retries for one photo.
 */
export function enqueueOfflineAnalysis(
  queue: OfflineQueue,
  intent: QueuedAnalysisIntent,
): OfflineQueue {
  const existing = queue.find((entry) => entry.key === intent.key);
  if (!existing) return [...queue, intent];
  const incomingIsNewer =
    intent.attempt > existing.attempt ||
    (intent.attempt === existing.attempt && intent.stagedAt >= existing.stagedAt);
  if (!incomingIsNewer) return queue;
  return queue.map((entry) => (entry.key === intent.key ? intent : entry));
}

/** Drop the queued intent for one item (explicit retry started, edit, or delete). */
export function removeQueuedForItem(
  queue: OfflineQueue,
  sessionId: string,
  itemId: string,
): OfflineQueue {
  const key = queueKey(sessionId, itemId);
  return queue.filter((entry) => entry.key !== key);
}

/**
 * Drop every queued intent for a session (delete-session / clear-all).
 * Queued intents must never outlive the evidence they point at.
 */
export function clearQueuedForSession(
  queue: OfflineQueue,
  sessionId: string,
): OfflineQueue {
  return queue.filter((entry) => entry.sessionId !== sessionId);
}

/** All pending intents for a session, in queue order. Explicit retry only. */
export function pendingForSession(
  queue: OfflineQueue,
  sessionId: string,
): OfflineQueue {
  return queue.filter(
    (entry) => entry.sessionId === sessionId && entry.status === "pending",
  );
}

/** True when the item currently waits in the offline queue. */
export function isItemQueued(
  queue: OfflineQueue,
  sessionId: string,
  itemId: string,
): boolean {
  const key = queueKey(sessionId, itemId);
  return queue.some((entry) => entry.key === key && entry.status === "pending");
}

/* ------------------------------------------------------------------ */
/* Persistence (injectable storage; corrupt rows are dropped, not trusted). */
/* ------------------------------------------------------------------ */

export interface LoadQueueResult {
  queue: OfflineQueue;
  /** True when at least one stored row was corrupt and dropped. */
  hadCorruptRows: boolean;
}

function memoryStorage(): StorageLike {
  const rows = new Map<string, string>();
  return {
    getItem: (key: string) => (rows.has(key) ? (rows.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
    removeItem: (key: string) => {
      rows.delete(key);
    },
  };
}

function resolveStorage(provided?: StorageLike | null): StorageLike | null {
  if (provided) return provided;
  if (typeof window !== "undefined") {
    try {
      const candidate = window.localStorage;
      // Probe once: private-mode storage may exist but throw on access.
      candidate.getItem(OFFLINE_QUEUE_STORAGE_KEY);
      return candidate;
    } catch {
      return memoryStorage();
    }
  }
  return memoryStorage();
}

/** Load the queue; corrupt rows are dropped and reported, never applied. */
export function loadOfflineQueue(storage?: StorageLike | null): LoadQueueResult {
  const store = resolveStorage(storage);
  if (!store) return { queue: [], hadCorruptRows: false };
  let raw: string | null = null;
  try {
    raw = store.getItem(OFFLINE_QUEUE_STORAGE_KEY);
  } catch {
    return { queue: [], hadCorruptRows: false };
  }
  if (raw === null || raw.trim().length === 0) {
    return { queue: [], hadCorruptRows: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { queue: [], hadCorruptRows: true };
  }
  if (!Array.isArray(parsed)) return { queue: [], hadCorruptRows: true };
  const queue: OfflineQueue = [];
  let hadCorruptRows = false;
  for (const row of parsed) {
    const checked = validateQueuedIntent(row);
    if (checked.ok) {
      if (!queue.some((entry) => entry.key === checked.intent.key)) {
        queue.push(checked.intent);
      }
    } else {
      hadCorruptRows = true;
    }
  }
  return { queue, hadCorruptRows };
}

/** Persist the queue. Failures are explicit; the in-memory queue is kept. */
export function saveOfflineQueue(
  queue: OfflineQueue,
  storage?: StorageLike | null,
): { ok: true } | QueueFailure {
  const store = resolveStorage(storage);
  if (!store) {
    return {
      ok: false,
      code: "STORAGE_UNAVAILABLE",
      message:
        "The offline queue could not be saved: no web storage is available. Pending items stay in memory for this page load only.",
    };
  }
  try {
    store.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(queue));
    return { ok: true };
  } catch {
    return {
      ok: false,
      code: "STORAGE_IO",
      message:
        "The offline queue could not be saved locally. Pending items stay in memory for this page load only.",
    };
  }
}

/* ------------------------------------------------------------------ */
/* Connectivity (event-driven; SSR-safe).                               */
/* ------------------------------------------------------------------ */

/** Current online guess. `true` when unknown (fail-open to attempting). */
export function isNavigatorOnline(navigatorRef?: {
  onLine?: unknown;
}): boolean {
  const candidate =
    navigatorRef ??
    (typeof navigator !== "undefined" ? navigator : undefined);
  if (!candidate || typeof candidate.onLine !== "boolean") return true;
  return candidate.onLine;
}

export type ConnectivityListener = (online: boolean) => void;

/**
 * Subscribe to browser online/offline transitions. Returns an unsubscribe
 * function. No-ops (returns a no-op unsubscribe) outside a browser.
 */
export function subscribeConnectivity(listener: ConnectivityListener): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return () => undefined;
  }
  const emit = (): void => {
    listener(isNavigatorOnline());
  };
  window.addEventListener("online", emit);
  window.addEventListener("offline", emit);
  return () => {
    window.removeEventListener("online", emit);
    window.removeEventListener("offline", emit);
  };
}

/* ------------------------------------------------------------------ */
/* Service-worker registration (shell only; never evidence).            */
/* ------------------------------------------------------------------ */

export function canUseServiceWorker(
  navigatorRef?: unknown,
  windowRef?: unknown,
): boolean {
  const nav = (navigatorRef ??
    (typeof navigator !== "undefined" ? navigator : undefined)) as
    | { serviceWorker?: { register?: unknown } }
    | undefined;
  const win = (windowRef ?? (typeof window !== "undefined" ? window : undefined)) as
    | { isSecureContext?: unknown }
    | undefined;
  if (!nav || typeof nav.serviceWorker?.register !== "function") return false;
  // Service workers require a secure context; localhost counts as secure.
  if (win && "isSecureContext" in (win as object)) {
    return (win as { isSecureContext?: boolean }).isSecureContext !== false;
  }
  return true;
}

export type RegisterServiceWorkerResult =
  | { ok: true; scope: string }
  | QueueFailure;

/**
 * Register the app-shell service worker. Injectable `register` keeps unit
 * tests deterministic; by default the browser's own registration is used.
 * Resolves `UNSUPPORTED` (with manual-install/offline guidance still
 * available) instead of throwing when workers are unavailable.
 */
export async function registerAppServiceWorker(
  register?: (url: string) => Promise<{ scope: string }>,
): Promise<RegisterServiceWorkerResult> {
  const run =
    register ??
    (async (url: string): Promise<{ scope: string }> => {
      if (!canUseServiceWorker()) {
        throw new Error("Service workers are unavailable in this browser.");
      }
      const registration = await navigator.serviceWorker.register(url);
      return { scope: registration.scope };
    });
  try {
    const { scope } = await run(SERVICE_WORKER_URL);
    return { ok: true, scope };
  } catch {
    const supported = canUseServiceWorker();
    return {
      ok: false,
      code: supported ? "REGISTER_FAILED" : "UNSUPPORTED",
      message: supported
        ? "The offline shell could not be installed. The page still works online; saved progress stays on this device."
        : "This browser cannot install the offline shell. The page still works online; saved progress stays on this device.",
    };
  }
}

/* ------------------------------------------------------------------ */
/* Install affordance: prompt when available, guidance otherwise.        */
/* ------------------------------------------------------------------ */

export type InstallPlatform = "android" | "ios" | "desktop" | "unknown";

export interface BeforeInstallPromptEventLike {
  prompt: () => Promise<void> | void;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** True when launched from the installed icon (standalone/fullscreen). */
export function isStandaloneDisplay(
  windowRef?: {
    matchMedia?: (query: string) => { matches: boolean };
    navigator?: { standalone?: unknown };
  } | null,
): boolean {
  const win =
    windowRef ??
    (typeof window !== "undefined" ? window : undefined);
  if (!win) return false;
  try {
    if (win.matchMedia?.("(display-mode: standalone)").matches) return true;
    if (win.matchMedia?.("(display-mode: fullscreen)").matches) return true;
  } catch {
    // matchMedia probes are best-effort; fall through to the iOS check.
  }
  return (win.navigator as { standalone?: unknown } | undefined)?.standalone === true;
}

/** Best-effort platform guess for tailored manual-install steps. */
export function detectInstallPlatform(userAgent?: string): InstallPlatform {
  const ua =
    userAgent ??
    (typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
      ? navigator.userAgent
      : "");
  if (!ua) return "unknown";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/windows|macintosh|mac os|cros|linux/i.test(ua)) return "desktop";
  return "unknown";
}

/**
 * Manual install steps per platform. Used whenever the automatic install
 * prompt is unavailable so the install path always degrades to guidance,
 * never to silence.
 */
export function manualInstallSteps(platform: InstallPlatform): string[] {
  switch (platform) {
    case "android":
      return [
        "Open this page in Chrome on Android.",
        "Tap the three-dot menu, then choose “Install app” or “Add to Home screen”.",
        "Open the installed “Walkthrough” icon to launch with your saved local progress.",
      ];
    case "ios":
      return [
        "Open this page in Safari on iPhone or iPad.",
        "Tap Share, then choose “Add to Home Screen”.",
        "Open the installed “Walkthrough” icon to launch with your saved local progress.",
      ];
    case "desktop":
      return [
        "Open this page in Chrome or Edge on desktop.",
        "Use the install icon in the address bar, or menu → “Install” / “Save and share → Install”.",
        "Open the installed app to launch with your saved local progress.",
      ];
    default:
      return [
        "Open this page in a browser that supports app installation (Chrome, Edge, or Safari).",
        "Use the browser menu option “Install app” or “Add to Home Screen”.",
        "Open the installed icon to launch with your saved local progress.",
      ];
  }
}

export type InstallAffordance =
  | { mode: "installed" }
  | { mode: "prompt" }
  | { mode: "guidance"; platform: InstallPlatform; steps: string[] };

/**
 * Decide the install affordance: hide it when already installed, offer the
 * captured prompt when available, otherwise degrade to manual guidance.
 */
export function getInstallAffordance(input: {
  standalone: boolean;
  deferredPromptAvailable: boolean;
  platform: InstallPlatform;
}): InstallAffordance {
  if (input.standalone) return { mode: "installed" };
  if (input.deferredPromptAvailable) return { mode: "prompt" };
  return {
    mode: "guidance",
    platform: input.platform,
    steps: manualInstallSteps(input.platform),
  };
}

/**
 * Holder for the deferred `beforeinstallprompt` event. The browser fires it
 * at most once per page load; the UI captures it here and `requestInstall`
 * triggers it from an explicit worker gesture (never automatically).
 */
export class DeferredInstallPrompt {
  private pending: BeforeInstallPromptEventLike | null = null;

  capture(event: BeforeInstallPromptEventLike): void {
    this.pending = event;
  }

  peek(): BeforeInstallPromptEventLike | null {
    return this.pending;
  }

  take(): BeforeInstallPromptEventLike | null {
    const current = this.pending;
    this.pending = null;
    return current;
  }

  get available(): boolean {
    return this.pending !== null;
  }
}

/**
 * Trigger the deferred install prompt from an explicit worker action.
 * Single-use by design: the event is consumed even when the worker
 * dismisses it, and dismissal falls back to manual guidance.
 */
export async function requestInstall(
  deferred: DeferredInstallPrompt,
): Promise<
  | { outcome: "accepted" }
  | { outcome: "dismissed"; steps: string[]; platform: InstallPlatform }
  | { outcome: "unavailable"; steps: string[]; platform: InstallPlatform }
> {
  const platform = detectInstallPlatform();
  const event = deferred.take();
  if (!event) {
    return { outcome: "unavailable", steps: manualInstallSteps(platform), platform };
  }
  try {
    await event.prompt();
    const choice = await event.userChoice;
    if (choice?.outcome === "accepted") return { outcome: "accepted" };
    return { outcome: "dismissed", steps: manualInstallSteps(platform), platform };
  } catch {
    return { outcome: "unavailable", steps: manualInstallSteps(platform), platform };
  }
}

/* ------------------------------------------------------------------ */
/* Accessible status text (announced via role=status/alert, never color). */
/* ------------------------------------------------------------------ */

/**
 * Offline/queue status line for sighted text and screen-reader announcement.
 * Always honest: pending means "photo kept, analysis not run, no verdict".
 */
export function describeOfflineState(input: {
  online: boolean;
  pendingCount: number;
  storedMessage?: string | null;
}): string {
  const count = Math.max(0, Math.floor(input.pendingCount));
  const noun = count === 1 ? "analysis" : "analyses";
  if (!input.online) {
    if (count === 0) {
      return (
        "You are offline. The saved walkthrough shell is available with your stored " +
        "progress. New photos are kept on this device and queued as pending — no draft " +
        "is created and no verdict is implied."
      );
    }
    return (
      `You are offline. ${count} queued ${noun} waiting as pending — each photo is kept, ` +
      "no draft was created, and no verdict is implied. Reconnect, then retry each item explicitly."
    );
  }
  if (count > 0) {
    return (
      `Back online. ${count} queued ${noun} still waiting as pending — nothing ran automatically. ` +
      "Retry each item explicitly; photos are kept."
    );
  }
  return (
    input.storedMessage ??
    "Online. No queued analyses. Saved progress is current on this device."
  );
}

/** Per-item pending line shown beside the staged photo while offline. */
export function describePendingItem(itemLabel: string): string {
  return (
    `Pending — the photo for “${itemLabel}” is kept on this device and will not be ` +
    "analyzed until you retry it explicitly. No draft exists and no verdict is implied."
  );
}

/* ------------------------------------------------------------------ */
/* Cache-boundary mirror (unit-testable twin of `public/sw.js` policy).  */
/* ------------------------------------------------------------------ */

/**
 * Pure twin of the service-worker caching policy: exact request targets the
 * worker may place in the shell cache. Everything else — API traffic,
 * non-GET work, evidence, provider payloads, keys, full-resolution media —
 * must stay network-only (or local-only) and is never cached.
 */
export function shouldServiceWorkerCache(
  requestUrl: string,
  method: string,
): boolean {
  if (method.toUpperCase() !== "GET") return false;
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return false;
  }
  if (url.pathname.indexOf("/api/") === 0) return false;
  if (url.pathname === "/manifest.webmanifest") return true;
  if (url.pathname.indexOf("/_next/static/") === 0) return true;
  if (url.pathname.indexOf("/icons/") === 0) return true;
  if (url.pathname.indexOf("/fonts/") === 0) return true;
  return false;
}
