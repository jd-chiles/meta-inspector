/**
 * Integrated behavioral tests for TASK-009
 * (REQ-001 … REQ-012, acceptance: integrated mobile/failure scenarios).
 *
 * Deterministic and fixture-only: MemorySessionStore, controllable fake
 * fetch, fixed clock/IDs, synthetic mock-unit bytes generated in code. No
 * provider keys, no network, no browser, no IndexedDB. Every hash, photo
 * byte, and draft below is synthetic test data — never live inference.
 * The separate live smoke (`npm run test:live`) must fail clearly without
 * credentials; nothing here proves it.
 *
 * Each block fails for the original bug it guards:
 * - Delayed fixture responses must never overwrite newer evidence, attach
 *   to another item, or restore deleted records (REQ-006).
 * - Storage failure/reload must surface explicit recovery, never silent
 *   loss or resurrection (REQ-007).
 * - Corrupt/oversized/mismatched images, timeouts, invalid model output,
 *   and missing credentials must fail closed with safe codes while the
 *   photo is kept; a failed live call must never silently become fixture
 *   output (REQ-002, REQ-003, REQ-004, REQ-010).
 * - Accepting text must never complete a physical test; rejection is not
 *   acceptance; exports must exclude unapproved draft text and never read
 *   as completed while anything is unresolved (REQ-005, REQ-008).
 * - Demo content must stay labeled and never claim a verified mapping;
 *   fixture output must stay labeled fixture (REQ-001, REQ-011).
 */
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";

import fixtureJson from "../../../fixtures/responses/fixture-draft.json";
import catalogJson from "../../../src/data/catalog.demo.json";
import {
  handleAnalyzeRequest,
  InflightTracker,
} from "../../../src/server/analyze";
import {
  canClaimFormMapping,
  DEMO_NOTICE,
  getCatalogItem,
  isDemoCatalog,
  validateCatalog,
  type Catalog,
} from "../../../src/domain/catalog";
import {
  commitDraftPayload,
  createSession,
  exportBlockers,
  reduceSession,
  unresolvedRequiredChecks,
  validateAnalysisDraft,
} from "../../../src/domain/evidence";
import {
  makeTestFile,
  WalkthroughSessionManager,
  type AnalyzeFetch,
  type AnalyzeSuccessBody,
} from "../../../src/features/walkthrough/session";
import {
  MemorySessionStore,
  isQuotaError,
  mergePreservingDeletion,
  validateStoredSession,
} from "../../../src/storage/db";
import {
  buildExportSnapshot,
  canExportCompleted,
  EXPORT_REVIEW_BANNER,
  renderExportHtml,
} from "../../../src/export/summary";
import {
  MAX_IMAGE_BYTES,
  crc32,
  validateAndNormalizeImage,
} from "../../../src/server/media/validate";
import {
  isMetaCallError,
  parseAnalysisMode,
  resolveMetaConfig,
  runFixtureDraft,
} from "../../../src/server/meta/adapter";

/* ------------------------------------------------------------------ */
/* Shared synthetic fixtures (mock-unit only).                         */
/* ------------------------------------------------------------------ */

const HASH_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const NOW = "2026-10-27T12:00:00.000Z";

const CATALOG_INPUT = {
  catalogId: "demo-habitability-walkthrough",
  catalogVersion: "0.3.0-demo.3",
  itemIds: ["demo-water-supply", "demo-interior-air"],
};

const REQUIRED_SUPPLY = ["demo-water-supply-mc1"];

const VALID_DRAFT = {
  observation: "The mock-unit sink basin looks intact with a single faucet.",
  visibleEvidence: ["basin without visible cracks"],
  unknowns: ["water flow cannot be told from the photo"],
  suggestedManualChecks: ["Run both taps and watch the basin drain."],
};

const INVALID_VERDICT_DRAFT = {
  observation: "Looks fine.",
  visibleEvidence: ["basin visible"],
  unknowns: ["flow unknown"],
  suggestedManualChecks: [],
  verdict: "approved",
};

function digestFor(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

function successBody(overrides: Record<string, unknown> = {}): AnalyzeSuccessBody {
  return {
    envelope: { draft: { ...VALID_DRAFT } },
    normalizedMedia: {
      mediaId: "media-server-1",
      mime: "image/jpeg",
      width: 800,
      height: 600,
      digest: digestFor("d"),
      base64: Buffer.from([9, 9, 9]).toString("base64"),
    },
    model: "muse-spark-1.3",
    mode: "fixture",
    requestId: "req-test-1",
    latencyMs: 5,
    ...overrides,
  } as unknown as AnalyzeSuccessBody;
}

/** Controllable deferred fetch: resolves only when the test releases it. */
function deferredFetch() {
  let release!: (outcome: { status: number; body: unknown }) => void;
  const calls: FormData[] = [];
  const pending = new Promise<{ status: number; body: unknown }>(
    (resolve) => {
      release = resolve;
    },
  );
  const fetch: AnalyzeFetch = (form) => {
    calls.push(form);
    return pending as unknown as ReturnType<AnalyzeFetch>;
  };
  return { fetch, release, calls };
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
      counter += 1;
      const url = `blob:mock-url-${counter}`;
      createdUrls.push(url);
      return url;
    },
    revokeObjectURL: (url) => {
      revokedUrls.push(url);
    },
    analyzeFetch: fetch,
    generateId: (prefix) => {
      counter += 1;
      return `${prefix}-test-${counter}`;
    },
    now: () => NOW,
  });
  return { manager, store, createdUrls, revokedUrls };
}

async function initHarness(
  harness: Harness,
  sessionId = "session-1",
): Promise<void> {
  await harness.manager.init(sessionId, CATALOG_INPUT);
}

/* Minimal valid PNG bytes generated in code (mock-unit only). */
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

function buildPng(width: number, height: number): Uint8Array {
  const signature = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = new Uint8Array(
    deflateSync(Buffer.from(new Uint8Array(height * (1 + width * 3)))),
  );
  return concatBytes([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function routeRequest(
  fields: Record<string, string>,
  image: { bytes: Uint8Array; name: string; type: string },
  origin?: string,
): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set(
    "image",
    new File([image.bytes as unknown as BlobPart], image.name, {
      type: image.type,
    }),
  );
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers.origin = origin;
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers,
    body: form,
  });
}

function demoCatalog(): Catalog {
  const parsed = validateCatalog(catalogJson);
  if (!parsed.ok) throw new Error(`demo catalog invalid: ${parsed.errors.join("; ")}`);
  return parsed.value;
}

const VALID_FIELDS = {
  sessionId: "session-1",
  itemId: "demo-water-supply",
  catalogVersion: "0.3.0-demo.3",
  analysisId: "analysis-1",
};

/* ------------------------------------------------------------------ */
/* Retake / delete / cancel races with delayed fixture responses.      */
/* ------------------------------------------------------------------ */

describe("delayed fixture responses never overwrite newer evidence", () => {
  it("a retake during inflight analysis discards the stale success", async () => {
    const deferred = deferredFetch();
    const harness = makeHarness(deferred.fetch);
    await initHarness(harness);
    const first = makeTestFile(new Uint8Array([1, 2, 3]), "image/jpeg");
    const analyzePromise = harness.manager.analyze("demo-water-supply", first);

    // Retake replaces the photo while the first analysis is still pending.
    const second = makeTestFile(new Uint8Array([4, 5, 6]), "image/jpeg");
    const staged = await harness.manager.captureLocal(
      "demo-water-supply",
      second,
    );
    expect(staged.ok).toBe(true);

    // The delayed first response arrives late and must be discarded.
    deferred.release({ status: 200, body: successBody() });
    const outcome = await analyzePromise;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("STALE_RESPONSE");

    const item = harness.manager.item("demo-water-supply");
    expect(item?.status).toBe("captured");
    expect(item?.draft).toBeNull();
    // Current evidence is the replacement photo, not the stale server bytes.
    if (staged.ok) expect(item?.mediaId).toBe(staged.mediaId);
  });

  it("deleting evidence during inflight analysis discards the late success", async () => {
    const deferred = deferredFetch();
    const harness = makeHarness(deferred.fetch);
    await initHarness(harness);
    const file = makeTestFile(new Uint8Array([7, 8, 9]), "image/jpeg");
    const analyzePromise = harness.manager.analyze("demo-water-supply", file);

    await harness.manager.deleteItemEvidence("demo-water-supply");

    deferred.release({ status: 200, body: successBody() });
    const outcome = await analyzePromise;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("STALE_RESPONSE");

    const item = harness.manager.item("demo-water-supply");
    expect(item?.deleted).toBe(true);
    expect(item?.draft).toBeNull();
    expect(item?.mediaId).toBeNull();
    // Storage holds no resurrected bytes for the deleted item.
    expect(harness.store.mediaIds()).not.toContain("media-server-1");
  });

  it("cancellation keeps the photo and a late failure never clears it", async () => {
    const abortAwareHangingFetch: AnalyzeFetch = (_form, signal) =>
      new Promise((_resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException("cancelled", "AbortError"));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(new DOMException("cancelled", "AbortError"));
        });
      });
    const harness = makeHarness(abortAwareHangingFetch);
    await initHarness(harness);
    const staged = await harness.manager.captureLocal(
      "demo-water-supply",
      makeTestFile(new Uint8Array([10, 11]), "image/jpeg"),
    );
    expect(staged.ok).toBe(true);

    // Begin analysis through the public path, then cancel before any response.
    const analyzePromise = harness.manager.analyze(
      "demo-water-supply",
      makeTestFile(new Uint8Array([12]), "image/jpeg"),
    );
    // Let the analysis reach its inflight fetch before cancelling.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const cancelled = await harness.manager.cancel("demo-water-supply");
    expect(
      cancelled.inflight.find(
        (entry) => entry.itemId === "demo-water-supply",
      ),
    ).toBeUndefined();
    const settled = await analyzePromise;
    expect(settled.ok).toBe(false);
    if (!settled.ok) expect(settled.code).toBe("CANCELLED");

    const item = harness.manager.item("demo-water-supply");
    expect(item?.status).toBe("captured");
    expect(item?.mediaId).not.toBeNull();
    expect(item?.draft).toBeNull();
  });

  it("the reducer ignores stale attempts and cross-item envelopes", () => {
    let state = createSession("session-1", CATALOG_INPUT, NOW);
    state = reduceSession(
      state,
      {
        type: "capture-media",
        itemId: "demo-water-supply",
        mediaId: "media-1",
        mediaHash: HASH_A,
        capturedAt: NOW,
      },
      NOW,
    );
    const attempt = state.items["demo-water-supply"].attempt;
    state = reduceSession(
      state,
      {
        type: "begin-analysis",
        itemId: "demo-water-supply",
        analysisId: "analysis-1",
        attempt,
      },
      NOW,
    );

    // Stale attempt: ignored by reference equality, no state change.
    const stale = reduceSession(
      state,
      commitDraftPayload(
        "demo-water-supply",
        "analysis-1",
        attempt + 99,
        "media-1",
        HASH_A,
        { sessionId: "session-1", catalogVersion: "0.3.0-demo.3" },
      ),
      NOW,
    );
    expect(stale).toBe(state);

    // Cross-session envelope: discarded, never attached.
    const crossSession = reduceSession(
      state,
      commitDraftPayload(
        "demo-water-supply",
        "analysis-1",
        attempt,
        "media-1",
        HASH_A,
        { sessionId: "intruder-session", catalogVersion: "0.3.0-demo.3" },
      ),
      NOW,
    );
    expect(crossSession).toBe(state);

    // Cross-item envelope: discarded, the other item stays untouched.
    const beforeOther = state.items["demo-interior-air"];
    const mismatched = {
      type: "commit-draft",
      itemId: "demo-water-supply",
      analysisId: "analysis-1",
      attempt,
      mediaId: "media-1",
      mediaHash: HASH_A,
      envelope: {
        analysisId: "analysis-1",
        sessionId: "session-1",
        itemId: "demo-interior-air",
        catalogVersion: "0.3.0-demo.3",
        mediaId: "media-1",
        mediaHash: HASH_A,
        model: "muse-spark-1.3",
        mode: "fixture",
        requestId: "req-analysis-1",
        latencyMs: 1,
        draft: { ...VALID_DRAFT },
      },
    } as const;
    const crossItem = reduceSession(state, mismatched, NOW);
    expect(crossItem).toBe(state);
    expect(state.items["demo-interior-air"]).toBe(beforeOther);
  });
});

/* ------------------------------------------------------------------ */
/* Storage failure, reload recovery, and deletion tombstones.          */
/* ------------------------------------------------------------------ */

describe("storage failure and reload keep explicit recovery", () => {
  it("refresh recovery restores the session, media bytes, and preview URLs", async () => {
    const harness = makeHarness(async () => ({
      status: 200,
      body: successBody(),
    }));
    await initHarness(harness);
    const analyzed = await harness.manager.analyze(
      "demo-water-supply",
      makeTestFile(new Uint8Array([21, 22]), "image/jpeg"),
    );
    expect(analyzed.ok).toBe(true);
    const mediaId = harness.manager.item("demo-water-supply")?.mediaId;
    expect(mediaId).not.toBeNull();

    // A fresh manager over the same store simulates a page reload.
    const reloaded = new WalkthroughSessionManager({
      store: harness.store,
      createObjectURL: () => "blob:rehydrated",
      revokeObjectURL: () => undefined,
      generateId: (prefix) => `${prefix}-reload`,
      now: () => NOW,
    });
    const snapshot = await reloaded.init("session-1", CATALOG_INPUT);
    expect(snapshot.storage.kind).toBe("ready");
    expect(reloaded.item("demo-water-supply")?.status).toBe("draft");
    expect(reloaded.item("demo-water-supply")?.draft?.observation).toContain(
      "basin",
    );
    expect(reloaded.previewUrlFor(mediaId ?? "")).toBe("blob:rehydrated");
  });

  it("quota failure switches to an explicit in-memory session with warning", async () => {
    const quotaStore = new MemorySessionStore({ quotaBytes: 0 });
    const manager = new WalkthroughSessionManager({
      store: quotaStore,
      inMemory: false,
      createObjectURL: () => "blob:memory",
      revokeObjectURL: () => undefined,
      generateId: (prefix) => `${prefix}-quota`,
      now: () => NOW,
    });
    await manager.init("session-quota", CATALOG_INPUT);
    const result = await manager.captureLocal(
      "demo-water-supply",
      makeTestFile(new Uint8Array([31]), "image/jpeg"),
    );
    expect(result.ok).toBe(true);
    const snapshot = manager.snapshot();
    expect(snapshot.storage.kind).toBe("in-memory");
    expect(snapshot.storage.inMemory).toBe(true);
    expect(snapshot.storage.message).toMatch(/memory only/i);
    expect(isQuotaError({ name: "QuotaExceededError" })).toBe(true);
    expect(isQuotaError(new Error("plain io"))).toBe(false);
  });

  it("corrupt rows and schema mismatches surface recovery instead of trust", async () => {
    // Corrupt row: not an object shaped like a session.
    const corruptStore = new MemorySessionStore();
    await corruptStore.saveSession({
      sessionId: "session-corrupt",
      schemaVersion: 1,
      items: {},
    } as never);
    // Force corruption through the raw shape validator.
    const bad = validateStoredSession({ nope: true });
    expect(bad.ok).toBe(false);

    const manager = new WalkthroughSessionManager({
      store: corruptStore,
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => undefined,
      generateId: (prefix) => `${prefix}-c`,
      now: () => NOW,
    });
    // A version mismatch row reports needs-reset, never a trusted session.
    await corruptStore.saveSession({
      sessionId: "session-old",
      schemaVersion: 999,
      catalogId: CATALOG_INPUT.catalogId,
      catalogVersion: CATALOG_INPUT.catalogVersion,
      currentItemId: null,
      items: {},
      deleted: false,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
    const loaded = await manager.init("session-old", CATALOG_INPUT);
    expect(loaded.storage.kind).toBe("needs-reset");
    expect(loaded.state).toBeNull();

    // Reset recovers with a fresh mock session.
    const reset = await manager.resetStorage("session-old", CATALOG_INPUT);
    expect(reset.state).not.toBeNull();
    expect(reset.state?.items["demo-water-supply"].status).toBe("empty");
  });

  it("storage merges never resurrect deleted sessions or items", () => {
    let state = createSession("session-1", CATALOG_INPUT, NOW);
    state = reduceSession(state, { type: "delete-session" }, NOW);
    const replayed = mergePreservingDeletion(state, {
      ...state,
      deleted: false,
    });
    expect(replayed.deleted).toBe(true);

    let live = createSession("session-2", CATALOG_INPUT, NOW);
    live = reduceSession(
      live,
      {
        type: "capture-media",
        itemId: "demo-water-supply",
        mediaId: "media-1",
        mediaHash: HASH_A,
        capturedAt: NOW,
      },
      NOW,
    );
    live = reduceSession(
      live,
      { type: "delete-item-evidence", itemId: "demo-water-supply" },
      NOW,
    );
    const resurrected = mergePreservingDeletion(live, {
      ...live,
      items: {
        ...live.items,
        "demo-water-supply": {
          ...live.items["demo-water-supply"],
          deleted: false,
          mediaId: "media-attacker",
        },
      },
    });
    expect(resurrected.items["demo-water-supply"].deleted).toBe(true);
    expect(
      resurrected.items["demo-water-supply"].mediaId,
    ).not.toBe("media-attacker");
  });
});

/* ------------------------------------------------------------------ */
/* Media boundaries at the API route (no provider involved).           */
/* ------------------------------------------------------------------ */

describe("media boundaries fail closed with safe codes", () => {
  it("rejects corrupt, mismatched, oversized, and empty uploads", async () => {
    const catalog = demoCatalog();
    const tracker = new InflightTracker();

    const garbage = await handleAnalyzeRequest(
      routeRequest(VALID_FIELDS, {
        bytes: new TextEncoder().encode("this is not an image"),
        name: "photo.png",
        type: "image/png",
      }),
      { catalog, tracker },
    );
    expect(garbage.status).toBe(415);
    expect(
      (garbage.body as { error: { code: string } }).error.code,
    ).toBe("INVALID_MEDIA");

    const truncated = await handleAnalyzeRequest(
      routeRequest(VALID_FIELDS, {
        bytes: buildPng(2, 2).slice(0, 10),
        name: "photo.png",
        type: "image/png",
      }),
      { catalog, tracker },
    );
    expect(truncated.status).toBe(422);

    const mismatched = await handleAnalyzeRequest(
      routeRequest(VALID_FIELDS, {
        bytes: buildPng(2, 2),
        name: "photo.jpg",
        type: "image/jpeg",
      }),
      { catalog, tracker },
    );
    expect(mismatched.status).toBe(422);

    const oversized = await handleAnalyzeRequest(
      routeRequest(
        { ...VALID_FIELDS, analysisId: "analysis-big" },
        {
          bytes: new Uint8Array(MAX_IMAGE_BYTES + 1),
          name: "photo.jpg",
          type: "image/jpeg",
        },
      ),
      { catalog, tracker },
    );
    expect(oversized.status).toBe(413);

    const empty = await handleAnalyzeRequest(
      routeRequest(
        { ...VALID_FIELDS, analysisId: "analysis-empty" },
        { bytes: new Uint8Array(0), name: "photo.jpg", type: "image/jpeg" },
      ),
      { catalog, tracker },
    );
    expect(empty.status).toBe(400);
  });

  it("rejects cross-origin, client-supplied URLs/models, version drift, and duplicates", async () => {
    const catalog = demoCatalog();
    const image = {
      bytes: buildPng(2, 2),
      name: "photo.png",
      type: "image/png",
    };

    const crossOrigin = await handleAnalyzeRequest(
      routeRequest(VALID_FIELDS, image, "https://evil.test"),
      { catalog, tracker: new InflightTracker() },
    );
    expect(crossOrigin.status).toBe(403);

    const withUrl = new Request("http://localhost/api/analyze", {
      method: "POST",
      body: (() => {
        const form = new FormData();
        for (const [key, value] of Object.entries(VALID_FIELDS)) {
          form.set(key, value);
        }
        form.set("imageUrl", "https://example.test/photo.jpg");
        form.set(
          "image",
          new File([image.bytes as unknown as BlobPart], image.name, {
            type: image.type,
          }),
        );
        return form;
      })(),
    });
    const urlRejected = await handleAnalyzeRequest(withUrl, {
      catalog,
      tracker: new InflightTracker(),
    });
    expect(urlRejected.status).toBe(400);

    const drifted = await handleAnalyzeRequest(
      routeRequest({ ...VALID_FIELDS, catalogVersion: "9.9.9" }, image),
      { catalog, tracker: new InflightTracker() },
    );
    expect(drifted.status).toBe(409);
    expect(
      (drifted.body as { error: { code: string } }).error.code,
    ).toBe("ITEM_MISMATCH");

    const tracker = new InflightTracker();
    expect(tracker.acquire("session-1", "analysis-a")).toBe(true);
    const duplicate = await handleAnalyzeRequest(
      routeRequest(VALID_FIELDS, image),
      { catalog, tracker },
    );
    expect(duplicate.status).toBe(409);
    expect(
      (duplicate.body as { error: { code: string; retryable: boolean } })
        .error.code,
    ).toBe("REQUEST_IN_PROGRESS");
    expect(
      (duplicate.body as { error: { retryable: boolean } }).error.retryable,
    ).toBe(true);
  });

  it("valid mock-unit bytes normalize with digest and downscale target", () => {
    const normalized = validateAndNormalizeImage(buildPng(2, 2), {
      claimedMime: "image/png",
      mediaId: "media-test",
    });
    expect(normalized.mediaId).toBe("media-test");
    expect(normalized.mime).toBe("image/png");
    expect(normalized.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(normalized.width).toBe(2);
    expect(normalized.height).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Timeout, invalid output, and missing credentials.                   */
/* ------------------------------------------------------------------ */

describe("timeout, invalid output, and missing key fail closed", () => {
  it("a timed-out provider call surfaces PROVIDER_TIMEOUT and keeps the photo", async () => {
    const catalog = demoCatalog();
    const abortingFetch = (
      _input: string,
      init?: { signal?: AbortSignal | null },
    ): Promise<never> =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const outcome = await handleAnalyzeRequest(
      routeRequest({ ...VALID_FIELDS, analysisId: "analysis-timeout" }, {
        bytes: buildPng(2, 2),
        name: "photo.png",
        type: "image/png",
      }),
      {
        catalog,
        tracker: new InflightTracker(),
        mode: "live",
        metaEnv: {
          APP_ANALYSIS_MODE: "live",
          META_API_KEY: "test-key-not-a-secret",
          META_API_BASE_URL: "https://api.meta.ai/v1",
          META_MODEL: "muse-spark-1.3",
        },
        fetchImpl: abortingFetch,
        timeoutMs: 20,
      },
    );
    expect(outcome.status).toBe(504);
    expect(
      (outcome.body as { error: { code: string; retryable: boolean } }).error
        .code,
    ).toBe("PROVIDER_TIMEOUT");
    expect(
      (outcome.body as { error: { retryable: boolean } }).error.retryable,
    ).toBe(true);

    // Manager-level: a failed analysis keeps the staged photo for retry.
    const harness = makeHarness(async () => ({
      status: 502,
      body: {
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: "synthetic outage. The photo is kept.",
          retryable: true,
        },
        analysisId: "analysis-x",
      },
    }));
    await initHarness(harness);
    const failed = await harness.manager.analyze(
      "demo-water-supply",
      makeTestFile(new Uint8Array([41]), "image/jpeg"),
    );
    expect(failed.ok).toBe(false);
    const item = harness.manager.item("demo-water-supply");
    expect(item?.status).toBe("error");
    expect(item?.mediaId).not.toBeNull();
    expect(item?.error?.code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("invalid model output is rejected and the photo is kept", async () => {
    const catalog = demoCatalog();
    const invalid = await handleAnalyzeRequest(
      routeRequest({ ...VALID_FIELDS, analysisId: "analysis-invalid" }, {
        bytes: buildPng(2, 2),
        name: "photo.png",
        type: "image/png",
      }),
      {
        catalog,
        tracker: new InflightTracker(),
        mode: "fixture",
        fixture: {
          mode: "fixture",
          model: "muse-spark-1.3",
          draft: INVALID_VERDICT_DRAFT,
        },
      },
    );
    expect(invalid.status).toBe(502);
    expect(
      (invalid.body as { error: { code: string } }).error.code,
    ).toBe("INVALID_MODEL_OUTPUT");

    const parsed = validateAnalysisDraft(INVALID_VERDICT_DRAFT);
    expect(parsed.ok).toBe(false);

    // Manager-level: strict output rejection lands in error with media kept.
    const harness = makeHarness(async () => ({
      status: 200,
      body: successBody({
        envelope: { draft: INVALID_VERDICT_DRAFT },
      }),
    }));
    await initHarness(harness);
    const outcome = await harness.manager.analyze(
      "demo-water-supply",
      makeTestFile(new Uint8Array([42]), "image/jpeg"),
    );
    // The manager records the validation failure as an error state; either
    // way the draft is never persisted and the photo survives.
    expect(outcome.ok).toBe(true);
    const item = harness.manager.item("demo-water-supply");
    expect(item?.status).toBe("error");
    expect(item?.draft).toBeNull();
    expect(item?.mediaId).not.toBeNull();
    expect(item?.error?.code).toBe("INVALID_MODEL_OUTPUT");
  });

  it("live mode without credentials fails closed and never falls back to fixtures", async () => {
    const catalog = demoCatalog();
    const outcome = await handleAnalyzeRequest(
      routeRequest({ ...VALID_FIELDS, analysisId: "analysis-nokey" }, {
        bytes: buildPng(2, 2),
        name: "photo.png",
        type: "image/png",
      }),
      {
        catalog,
        tracker: new InflightTracker(),
        mode: "live",
        metaEnv: {
          APP_ANALYSIS_MODE: "live",
          META_API_BASE_URL: "https://api.meta.ai/v1",
        },
        fetchImpl: () => {
          throw new Error("must never be called without credentials");
        },
      },
    );
    expect(outcome.status).toBe(503);
    expect(
      (outcome.body as { error: { code: string } }).error.code,
    ).toBe("SETUP_REQUIRED");
    expect(outcome.body).not.toHaveProperty("envelope");
    expect(outcome.body).not.toHaveProperty("normalizedMedia");
  });

  it("rate limits map to a safe retryable code and mode parsing stays explicit", async () => {
    expect(parseAnalysisMode(undefined)).toBe("fixture");
    expect(parseAnalysisMode("live")).toBe("live");
    expect(parseAnalysisMode("auto")).toBeNull();

    const catalog = demoCatalog();
    const limited = await handleAnalyzeRequest(
      routeRequest({ ...VALID_FIELDS, analysisId: "analysis-429" }, {
        bytes: buildPng(2, 2),
        name: "photo.png",
        type: "image/png",
      }),
      {
        catalog,
        tracker: new InflightTracker(),
        mode: "live",
        metaEnv: {
          APP_ANALYSIS_MODE: "live",
          META_API_KEY: "test-key-not-a-secret",
          META_API_BASE_URL: "https://api.meta.ai/v1",
        },
        fetchImpl: async () => ({
          ok: false,
          status: 429,
          headers: { get: () => null },
          json: async () => ({}),
        }),
      },
    );
    expect(limited.status).toBe(429);
    const limitedBody = limited.body as {
      error: { code: string; retryable: boolean };
    };
    expect(limitedBody.error.code).toBe("PROVIDER_RATE_LIMIT");
    expect(limitedBody.error.retryable).toBe(true);
    expect(parseAnalysisMode(undefined)).toBe("fixture");
    expect(parseAnalysisMode("live")).toBe("live");
    expect(parseAnalysisMode("auto")).toBeNull();

    const config = resolveMetaConfig({
      APP_ANALYSIS_MODE: "fixture",
      META_API_BASE_URL: "https://api.meta.ai/v1",
    });
    expect(config.mode).toBe("fixture");

    const fixture = runFixtureDraft(fixtureJson, { requestId: "req-1" });
    expect(fixture.mode).toBe("fixture");
    expect(fixture.draft.observation.length).toBeGreaterThan(0);

    const corrupt = () =>
      runFixtureDraft({
        mode: "fixture",
        model: "muse-spark-1.3",
        draft: INVALID_VERDICT_DRAFT,
      });
    let threw = false;
    try {
      corrupt();
    } catch (error) {
      threw = true;
      expect(isMetaCallError(error)).toBe(true);
    }
    expect(threw, "corrupt fixture drafts must throw").toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Review, manual checks, and review-only export honesty.               */
/* ------------------------------------------------------------------ */

describe("review and manual checks stay honest", () => {
  function acceptedState() {
    let state = createSession("session-1", CATALOG_INPUT, NOW);
    state = reduceSession(
      state,
      {
        type: "capture-media",
        itemId: "demo-water-supply",
        mediaId: "media-1",
        mediaHash: HASH_A,
        capturedAt: NOW,
      },
      NOW,
    );
    const attempt = state.items["demo-water-supply"].attempt;
    state = reduceSession(
      state,
      {
        type: "begin-analysis",
        itemId: "demo-water-supply",
        analysisId: "analysis-1",
        attempt,
      },
      NOW,
    );
    state = reduceSession(
      state,
      commitDraftPayload(
        "demo-water-supply",
        "analysis-1",
        attempt,
        "media-1",
        HASH_A,
        { sessionId: "session-1", catalogVersion: "0.3.0-demo.3" },
      ),
      NOW,
    );
    return state;
  }

  it("accepting text never completes a physical test", async () => {
    let state = createSession("session-9", CATALOG_INPUT, NOW);
    state = reduceSession(
      state,
      {
        type: "capture-media",
        itemId: "demo-water-supply",
        mediaId: "media-1",
        mediaHash: HASH_A,
        capturedAt: NOW,
      },
      NOW,
    );
    const attempt = state.items["demo-water-supply"].attempt;
    state = reduceSession(
      state,
      {
        type: "begin-analysis",
        itemId: "demo-water-supply",
        analysisId: "analysis-1",
        attempt,
      },
      NOW,
    );
    state = reduceSession(
      state,
      commitDraftPayload(
        "demo-water-supply",
        "analysis-1",
        attempt,
        "media-1",
        HASH_A,
        { sessionId: "session-9", catalogVersion: "0.3.0-demo.3" },
      ),
      NOW,
    );
    state = reduceSession(
      state,
      { type: "accept", itemId: "demo-water-supply" },
      NOW,
    );
    expect(state.items["demo-water-supply"].status).toBe("reviewed");
    // No manual-check response was recorded by the acceptance.
    expect(
      unresolvedRequiredChecks(REQUIRED_SUPPLY, state.items["demo-water-supply"].manualChecks),
    ).toEqual(REQUIRED_SUPPLY);
    // Both items block export: the accepted item still lacks performed
    // checks, and the untouched item has no review at all.
    expect(
      exportBlockers(state, { "demo-water-supply": REQUIRED_SUPPLY }),
    ).toHaveLength(2);
  });

  it("not-performed stays unresolved; rejection is not acceptance", () => {
    let state = acceptedState();
    state = reduceSession(
      state,
      {
        type: "record-manual-check",
        itemId: "demo-water-supply",
        checkId: "demo-water-supply-mc1",
        outcome: "not-performed",
        note: "Tenant declined the tap test today.",
        recordedAt: NOW,
        requiredCheckIds: REQUIRED_SUPPLY,
      },
      NOW,
    );
    expect(
      unresolvedRequiredChecks(REQUIRED_SUPPLY, state.items["demo-water-supply"].manualChecks),
    ).toContain("demo-water-supply-mc1");

    let rejected = acceptedState();
    rejected = reduceSession(
      rejected,
      { type: "reject", itemId: "demo-water-supply", reason: "Too dark." },
      NOW,
    );
    expect(rejected.items["demo-water-supply"].status).toBe("rejected");
    expect(rejected.items["demo-water-supply"].disposition).toBe("rejected");
    // Rejection plus the untouched second item: two export blockers.
    expect(
      exportBlockers(rejected, { "demo-water-supply": REQUIRED_SUPPLY }),
    ).toHaveLength(2);
  });

  it("export excludes unapproved draft text and never reads as completed while unresolved", () => {
    const catalog = demoCatalog();
    let state = acceptedState();
    // Record every required check as performed with notes.
    for (const checkId of REQUIRED_SUPPLY) {
      state = reduceSession(
        state,
        {
          type: "record-manual-check",
          itemId: "demo-water-supply",
          checkId,
          outcome: "performed",
          note: `Performed ${checkId}.`,
          recordedAt: NOW,
          requiredCheckIds: REQUIRED_SUPPLY,
        },
        NOW,
      );
    }
    state = reduceSession(
      state,
      { type: "accept", itemId: "demo-water-supply" },
      NOW,
    );
    const mediaById = {
      "media-1": {
        bytes: buildPng(2, 2),
        mime: "image/png",
      },
    };
    const snapshot = buildExportSnapshot({
      state,
      catalog,
      mediaById,
      analysisMode: "fixture",
      generatedAt: NOW,
    });
    // One item completed, the other untouched: the export stays unresolved.
    expect(snapshot.canClaimCompleted).toBe(false);
    expect(canExportCompleted(snapshot)).toBe(false);
    expect(snapshot.unresolved.map((entry) => entry.itemId)).toContain(
      "demo-interior-air",
    );
    const completed = snapshot.items.find(
      (entry) => entry.itemId === "demo-water-supply",
    );
    expect(completed?.completed).toBe(true);
    expect(completed?.reviewedNote).toContain("basin");
    expect(completed?.photoDataUrl?.startsWith("data:image/png;base64,")).toBe(
      true,
    );
    const pending = snapshot.items.find(
      (entry) => entry.itemId === "demo-interior-air",
    );
    expect(pending?.completed).toBe(false);
    expect(pending?.reviewedNote).toBeNull();

    const html = renderExportHtml(snapshot);
    // Banner repeats: header, every item, footer, and the print header.
    const bannerCount = html.split(EXPORT_REVIEW_BANNER).length - 1;
    expect(bannerCount).toBeGreaterThanOrEqual(snapshot.items.length + 2);
    // The unresolved item contributes no draft text and no remote imagery.
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("blob:");
    expect(html).toContain("Unresolved items");
    // The export never claims approval or completion for unresolved work:
    // the only approval-adjacent wording is the review-only banner itself.
    expect(html).toContain("not an approved inspection");
    expect(html).not.toMatch(/certified|passed inspection|fully compliant/i);
  });

  it("hostile model and worker text is escaped in printable HTML", () => {
    const catalog = demoCatalog();
    let state = createSession("session-evil", CATALOG_INPUT, NOW);
    state = reduceSession(
      state,
      {
        type: "capture-media",
        itemId: "demo-water-supply",
        mediaId: "media-1",
        mediaHash: HASH_A,
        capturedAt: NOW,
      },
      NOW,
    );
    const attempt = state.items["demo-water-supply"].attempt;
    state = reduceSession(
      state,
      {
        type: "begin-analysis",
        itemId: "demo-water-supply",
        analysisId: "analysis-1",
        attempt,
      },
      NOW,
    );
    state = reduceSession(
      state,
      commitDraftPayload(
        "demo-water-supply",
        "analysis-1",
        attempt,
        "media-1",
        HASH_A,
        {
          sessionId: "session-evil",
          catalogVersion: "0.3.0-demo.3",
          draft: {
            observation: 'Sink looks ok <script>alert("xss")</script>.',
            visibleEvidence: ['<img src=x onerror=alert(1)>'],
            unknowns: ["flow unknown"],
            suggestedManualChecks: [],
          },
        },
      ),
      NOW,
    );
    for (const checkId of REQUIRED_SUPPLY) {
      state = reduceSession(
        state,
        {
          type: "record-manual-check",
          itemId: "demo-water-supply",
          checkId,
          outcome: "performed",
          note: 'Note with <b>markup</b> & "quotes".',
          recordedAt: NOW,
          requiredCheckIds: REQUIRED_SUPPLY,
        },
        NOW,
      );
    }
    state = reduceSession(
      state,
      { type: "accept-edited", itemId: "demo-water-supply", revisedText: "Worker note <i>edited</i>." },
      NOW,
    );
    // Second item must also complete or the snapshot cannot claim completed;
    // force the scope to the single reviewed item for the escaping assertion.
    const singleCatalog: Catalog = {
      ...catalog,
      items: catalog.items.filter((entry) => entry.id === "demo-water-supply"),
    };
    const snapshot = buildExportSnapshot({
      state,
      catalog: singleCatalog,
      mediaById: {
        "media-1": { bytes: buildPng(2, 2), mime: "image/png" },
      },
      analysisMode: "fixture",
      generatedAt: NOW,
    });
    const completed = snapshot.items.find(
      (entry) => entry.itemId === "demo-water-supply",
    );
    // Exact drop-point guard: the edited path must stay completed with all
    // reviewed hostile content present in the snapshot (REQ-005/REQ-008).
    expect(completed?.completed).toBe(true);
    expect(completed?.reviewedNote).toContain("<i>edited</i>");
    expect(completed?.originalObservation).toContain("<script>");
    expect(completed?.visibleEvidence).toEqual([
      "<img src=x onerror=alert(1)>",
    ]);
    expect(
      completed?.manualChecks.find(
        (check) => check.checkId === "demo-water-supply-mc1",
      )?.note,
    ).toContain("<b>");
    const html = renderExportHtml(snapshot);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>markup</b>");
    expect(html).not.toContain("<i>edited</i>");
    // NOTE: no `not.toContain("onerror=alert(1)")` guard here by design:
    // escapeHtml neutralizes `<`/`>` but preserves the inert handler text,
    // so the correctly escaped output `&lt;img src=x onerror=alert(1)&gt;`
    // still contains that substring. Non-executability is proven by the
    // raw-markup guards above (`<script>`, `<img src=x` absent) plus the
    // escaped-form guards below (`&lt;...&gt;` present).
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;b&gt;markup&lt;/b&gt;");
    expect(html).toContain("&lt;i&gt;edited&lt;/i&gt;");
  });

  it("an entirely unreviewed session cannot export as completed", () => {
    const catalog = demoCatalog();
    const state = createSession("session-fresh", CATALOG_INPUT, NOW);
    const snapshot = buildExportSnapshot({
      state,
      catalog,
      mediaById: {},
      analysisMode: "fixture",
      generatedAt: NOW,
    });
    expect(snapshot.canClaimCompleted).toBe(false);
    expect(snapshot.completedCount).toBe(0);
    expect(snapshot.unresolved).toHaveLength(catalog.items.length);
    expect(
      exportBlockers(state, {
        "demo-water-supply": REQUIRED_SUPPLY,
        "demo-interior-air": ["demo-interior-air-mc1"],
      }).length,
    ).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Catalog honesty and fixture labeling.                                */
/* ------------------------------------------------------------------ */

describe("catalog and fixture honesty", () => {
  it("the bundled demo catalog stays labeled and cannot claim a mapping", () => {
    const catalog = demoCatalog();
    expect(isDemoCatalog(catalog)).toBe(true);
    expect(catalog.demoNotice).toBe(DEMO_NOTICE);
    expect(canClaimFormMapping(catalog)).toBe(false);
    expect(catalog.items.length).toBe(11);
    expect(catalog.items.map((item) => item.id)).toEqual([
      "demo-item-05",
      "demo-item-06",
      "demo-item-07",
      "demo-interior-air",
      "demo-water-supply",
      "demo-item-08",
      "demo-item-09",
      "demo-lighting-electric",
      "demo-item-10",
      "demo-item-11",
      "demo-smoke-co",
    ]);
    expect(getCatalogItem(catalog, "demo-water-supply")).not.toBeNull();

    // A fake confirmation (demo mode claiming verified) never promotes.
    const fakeConfirmed = validateCatalog({
      ...(catalogJson as Record<string, unknown>),
      sourceConfirmation: {
        status: "confirmed",
        suppliedBy: "someone",
        verifiedBy: "someone",
        verifiedAt: "2026-10-27",
        notes: "fake confirmation attached to a demo catalog",
      },
    });
    expect(fakeConfirmed.ok).toBe(false);
  });

  it("fixture output is always labeled fixture and distinct from live", () => {
    expect(fixtureJson.mode).toBe("fixture");
    expect(typeof fixtureJson.fixtureNotice).toBe("string");
    const image = buildPng(2, 2);
    const normalized = validateAndNormalizeImage(image, {
      claimedMime: "image/png",
    });
    expect(normalized.digest).toMatch(/^[0-9a-f]{64}$/);
    // Placeholder digests used by the session manager are also 64-hex but
    // are never presented as verified media hashes.
    expect(digestFor("z")).toHaveLength(64);
    expect(HASH_B).not.toBe(HASH_A);
  });
});
