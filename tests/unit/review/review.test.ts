/**
 * Behavioral and regression tests for TASK-006
 * (REQ-004, REQ-005, REQ-006, REQ-009).
 *
 * Deterministic and fixture-only: MemorySessionStore, fake fetch, fixed
 * clock, synthetic mock-unit digests. No network, no provider keys, no
 * browser, no IndexedDB. Every hash below is synthetic test data — never
 * live inference.
 *
 * Covers:
 * - Accept / edit-and-accept / reject create revisions through the session
 *   manager; empty text and wrong-status transitions change nothing.
 * - Accepting text never marks a physical test performed: manual-check
 *   responses are untouched and export stays blocked until checks resolve.
 * - Manual checks require a worker note; "not-performed" stays unresolved;
 *   unknown checks attach to nothing.
 * - Reanalyze invalidates review and manual checks, bumps the attempt, and
 *   discards a late inflight response (generation guard).
 * - Review panel helpers: status→kind mapping, provenance identity rows,
 *   unresolved computation, and required-check preservation against a model
 *   that claims no further checks are needed.
 */
import { describe, expect, it } from "vitest";

import type { CatalogItem } from "../../../src/domain/catalog";
import { effectiveManualChecks } from "../../../src/domain/catalog";
import {
  commitDraftPayload,
  createSession,
  exportBlockers,
  reduceSession,
  unresolvedRequiredChecks,
  type SessionState,
} from "../../../src/domain/evidence";
import {
  reviewPanelKind,
  reviewProvenanceRows,
  reviewUnresolvedIds,
} from "../../../src/features/walkthrough/review";
import {
  makeTestFile,
  WalkthroughSessionManager,
  type AnalyzeFetch,
} from "../../../src/features/walkthrough/session";
import { MemorySessionStore } from "../../../src/storage/db";

/** Synthetic SHA-256-shaped digests for mock-unit evidence (not real media). */
const HASH_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const T0 = "2026-10-27T12:00:00.000Z";
const T1 = "2026-10-27T12:01:00.000Z";

const CATALOG = {
  catalogId: "demo-habitability-walkthrough",
  catalogVersion: "0.3.0-demo.3",
  itemIds: ["item-a", "item-b"],
};

const REQUIRED_A = ["item-a-mc1", "item-a-mc2"];

const SINK_ITEM: CatalogItem = {
  id: "item-a",
  label: "Kitchen sink area (illustrative)",
  captureGuidance: "Photograph the sink basin and faucet in one frame.",
  manualChecks: [
    {
      id: "item-a-mc1",
      instruction:
        "Run both hot and cold taps and watch the basin drain. A photograph cannot establish water flow or drainage.",
      requiresPhysicalTest: true,
      photoCannotEstablish: true,
    },
    {
      id: "item-a-mc2",
      instruction:
        "Open the under-sink cabinet and check for active drips or dampness.",
      requiresPhysicalTest: true,
      photoCannotEstablish: true,
    },
  ],
};

/** Drive a fresh session to an unreviewed draft for item-a. */
function draftState(): SessionState {
  let state = createSession("session-1", CATALOG, T0);
  state = reduceSession(
    state,
    {
      type: "capture-media",
      itemId: "item-a",
      mediaId: "media-1",
      mediaHash: HASH_A,
      capturedAt: T0,
    },
    T0,
  );
  const attempt = state.items["item-a"].attempt;
  state = reduceSession(
    state,
    {
      type: "begin-analysis",
      itemId: "item-a",
      analysisId: "analysis-1",
      attempt,
    },
    T0,
  );
  state = reduceSession(
    state,
    commitDraftPayload("item-a", "analysis-1", attempt, "media-1", HASH_A),
    T1,
  );
  return state;
}

interface Harness {
  manager: WalkthroughSessionManager;
  store: MemorySessionStore;
}

async function makeSeededHarness(state?: SessionState): Promise<Harness> {
  const store = new MemorySessionStore();
  await store.saveSession(state ?? draftState());
  let counter = 0;
  const manager = new WalkthroughSessionManager({
    store,
    createObjectURL: () => `blob:test-${counter++}`,
    revokeObjectURL: () => undefined,
    generateId: (prefix: string) => {
      counter += 1;
      return `${prefix}-${counter}`;
    },
    now: () => T1,
  });
  await manager.init("session-1", CATALOG);
  return { manager, store };
}

async function waitForInflight(manager: WalkthroughSessionManager): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (manager.snapshot().inflight.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("timed out waiting for inflight analysis");
}

describe("manager accept / edit / reject create revisions (REQ-005)", () => {
  it("accept records accepted with a new revision and keeps the draft", async () => {
    const { manager, store } = await makeSeededHarness();
    const before = manager.item("item-a");
    expect(before?.status).toBe("draft");
    expect(before?.disposition).toBe("unreviewed");

    const result = await manager.acceptReview("item-a");
    expect(result.ok).toBe(true);

    const item = manager.item("item-a");
    expect(item?.status).toBe("reviewed");
    expect(item?.disposition).toBe("accepted");
    expect(item?.dispositionAt).toBe(T1);
    expect(item?.revision).toBe((before?.revision ?? 0) + 1);
    // The original model draft is preserved for audit.
    expect(item?.draft?.observation).toContain("sink");

    // The revision is persisted, not just in memory.
    const loaded = await store.loadSession("session-1");
    expect(loaded.kind).toBe("found");
    if (loaded.kind !== "found") return;
    expect(loaded.state.items["item-a"].disposition).toBe("accepted");
  });

  it("accept on an item without a draft changes nothing", async () => {
    const { manager } = await makeSeededHarness();
    const ref = manager.item("item-b");
    expect(ref?.status).toBe("empty");

    const result = await manager.acceptReview("item-b");
    expect(result).toMatchObject({ ok: false, code: "NOT_REVIEWABLE" });
    expect(manager.item("item-b")).toBe(ref);
    expect(manager.item("item-b")?.status).toBe("empty");
  });

  it("edit-and-accept stores the worker revision and preserves the draft", async () => {
    const { manager } = await makeSeededHarness();
    const before = manager.item("item-a");

    const result = await manager.acceptEditedReview(
      "item-a",
      "Basin intact; taps run clear.",
    );
    expect(result.ok).toBe(true);

    const item = manager.item("item-a");
    expect(item?.status).toBe("reviewed");
    expect(item?.disposition).toBe("accepted-edited");
    expect(item?.workerRevision).toBe("Basin intact; taps run clear.");
    expect(item?.draft?.observation).toContain("sink");
    expect(item?.revision).toBe((before?.revision ?? 0) + 1);
  });

  it("rejects empty edit text and empty rejection reasons", async () => {
    const { manager } = await makeSeededHarness();

    expect(await manager.acceptEditedReview("item-a", "   ")).toMatchObject({
      ok: false,
    });
    expect(await manager.rejectReview("item-a", "")).toMatchObject({
      ok: false,
    });
    // Nothing changed: still an unreviewed draft.
    expect(manager.item("item-a")?.status).toBe("draft");
    expect(manager.item("item-a")?.disposition).toBe("unreviewed");
  });

  it("reject moves to rejected with the worker reason; rejection is not acceptance", async () => {
    const { manager } = await makeSeededHarness();
    const before = manager.item("item-a");

    const result = await manager.rejectReview("item-a", "Photo too dark to use.");
    expect(result.ok).toBe(true);

    const item = manager.item("item-a");
    expect(item?.status).toBe("rejected");
    expect(item?.disposition).toBe("rejected");
    expect(item?.workerRevision).toBe("Photo too dark to use.");
    expect(item?.revision).toBe((before?.revision ?? 0) + 1);
    // The original draft is preserved for audit, but the item is unresolved.
    expect(item?.draft?.observation).toContain("sink");
    expect(
      exportBlockers(manager.snapshot().state ?? draftState(), {
        "item-a": REQUIRED_A,
        "item-b": ["item-b-mc1"],
      }).some((blocker) => blocker.itemId === "item-a"),
    ).toBe(true);
  });
});

describe("accepting text never completes a physical test (REQ-005)", () => {
  it("accept leaves manual checks untouched and export stays blocked", async () => {
    const { manager } = await makeSeededHarness();
    const accepted = await manager.acceptReview("item-a");
    expect(accepted.ok).toBe(true);

    const item = manager.item("item-a");
    expect(item?.manualChecks).toEqual([]);
    expect(
      unresolvedRequiredChecks(REQUIRED_A, item?.manualChecks ?? []),
    ).toEqual(REQUIRED_A);
    expect(
      exportBlockers(manager.snapshot().state ?? draftState(), {
        "item-a": REQUIRED_A,
        "item-b": ["item-b-mc1"],
      }).some((blocker) => blocker.itemId === "item-a"),
    ).toBe(true);
  });
});

describe("manager manual checks (REQ-005)", () => {
  it("performed with a note resolves; not-performed stays unresolved", async () => {
    const { manager } = await makeSeededHarness();

    const performed = await manager.recordManualCheck(
      "item-a",
      "item-a-mc1",
      "performed",
      "Ran both taps; basin drained.",
      REQUIRED_A,
    );
    expect(performed.ok).toBe(true);
    const afterPerformed = manager.item("item-a");
    if (!afterPerformed) throw new Error("expected item-a after performed");
    expect(reviewUnresolvedIds(REQUIRED_A, afterPerformed)).toEqual([
      "item-a-mc2",
    ]);

    const declined = await manager.recordManualCheck(
      "item-a",
      "item-a-mc2",
      "not-performed",
      "Tenant declined the run test.",
      REQUIRED_A,
    );
    expect(declined.ok).toBe(true);
    // A declined physical test is an open item, not a completed one.
    const afterDeclined = manager.item("item-a");
    if (!afterDeclined) throw new Error("expected item-a after not-performed");
    expect(reviewUnresolvedIds(REQUIRED_A, afterDeclined)).toEqual([
      "item-a-mc2",
    ]);
  });

  it("missing notes and unknown checks are not recorded", async () => {
    const { manager } = await makeSeededHarness();
    const before = manager.item("item-a")?.revision;

    expect(
      await manager.recordManualCheck(
        "item-a",
        "item-a-mc1",
        "performed",
        "   ",
        REQUIRED_A,
      ),
    ).toMatchObject({ ok: false, code: "CHECK_NOT_RECORDED" });
    expect(
      await manager.recordManualCheck(
        "item-a",
        "item-a-nope",
        "performed",
        "Did it.",
        REQUIRED_A,
      ),
    ).toMatchObject({ ok: false, code: "CHECK_NOT_RECORDED" });
    expect(manager.item("item-a")?.manualChecks).toEqual([]);
    expect(manager.item("item-a")?.revision).toBe(before);
  });
});

describe("reanalyze invalidates review and late responses (REQ-005, REQ-006)", () => {
  it("reanalyze clears review and manual checks and bumps the attempt", async () => {
    const { manager } = await makeSeededHarness();
    await manager.acceptReview("item-a");
    await manager.recordManualCheck(
      "item-a",
      "item-a-mc1",
      "performed",
      "Ran both taps; basin drained.",
      REQUIRED_A,
    );
    const attemptBefore = manager.item("item-a")?.attempt ?? 0;

    const result = await manager.reanalyzeItem("item-a");
    expect(result.ok).toBe(true);

    const item = manager.item("item-a");
    expect(item?.status).toBe("captured");
    expect(item?.disposition).toBe("unreviewed");
    expect(item?.draft).toBeNull();
    expect(item?.manualChecks).toEqual([]);
    expect(item?.attempt).toBe(attemptBefore + 1);
  });

  it("reanalyze without a photo changes nothing", async () => {
    const { manager } = await makeSeededHarness();
    expect(await manager.reanalyzeItem("item-b")).toMatchObject({
      ok: false,
      code: "NOT_REANALYZABLE",
    });
  });

  it("a late inflight response after reanalyze is discarded", async () => {
    let release!: (value: {
      status: number;
      body: {
        envelope: { draft: unknown };
        normalizedMedia: {
          mediaId: string;
          mime: string;
          width: number;
          height: number;
          digest: string;
          base64: string;
        };
      };
    }) => void;
    const gate = new Promise<{
      status: number;
      body: {
        envelope: { draft: unknown };
        normalizedMedia: {
          mediaId: string;
          mime: string;
          width: number;
          height: number;
          digest: string;
          base64: string;
        };
      };
    }>((resolve) => {
      release = resolve;
    });
    const fetch: AnalyzeFetch = () => gate;
    const store = new MemorySessionStore();
    let counter = 0;
    const manager = new WalkthroughSessionManager({
      store,
      createObjectURL: () => `blob:test-${counter++}`,
      revokeObjectURL: () => undefined,
      generateId: (prefix: string) => {
        counter += 1;
        return `${prefix}-${counter}`;
      },
      now: () => T1,
      analyzeFetch: fetch,
    });
    await manager.init("session-1", CATALOG);

    const pending = manager.analyze(
      "item-a",
      makeTestFile(new Uint8Array([7, 7, 7])),
    );
    await waitForInflight(manager);
    const reanalyzed = await manager.reanalyzeItem("item-a");
    expect(reanalyzed.ok).toBe(true);
    const attemptAfterReanalyze = manager.item("item-a")?.attempt;

    release({
      status: 200,
      body: {
        envelope: {
          draft: {
            observation: "Late draft that must never attach.",
            visibleEvidence: ["basin"],
            unknowns: ["flow unknown"],
            suggestedManualChecks: [],
          },
        },
        normalizedMedia: {
          mediaId: "media-server-1",
          mime: "image/jpeg",
          width: 800,
          height: 600,
          digest: HASH_B,
          base64: "CQkJ",
        },
      },
    });
    const result = await pending;
    expect(result).toMatchObject({ ok: false, code: "STALE_RESPONSE" });
    // The reanalyzed attempt stands; no draft from the retired attempt.
    expect(manager.item("item-a")?.attempt).toBe(attemptAfterReanalyze);
    expect(manager.item("item-a")?.status).toBe("captured");
    expect(manager.item("item-a")?.draft).toBeNull();
  });
});

describe("review panel helpers (REQ-004, REQ-006, REQ-009)", () => {
  it("maps every item status to an honest panel kind", () => {
    expect(reviewPanelKind({ status: "empty" })).toBe("empty");
    expect(reviewPanelKind({ status: "captured" })).toBe("empty");
    expect(reviewPanelKind({ status: "analyzing" })).toBe("loading");
    expect(reviewPanelKind({ status: "draft" })).toBe("awaiting-review");
    expect(reviewPanelKind({ status: "reviewed" })).toBe("reviewed");
    expect(reviewPanelKind({ status: "rejected" })).toBe("rejected");
    expect(reviewPanelKind({ status: "error" })).toBe("error");
  });

  it("provenance rows bind session, item, catalog, media, attempt, revision, and mode", () => {
    const state = draftState();
    const rows = reviewProvenanceRows(
      state.items["item-a"],
      "session-1",
      "0.3.0-demo.3",
      "fixture",
    );
    const byLabel = new Map(rows.map((row) => [row.label, row.value]));
    expect(byLabel.get("Session")).toBe("session-1");
    expect(byLabel.get("Item")).toBe("item-a");
    expect(byLabel.get("Catalog version")).toBe("0.3.0-demo.3");
    expect(byLabel.get("Media ID")).toBe("media-1");
    expect(byLabel.get("Media digest")).toBe(HASH_A);
    expect(byLabel.get("Attempt")).toBe(
      String(state.items["item-a"].attempt),
    );
    expect(byLabel.get("Review revision")).toBe(
      String(state.items["item-a"].revision),
    );
    expect(byLabel.get("Analysis mode")).toBe("fixture");
  });

  it("keeps required checks even when the model says none are needed", () => {
    const effective = effectiveManualChecks(SINK_ITEM, [
      "No further checks needed.",
    ]);
    const requiredIds = SINK_ITEM.manualChecks.map((check) => check.id);
    for (const id of requiredIds) {
      expect(effective.some((check) => check.id === id)).toBe(true);
    }
    expect(
      effective.filter((check) => check.source === "required").length,
    ).toBe(requiredIds.length);
    // The model suggestion is shown as a suggestion only — never required.
    const extra = effective.find(
      (check) => check.instruction === "No further checks needed.",
    );
    expect(extra?.source).toBe("model-suggestion");
  });

  it("unresolved ids stay complete until each required check is performed", () => {
    let state = draftState();
    expect(reviewUnresolvedIds(REQUIRED_A, state.items["item-a"])).toEqual(
      REQUIRED_A,
    );
    state = reduceSession(
      state,
      {
        type: "record-manual-check",
        itemId: "item-a",
        checkId: "item-a-mc1",
        outcome: "performed",
        note: "Ran both taps; basin drained.",
        recordedAt: T1,
        requiredCheckIds: REQUIRED_A,
      },
      T1,
    );
    expect(reviewUnresolvedIds(REQUIRED_A, state.items["item-a"])).toEqual([
      "item-a-mc2",
    ]);
  });
});
