/**
 * Behavioral and regression tests for TASK-003 (REQ-001, REQ-004, REQ-005,
 * REQ-006). Covers the versioned illustrative catalog, strict schema
 * rejection (malformed/extra/verdict), required-check preservation, and the
 * evidence reducer's stale-attempt and invalidation rules including races
 * and rejection.
 *
 * Deterministic and fixture-only: no network, no provider keys, no browser.
 * Mock-unit media hashes are synthetic 64-hex digests, never live inference.
 */
import { describe, expect, it } from "vitest";

import demoCatalogJson from "../../../src/data/catalog.demo.json";
import {
  assertValidCatalog,
  canClaimFormMapping,
  DEMO_NOTICE,
  effectiveManualChecks,
  getCatalogItem,
  getRequiredChecks,
  isDemoCatalog,
  validateCatalog,
} from "../../../src/domain/catalog";
import {
  commitDraftPayload,
  createSession,
  exportBlockers,
  isCheckResolved,
  reduceSession,
  unresolvedRequiredChecks,
  validateAnalysisDraft,
  validateEnvelope,
  type SessionState,
} from "../../../src/domain/evidence";

/** Synthetic SHA-256-shaped digests for mock-unit evidence (not real media). */
const HASH_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const T0 = "2026-10-27T12:00:00.000Z";
const T1 = "2026-10-27T12:01:00.000Z";

function validDraft(overrides: Record<string, unknown> = {}) {
  return {
    observation: "The sink basin looks intact with a single faucet.",
    visibleEvidence: ["basin without visible cracks"],
    unknowns: ["water flow cannot be told from the photo"],
    suggestedManualChecks: ["Run the taps and watch drainage."],
    ...overrides,
  };
}

function validEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    analysisId: "analysis-1",
    sessionId: "session-1",
    itemId: "demo-water-supply",
    catalogVersion: "0.2.0-demo.1",
    mediaId: "media-1",
    mediaHash: HASH_A,
    model: "muse-spark-1.3",
    mode: "fixture",
    requestId: "req-1",
    latencyMs: 12,
    draft: validDraft(),
    ...overrides,
  };
}

/** Drive an item to an unreviewed draft (capture/begin/commit, no review). */
function draftSession(): SessionState {
  let state = createSession(
    "session-1",
    {
      catalogId: "demo-habitability-walkthrough",
      catalogVersion: "0.2.0-demo.1",
      itemIds: ["demo-water-supply", "demo-interior-air"],
    },
    T0,
  );
  state = reduceSession(
    state,
    {
      type: "capture-media",
      itemId: "demo-water-supply",
      mediaId: "media-1",
      mediaHash: HASH_A,
      capturedAt: T0,
    },
    T0,
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
    T0,
  );
  state = reduceSession(
    state,
    commitDraftPayload("demo-water-supply", "analysis-1", attempt, "media-1", HASH_A),
    T1,
  );
  return state;
}

/** Drive an item to reviewed status through the happy path. */
function reviewedSession(): SessionState {
  return reduceSession(
    draftSession(),
    { type: "accept", itemId: "demo-water-supply" },
    T1,
  );
}

describe("versioned illustrative catalog (REQ-001)", () => {
  it("ships 4 items with stable demo IDs, version, and demo notice", () => {
    const result = validateCatalog(demoCatalogJson);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.length).toBe(4);
    expect(result.value.version).toBe("0.2.0-demo.1");
    expect(result.value.mode).toBe("demo");
    expect(result.value.demoNotice).toBe(DEMO_NOTICE);
    const ids = result.value.items.map((item) => item.id);
    expect(ids).toEqual([
      "demo-interior-air",
      "demo-water-supply",
      "demo-lighting-electric",
      "demo-smoke-co",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith("demo-")).toBe(true);
    }
  });

  it("requires every item to pair a photo-gap check with a physical test", () => {
    const catalog = assertValidCatalog(demoCatalogJson);
    for (const item of catalog.items) {
      expect(item.manualChecks.length).toBeGreaterThan(0);
      expect(
        item.manualChecks.some(
          (check) => check.photoCannotEstablish && check.requiresPhysicalTest,
        ),
        `item ${item.id} must keep a physical test a photograph cannot establish`,
      ).toBe(true);
    }
  });

  it("rejects an item with no photo-gap physical test", () => {
    const catalog = assertValidCatalog(demoCatalogJson);
    const weakened = validateCatalog({
      ...catalog,
      items: catalog.items.map((item, index) =>
        index === 0
          ? {
              ...item,
              manualChecks: item.manualChecks.map((check) => ({
                ...check,
                photoCannotEstablish: false,
              })),
            }
          : item,
      ),
    });
    expect(weakened.ok).toBe(false);
  });

  it("stays unconfirmed and cannot claim a Form 1083 mapping", () => {
    const catalog = assertValidCatalog(demoCatalogJson);
    expect(isDemoCatalog(catalog)).toBe(true);
    expect(catalog.sourceConfirmation.status).toBe("unconfirmed");
    expect(canClaimFormMapping(catalog)).toBe(false);
  });

  it("rejects catalogs with wrong item counts or duplicate IDs", () => {
    const catalog = assertValidCatalog(demoCatalogJson);
    const tooFew = validateCatalog({ ...catalog, items: catalog.items.slice(0, 1) });
    expect(tooFew.ok).toBe(false);
    const doubled = validateCatalog({
      ...catalog,
      items: [...catalog.items, ...catalog.items],
    });
    expect(doubled.ok).toBe(false);
    if (!doubled.ok) {
      expect(doubled.errors.some((e) => e.includes("3–4 items"))).toBe(true);
    }
  });

  it("rejects extra top-level and item fields, including demo mapping claims", () => {
    const catalog = assertValidCatalog(demoCatalogJson);
    expect(
      validateCatalog({ ...catalog, form1083Reference: "§1 Kitchen" }).ok,
    ).toBe(false);
    const withMapping = {
      ...catalog,
      items: catalog.items.map((item, index) =>
        index === 0
          ? { ...item, officialItemNumber: "1", officialWording: "Kitchen" }
          : item,
      ),
    };
    const result = validateCatalog(withMapping);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("officialItemNumber"))).toBe(
        true,
      );
    }
  });

  it("rejects demo catalogs that claim confirmation without verifier/date", () => {
    const catalog = assertValidCatalog(demoCatalogJson);
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

  it("resolves items by stable ID and preserves required checks", () => {
    const catalog = assertValidCatalog(demoCatalogJson);
    const item = getCatalogItem(catalog, "demo-interior-air");
    expect(item).not.toBeNull();
    if (item === null) throw new Error("expected demo-interior-air in catalog");
    expect(item.label).toMatch(/interior air/i);
    expect(getCatalogItem(catalog, "no-such-item")).toBeNull();
    const required = getRequiredChecks(item);
    const requiredCount = required.length;
    expect(requiredCount).toBeGreaterThan(0);
    // Callers cannot mutate the catalog through the returned list.
    required.pop();
    expect(getCatalogItem(catalog, "demo-interior-air")?.manualChecks.length).toBe(
      requiredCount,
    );
  });
});

describe("strict draft and envelope schemas (REQ-004)", () => {
  it("accepts a well-formed neutral draft", () => {
    expect(validateAnalysisDraft(validDraft()).ok).toBe(true);
  });

  it("rejects verdict, confidence, and pass/fail fields", () => {
    for (const poison of [
      { verdict: "Approved" },
      { confidence: 0.99 },
      { pass: true },
      { habitability: "habitable" },
      { deficient: false },
      { score: 9 },
    ]) {
      const result = validateAnalysisDraft({ ...validDraft(), ...poison });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes("forbidden"))).toBe(true);
      }
    }
  });

  it("rejects extra, missing, and malformed structure", () => {
    expect(
      validateAnalysisDraft({ ...validDraft(), extra: "nope" }).ok,
    ).toBe(false);
    const missing = { ...validDraft() } as Record<string, unknown>;
    delete missing.unknowns;
    expect(validateAnalysisDraft(missing).ok).toBe(false);
    expect(validateAnalysisDraft(null).ok).toBe(false);
    expect(validateAnalysisDraft({ ...validDraft(), observation: "  " }).ok).toBe(
      false,
    );
  });

  it("rejects oversized strings and over-long lists", () => {
    expect(
      validateAnalysisDraft({ ...validDraft(), observation: "x".repeat(601) }).ok,
    ).toBe(false);
    expect(
      validateAnalysisDraft({
        ...validDraft(),
        visibleEvidence: ["a", "b", "c", "d", "e", "f"],
      }).ok,
    ).toBe(false);
    expect(
      validateAnalysisDraft({ ...validDraft(), unknowns: ["y".repeat(201)] }).ok,
    ).toBe(false);
  });

  it("rejects unusable empty output (nothing evidenced, unknown, or suggested)", () => {
    const result = validateAnalysisDraft({
      observation: "A room.",
      visibleEvidence: [],
      unknowns: [],
      suggestedManualChecks: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("unusable empty output"))).toBe(
        true,
      );
    }
  });

  it("rejects envelopes with unknown fields, bad digests, or bad modes", () => {
    expect(
      validateEnvelope({ ...validEnvelope(), verdict: "Approved" }).ok,
    ).toBe(false);
    expect(
      validateEnvelope({ ...validEnvelope(), mediaHash: "not-a-hash" }).ok,
    ).toBe(false);
    expect(validateEnvelope({ ...validEnvelope(), mode: "live-fake" }).ok).toBe(
      false,
    );
    expect(
      validateEnvelope({ ...validEnvelope(), latencyMs: Number.NaN }).ok,
    ).toBe(false);
  });

  it("keeps required catalog checks even when the model says otherwise", () => {
    const catalog = assertValidCatalog(demoCatalogJson);
    const item = getCatalogItem(catalog, "demo-interior-air");
    expect(item).not.toBeNull();
    if (item === null) throw new Error("expected demo-interior-air in catalog");
    // The model suggests a duplicate and claims a required check is needless;
    // display text can never drop the catalog requirement.
    const effective = effectiveManualChecks(item, [
      "Operate the window / switch the fan or A/C on and confirm airflow or function by feel or sound. A photograph cannot establish airflow or that the unit runs.",
      "No further checks needed.",
    ]);
    const requiredIds = item.manualChecks.map((check) => check.id);
    for (const id of requiredIds) {
      expect(effective.some((check) => check.id === id)).toBe(true);
    }
    expect(
      effective.filter((check) => check.source === "required").length,
    ).toBe(requiredIds.length);
    expect(
      effective.some(
        (check) =>
          check.source === "model-suggestion" &&
          check.instruction === "No further checks needed.",
      ),
    ).toBe(true);
  });
});

describe("evidence reducer races and review integrity (REQ-005, REQ-006)", () => {
  it("commits a draft only when session, item, media, and attempt still match", () => {
    let state = createSession(
      "session-1",
      {
        catalogId: "demo-habitability-walkthrough",
        catalogVersion: "0.2.0-demo.1",
        itemIds: ["demo-water-supply"],
      },
      T0,
    );
    state = reduceSession(
      state,
      {
        type: "capture-media",
        itemId: "demo-water-supply",
        mediaId: "media-1",
        mediaHash: HASH_A,
        capturedAt: T0,
      },
      T0,
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
      T0,
    );
    const next = reduceSession(
      state,
      commitDraftPayload("demo-water-supply", "analysis-1", attempt, "media-1", HASH_A),
      T1,
    );
    expect(next.items["demo-water-supply"].status).toBe("draft");
    expect(next.items["demo-water-supply"].disposition).toBe("unreviewed");
    expect(next.items["demo-water-supply"].draft?.observation).toContain("sink");
  });

  it("ignores a delayed response for a superseded attempt (race A after B)", () => {
    let state = createSession(
      "session-1",
      {
        catalogId: "demo-habitability-walkthrough",
        catalogVersion: "0.2.0-demo.1",
        itemIds: ["demo-water-supply"],
      },
      T0,
    );
    state = reduceSession(
      state,
      {
        type: "capture-media",
        itemId: "demo-water-supply",
        mediaId: "media-1",
        mediaHash: HASH_A,
        capturedAt: T0,
      },
      T0,
    );
    const attempt1 = state.items["demo-water-supply"].attempt;
    state = reduceSession(
      state,
      {
        type: "begin-analysis",
        itemId: "demo-water-supply",
        analysisId: "analysis-1",
        attempt: attempt1,
      },
      T0,
    );
    // Media is replaced while analysis-1 is inflight: attempt 2 is current.
    state = reduceSession(
      state,
      {
        type: "capture-media",
        itemId: "demo-water-supply",
        mediaId: "media-2",
        mediaHash: HASH_B,
        capturedAt: T1,
      },
      T1,
    );
    // The late analysis-1 response for attempt 1 must not overwrite media-2.
    const stale = reduceSession(
      state,
      commitDraftPayload("demo-water-supply", "analysis-1", attempt1, "media-1", HASH_A),
      T1,
    );
    expect(stale).toBe(state);
    expect(stale.items["demo-water-supply"].mediaId).toBe("media-2");
    expect(stale.items["demo-water-supply"].draft).toBeNull();
  });

  it("invalidates review and manual checks when media is replaced", () => {
    let state = reviewedSession();
    state = reduceSession(
      state,
      {
        type: "record-manual-check",
        itemId: "demo-water-supply",
        checkId: "demo-water-supply-mc1",
        outcome: "performed",
        note: "Ran both taps; basin drained.",
        recordedAt: T1,
        requiredCheckIds: ["demo-water-supply-mc1"],
      },
      T1,
    );
    expect(state.items["demo-water-supply"].manualChecks.length).toBe(1);
    state = reduceSession(
      state,
      {
        type: "capture-media",
        itemId: "demo-water-supply",
        mediaId: "media-2",
        mediaHash: HASH_B,
        capturedAt: T1,
      },
      T1,
    );
    const item = state.items["demo-water-supply"];
    expect(item.status).toBe("captured");
    expect(item.disposition).toBe("unreviewed");
    expect(item.draft).toBeNull();
    expect(item.manualChecks).toEqual([]);
  });

  it("invalidates review on reanalysis and ignores its stale inflight", () => {
    let state = reviewedSession();
    const revisionBefore = state.items["demo-water-supply"].revision;
    state = reduceSession(state, { type: "reanalyze", itemId: "demo-water-supply" }, T1);
    const item = state.items["demo-water-supply"];
    expect(item.status).toBe("captured");
    expect(item.disposition).toBe("unreviewed");
    expect(item.draft).toBeNull();
    expect(item.revision).toBeGreaterThan(revisionBefore);
  });

  it("never attaches a commit to another item or version", () => {
    const state = reviewedSession();
    const before: SessionState = state;
    const crossItem = reduceSession(
      state,
      commitDraftPayload("demo-interior-air", "analysis-1", 0, "media-1", HASH_A),
      T1,
    );
    expect(crossItem).toBe(before);
    const wrongHash = reduceSession(
      state,
      {
        type: "capture-media",
        itemId: "demo-interior-air",
        mediaId: "media-w",
        mediaHash: HASH_B,
        capturedAt: T1,
      },
      T1,
    );
    const attempt = wrongHash.items["demo-interior-air"].attempt;
    const analyzing = reduceSession(
      wrongHash,
      {
        type: "begin-analysis",
        itemId: "demo-interior-air",
        analysisId: "analysis-w",
        attempt,
      },
      T1,
    );
    // Envelope names media-w but the payload presents media-X: discarded.
    const mismatched = reduceSession(
      analyzing,
      {
        type: "commit-draft",
        itemId: "demo-interior-air",
        analysisId: "analysis-w",
        attempt,
        mediaId: "media-X",
        mediaHash: HASH_A,
        envelope: {
          ...validEnvelope(),
          itemId: "demo-interior-air",
          analysisId: "analysis-w",
          mediaId: "media-w",
          mediaHash: HASH_B,
        },
      },
      T1,
    );
    expect(mismatched).toBe(analyzing);
  });

  it("drops late writes after cancellation, failure, and deletion", () => {
    let state = createSession(
      "session-1",
      {
        catalogId: "demo-habitability-walkthrough",
        catalogVersion: "0.2.0-demo.1",
        itemIds: ["demo-water-supply"],
      },
      T0,
    );
    state = reduceSession(
      state,
      {
        type: "capture-media",
        itemId: "demo-water-supply",
        mediaId: "media-1",
        mediaHash: HASH_A,
        capturedAt: T0,
      },
      T0,
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
      T0,
    );
    const cancelled = reduceSession(
      state,
      { type: "cancel-analysis", itemId: "demo-water-supply", attempt },
      T1,
    );
    expect(cancelled.items["demo-water-supply"].status).toBe("captured");
    // The cancelled analysis ID no longer matches: its late commit dies.
    expect(
      reduceSession(
        cancelled,
        commitDraftPayload("demo-water-supply", "analysis-1", attempt, "media-1", HASH_A),
        T1,
      ),
    ).toBe(cancelled);
    const deleted = reduceSession(cancelled, { type: "delete-item-evidence", itemId: "demo-water-supply" }, T1);
    expect(
      reduceSession(
        deleted,
        commitDraftPayload("demo-water-supply", "analysis-1", attempt, "media-1", HASH_A),
        T1,
      ),
    ).toBe(deleted);
    const sessionDeleted = reduceSession({ ...cancelled }, { type: "delete-session" }, T1);
    expect(
      reduceSession(
        sessionDeleted,
        commitDraftPayload("demo-water-supply", "analysis-1", attempt, "media-1", HASH_A),
        T1,
      ),
    ).toBe(sessionDeleted);
  });

  it("rejects invalid model output without persisting a draft, keeping the photo", () => {
    let state = createSession(
      "session-1",
      {
        catalogId: "demo-habitability-walkthrough",
        catalogVersion: "0.2.0-demo.1",
        itemIds: ["demo-water-supply"],
      },
      T0,
    );
    state = reduceSession(
      state,
      {
        type: "capture-media",
        itemId: "demo-water-supply",
        mediaId: "media-1",
        mediaHash: HASH_A,
        capturedAt: T0,
      },
      T0,
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
      T0,
    );
    const next = reduceSession(
      state,
      {
        type: "commit-draft",
        itemId: "demo-water-supply",
        analysisId: "analysis-1",
        attempt,
        mediaId: "media-1",
        mediaHash: HASH_A,
        envelope: validEnvelope({ draft: { ...validDraft(), verdict: "Approved" } }),
      },
      T1,
    );
    expect(next.items["demo-water-supply"].status).toBe("error");
    expect(next.items["demo-water-supply"].draft).toBeNull();
    expect(next.items["demo-water-supply"].mediaId).toBe("media-1");
    expect(next.items["demo-water-supply"].error?.code).toBe("INVALID_MODEL_OUTPUT");
  });
});

describe("worker review and manual checks (REQ-005)", () => {
  it("supports accept, edit-and-accept, and reject with revision history", () => {
    const accepted = reviewedSession();
    expect(accepted.items["demo-water-supply"].disposition).toBe("accepted");

    let edited = draftSession();
    expect(edited.items["demo-water-supply"].status).toBe("draft");
    expect(edited.items["demo-water-supply"].disposition).toBe("unreviewed");
    const before = edited.items["demo-water-supply"].revision;
    edited = reduceSession(
      edited,
      { type: "accept-edited", itemId: "demo-water-supply", revisedText: "Basin intact; taps run clear." },
      T1,
    );
    expect(edited.items["demo-water-supply"].disposition).toBe("accepted-edited");
    expect(edited.items["demo-water-supply"].workerRevision).toContain("taps run clear");
    expect(edited.items["demo-water-supply"].revision).toBeGreaterThan(before);
    // The original model draft is preserved alongside the worker revision.
    expect(edited.items["demo-water-supply"].draft?.observation).toContain("sink");

    let rejected = draftSession();
    rejected = reduceSession(
      rejected,
      { type: "reject", itemId: "demo-water-supply", reason: "Photo too dark to use." },
      T1,
    );
    expect(rejected.items["demo-water-supply"].status).toBe("rejected");
    expect(rejected.items["demo-water-supply"].disposition).toBe("rejected");
  });

  it("rejects empty edit text and empty rejection reasons", () => {
    const state = draftSession();
    expect(
      reduceSession(
        state,
        { type: "accept-edited", itemId: "demo-water-supply", revisedText: "   " },
        T1,
      ),
    ).toBe(state);
    expect(
      reduceSession(state, { type: "reject", itemId: "demo-water-supply", reason: "" }, T1),
    ).toBe(state);
  });

  it("accepting text never marks a physical test performed", () => {
    const state = reviewedSession();
    const required = ["demo-water-supply-mc1"];
    expect(unresolvedRequiredChecks(required, state.items["demo-water-supply"].manualChecks)).toEqual(required);
    expect(
      exportBlockers(state, {
        "demo-water-supply": required,
        "demo-interior-air": ["demo-interior-air-mc1"],
      }).some((blocker) => blocker.itemId === "demo-water-supply"),
    ).toBe(true);
  });

  it("requires a worker note; not-performed stays unresolved", () => {
    let state = reviewedSession();
    const required = ["demo-water-supply-mc1"];
    // Missing note: ignored, still pending.
    expect(
      reduceSession(
        state,
        {
          type: "record-manual-check",
          itemId: "demo-water-supply",
          checkId: "demo-water-supply-mc1",
          outcome: "performed",
          note: "   ",
          recordedAt: T1,
          requiredCheckIds: required,
        },
        T1,
      ),
    ).toBe(state);
    // Unknown check IDs attach to nothing.
    expect(
      reduceSession(
        state,
        {
          type: "record-manual-check",
          itemId: "demo-water-supply",
          checkId: "demo-water-supply-nope",
          outcome: "performed",
          note: "Did it.",
          recordedAt: T1,
          requiredCheckIds: required,
        },
        T1,
      ),
    ).toBe(state);
    state = reduceSession(
      state,
      {
        type: "record-manual-check",
        itemId: "demo-water-supply",
        checkId: "demo-water-supply-mc1",
        outcome: "not-performed",
        note: "Tenant declined the run test.",
        recordedAt: T1,
        requiredCheckIds: required,
      },
      T1,
    );
    expect(isCheckResolved(state.items["demo-water-supply"].manualChecks, "demo-water-supply-mc1")).toBe(false);
    expect(
      unresolvedRequiredChecks(required, state.items["demo-water-supply"].manualChecks),
    ).toEqual(required);
    state = reduceSession(
      state,
      {
        type: "record-manual-check",
        itemId: "demo-water-supply",
        checkId: "demo-water-supply-mc1",
        outcome: "performed",
        note: " Ran both taps; basin drained. ",
        recordedAt: T1,
        requiredCheckIds: required,
      },
      T1,
    );
    expect(isCheckResolved(state.items["demo-water-supply"].manualChecks, "demo-water-supply-mc1")).toBe(true);
    expect(
      unresolvedRequiredChecks(required, state.items["demo-water-supply"].manualChecks),
    ).toEqual([]);
  });

  it("blocks completed export until every item is reviewed with checks resolved", () => {
    const state = reviewedSession();
    const required: Record<string, string[]> = {
      "demo-water-supply": ["demo-water-supply-mc1"],
      "demo-interior-air": ["demo-interior-air-mc1"],
    };
    // demo-interior-air was never captured: unresolved.
    expect(exportBlockers(state, required).length).toBeGreaterThan(0);
    // A fully reviewed item with all checks performed exports clean.
    let done = state;
    for (const checkId of required["demo-water-supply"]) {
      done = reduceSession(
        done,
        {
          type: "record-manual-check",
          itemId: "demo-water-supply",
          checkId,
          outcome: "performed",
          note: `Verified ${checkId}.`,
          recordedAt: T1,
          requiredCheckIds: required["demo-water-supply"],
        },
        T1,
      );
    }
    expect(
      exportBlockers(done, required).some(
        (blocker) => blocker.itemId === "demo-water-supply",
      ),
    ).toBe(false);
  });
});
