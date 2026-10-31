/**
 * Behavioral and regression tests for TASK-007 (REQ-005, REQ-006, REQ-008).
 *
 * Deterministic and fixture-only: synthetic mock-unit digests and bytes, fixed
 * clock, no network, no provider keys, no browser, no IndexedDB. Every hash
 * and photo byte below is synthetic test data — never live inference.
 *
 * Covers:
 * - Stable snapshots: later reducer transitions cannot change built content,
 *   and building never mutates review state.
 * - Policy: only reviewed-with-resolved-checks items carry a reviewed note
 *   and draft context; pending/rejected/failed items list as unresolved with
 *   no unapproved draft text.
 * - Escaping: hostile model/worker text is escaped in printable HTML; the
 *   document makes no remote image requests and embeds normalized bytes.
 * - Banner/provenance/mode: the review-only banner repeats (header, every
 *   item, footer, print header); fixture/live and manual-check states stay
 *   visible; nothing claims approval, a completed inspection, or HMIS
 *   submission; an entirely unreviewed session cannot read as completed.
 */
import { describe, expect, it } from "vitest";

import type { Catalog } from "../../../src/domain/catalog";
import {
  commitDraftPayload,
  createSession,
  reduceSession,
} from "../../../src/domain/evidence";
import {
  buildExportSnapshot,
  canExportCompleted,
  escapeHtml,
  EXPORT_REVIEW_BANNER,
  renderExportHtml,
  type BuildExportInput,
  type ExportSnapshot,
} from "../../../src/export/summary";

/** Synthetic SHA-256-shaped digests for mock-unit evidence (not real media). */
const HASH_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const T0 = "2026-10-27T12:00:00.000Z";
const T1 = "2026-10-27T12:01:00.000Z";

const CATALOG: Catalog = {
  schemaVersion: 1,
  catalogId: "demo-habitability-walkthrough",
  version: "0.3.0-demo.3",
  mode: "demo",
  demoNotice: "Project owner confirms this workflow uses LAHSA Form 1083. This local app prepares a draft; it does not submit to HMIS.",
  sourceConfirmation: {
    status: "unconfirmed",
    suppliedBy: null,
    verifiedBy: null,
    verifiedAt: null,
    notes: "Illustrative demo catalog for tests.",
  },
  items: [
    {
      id: "demo-water-supply",
      label: "Kitchen sink area (illustrative)",
      captureGuidance: "Photograph the sink basin and faucet in one frame.",
      manualChecks: [
        {
          id: "demo-water-supply-mc1",
          instruction:
            "Run both hot and cold taps and watch the basin drain. A photograph cannot establish water flow or drainage.",
          requiresPhysicalTest: true,
          photoCannotEstablish: true,
        },
      ],
    },
    {
      id: "demo-interior-air",
      label: "Window and lock (illustrative)",
      captureGuidance: "Photograph the window, frame, and lock in daylight.",
      manualChecks: [
        {
          id: "demo-interior-air-mc1",
          instruction:
            "Operate the window lock open and closed by hand and confirm it latches. A photograph cannot establish that a lock functions.",
          requiresPhysicalTest: true,
          photoCannotEstablish: true,
        },
      ],
    },
  ],
};

const REQUIRED_SUPPLY = ["demo-water-supply-mc1"];
const REQUIRED_AIR = ["demo-interior-air-mc1"];

/** Two-byte synthetic "photo" — not real media. */
function fakePng(): Uint8Array {
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
}

/** Drive one item to an unreviewed draft. */
function draftOnly() {
  let state = createSession(
    "session-1",
    {
      catalogId: CATALOG.catalogId,
      catalogVersion: CATALOG.version,
      itemIds: CATALOG.items.map((i) => i.id),
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
    { type: "begin-analysis", itemId: "demo-water-supply", analysisId: "analysis-1", attempt },
    T0,
  );
  state = reduceSession(
    state,
    commitDraftPayload("demo-water-supply", "analysis-1", attempt, "media-1", HASH_A),
    T1,
  );
  return state;
}

/** Fully completed session: every item reviewed with checks performed. */
function completedState() {
  let state = createSession(
    "session-1",
    {
      catalogId: CATALOG.catalogId,
      catalogVersion: CATALOG.version,
      itemIds: CATALOG.items.map((i) => i.id),
    },
    T0,
  );
  for (const [itemId, mediaId, hash, analysisId] of [
    ["demo-water-supply", "media-1", HASH_A, "analysis-1"],
    ["demo-interior-air", "media-2", HASH_B, "analysis-2"],
  ] as const) {
    state = reduceSession(
      state,
      { type: "capture-media", itemId, mediaId, mediaHash: hash, capturedAt: T0 },
      T0,
    );
    const attempt = state.items[itemId].attempt;
    state = reduceSession(
      state,
      { type: "begin-analysis", itemId, analysisId, attempt },
      T0,
    );
    state = reduceSession(
      state,
      commitDraftPayload(itemId, analysisId, attempt, mediaId, hash),
      T1,
    );
    state = reduceSession(state, { type: "accept", itemId }, T1);
  }
  state = reduceSession(
    state,
    {
      type: "record-manual-check",
      itemId: "demo-water-supply",
      checkId: "demo-water-supply-mc1",
      outcome: "performed",
      note: "Ran both taps; basin drained.",
      recordedAt: T1,
      requiredCheckIds: REQUIRED_SUPPLY,
    },
    T1,
  );
  state = reduceSession(
    state,
    {
      type: "record-manual-check",
      itemId: "demo-interior-air",
      checkId: "demo-interior-air-mc1",
      outcome: "performed",
      note: "Latched by hand.",
      recordedAt: T1,
      requiredCheckIds: REQUIRED_AIR,
    },
    T1,
  );
  return state;
}

function inputFor(
  overrides: Partial<BuildExportInput> = {},
): BuildExportInput {
  return {
    state: draftOnly(),
    catalog: CATALOG,
    mediaById: { "media-1": { bytes: fakePng(), mime: "image/png" } },
    analysisMode: "fixture",
    generatedAt: T1,
    ...overrides,
  };
}

describe("export snapshot stability (REQ-006, REQ-008)", () => {
  it("freezes a deep copy: later review transitions cannot change it", () => {
    let state = draftOnly();
    const snapshot = buildExportSnapshot(inputFor({ state }));
    // Unresolved at build time: no approved note.
    expect(
      snapshot.items.find((i) => i.itemId === "demo-water-supply")?.reviewedNote,
    ).toBeNull();

    // Later worker action changes live state but not the frozen snapshot.
    state = reduceSession(state, { type: "accept", itemId: "demo-water-supply" }, T1);
    expect(state.items["demo-water-supply"].status).toBe("reviewed");
    expect(
      snapshot.items.find((i) => i.itemId === "demo-water-supply")?.completed,
    ).toBe(false);
    expect(snapshot.unresolved.length).toBe(2);
  });

  it("building the snapshot never mutates review state", () => {
    const state = draftOnly();
    const before = JSON.stringify(state);
    buildExportSnapshot(inputFor({ state }));
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("export review policy (REQ-005, REQ-008)", () => {
  it("excludes unapproved draft text and lists pending items as unresolved", () => {
    const snapshot = buildExportSnapshot(inputFor({}));
    const sink = snapshot.items.find((i) => i.itemId === "demo-water-supply");
    expect(sink?.completed).toBe(false);
    expect(sink?.reviewedNote).toBeNull();
    expect(sink?.visibleEvidence).toEqual([]);
    expect(sink?.unknowns).toEqual([]);
    expect(sink?.suggestedManualChecks).toEqual([]);
    expect(sink?.unresolvedReason).toMatch(/unreviewed/);
    expect(snapshot.canClaimCompleted).toBe(false);
    expect(canExportCompleted(snapshot)).toBe(false);

    const html = renderExportHtml(snapshot);
    // The model's observation must not leak for an unreviewed draft.
    expect(html).not.toContain("sink basin");
    expect(html).toContain("Unresolved items (2)");
  });

  it("lists rejected and failed items as unresolved without draft text", () => {
    let state = draftOnly();
    state = reduceSession(
      state,
      { type: "reject", itemId: "demo-water-supply", reason: "Too dark." },
      T1,
    );
    const snapshot = buildExportSnapshot(
      inputFor({
        state,
        mediaById: { "media-1": { bytes: fakePng(), mime: "image/png" } },
      }),
    );
    const sink = snapshot.items.find((i) => i.itemId === "demo-water-supply");
    expect(sink?.completed).toBe(false);
    expect(sink?.reviewedNote).toBeNull();
    expect(sink?.unresolvedReason).toMatch(/rejected/);
    const html = renderExportHtml(snapshot);
    expect(html).not.toContain("Too dark.");
    expect(html).not.toContain("sink basin");
    expect(html).toContain("draft rejected — unresolved");
  });

  it("accepted text never resolves manual checks: stays unresolved until performed", () => {
    let state = draftOnly();
    state = reduceSession(state, { type: "accept", itemId: "demo-water-supply" }, T1);
    const snapshot = buildExportSnapshot(
      inputFor({
        state,
        mediaById: { "media-1": { bytes: fakePng(), mime: "image/png" } },
      }),
    );
    const sink = snapshot.items.find((i) => i.itemId === "demo-water-supply");
    // Accepted but the required physical test is still pending.
    expect(sink?.completed).toBe(false);
    expect(sink?.unresolvedReason).toMatch(/unresolved manual checks/);
    expect(snapshot.canClaimCompleted).toBe(false);
    const html = renderExportHtml(snapshot);
    expect(html).toContain("pending — unresolved");
  });

  it("a fully reviewed session with resolved checks exports completed notes", () => {
    const state = completedState();
    const snapshot = buildExportSnapshot({
      state,
      catalog: CATALOG,
      mediaById: {
        "media-1": { bytes: fakePng(), mime: "image/png" },
        "media-2": { bytes: fakePng(), mime: "image/jpeg" },
      },
      analysisMode: "fixture",
      generatedAt: T1,
    });
    expect(snapshot.completedCount).toBe(2);
    expect(snapshot.unresolved).toEqual([]);
    expect(snapshot.canClaimCompleted).toBe(true);
    const sink = snapshot.items.find((i) => i.itemId === "demo-water-supply");
    expect(sink?.completed).toBe(true);
    expect(sink?.reviewedNote).toContain("sink");
    const html = renderExportHtml(snapshot);
    expect(html).toContain("Reviewed items: 2 of 2");
    expect(html).toContain("Reviewed note (worker-approved)");
  });

  it("an entirely unreviewed session cannot read as completed", () => {
    const state = createSession(
      "session-1",
      {
        catalogId: CATALOG.catalogId,
        catalogVersion: CATALOG.version,
        itemIds: CATALOG.items.map((i) => i.id),
      },
      T0,
    );
    const snapshot = buildExportSnapshot(inputFor({ state, mediaById: {} }));
    expect(snapshot.completedCount).toBe(0);
    expect(snapshot.canClaimCompleted).toBe(false);
    expect(renderExportHtml(snapshot)).toContain("worker-review draft");
  });
});

describe("export escaping, media, and banner (REQ-008)", () => {
  it("escapes hostile model/worker text and embeds photos without remote requests", () => {
    const hostileDraft = {
      observation: "<script>alert('xss')</script> Sink looks fine & intact.",
      visibleEvidence: ["<img src=x onerror=alert(1)> basin"],
      unknowns: ["flow & drainage <unknown>"],
      suggestedManualChecks: ["Run taps \"carefully\"."],
    };
    let state = createSession(
      "session-1",
      {
        catalogId: CATALOG.catalogId,
        catalogVersion: CATALOG.version,
        itemIds: ["demo-water-supply", "demo-interior-air"],
      },
      T0,
    );
    state = reduceSession(
      state,
      { type: "capture-media", itemId: "demo-water-supply", mediaId: "media-1", mediaHash: HASH_A, capturedAt: T0 },
      T0,
    );
    const a1 = state.items["demo-water-supply"].attempt;
    state = reduceSession(
      state,
      { type: "begin-analysis", itemId: "demo-water-supply", analysisId: "analysis-1", attempt: a1 },
      T0,
    );
    state = reduceSession(
      state,
      {
        type: "commit-draft",
        itemId: "demo-water-supply",
        analysisId: "analysis-1",
        attempt: a1,
        mediaId: "media-1",
        mediaHash: HASH_A,
        envelope: {
          analysisId: "analysis-1",
          sessionId: "session-1",
          itemId: "demo-water-supply",
          catalogVersion: CATALOG.version,
          mediaId: "media-1",
          mediaHash: HASH_A,
          model: "muse-spark-1.3",
          mode: "fixture",
          requestId: "req-1",
          latencyMs: 1,
          draft: hostileDraft,
        },
      },
      T1,
    );
    state = reduceSession(state, { type: "accept", itemId: "demo-water-supply" }, T1);
    state = reduceSession(
      state,
      {
        type: "record-manual-check",
        itemId: "demo-water-supply",
        checkId: "demo-water-supply-mc1",
        outcome: "performed",
        note: "Ran taps <&> drained.",
        recordedAt: T1,
        requiredCheckIds: REQUIRED_SUPPLY,
      },
      T1,
    );
    // Second item stays unresolved so the hostile draft path is gating only
    // the completed item; unresolved items must carry no draft text at all.
    const snapshot = buildExportSnapshot({
      state,
      catalog: CATALOG,
      mediaById: { "media-1": { bytes: fakePng(), mime: "image/png" } },
      analysisMode: "live",
      generatedAt: T1,
    });
    const html = renderExportHtml(snapshot);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert");
    expect(html).toContain("Sink looks fine &amp; intact.");
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain('src="http');
    expect(html).not.toContain("src='http");
    expect(html).not.toContain('src="blob:');
    expect(escapeHtml("<a href=\"x\">&'</a>")).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("omits oversized photos with an explicit reason instead of embedding", () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    const snapshot = buildExportSnapshot(
      inputFor({ mediaById: { "media-1": { bytes: big, mime: "image/png" } } }),
    );
    const sink = snapshot.items.find((i) => i.itemId === "demo-water-supply");
    expect(sink?.photoDataUrl).toBeNull();
    expect(sink?.photoOmittedReason).toMatch(/2 MiB/);
  });

  it("repeats the review-only banner, shows mode/checks, and claims nothing", () => {
    const snapshot = buildExportSnapshot(inputFor({ analysisMode: "fixture" }));
    const html = renderExportHtml(snapshot);
    const bannerCount = html.split(EXPORT_REVIEW_BANNER).length - 1;
    // Fixed print header + document header + one per item + footer.
    expect(bannerCount).toBeGreaterThanOrEqual(snapshot.items.length + 2);
    expect(html).toContain("Analysis mode: fixture (mock output — not live inference)");
    expect(html).toContain(CATALOG.demoNotice);
    expect(html).toContain("Evidence provenance");
    expect(html).toContain("Manual checks");
    // The banner's own negation is required; positive claims are forbidden.
    expect(html).toContain(EXPORT_REVIEW_BANNER);
    expect(html).not.toMatch(/is (hereby |now )?approved/i);
    expect(html).not.toMatch(/certif/i);
    expect(html).not.toMatch(/inspection (passed|complete|is complete)/i);
    expect(html).not.toMatch(/HMIS submission (confirmed|complete|approved)/i);
    expect(html).not.toContain("META_API_KEY");
  });
});

describe("export hardening for missing fields (REQ-005, REQ-008)", () => {
  it("escapeHtml coerces unknown input without throwing", () => {
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml("<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
  });

  it("renders snapshots with missing fields as unresolved with zero draft text", () => {
    const snapshot = buildExportSnapshot(inputFor({}));
    const partial = {
      ...snapshot,
      sessionId: undefined,
      catalogId: undefined,
      catalogVersion: undefined,
      catalogMode: undefined,
      demoNotice: undefined,
      generatedAt: undefined,
      items: snapshot.items.map((entry) => ({
        ...entry,
        label: undefined,
        status: undefined,
        disposition: undefined,
        unresolvedReason: undefined,
        photoDataUrl: null,
        photoOmittedReason: undefined,
        reviewedNote: undefined,
      })),
      unresolved: snapshot.unresolved.map((entry) => ({
        ...entry,
        reason: undefined,
      })),
    } as unknown as ExportSnapshot;
    const html = renderExportHtml(partial);
    expect(html).toContain("unknown-session");
    expect(html).toContain("No photo available.");
    expect(html).toContain("unresolved");
    expect(html).toContain(EXPORT_REVIEW_BANNER);
    expect(html).not.toContain("sink basin");
  });
});
