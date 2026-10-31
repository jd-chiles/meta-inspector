/**
 * Behavioral and regression tests for TASK-072 (REQ-001 … REQ-013).
 *
 * 11-item catalog flows, offline pending queue with explicit reconnect sync,
 * PDF/export parity (print-CSS policy included), and reconnect-race guards.
 *
 * Deterministic and fixture-only: synthetic mock-unit digests and bytes, fixed
 * clock, no network, no provider keys, no browser, no IndexedDB. Every hash
 * and photo byte below is synthetic test data — never live inference.
 *
 * These tests fail without the feature:
 * - The catalog gate requires exactly 11 items, so the pre-epoch-3 3–4-item
 *   validator rejects the bundled 11-item demo catalog (and vice versa).
 * - Queue, cache-boundary, banner-parity, and race assertions pin the
 *   pending-only offline semantics and print policy that the PWA delta adds.
 */
import { describe, expect, it } from "vitest";

import demoCatalogJson from "../../src/data/catalog.demo.json";
import {
  assertValidCatalog,
  canClaimFormMapping,
  DEMO_NOTICE,
  getCatalogItem,
  isDemoCatalog,
  validateCatalog,
} from "../../src/domain/catalog";
import {
  commitDraftPayload,
  createSession,
  exportBlockers,
  isCheckResolved,
  reduceSession,
  unresolvedRequiredChecks,
  type SessionState,
} from "../../src/domain/evidence";
import {
  buildExportSnapshot,
  canExportCompleted,
  EXPORT_REVIEW_BANNER,
  renderExportHtml,
  __testOnly,
  type BuildExportInput,
} from "../../src/export/summary";
import {
  clearQueuedForSession,
  createQueuedIntent,
  describeOfflineState,
  describePendingItem,
  enqueueOfflineAnalysis,
  isItemQueued,
  loadOfflineQueue,
  OFFLINE_QUEUE_STORAGE_KEY,
  pendingForSession,
  removeQueuedForItem,
  saveOfflineQueue,
  shouldServiceWorkerCache,
  validateQueuedIntent,
  type OfflineQueue,
  type StorageLike,
} from "../../src/features/walkthrough/offline";

/** Fixed clock for deterministic evidence transitions. */
const T0 = "2026-10-27T12:00:00.000Z";
const T1 = "2026-10-27T12:01:00.000Z";

/** Deterministic synthetic 64-hex digests for mock-unit evidence. */
function hashFor(index: number): string {
  return index.toString(16).padStart(2, "0").repeat(32);
}

/** Two-byte synthetic "photo" — not real media. */
function fakePng(): Uint8Array {
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
}

/** Existing item identities preserved from the initial demo catalog. */
const CARRIED_IDS = [
  "demo-interior-air",
  "demo-water-supply",
  "demo-lighting-electric",
  "demo-smoke-co",
];

/** Earlier generic slots now have the named Form 1083 areas. */
const RESERVED_IDS = [
  "demo-item-05",
  "demo-item-06",
  "demo-item-07",
  "demo-item-08",
  "demo-item-09",
  "demo-item-10",
  "demo-item-11",
];

function validatedCatalog() {
  return assertValidCatalog(demoCatalogJson);
}

function elevenItemSession(): SessionState {
  const catalog = validatedCatalog();
  return createSession(
    "session-1",
    {
      catalogId: catalog.catalogId,
      catalogVersion: catalog.version,
      itemIds: catalog.items.map((item) => item.id),
    },
    T0,
  );
}

function requiredIdsFor(itemId: string): string[] {
  const catalog = validatedCatalog();
  const item = getCatalogItem(catalog, itemId);
  if (!item) throw new Error(`missing catalog item ${itemId}`);
  return item.manualChecks.map((check) => check.id);
}

/** Drive one item to completed: captured → draft → accepted → checks performed. */
function completeItem(
  state: SessionState,
  itemId: string,
  index: number,
): SessionState {
  let next = reduceSession(
    state,
    {
      type: "capture-media",
      itemId,
      mediaId: `media-${itemId}`,
      mediaHash: hashFor(index),
      capturedAt: T0,
    },
    T0,
  );
  const attempt = next.items[itemId].attempt;
  next = reduceSession(
    next,
    { type: "begin-analysis", itemId, analysisId: `analysis-${index}`, attempt },
    T0,
  );
  next = reduceSession(
    next,
    commitDraftPayload(
      itemId,
      `analysis-${index}`,
      attempt,
      `media-${itemId}`,
      hashFor(index),
    ),
    T1,
  );
  expect(next.items[itemId].status).toBe("draft");
  next = reduceSession(next, { type: "accept", itemId }, T1);
  const required = requiredIdsFor(itemId);
  expect(required.length).toBeGreaterThan(0);
  for (const checkId of required) {
    next = reduceSession(
      next,
      {
        type: "record-manual-check",
        itemId,
        checkId,
        outcome: "performed",
        note: `Verified ${checkId} by hand.`,
        recordedAt: T1,
        requiredCheckIds: required,
      },
      T1,
    );
  }
  expect(
    unresolvedRequiredChecks(required, next.items[itemId].manualChecks),
  ).toEqual([]);
  return next;
}

function mediaByIdFor(itemIds: string[]): BuildExportInput["mediaById"] {
  const out: BuildExportInput["mediaById"] = {};
  for (const itemId of itemIds) {
    out[`media-${itemId}`] = { bytes: fakePng(), mime: "image/png" };
  }
  return out;
}

function inputFor(
  state: SessionState,
  overrides: Partial<BuildExportInput> = {},
): BuildExportInput {
  const catalog = validatedCatalog();
  return {
    state,
    catalog,
    mediaById: {},
    analysisMode: "fixture",
    generatedAt: T1,
    ...overrides,
  };
}

/** In-memory StorageLike for queue persistence tests. */
function fakeStorage(initial: Record<string, string> = {}): StorageLike & {
  rows: Map<string, string>;
} {
  const rows = new Map(Object.entries(initial));
  return {
    rows,
    getItem: (key: string) => (rows.has(key) ? (rows.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
    removeItem: (key: string) => {
      rows.delete(key);
    },
  };
}

describe("11-item versioned catalog contract (REQ-001)", () => {
  it("loads all 11 named Form 1083 areas with stable demo IDs", () => {
    const result = validateCatalog(demoCatalogJson);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.length).toBe(11);
    const ids = result.value.items.map((item) => item.id);
    expect(ids).toEqual([
      ...RESERVED_IDS.slice(0, 3),
      CARRIED_IDS[0],
      CARRIED_IDS[1],
      RESERVED_IDS[3],
      RESERVED_IDS[4],
      CARRIED_IDS[2],
      RESERVED_IDS[5],
      RESERVED_IDS[6],
      CARRIED_IDS[3],
    ]);
    expect(new Set(ids).size).toBe(11);
    for (const id of ids) {
      expect(id.startsWith("demo-")).toBe(true);
    }
  });

  it("keeps the demo contract: version 0.3.0-demo.3, mode demo, verbatim notice", () => {
    const catalog = validatedCatalog();
    expect(catalog.catalogId).toBe("demo-habitability-walkthrough");
    expect(catalog.version).toBe("0.3.0-demo.3");
    expect(catalog.mode).toBe("demo");
    expect(catalog.demoNotice).toBe(DEMO_NOTICE);
    expect(catalog.sourceConfirmation.status).toBe("owner-attested");
    expect(isDemoCatalog(catalog)).toBe(true);
    expect(canClaimFormMapping(catalog)).toBe(false);
  });

  it("accepts a 0.3.x patch version with the same 11 stable IDs", () => {
    const catalog = validatedCatalog();
    const patched = validateCatalog({ ...catalog, version: "0.3.7" });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.value.items.map((item) => item.id)).toEqual(
      catalog.items.map((item) => item.id),
    );
  });

  it("requires every one of the 11 items to carry capture guidance and a photo-gap physical test", () => {
    const catalog = validatedCatalog();
    expect(catalog.items.length).toBe(11);
    for (const item of catalog.items) {
      expect(
        item.captureGuidance.trim().length,
        `item ${item.id} must carry capture guidance`,
      ).toBeGreaterThan(0);
      expect(
        item.manualChecks.some(
          (check) => check.photoCannotEstablish && check.requiresPhysicalTest,
        ),
        `item ${item.id} must keep a physical test a photograph cannot establish`,
      ).toBe(true);
    }
  });

  it("rejects 10- and 12-item catalogs at the boundary with an exact-count error", () => {
    const catalog = validatedCatalog();
    const ten = validateCatalog({
      ...catalog,
      items: catalog.items.slice(0, 10),
    });
    expect(ten.ok).toBe(false);
    if (!ten.ok) {
      expect(ten.errors.some((e) => e.includes("exactly 11 items"))).toBe(true);
    }
    const twelve = validateCatalog({
      ...catalog,
      items: [...catalog.items, { ...catalog.items[0] }],
    });
    expect(twelve.ok).toBe(false);
    if (!twelve.ok) {
      expect(twelve.errors.some((e) => e.includes("exactly 11 items"))).toBe(
        true,
      );
    }
  });

  it("rejects duplicates and demo mapping claims across the 11-item list", () => {
    const catalog = validatedCatalog();
    const doubled = validateCatalog({
      ...catalog,
      items: [...catalog.items, ...catalog.items],
    });
    expect(doubled.ok).toBe(false);
    const reservedWithMapping = {
      ...catalog,
      items: catalog.items.map((item, index) =>
        index === 10
          ? { ...item, officialWording: "Reserved area, exact text" }
          : item,
      ),
    };
    const mapped = validateCatalog(reservedWithMapping);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) {
      expect(mapped.errors.some((e) => e.includes("officialWording"))).toBe(
        true,
      );
    }
  });

  it("rejects fake confirmation of the 11-item catalog without verifier/date", () => {
    const catalog = validatedCatalog();
    expect(
      validateCatalog({
        ...catalog,
        mode: "confirmed",
        sourceConfirmation: {
          status: "confirmed",
          suppliedBy: "someone",
          verifiedBy: null,
          verifiedAt: null,
          notes: "fake confirmation",
        },
      }).ok,
    ).toBe(false);
  });
});

describe("11-item capture, review, and manual-check flows (REQ-002, REQ-004, REQ-005)", () => {
  it("creates a session covering all 11 items with no shared identity", () => {
    const state = elevenItemSession();
    expect(Object.keys(state.items).length).toBe(11);
    expect(state.currentItemId).toBe(RESERVED_IDS[0]);
    for (const id of [...CARRIED_IDS, ...RESERVED_IDS]) {
      expect(state.items[id].status).toBe("empty");
    }
  });

  it("captures and drafts a reserved placeholder exactly like a carried item", () => {
    const itemId = "demo-item-07";
    let state = elevenItemSession();
    state = reduceSession(
      state,
      {
        type: "capture-media",
        itemId,
        mediaId: `media-${itemId}`,
        mediaHash: hashFor(6),
        capturedAt: T0,
      },
      T0,
    );
    const attempt = state.items[itemId].attempt;
    state = reduceSession(
      state,
      { type: "begin-analysis", itemId, analysisId: "analysis-7", attempt },
      T0,
    );
    state = reduceSession(
      state,
      commitDraftPayload(itemId, "analysis-7", attempt, `media-${itemId}`, hashFor(6)),
      T1,
    );
    expect(state.items[itemId].status).toBe("draft");
    expect(state.items[itemId].disposition).toBe("unreviewed");
    expect(state.items[itemId].draft?.observation).toContain("sink");
    // Sibling items are untouched: no cross-item draft attachment.
    for (const other of [...CARRIED_IDS, ...RESERVED_IDS].filter(
      (id) => id !== itemId,
    )) {
      expect(state.items[other].status).toBe("empty");
      expect(state.items[other].draft).toBeNull();
    }
  });

  it("accepting draft text on any item never resolves its required manual checks", () => {
    const itemId = "demo-item-05";
    let state = elevenItemSession();
    state = draftItem(state, itemId, 4);
    const required = requiredIdsFor(itemId);
    state = reduceSession(state, { type: "accept", itemId }, T1);
    expect(
      unresolvedRequiredChecks(required, state.items[itemId].manualChecks),
    ).toEqual(required);
    expect(
      exportBlockers(state, { [itemId]: required }).some(
        (blocker) => blocker.itemId === itemId,
      ),
    ).toBe(true);
  });

  it("blocks completed export until all 11 items are reviewed with checks resolved", () => {
    let state = elevenItemSession();
    const catalog = validatedCatalog();
    const requiredByItem: Record<string, string[]> = {};
    for (const item of catalog.items) {
      requiredByItem[item.id] = item.manualChecks.map((check) => check.id);
    }
    expect(exportBlockers(state, requiredByItem).length).toBe(11);
    const ids = catalog.items.map((item) => item.id);
    ids.forEach((itemId, index) => {
      state = completeItem(state, itemId, index);
    });
    expect(exportBlockers(state, requiredByItem)).toEqual([]);
    for (const itemId of ids) {
      expect(isCheckResolved(state.items[itemId].manualChecks, requiredIdsFor(itemId)[0])).toBe(
        true,
      );
    }
  });
});

/** Drive an item to an unreviewed draft (capture/begin/commit, no review). */
function draftItem(
  state: SessionState,
  itemId: string,
  index: number,
): SessionState {
  let next = reduceSession(
    state,
    {
      type: "capture-media",
      itemId,
      mediaId: `media-${itemId}`,
      mediaHash: hashFor(index),
      capturedAt: T0,
    },
    T0,
  );
  const attempt = next.items[itemId].attempt;
  next = reduceSession(
    next,
    { type: "begin-analysis", itemId, analysisId: `analysis-${index}`, attempt },
    T0,
  );
  return reduceSession(
    next,
    commitDraftPayload(
      itemId,
      `analysis-${index}`,
      attempt,
      `media-${itemId}`,
      hashFor(index),
    ),
    T1,
  );
}

describe("reconnect-race guards across the offline boundary (REQ-006)", () => {
  it("discards a stale queued retry after a retake, then honors an explicit retry at current identity", () => {
    const itemId = "demo-water-supply";
    let state = elevenItemSession();
    state = draftItem(state, itemId, 1);
    expect(state.items[itemId].status).toBe("draft");
    // A retake while the draft stands invalidates review and bumps identity.
    state = reduceSession(
      state,
      {
        type: "capture-media",
        itemId,
        mediaId: "media-retake",
        mediaHash: hashFor(2),
        capturedAt: T1,
      },
      T1,
    );
    expect(state.items[itemId].status).toBe("captured");
    expect(state.items[itemId].draft).toBeNull();
    expect(state.items[itemId].disposition).toBe("unreviewed");
    // The stale draft for the old attempt cannot be recommitted against the
    // retaken photo: attempt and media identity both differ.
    const stale = reduceSession(
      state,
      commitDraftPayload(itemId, "analysis-1", 0, "media-old", hashFor(1)),
      T1,
    );
    expect(stale).toBe(state);
    // An explicit retry at the current identity succeeds.
    const current = state.items[itemId].attempt;
    let retrying = reduceSession(
      state,
      { type: "begin-analysis", itemId, analysisId: "analysis-retry", attempt: current },
      T1,
    );
    retrying = reduceSession(
      retrying,
      commitDraftPayload(itemId, "analysis-retry", current, "media-retake", hashFor(2)),
      T1,
    );
    expect(retrying.items[itemId].status).toBe("draft");
  });

  it("drops late writes after cancellation, failure, deletion, and session deletion", () => {
    const itemId = "demo-item-09";
    let state = elevenItemSession();
    // Stage a photo and start analysis with no draft yet.
    state = reduceSession(
      state,
      {
        type: "capture-media",
        itemId,
        mediaId: `media-${itemId}`,
        mediaHash: hashFor(8),
        capturedAt: T0,
      },
      T0,
    );
    const stagedAttempt = state.items[itemId].attempt;
    state = reduceSession(
      state,
      {
        type: "begin-analysis",
        itemId,
        analysisId: "analysis-bad",
        attempt: stagedAttempt,
      },
      T0,
    );
    expect(state.items[itemId].status).toBe("analyzing");
    // Invalid model output fails the item but keeps the photo for retry.
    const invalid = {
      type: "commit-draft",
      itemId,
      analysisId: "analysis-bad",
      attempt: state.items[itemId].attempt,
      mediaId: `media-${itemId}`,
      mediaHash: hashFor(8),
      envelope: {
        analysisId: "analysis-bad",
        sessionId: "session-1",
        itemId,
        catalogVersion: "0.3.0-demo.3",
        mediaId: `media-${itemId}`,
        mediaHash: hashFor(8),
        model: "muse-spark-1.3",
        mode: "fixture",
        requestId: "req-analysis-bad",
        latencyMs: 12,
        draft: {
          observation: "A room.",
          visibleEvidence: ["a wall"],
          unknowns: ["flow unknown"],
          suggestedManualChecks: ["Test by hand."],
          verdict: "Approved",
        },
      },
    } as const;
    const failed = reduceSession(state, invalid, T1);
    expect(failed.items[itemId].status).toBe("error");
    expect(failed.items[itemId].draft).toBeNull();
    expect(failed.items[itemId].mediaId).toBe(`media-${itemId}`);
    expect(failed.items[itemId].error?.code).toBe("INVALID_MODEL_OUTPUT");
    // Retry from the error state is allowed and lands a real draft.
    const retryAttempt = failed.items[itemId].attempt;
    let retrying = reduceSession(
      failed,
      { type: "begin-analysis", itemId, analysisId: "analysis-ok", attempt: retryAttempt },
      T1,
    );
    retrying = reduceSession(
      retrying,
      commitDraftPayload(itemId, "analysis-ok", retryAttempt, `media-${itemId}`, hashFor(8)),
      T1,
    );
    expect(retrying.items[itemId].status).toBe("draft");
    // Deleting the evidence drops any late write for it.
    const deleted = reduceSession(
      retrying,
      { type: "delete-item-evidence", itemId },
      T1,
    );
    expect(
      reduceSession(
        deleted,
        commitDraftPayload(itemId, "analysis-ok", retryAttempt, `media-${itemId}`, hashFor(8)),
        T1,
      ),
    ).toBe(deleted);
    const sessionDeleted = reduceSession(deleted, { type: "delete-session" }, T1);
    expect(
      reduceSession(
        sessionDeleted,
        commitDraftPayload(itemId, "analysis-ok", retryAttempt, `media-${itemId}`, hashFor(8)),
        T1,
      ),
    ).toBe(sessionDeleted);
  });

  it("queued offline work never outlives a delete: clearing the session drops its intents", () => {
    let queue: OfflineQueue = [];
    queue = enqueueOfflineAnalysis(
      queue,
      createQueuedIntent({
        sessionId: "session-1",
        itemId: "demo-water-supply",
        attempt: 1,
        mediaId: "media-demo-water-supply",
        stagedAt: T0,
      }),
    );
    queue = enqueueOfflineAnalysis(
      queue,
      createQueuedIntent({
        sessionId: "session-2",
        itemId: "demo-item-05",
        attempt: 1,
        mediaId: "media-demo-item-05",
        stagedAt: T0,
      }),
    );
    const cleared = clearQueuedForSession(queue, "session-1");
    expect(cleared.length).toBe(1);
    expect(cleared[0].sessionId).toBe("session-2");
    expect(isItemQueued(cleared, "session-1", "demo-water-supply")).toBe(false);
  });
});

describe("offline pending queue and explicit reconnect sync (REQ-007)", () => {
  it("creates pending-only intents that carry identity, never drafts or verdicts", () => {
    const intent = createQueuedIntent({
      sessionId: "session-1",
      itemId: "demo-item-06",
      attempt: 2,
      mediaId: "media-demo-item-06",
      stagedAt: T0,
    });
    expect(intent.key).toBe("session-1:demo-item-06");
    expect(intent.status).toBe("pending");
    expect(intent.origin).toBe("offline-queue");
    expect(intent.attempt).toBe(2);
    expect(intent.mediaId).toBe("media-demo-item-06");
    // Identity only: no draft, no verdict, no bytes, no approval fields.
    for (const forbidden of ["draft", "verdict", "approved", "bytes", "result"]) {
      expect(intent as unknown as Record<string, unknown>).not.toHaveProperty(
        forbidden,
      );
    }
  });

  it("keeps at most one pending intent per item: newer attempts replace, older ones never fork", () => {
    let queue: OfflineQueue = [];
    const first = createQueuedIntent({
      sessionId: "session-1",
      itemId: "demo-item-06",
      attempt: 1,
      mediaId: "media-a",
      stagedAt: T0,
    });
    queue = enqueueOfflineAnalysis(queue, first);
    expect(queue.length).toBe(1);
    // An older attempt arriving late never forks a second retry.
    const older = createQueuedIntent({
      sessionId: "session-1",
      itemId: "demo-item-06",
      attempt: 0,
      mediaId: "media-old",
      stagedAt: T1,
    });
    const kept = enqueueOfflineAnalysis(queue, older);
    expect(kept).toBe(queue);
    expect(kept[0].mediaId).toBe("media-a");
    // A newer attempt replaces the queued photo exactly once.
    const newer = createQueuedIntent({
      sessionId: "session-1",
      itemId: "demo-item-06",
      attempt: 2,
      mediaId: "media-b",
      stagedAt: T1,
    });
    queue = enqueueOfflineAnalysis(queue, newer);
    expect(queue.length).toBe(1);
    expect(queue[0].mediaId).toBe("media-b");
    expect(queue[0].attempt).toBe(2);
    // A different item queues independently.
    queue = enqueueOfflineAnalysis(
      queue,
      createQueuedIntent({
        sessionId: "session-1",
        itemId: "demo-item-07",
        attempt: 1,
        mediaId: "media-c",
        stagedAt: T1,
      }),
    );
    expect(queue.length).toBe(2);
    expect(
      pendingForSession(queue, "session-1").map((entry) => entry.itemId),
    ).toEqual(["demo-item-06", "demo-item-07"]);
  });

  it("explicit retry consumes the queue entry instead of auto-running it", () => {
    let queue = enqueueOfflineAnalysis(
      [],
      createQueuedIntent({
        sessionId: "session-1",
        itemId: "demo-item-06",
        attempt: 1,
        mediaId: "media-a",
        stagedAt: T0,
      }),
    );
    expect(isItemQueued(queue, "session-1", "demo-item-06")).toBe(true);
    expect(isItemQueued(queue, "session-1", "demo-item-07")).toBe(false);
    queue = removeQueuedForItem(queue, "session-1", "demo-item-06");
    expect(queue).toEqual([]);
    expect(pendingForSession(queue, "session-1")).toEqual([]);
  });

  it("rejects non-pending, foreign-origin, and misshapen rows instead of trusting them", () => {
    const valid = validateQueuedIntent({
      sessionId: "session-1",
      itemId: "demo-item-06",
      attempt: 1,
      mediaId: "media-a",
      stagedAt: T0,
      status: "pending",
      origin: "offline-queue",
      key: "wrong-key-is-rederived",
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.intent.key).toBe("session-1:demo-item-06");
    }
    for (const bad of [
      { status: "analyzed" },
      { status: "complete" },
      { origin: "background-sync" },
      { origin: "server" },
      { attempt: -1 },
      { attempt: 1.5 },
      { mediaId: "" },
      { itemId: "" },
      { sessionId: "" },
      { stagedAt: "" },
    ]) {
      const checked = validateQueuedIntent({
        sessionId: "session-1",
        itemId: "demo-item-06",
        attempt: 1,
        mediaId: "media-a",
        stagedAt: T0,
        status: "pending",
        origin: "offline-queue",
        ...bad,
      });
      expect(checked.ok, JSON.stringify(bad)).toBe(false);
    }
    expect(validateQueuedIntent(null).ok).toBe(false);
    expect(validateQueuedIntent([]).ok).toBe(false);
  });

  it("persists the queue under the documented key and reloads it intact", () => {
    const storage = fakeStorage();
    const queue: OfflineQueue = [
      createQueuedIntent({
        sessionId: "session-1",
        itemId: "demo-item-06",
        attempt: 1,
        mediaId: "media-a",
        stagedAt: T0,
      }),
    ];
    expect(saveOfflineQueue(queue, storage)).toEqual({ ok: true });
    expect(storage.rows.has(OFFLINE_QUEUE_STORAGE_KEY)).toBe(true);
    const loaded = loadOfflineQueue(storage);
    expect(loaded.hadCorruptRows).toBe(false);
    expect(loaded.queue).toEqual(queue);
  });

  it("drops corrupt rows with recovery instead of trusting them", () => {
    const badJson = fakeStorage({
      [OFFLINE_QUEUE_STORAGE_KEY]: "not-json{{{",
    });
    const corrupt = loadOfflineQueue(badJson);
    expect(corrupt.queue).toEqual([]);
    expect(corrupt.hadCorruptRows).toBe(true);
    const mixed = fakeStorage({
      [OFFLINE_QUEUE_STORAGE_KEY]: JSON.stringify([
        {
          sessionId: "session-1",
          itemId: "demo-item-06",
          attempt: 1,
          mediaId: "media-a",
          stagedAt: T0,
          status: "pending",
          origin: "offline-queue",
        },
        {
          sessionId: "session-1",
          itemId: "demo-item-07",
          attempt: 0,
          mediaId: "media-b",
          stagedAt: T0,
          status: "analyzed",
          origin: "offline-queue",
        },
        "garbage-row",
      ]),
    });
    const loaded = loadOfflineQueue(mixed);
    expect(loaded.hadCorruptRows).toBe(true);
    expect(loaded.queue.length).toBe(1);
    expect(loaded.queue[0].itemId).toBe("demo-item-06");
    expect(loadOfflineQueue(fakeStorage()).queue).toEqual([]);
  });

  it("reports save failures explicitly without losing the in-memory queue", () => {
    const failing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => undefined,
    };
    const queue: OfflineQueue = [
      createQueuedIntent({
        sessionId: "session-1",
        itemId: "demo-item-06",
        attempt: 1,
        mediaId: "media-a",
        stagedAt: T0,
      }),
    ];
    const saved = saveOfflineQueue(queue, failing);
    expect(saved.ok).toBe(false);
    if (!saved.ok) {
      expect(saved.code).toBe("STORAGE_IO");
      expect(saved.message).toMatch(/memory/);
    }
    expect(queue.length).toBe(1);
  });

  it("announces offline, pending, and reconnect states honestly with recovery", () => {
    const offlineEmpty = describeOfflineState({ online: false, pendingCount: 0 });
    expect(offlineEmpty).toMatch(/offline/i);
    expect(offlineEmpty).toMatch(/pending/);
    expect(offlineEmpty).toMatch(/no draft/);
    expect(offlineEmpty).toMatch(/no verdict/);
    const offlineTwo = describeOfflineState({ online: false, pendingCount: 2 });
    expect(offlineTwo).toMatch(/2 queued analyses/);
    expect(offlineTwo).toMatch(/no draft was created/);
    expect(offlineTwo).toMatch(/no verdict is implied/);
    expect(offlineTwo).toMatch(/explicitly/);
    const backOnline = describeOfflineState({ online: true, pendingCount: 1 });
    expect(backOnline).toMatch(/Back online/);
    expect(backOnline).toMatch(/1 queued analysis/);
    expect(backOnline).toMatch(/nothing ran automatically/);
    expect(backOnline).toMatch(/explicitly/);
    const idle = describeOfflineState({ online: true, pendingCount: 0 });
    expect(idle).toMatch(/No queued analyses/);
    const itemLine = describePendingItem("Reserved placeholder 06");
    expect(itemLine).toMatch(/^Pending/);
    expect(itemLine).toMatch(/kept on this device/);
    expect(itemLine).toMatch(/explicitly/);
    expect(itemLine).toMatch(/No draft exists/);
    expect(itemLine).toMatch(/no verdict is implied/);
  });
});

describe("service-worker cache boundary twin (REQ-010, REQ-013)", () => {
  it("caches shell assets only: never API traffic, uploads, or media", () => {
    expect(
      shouldServiceWorkerCache("https://walkthrough.local/_next/static/abc.js", "GET"),
    ).toBe(true);
    expect(
      shouldServiceWorkerCache("https://walkthrough.local/manifest.webmanifest", "GET"),
    ).toBe(true);
    expect(
      shouldServiceWorkerCache("https://walkthrough.local/icons/icon-192.svg", "GET"),
    ).toBe(true);
    expect(
      shouldServiceWorkerCache(
        "https://walkthrough.local/fonts/public-sans-latin-400-normal.woff2",
        "GET",
      ),
    ).toBe(true);
    // API traffic is never cached and never served from cache.
    expect(
      shouldServiceWorkerCache("https://walkthrough.local/api/analyze", "GET"),
    ).toBe(false);
    expect(
      shouldServiceWorkerCache("https://walkthrough.local/api/analyze", "POST"),
    ).toBe(false);
    // Non-GET work (uploads, deletions) never enters the cache.
    expect(
      shouldServiceWorkerCache("https://walkthrough.local/manifest.webmanifest", "POST"),
    ).toBe(false);
    // Same-origin media-like paths stay network-only.
    expect(
      shouldServiceWorkerCache("https://walkthrough.local/media/photo.jpg", "GET"),
    ).toBe(false);
    expect(shouldServiceWorkerCache("not a url", "GET")).toBe(false);
  });
});

describe("export snapshot and PDF/print parity across 11 items (REQ-008)", () => {
  it("builds an 11-entry snapshot where unresolved items carry no draft text", () => {
    let state = elevenItemSession();
    state = draftItem(state, "demo-water-supply", 1);
    const ids = validatedCatalog().items.map((item) => item.id);
    const snapshot = buildExportSnapshot(
      inputFor(state, { mediaById: mediaByIdFor(ids) }),
    );
    expect(snapshot.items.length).toBe(11);
    expect(snapshot.completedCount).toBe(0);
    expect(snapshot.unresolved.length).toBe(11);
    expect(snapshot.canClaimCompleted).toBe(false);
    expect(canExportCompleted(snapshot)).toBe(false);
    const html = renderExportHtml(snapshot);
    // The unreviewed draft observation must not leak anywhere.
    expect(html).not.toContain("sink basin");
    expect(html).toContain("Unresolved items (11)");
    expect(html).toContain("worker-review draft");
  });

  it("lists rejected and failed items as unresolved without unapproved draft text", () => {
    let state = elevenItemSession();
    state = draftItem(state, "demo-water-supply", 1);
    state = reduceSession(
      state,
      { type: "reject", itemId: "demo-water-supply", reason: "Too dark." },
      T1,
    );
    const ids = validatedCatalog().items.map((item) => item.id);
    const snapshot = buildExportSnapshot(
      inputFor(state, { mediaById: mediaByIdFor(ids) }),
    );
    const rejected = snapshot.items.find(
      (entry) => entry.itemId === "demo-water-supply",
    );
    expect(rejected?.completed).toBe(false);
    expect(rejected?.reviewedNote).toBeNull();
    expect(rejected?.unresolvedReason).toMatch(/rejected/);
    const html = renderExportHtml(snapshot);
    expect(html).not.toContain("Too dark.");
    expect(html).not.toContain("sink basin");
    expect(html).toContain("draft rejected — unresolved");
  });

  it("exports completed notes for reviewed items while the rest stay unresolved", () => {
    let state = elevenItemSession();
    state = completeItem(state, "demo-water-supply", 1);
    state = completeItem(state, "demo-item-05", 4);
    const snapshot = buildExportSnapshot(
      inputFor(state, {
        mediaById: mediaByIdFor(["demo-water-supply", "demo-item-05"]),
      }),
    );
    expect(snapshot.completedCount).toBe(2);
    expect(snapshot.unresolved.length).toBe(9);
    expect(snapshot.canClaimCompleted).toBe(false);
    const completed = snapshot.items.find(
      (entry) => entry.itemId === "demo-water-supply",
    );
    expect(completed?.completed).toBe(true);
    expect(completed?.reviewedNote).toContain("sink");
    const html = renderExportHtml(snapshot);
    expect(html).toContain("Reviewed items: 2 of 11");
    expect(html).toContain("Reviewed note (worker-approved)");
  });

  it("claims completed only when all 11 items are reviewed with checks resolved", () => {
    let state = elevenItemSession();
    const ids = validatedCatalog().items.map((item) => item.id);
    ids.forEach((itemId, index) => {
      state = completeItem(state, itemId, index);
    });
    const snapshot = buildExportSnapshot(
      inputFor(state, { mediaById: mediaByIdFor(ids) }),
    );
    expect(snapshot.completedCount).toBe(11);
    expect(snapshot.unresolved).toEqual([]);
    expect(snapshot.canClaimCompleted).toBe(true);
    expect(canExportCompleted(snapshot)).toBe(true);
    expect(renderExportHtml(snapshot)).toContain("Reviewed items: 11 of 11");
  });

  it("repeats the identical review banner, escaping, and no-remote-request policy for print/PDF", () => {
    let state = elevenItemSession();
    state = completeItem(state, "demo-water-supply", 1);
    const snapshot = buildExportSnapshot(
      inputFor(state, {
        mediaById: mediaByIdFor(["demo-water-supply"]),
      }),
    );
    const html = renderExportHtml(snapshot);
    // Identical banner policy as HTML: header, every item, footer, print header.
    const bannerCount = html.split(EXPORT_REVIEW_BANNER).length - 1;
    expect(bannerCount).toBeGreaterThanOrEqual(snapshot.items.length + 2);
    expect(html).toContain('<div class="export-print-banner"');
    expect(html).toContain("Project owner confirms this workflow uses LAHSA Form 1083. This local app prepares a draft; it does not submit to HMIS.");
    expect(html).toContain("Analysis mode: fixture (mock output — not live inference)");
    expect(html).not.toContain('src="http');
    expect(html).not.toContain("src='http");
    expect(html).not.toContain("src=\"blob:");
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain("META_API_KEY");
  });

  it("carries the print stylesheet for PDF parity: fixed banner, no remote media, unbroken cards", () => {
    const css = __testOnly.EXPORT_CSS;
    // PDF output uses the identical banner/content policy as HTML via print CSS.
    expect(css).toContain("@media print");
    expect(css).toContain(".export-print-banner");
    expect(css).toContain("break-inside:avoid");
    expect(css).toContain("page-break-inside:avoid");
    // The printable document is self-contained: no remote image requests.
    const snapshot = buildExportSnapshot(inputFor(elevenItemSession()));
    const html = renderExportHtml(snapshot);
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<img[^>]+src="https?:/);
  });
});
