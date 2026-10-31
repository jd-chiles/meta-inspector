/**
 * Behavioral tests for TASK-005 (REQ-002, REQ-006, REQ-007, REQ-009).
 *
 * Deterministic and fixture-only: MemorySessionStore, fake fetch, fake
 * object URLs, synthetic mock-unit bytes. No network, no provider keys, no
 * browser, no IndexedDB. Every hash below is synthetic test data — never
 * live inference.
 *
 * Covers:
 * - Refresh recovery (save → load returns the same session and media bytes).
 * - Schema mismatch → explicit needs-reset; corrupt rows → explicit corrupt;
 *   resetStorage recovers with a fresh session.
 * - Quota failures surface explicitly and switch to the in-memory session
 *   with a warning (isQuotaError classification).
 * - Delete and replace invalidate inflight responses and revoke media URLs;
 *   storage operations never restore deleted records.
 * - Client-side invalid files and server failures preserve earlier usable
 *   evidence; cancellation keeps the photo and discards late responses.
 */
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  createSession,
  reduceSession,
} from "../../../src/domain/evidence";
import {
  isQuotaError,
  MemorySessionStore,
  mergePreservingDeletion,
  validateStoredSession,
  STORAGE_SCHEMA_VERSION,
} from "../../../src/storage/db";
import {
  makeTestFile,
  placeholderDigest,
  validateClientFile,
  WalkthroughSessionManager,
  type AnalyzeErrorBody,
  type AnalyzeFetch,
  type AnalyzeSuccessBody,
} from "../../../src/features/walkthrough/session";

const CATALOG = {
  catalogId: "demo-habitability-walkthrough",
  catalogVersion: "0.3.0-demo.3",
  itemIds: ["item-a", "item-b"],
};

const NOW = "2026-10-27T12:00:00.000Z";

const VALID_DRAFT = {
  observation: "The sink basin looks intact with a single faucet.",
  visibleEvidence: ["basin without visible cracks"],
  unknowns: [],
  suggestedManualChecks: [],
};

function successBody(overrides: Record<string, unknown> = {}) {
  const digest = "d".repeat(64);
  return {
    envelope: { draft: VALID_DRAFT },
    normalizedMedia: {
      mediaId: "media-server-1",
      mime: "image/jpeg",
      width: 800,
      height: 600,
      digest,
      base64: Buffer.from([9, 9, 9]).toString("base64"),
    },
    model: "muse-spark-1.3",
    mode: "fixture",
    requestId: "req-1",
    latencyMs: 5,
    ...overrides,
  };
}

function failureBody(code = "PROVIDER_UNAVAILABLE") {
  return {
    error: {
      code,
      message: `${code}: synthetic test failure. The photo is kept.`,
      retryable: true,
    },
    analysisId: "analysis-test",
  };
}

interface Harness {
  manager: WalkthroughSessionManager;
  store: MemorySessionStore;
  createdUrls: string[];
  revokedUrls: string[];
}

function makeHarness(fetch?: AnalyzeFetch): Harness {
  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];
  let counter = 0;
  const store = new MemorySessionStore();
  const manager = new WalkthroughSessionManager({
    store,
    createObjectURL: () => {
      const url = `blob:test-${counter}`;
      counter += 1;
      createdUrls.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      revokedUrls.push(url);
    },
    generateId: (prefix: string) => {
      counter += 1;
      return `${prefix}-${counter}`;
    },
    now: () => NOW,
    ...(fetch ? { analyzeFetch: fetch } : {}),
  });
  return { manager, store, createdUrls, revokedUrls };
}

/** Wait until the manager registers an inflight analysis (bounded, deterministic). */
async function waitForInflight(manager: WalkthroughSessionManager): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (manager.snapshot().inflight.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("inflight analysis never started");
}

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

/* ------------------------------------------------------------------ */
/* Pure storage helpers.                                               */
/* ------------------------------------------------------------------ */

describe("storage helpers", () => {
  it("classifies quota-shaped errors without swallowing other failures", () => {
    expect(isQuotaError(Object.assign(new Error("q"), { name: "QuotaExceededError" }))).toBe(true);
    expect(isQuotaError(Object.assign(new Error("q"), { code: 22 }))).toBe(true);
    expect(isQuotaError(Object.assign(new Error("q"), { name: "NS_ERROR_DOM_QUOTA_REACHED" }))).toBe(true);
    expect(isQuotaError(new Error("boom"))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError("QuotaExceededError")).toBe(false);
  });

  it("rejects malformed stored sessions as corrupt (never trusted)", () => {
    expect(validateStoredSession(null).ok).toBe(false);
    expect(validateStoredSession({}).ok).toBe(false);
    expect(
      validateStoredSession({ sessionId: "s", schemaVersion: 1, items: { a: { itemId: "b", attempt: 0, revision: 0 } } }).ok,
    ).toBe(false);
    const good = createSession("s", CATALOG, NOW);
    const parsed = validateStoredSession(JSON.parse(JSON.stringify(good)) as unknown);
    expect(parsed.ok).toBe(true);
  });

  it("never resurrects deleted sessions or items on write", () => {
    const live = createSession("s", CATALOG, NOW);
    const tombstoned = reduceSession(live, { type: "delete-session" }, NOW);
    const mergedSession = mergePreservingDeletion(tombstoned, live);
    expect(mergedSession.deleted).toBe(true);

    const withItem = reduceSession(live, { type: "delete-item-evidence", itemId: "item-a" }, NOW);
    const resurrectedAttempt = {
      ...live,
      items: { ...live.items, "item-a": live.items["item-a"] },
    };
    const mergedItem = mergePreservingDeletion(withItem, resurrectedAttempt);
    expect(mergedItem.items["item-a"].deleted).toBe(true);
    expect(mergedItem.items["item-b"].deleted).toBe(false);
  });

  it("validates client files without touching current evidence", () => {
    expect(validateClientFile(makeTestFile(JPEG_BYTES))).toEqual({ ok: true });
    expect(
      validateClientFile({ size: 0, type: "image/jpeg" } as File).ok,
    ).toBe(false);
    expect(
      validateClientFile({ size: 8 * 1024 * 1024 + 1, type: "image/jpeg" } as File).ok,
    ).toBe(false);
    expect(validateClientFile({ size: 10, type: "image/gif" } as File).ok).toBe(
      false,
    );
    expect(placeholderDigest(JPEG_BYTES)).toMatch(/^[0-9a-f]{64}$/);
    // Staging digests gate capture-media: every byte pattern used in race
    // coverage must hash to strict hex, never signed artifacts (REQ-006).
    for (const bytes of [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      new Uint8Array([7, 8, 9]),
      new Uint8Array([10, 11]),
      new Uint8Array([12]),
      new Uint8Array([7, 7, 7]),
      new Uint8Array([1, 2, 3, 4]),
    ]) {
      expect(placeholderDigest(bytes)).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Refresh recovery, schema, quota, deletion.                          */
/* ------------------------------------------------------------------ */

describe("local session storage", () => {
  it("recovers the session and media bytes after a refresh", async () => {
    const { manager, store } = makeHarness();
    await manager.init("session-1", CATALOG);
    const staged = await manager.captureLocal("item-a", makeTestFile(JPEG_BYTES));
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;

    // Simulate a refresh: a new manager over the same store recovers state.
    const reloaded = new WalkthroughSessionManager({
      store,
      createObjectURL: (blob: Blob) => `blob:rehydrated-${blob.size}`,
      revokeObjectURL: () => undefined,
      now: () => NOW,
    });
    const snapshot = await reloaded.init("session-1", CATALOG);
    expect(snapshot.storage.kind).toBe("ready");
    expect(snapshot.state?.items["item-a"].mediaId).toBe(staged.mediaId);
    expect(reloaded.previewUrlFor(staged.mediaId)).toContain("blob:rehydrated-");
    const record = await store.loadMedia(staged.mediaId);
    expect(record ? [...record.bytes] : null).toEqual([...JPEG_BYTES]);
  });

  it("surfaces schema mismatch as needs-reset and recovers via reset", async () => {
    const store = new MemorySessionStore();
    const stale = createSession("session-old", CATALOG, NOW);
    (stale as { schemaVersion: number }).schemaVersion = 999;
    await store.saveSession(stale);

    const manager = new WalkthroughSessionManager({
      store,
      now: () => NOW,
    });
    const snapshot = await manager.init("session-old", CATALOG);
    expect(snapshot.storage.kind).toBe("needs-reset");
    expect(snapshot.state).toBeNull();

    const after = await manager.resetStorage("session-old", CATALOG);
    expect(after.state?.sessionId).toBe("session-old");
    expect(after.state?.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
    expect(["ready", "in-memory"]).toContain(after.storage.kind);
  });

  it("surfaces corrupt rows without trusting them", async () => {
    const parsed = validateStoredSession({ sessionId: "", items: {} });
    expect(parsed.ok).toBe(false);
  });

  it("exposes quota failures and keeps going in memory with a warning", async () => {
    const store = new MemorySessionStore({ quotaBytes: 0 });
    const manager = new WalkthroughSessionManager({
      store,
      now: () => NOW,
    });
    await manager.init("session-quota", CATALOG);
    const staged = await manager.captureLocal("item-a", makeTestFile(JPEG_BYTES));
    // Media bytes exceed the zero budget, so persistence falls back to
    // memory — but staging still succeeds and warns explicitly.
    expect(staged.ok).toBe(true);
    expect(manager.snapshot().storage.kind).toBe("in-memory");
    expect(manager.snapshot().storage.message).toMatch(/quota/i);
  });

  it("delete-session drops media bytes and lists nothing afterwards", async () => {
    const { manager, store } = makeHarness();
    await manager.init("session-1", CATALOG);
    const staged = await manager.captureLocal("item-a", makeTestFile(JPEG_BYTES));
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;

    await manager.deleteSession();
    expect(await store.listSessionIds()).toEqual([]);
    expect(await store.loadMedia(staged.mediaId)).toBeNull();
    expect(await store.loadSession("session-1")).toMatchObject({ kind: "missing" });
    expect(manager.snapshot().state?.deleted).toBe(true);
  });

  it("storage writes never restore a deleted item record", async () => {
    const { manager, store } = makeHarness();
    await manager.init("session-1", CATALOG);
    const staged = await manager.captureLocal("item-a", makeTestFile(JPEG_BYTES));
    expect(staged.ok).toBe(true);
    await manager.deleteItemEvidence("item-a");

    // A replayed pre-deletion write must not resurrect the item.
    const current = manager.snapshot().state;
    expect(current?.items["item-a"].deleted).toBe(true);
    const replayed = JSON.parse(JSON.stringify(current)) as typeof current;
    if (replayed && current) {
      replayed.items["item-a"] = {
        ...current.items["item-a"],
        deleted: false,
        status: "captured",
        mediaId: staged.ok ? staged.mediaId : null,
      };
      await store.saveSession(replayed);
    }
    const loaded = await store.loadSession("session-1");
    expect(loaded.kind).toBe("found");
    if (loaded.kind === "found") {
      expect(loaded.state.items["item-a"].deleted).toBe(true);
      expect(loaded.state.items["item-a"].mediaId).toBeNull();
    }
    expect(await store.loadMedia(staged.ok ? staged.mediaId : "missing")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Replace / cancel / delete races against inflight analysis.           */
/* ------------------------------------------------------------------ */

describe("inflight invalidation", () => {
  it("applies a successful response: canonical bytes replace staging, draft attaches", async () => {
    const fetch: AnalyzeFetch = async () => ({ status: 200, body: successBody() });
    const { manager, store, revokedUrls } = makeHarness(fetch);
    await manager.init("session-1", CATALOG);

    const result = await manager.analyze("item-a", makeTestFile(JPEG_BYTES));
    expect(result).toMatchObject({ ok: true });

    const item = manager.item("item-a");
    expect(item?.status).toBe("draft");
    expect(item?.mediaId).toBe("media-server-1");
    expect(item?.mediaHash).toBe("d".repeat(64));
    expect(item?.draft?.observation).toMatch(/sink basin/);

    const canonical = await store.loadMedia("media-server-1");
    expect(canonical ? [...canonical.bytes] : null).toEqual([9, 9, 9]);
    // Staging bytes are dropped and their preview URL revoked.
    expect(revokedUrls.length).toBeGreaterThan(0);
    expect(manager.previewUrlFor("media-server-1")).not.toBeNull();
  });

  it("discards a late success after replace: newer photo wins, URLs revoked", async () => {
    let release!: (value: { status: number; body: ReturnType<typeof successBody> }) => void;
    const gate = new Promise<{ status: number; body: ReturnType<typeof successBody> }>(
      (resolve) => {
        release = resolve;
      },
    );
    const fetch: AnalyzeFetch = () => gate;
    const { manager, store, createdUrls, revokedUrls } = makeHarness(fetch);
    await manager.init("session-1", CATALOG);

    const pending = manager.analyze("item-a", makeTestFile(JPEG_BYTES));
    await waitForInflight(manager);
    const replacement = await manager.captureLocal(
      "item-a",
      makeTestFile(new Uint8Array([1, 2, 3, 4])),
    );
    expect(replacement.ok).toBe(true);
    if (!replacement.ok) return;
    const firstPreview = createdUrls[0];

    release({ status: 200, body: successBody() });
    const result = await pending;
    expect(result).toMatchObject({ ok: false, code: "STALE_RESPONSE" });

    const item = manager.item("item-a");
    expect(item?.mediaId).toBe(replacement.mediaId);
    expect(item?.status).toBe("captured");
    expect(revokedUrls).toContain(firstPreview);
    expect(await store.loadMedia("media-server-1")).toBeNull();
  });

  it("discards a late success after delete and never restores the record", async () => {
    let release!: (value: { status: number; body: ReturnType<typeof successBody> }) => void;
    const gate = new Promise<{ status: number; body: ReturnType<typeof successBody> }>(
      (resolve) => {
        release = resolve;
      },
    );
    const { manager, store } = makeHarness(() => gate);
    await manager.init("session-1", CATALOG);

    const pending = manager.analyze("item-a", makeTestFile(JPEG_BYTES));
    await waitForInflight(manager);
    await manager.deleteItemEvidence("item-a");
    release({ status: 200, body: successBody() });
    const result = await pending;
    expect(result).toMatchObject({ ok: false, code: "STALE_RESPONSE" });

    const item = manager.item("item-a");
    expect(item?.deleted).toBe(true);
    expect(item?.mediaId).toBeNull();
    expect(manager.previewUrlFor("media-server-1")).toBeNull();
    expect(await store.loadMedia("media-server-1")).toBeNull();
  });

  it("cancel keeps the photo and discards the late response", async () => {
    const fetch: AnalyzeFetch = (_form, signal) =>
      new Promise<{
        status: number;
        body: AnalyzeSuccessBody | AnalyzeErrorBody;
      }>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    const { manager } = makeHarness(fetch);
    await manager.init("session-1", CATALOG);

    const pending = manager.analyze("item-a", makeTestFile(JPEG_BYTES));
    await waitForInflight(manager);
    await manager.cancel("item-a");
    const result = await pending;
    expect(result).toMatchObject({ ok: false, code: "CANCELLED" });

    const item = manager.item("item-a");
    expect(item?.status).toBe("captured");
    expect(item?.mediaId).not.toBeNull();
    expect(manager.previewUrlFor(item?.mediaId ?? null)).not.toBeNull();
  });

  it("server failure keeps the earlier photo with an explicit error", async () => {
    const fetch: AnalyzeFetch = async () => ({ status: 500, body: failureBody() });
    const { manager } = makeHarness(fetch);
    await manager.init("session-1", CATALOG);

    const result = await manager.analyze("item-a", makeTestFile(JPEG_BYTES));
    expect(result).toMatchObject({ ok: false, code: "PROVIDER_UNAVAILABLE" });

    const item = manager.item("item-a");
    expect(item?.status).toBe("error");
    expect(item?.mediaId).not.toBeNull();
    expect(item?.error?.code).toBe("PROVIDER_UNAVAILABLE");
    expect(manager.previewUrlFor(item?.mediaId ?? null)).not.toBeNull();
  });

  it("rejects oversized and unsupported files without clearing the photo", async () => {
    const { manager } = makeHarness();
    await manager.init("session-1", CATALOG);
    const staged = await manager.captureLocal("item-a", makeTestFile(JPEG_BYTES));
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    const keptMediaId = staged.mediaId;

    const tooBig = await manager.captureLocal(
      "item-a",
      { size: 8 * 1024 * 1024 + 1, type: "image/jpeg", arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File,
    );
    expect(tooBig.ok).toBe(false);
    const badType = await manager.captureLocal(
      "item-a",
      { size: 10, type: "image/gif", arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File,
    );
    expect(badType.ok).toBe(false);

    expect(manager.item("item-a")?.mediaId).toBe(keptMediaId);
    expect(manager.previewUrlFor(keptMediaId)).not.toBeNull();
  });
});
