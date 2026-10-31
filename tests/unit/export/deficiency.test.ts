/**
 * Behavioral tests for TASK-095 (REQ-005, REQ-008, REQ-011, REQ-012).
 *
 * Deficiency / case-notes reducer + export semantics. Fixture-only:
 * synthetic digests/bytes, fixed clock, no network, no provider keys,
 * no browser, no IndexedDB. Every hash and photo byte below is synthetic
 * test data — never live inference.
 *
 * Each block fails for the original bug it guards:
 * - Worker findings bind to the current photo, survive review, flag
 *   staleness on photo change, re-bind on re-record, clear on delete,
 *   and never resolve a required physical check.
 * - Session case notes validate 1–2000 chars, persist across reload,
 *   survive item deletion, and clear explicitly.
 * - Export keeps worker deficiencies, session case notes, and unresolved
 *   required checks in three separate sections; unresolved items export
 *   worker text but never model draft text; hostile text is escaped.
 */
import { describe, expect, it } from "vitest";

import type { Catalog } from "../../../src/domain/catalog";
import {
  commitDraftPayload,
  createSession,
  ensureSessionShape,
  reduceSession,
  validateCaseNotes,
  validateWorkerDeficiency,
  type SessionState,
} from "../../../src/domain/evidence";
import {
  buildExportSnapshot,
  canExportCompleted,
  EXPORT_REVIEW_BANNER,
  renderExportHtml,
  type BuildExportInput,
} from "../../../src/export/summary";

/** Synthetic SHA-256-shaped digests for mock-unit evidence (not real media). */
const HASH_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH_C =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const T0 = "2026-10-27T12:00:00.000Z";
const T1 = "2026-10-27T12:01:00.000Z";
const T2 = "2026-10-27T12:02:00.000Z";

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

function fakePng(): Uint8Array {
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
}

/** Fresh session with one captured photo on demo-water-supply. */
function capturedState(): SessionState {
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
  return state;
}

/** Drive demo-water-supply to an unreviewed draft. */
function draftState(): SessionState {
  let state = capturedState();
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
    commitDraftPayload(
      "demo-water-supply",
      "analysis-1",
      attempt,
      "media-1",
      HASH_A,
    ),
    T1,
  );
  return state;
}

function recordDeficiency(
  state: SessionState,
  overrides: {
    responsibleParty?: string;
    targetDate?: string;
    recordedAt?: string;
    issueDescription?: string;
    correctiveAction?: string;
  } = {},
): SessionState {
  return reduceSession(
    state,
    {
      type: "record-deficiency",
      itemId: "demo-water-supply",
      issueDescription:
        overrides.issueDescription ?? "Bathroom faucet drips continuously.",
      correctiveAction:
        overrides.correctiveAction ?? "Ask maintenance to reseat the washer; will recheck.",
      ...(overrides.responsibleParty !== undefined
        ? { responsibleParty: overrides.responsibleParty }
        : {}),
      ...(overrides.targetDate !== undefined
        ? { targetDate: overrides.targetDate }
        : {}),
      recordedAt: overrides.recordedAt ?? T1,
    },
    T1,
  );
}

function inputFor(
  state: SessionState,
  overrides: Partial<BuildExportInput> = {},
): BuildExportInput {
  return {
    state,
    catalog: CATALOG,
    mediaById: { "media-1": { bytes: fakePng(), mime: "image/png" } },
    analysisMode: "fixture",
    generatedAt: T1,
    ...overrides,
  };
}

describe("deficiency validation (REQ-005)", () => {
  it("requires a photo: recording without capture changes nothing", () => {
    const fresh = createSession(
      "session-1",
      {
        catalogId: CATALOG.catalogId,
        catalogVersion: CATALOG.version,
        itemIds: CATALOG.items.map((i) => i.id),
      },
      T0,
    );
    const next = reduceSession(
      fresh,
      {
        type: "record-deficiency",
        itemId: "demo-water-supply",
        issueDescription: "Drips.",
        correctiveAction: "Fix it.",
        recordedAt: T1,
      },
      T1,
    );
    expect(next).toStrictEqual(fresh);
    expect(next.items["demo-water-supply"].deficiency).toBeNull();
  });

  it("rejects empty issue/action text without recording", () => {
    const base = capturedState();
    const emptyIssue = reduceSession(
      base,
      {
        type: "record-deficiency",
        itemId: "demo-water-supply",
        issueDescription: "   ",
        correctiveAction: "Fix it.",
        recordedAt: T1,
      },
      T1,
    );
    expect(emptyIssue).toStrictEqual(base);
    const emptyAction = reduceSession(
      base,
      {
        type: "record-deficiency",
        itemId: "demo-water-supply",
        issueDescription: "Drips.",
        correctiveAction: "",
        recordedAt: T1,
      },
      T1,
    );
    expect(emptyAction).toStrictEqual(base);
  });

  it("rejects overlong text, bad target dates, and empty optional owner", () => {
    const base = capturedState();
    const overlong = reduceSession(
      base,
      {
        type: "record-deficiency",
        itemId: "demo-water-supply",
        issueDescription: "x".repeat(1001),
        correctiveAction: "Fix it.",
        recordedAt: T1,
      },
      T1,
    );
    expect(overlong).toStrictEqual(base);
    const badDate = reduceSession(
      base,
      {
        type: "record-deficiency",
        itemId: "demo-water-supply",
        issueDescription: "Drips.",
        correctiveAction: "Fix it.",
        targetDate: "27-10-2026",
        recordedAt: T1,
      },
      T1,
    );
    expect(badDate).toStrictEqual(base);
    const badCalendarDate = reduceSession(
      base,
      {
        type: "record-deficiency",
        itemId: "demo-water-supply",
        issueDescription: "Drips.",
        correctiveAction: "Fix it.",
        targetDate: "2026-02-30",
        recordedAt: T1,
      },
      T1,
    );
    expect(badCalendarDate).toStrictEqual(base);
    const emptyParty = reduceSession(
      base,
      {
        type: "record-deficiency",
        itemId: "demo-water-supply",
        issueDescription: "Drips.",
        correctiveAction: "Fix it.",
        responsibleParty: "   ",
        recordedAt: T1,
      },
      T1,
    );
    expect(emptyParty).toStrictEqual(base);
  });

  it("rejects impossible calendar dates while accepting real ones", () => {
    const base = capturedState();
    // February 30 rolls over to March under Date.parse: it must be rejected.
    for (const targetDate of [
      "2026-02-30",
      "2023-02-29",
      "2026-04-31",
      "2026-06-31",
      "2026-09-31",
      "2026-11-31",
      "2026-13-01",
      "2026-00-10",
      "2026-01-00",
      "2026-01-32",
    ]) {
      const next = reduceSession(
        base,
        {
          type: "record-deficiency",
          itemId: "demo-water-supply",
          issueDescription: "Drips.",
          correctiveAction: "Fix it.",
          targetDate,
          recordedAt: T1,
        },
        T1,
      );
      expect(next).toStrictEqual(base);
      expect(next.items["demo-water-supply"].deficiency).toBeNull();
      const direct = validateWorkerDeficiency({
        issueDescription: "Drips.",
        correctiveAction: "Fix it.",
        targetDate,
        recordedAt: T1,
        mediaId: "media-1",
        needsConfirmation: false,
      });
      expect(direct.ok).toBe(false);
      if (!direct.ok) {
        expect(direct.errors.join(" ")).toMatch(/targetDate/);
      }
    }
    // Real dates — including a leap day — still record and bind to the photo.
    for (const targetDate of [
      "2026-02-28",
      "2024-02-29",
      "2026-04-30",
      "2026-12-31",
    ]) {
      const direct = validateWorkerDeficiency({
        issueDescription: "Drips.",
        correctiveAction: "Fix it.",
        targetDate,
        recordedAt: T1,
        mediaId: "media-1",
        needsConfirmation: false,
      });
      expect(direct.ok).toBe(true);
      const next = reduceSession(
        base,
        {
          type: "record-deficiency",
          itemId: "demo-water-supply",
          issueDescription: "Drips.",
          correctiveAction: "Fix it.",
          targetDate,
          recordedAt: T1,
        },
        T1,
      );
      expect(next.items["demo-water-supply"].deficiency?.targetDate).toBe(
        targetDate,
      );
    }
  });

  it("records optional owner/date and binds to the current photo unflagged", () => {
    const next = recordDeficiency(capturedState(), {
      responsibleParty: "Maintenance team",
      targetDate: "2026-11-04",
      recordedAt: T1,
    });
    const deficiency = next.items["demo-water-supply"].deficiency;
    expect(deficiency).not.toBeNull();
    expect(deficiency?.issueDescription).toBe(
      "Bathroom faucet drips continuously.",
    );
    expect(deficiency?.responsibleParty).toBe("Maintenance team");
    expect(deficiency?.targetDate).toBe("2026-11-04");
    expect(deficiency?.mediaId).toBe("media-1");
    expect(deficiency?.needsConfirmation).toBe(false);
  });

  it("validator rejects verdict and HMIS keys: never a verdict or submission", () => {
    const verdict = validateWorkerDeficiency({
      issueDescription: "Drips.",
      correctiveAction: "Fix it.",
      recordedAt: T1,
      mediaId: "media-1",
      needsConfirmation: false,
      verdict: "approved",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.errors.join(" ")).toMatch(/verdict/i);
    }
    const hmis = validateWorkerDeficiency({
      issueDescription: "Drips.",
      correctiveAction: "Fix it.",
      recordedAt: T1,
      mediaId: "media-1",
      needsConfirmation: false,
      hmisId: "H-123",
    });
    expect(hmis.ok).toBe(false);
    if (!hmis.ok) {
      expect(hmis.errors.join(" ")).toMatch(/HMIS/i);
    }
    const ssn = validateWorkerDeficiency({
      issueDescription: "Drips.",
      correctiveAction: "Fix it.",
      recordedAt: T1,
      mediaId: "media-1",
      needsConfirmation: false,
      ssn: "000-00-0000",
    });
    expect(ssn.ok).toBe(false);
  });
});

describe("deficiency lifecycle (REQ-005, REQ-006)", () => {
  it("survives review: accepting text keeps the worker finding", () => {
    let state = recordDeficiency(draftState(), { recordedAt: T1 });
    const before = state.items["demo-water-supply"].deficiency;
    expect(before).not.toBeNull();
    state = reduceSession(state, { type: "accept", itemId: "demo-water-supply" }, T1);
    expect(state.items["demo-water-supply"].status).toBe("reviewed");
    expect(state.items["demo-water-supply"].deficiency).toEqual(before);
  });

  it("flags needs-confirmation when the photo changes, and re-record clears it", () => {
    let state = recordDeficiency(capturedState(), { recordedAt: T1 });
    expect(state.items["demo-water-supply"].deficiency?.needsConfirmation).toBe(
      false,
    );
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
    expect(state.items["demo-water-supply"].deficiency?.mediaId).toBe("media-1");
    expect(state.items["demo-water-supply"].deficiency?.needsConfirmation).toBe(
      true,
    );
    // Same-media capture without a new finding keeps the flag (still stale).
    state = reduceSession(state, { type: "reanalyze", itemId: "demo-water-supply" }, T1);
    expect(state.items["demo-water-supply"].deficiency?.needsConfirmation).toBe(
      true,
    );
    // Re-recording re-binds to the current photo and clears the flag.
    state = reduceSession(
      state,
      {
        type: "record-deficiency",
        itemId: "demo-water-supply",
        issueDescription: "Still drips after retake.",
        correctiveAction: "Recheck after maintenance visit.",
        recordedAt: T2,
      },
      T2,
    );
    expect(state.items["demo-water-supply"].deficiency?.mediaId).toBe("media-2");
    expect(state.items["demo-water-supply"].deficiency?.needsConfirmation).toBe(
      false,
    );
  });

  it("reanalysis preserves the finding as-is without inventing staleness", () => {
    let state = recordDeficiency(capturedState(), { recordedAt: T1 });
    const before = state.items["demo-water-supply"].deficiency;
    state = reduceSession(state, { type: "reanalyze", itemId: "demo-water-supply" }, T1);
    expect(state.items["demo-water-supply"].status).toBe("captured");
    expect(state.items["demo-water-supply"].deficiency).toEqual(before);
    expect(state.items["demo-water-supply"].deficiency?.needsConfirmation).toBe(
      false,
    );
  });

  it("delete clears the finding with the photo; a second clear is a no-op", () => {
    let state = recordDeficiency(capturedState(), { recordedAt: T1 });
    state = reduceSession(state, { type: "set-case-notes", notes: "Session draft." }, T1);
    state = reduceSession(state, { type: "delete-item-evidence", itemId: "demo-water-supply" }, T1);
    expect(state.items["demo-water-supply"].deficiency).toBeNull();
    expect(state.items["demo-water-supply"].deleted).toBe(true);
    // Session-level case notes survive item deletion.
    expect(state.caseNotes).toBe("Session draft.");

    // Clearing an already-cleared item changes nothing.
    const cleared = reduceSession(
      state,
      { type: "clear-deficiency", itemId: "demo-water-supply" },
      T2,
    );
    expect(cleared).toBe(state);
  });

  it("explicit clear removes the finding and is idempotent", () => {
    let state = recordDeficiency(draftState(), { recordedAt: T1 });
    state = reduceSession(
      state,
      { type: "clear-deficiency", itemId: "demo-water-supply" },
      T2,
    );
    expect(state.items["demo-water-supply"].deficiency).toBeNull();
    const again = reduceSession(
      state,
      { type: "clear-deficiency", itemId: "demo-water-supply" },
      T2,
    );
    expect(again).toBe(state);
  });

  it("survives a storage round-trip: JSON reload keeps finding and notes", () => {
    let state = recordDeficiency(draftState(), {
      responsibleParty: "Maintenance team",
      targetDate: "2026-11-04",
      recordedAt: T1,
    });
    state = reduceSession(state, { type: "set-case-notes", notes: "Occupant present; recheck tap." }, T1);
    const reloaded = JSON.parse(JSON.stringify(state)) as SessionState;
    expect(reloaded.items["demo-water-supply"].deficiency?.issueDescription).toBe(
      "Bathroom faucet drips continuously.",
    );
    expect(reloaded.items["demo-water-supply"].deficiency?.targetDate).toBe(
      "2026-11-04",
    );
    expect(reloaded.caseNotes).toBe("Occupant present; recheck tap.");
    // The reloaded row still builds the same export sections.
    const snapshot = buildExportSnapshot(inputFor(reloaded));
    expect(snapshot.deficiencies.length).toBe(1);
    expect(snapshot.caseNotes).toBe("Occupant present; recheck tap.");
  });

  it("migrates legacy rows without deficiency/case-notes instead of resetting", () => {
    const modern = capturedState();
    const { deficiency: removedDeficiency, ...supplyRest } =
      modern.items["demo-water-supply"];
    expect(removedDeficiency).toBeNull();
    const legacy = {
      ...modern,
      caseNotes: undefined,
      items: {
        ...modern.items,
        "demo-water-supply": supplyRest,
      },
    } as unknown as SessionState;
    expect("deficiency" in legacy.items["demo-water-supply"]).toBe(false);
    const migrated = ensureSessionShape(legacy);
    expect(migrated).not.toBe(legacy);
    expect(migrated.caseNotes).toBeNull();
    expect(migrated.items["demo-water-supply"].deficiency).toBeNull();
    // Already-current rows return the same reference (no spurious migration).
    expect(ensureSessionShape(migrated)).toBe(migrated);
    expect(ensureSessionShape(modern)).toBe(modern);
  });
});

describe("case-notes validation and lifecycle (REQ-008)", () => {
  it("enforces the 1–2000 character boundary", () => {
    expect(validateCaseNotes("").ok).toBe(false);
    expect(validateCaseNotes("   ").ok).toBe(false);
    expect(validateCaseNotes("x".repeat(2001)).ok).toBe(false);
    const exact = validateCaseNotes("x".repeat(2000));
    expect(exact.ok).toBe(true);
    const one = validateCaseNotes("a");
    expect(one.ok).toBe(true);
  });

  it("sets, replaces, and clears session notes; identical set is a no-op", () => {
    let state = capturedState();
    expect(state.caseNotes).toBeNull();
    state = reduceSession(state, { type: "set-case-notes", notes: "First draft." }, T1);
    expect(state.caseNotes).toBe("First draft.");
    const same = reduceSession(state, { type: "set-case-notes", notes: "First draft." }, T2);
    expect(same).toBe(state);
    state = reduceSession(state, { type: "set-case-notes", notes: "Second draft." }, T2);
    expect(state.caseNotes).toBe("Second draft.");
    state = reduceSession(state, { type: "clear-case-notes" }, T2);
    expect(state.caseNotes).toBeNull();
    const clearedAgain = reduceSession(state, { type: "clear-case-notes" }, T2);
    expect(clearedAgain).toBe(state);
  });

  it("rejects empty and overlong notes without touching existing notes", () => {
    const state = reduceSession(capturedState(), { type: "set-case-notes", notes: "Keep me." }, T1);
    const empty = reduceSession(state, { type: "set-case-notes", notes: "   " }, T2);
    expect(empty).toBe(state);
    const overlong = reduceSession(
      state,
      { type: "set-case-notes", notes: "y".repeat(2001) },
      T2,
    );
    expect(overlong).toBe(state);
    expect(state.caseNotes).toBe("Keep me.");
  });
});

describe("deficiency / case-notes export semantics (REQ-008, REQ-011)", () => {
  it("exports a worker finding for an unresolved item without any draft text", () => {
    const state = recordDeficiency(draftState(), { recordedAt: T1 });
    const snapshot = buildExportSnapshot(inputFor(state));
    const item = snapshot.items.find((i) => i.itemId === "demo-water-supply");
    expect(item?.completed).toBe(false);
    expect(item?.reviewedNote).toBeNull();
    expect(item?.visibleEvidence).toEqual([]);
    expect(item?.deficiency?.issueDescription).toBe(
      "Bathroom faucet drips continuously.",
    );
    expect(snapshot.deficiencies.length).toBe(1);
    expect(snapshot.deficiencies[0].itemId).toBe("demo-water-supply");
    // The unresolved item still lists as unresolved while carrying the finding.
    expect(snapshot.unresolved.some((u) => u.itemId === "demo-water-supply")).toBe(
      true,
    );
    const html = renderExportHtml(snapshot);
    expect(html).toContain("Bathroom faucet drips continuously.");
    expect(html).toContain("Worker deficiency list (1)");
    expect(html).toContain("Worker-recorded notes only — never approved findings");
    // Model draft text never leaks for the unresolved item.
    expect(html).not.toContain("sink basin");
  });

  it("keeps unresolved required checks separate from worker findings", () => {
    let state = recordDeficiency(draftState(), { recordedAt: T1 });
    state = reduceSession(state, { type: "accept", itemId: "demo-water-supply" }, T1);
    const snapshot = buildExportSnapshot(inputFor(state));
    // Accepted but the required physical test is still pending: unresolved.
    expect(snapshot.deficiencies.length).toBe(1);
    expect(
      snapshot.unresolvedChecks.some(
        (c) => c.itemId === "demo-water-supply" && c.checkId === REQUIRED_SUPPLY[0],
      ),
    ).toBe(true);
    const html = renderExportHtml(snapshot);
    expect(html).toContain("Worker deficiency list (1)");
    expect(html).toContain("Unresolved required checks (2)");
    expect(html).toContain("Missing evidence only — not worker findings");
    // A worker finding never resolves the physical test.
    const supply = snapshot.items.find((i) => i.itemId === "demo-water-supply");
    expect(supply?.completed).toBe(false);
    expect(canExportCompleted(snapshot)).toBe(false);
  });

  it("a declined check stays unresolved even with a finding on file", () => {
    let state = recordDeficiency(draftState(), { recordedAt: T1 });
    state = reduceSession(state, { type: "accept", itemId: "demo-water-supply" }, T1);
    state = reduceSession(
      state,
      {
        type: "record-manual-check",
        itemId: "demo-water-supply",
        checkId: REQUIRED_SUPPLY[0],
        outcome: "not-performed",
        note: "Tenant declined the run test.",
        recordedAt: T1,
        requiredCheckIds: REQUIRED_SUPPLY,
      },
      T1,
    );
    const snapshot = buildExportSnapshot(inputFor(state));
    expect(snapshot.deficiencies.length).toBe(1);
    expect(
      snapshot.unresolvedChecks.some((c) => c.checkId === REQUIRED_SUPPLY[0]),
    ).toBe(true);
    expect(snapshot.canClaimCompleted).toBe(false);
  });

  it("completed items export both the approved note and the worker finding", () => {
    let state = recordDeficiency(draftState(), {
      responsibleParty: "Maintenance team",
      targetDate: "2026-11-04",
      recordedAt: T1,
    });
    state = reduceSession(state, { type: "accept", itemId: "demo-water-supply" }, T1);
    state = reduceSession(
      state,
      {
        type: "record-manual-check",
        itemId: "demo-water-supply",
        checkId: REQUIRED_SUPPLY[0],
        outcome: "performed",
        note: "Ran both taps; basin drained.",
        recordedAt: T1,
        requiredCheckIds: REQUIRED_SUPPLY,
      },
      T1,
    );
    // Second item stays untouched so completion is still blocked (1 of 2).
    const snapshot = buildExportSnapshot(inputFor(state));
    const supply = snapshot.items.find((i) => i.itemId === "demo-water-supply");
    expect(supply?.reviewedNote).toContain("sink");
    expect(supply?.deficiency?.responsibleParty).toBe("Maintenance team");
    expect(htmlContainsAll(renderExportHtml(snapshot), [
      "Reviewed note (worker-approved)",
      "Worker deficiency (worker-recorded, unreviewed)",
      "Responsible party: Maintenance team",
      "Target date: 2026-11-04",
    ])).toBe(true);
  });

  it("delete clears the finding from every export section", () => {
    let state = recordDeficiency(draftState(), { recordedAt: T1 });
    state = reduceSession(
      state,
      { type: "delete-item-evidence", itemId: "demo-water-supply" },
      T1,
    );
    const snapshot = buildExportSnapshot(inputFor(state));
    expect(snapshot.deficiencies).toEqual([]);
    expect(
      snapshot.items.find((i) => i.itemId === "demo-water-supply")?.deficiency,
    ).toBeNull();
    expect(renderExportHtml(snapshot)).toContain("No worker deficiencies recorded.");
  });

  it("surfaces the re-confirmation flag in snapshot and printable HTML", () => {
    let state = recordDeficiency(capturedState(), { recordedAt: T1 });
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
    const snapshot = buildExportSnapshot(inputFor(state));
    expect(snapshot.deficiencies[0].deficiency.needsConfirmation).toBe(true);
    const html = renderExportHtml(snapshot);
    expect(html).toContain("must re-confirm");
    expect(html).toContain("photo changed since recorded");
  });

  it("exports session case notes as an unreviewed worker draft, escaped", () => {
    let state = recordDeficiency(draftState(), { recordedAt: T1 });
    state = reduceSession(
      state,
      { type: "set-case-notes", notes: "Occupant present; <b>recheck</b> & follow up." },
      T1,
    );
    const snapshot = buildExportSnapshot(inputFor(state));
    expect(snapshot.caseNotes).toBe("Occupant present; <b>recheck</b> & follow up.");
    const html = renderExportHtml(snapshot);
    expect(html).toContain("Session case notes (worker draft — unreviewed)");
    expect(html).toContain("Occupant present; &lt;b&gt;recheck&lt;/b&gt; &amp; follow up.");
    expect(html).toContain("Unreviewed worker draft — not an approved record");
    expect(html).not.toContain("<b>recheck</b>");
  });

  it("renders an explicit empty state when no case notes exist", () => {
    const snapshot = buildExportSnapshot(inputFor(draftState()));
    expect(snapshot.caseNotes).toBeNull();
    expect(renderExportHtml(snapshot)).toContain("No session case notes recorded.");
  });

  it("escapes hostile finding and notes text; the packet makes no remote requests", () => {
    let state = capturedState();
    state = reduceSession(
      state,
      {
        type: "record-deficiency",
        itemId: "demo-water-supply",
        issueDescription: "<script>alert('xss')</script> Drips & leaks.",
        correctiveAction: 'Fix <img src=x onerror=alert(1)> "now".',
        responsibleParty: "<b>owner</b>",
        recordedAt: T1,
      },
      T1,
    );
    state = reduceSession(
      state,
      { type: "set-case-notes", notes: "<script>alert('notes')</script> & done." },
      T1,
    );
    const snapshot = buildExportSnapshot(inputFor(state));
    const html = renderExportHtml(snapshot);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert");
    expect(html).toContain("Drips &amp; leaks.");
    expect(html).toContain("&lt;b&gt;owner&lt;/b&gt;");
    expect(html).not.toContain('src="http');
    expect(html).not.toContain("src='http");
    expect(html).not.toContain('src="blob:');
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain(EXPORT_REVIEW_BANNER);
  });

  it("freezes findings and notes: later edits cannot change built content", () => {
    let state = recordDeficiency(draftState(), { recordedAt: T1 });
    state = reduceSession(state, { type: "set-case-notes", notes: "Original notes." }, T1);
    const snapshot = buildExportSnapshot(inputFor(state));
    expect(snapshot.deficiencies[0].deficiency.issueDescription).toBe(
      "Bathroom faucet drips continuously.",
    );
    // Later worker actions change live state but not the frozen packet.
    state = reduceSession(
      state,
      {
        type: "record-deficiency",
        itemId: "demo-water-supply",
        issueDescription: "Edited after export.",
        correctiveAction: "New action.",
        recordedAt: T2,
      },
      T2,
    );
    state = reduceSession(state, { type: "set-case-notes", notes: "Edited notes." }, T2);
    state = reduceSession(state, { type: "clear-deficiency", itemId: "demo-water-supply" }, T2);
    expect(snapshot.deficiencies[0].deficiency.issueDescription).toBe(
      "Bathroom faucet drips continuously.",
    );
    expect(snapshot.caseNotes).toBe("Original notes.");
    expect(state.caseNotes).toBe("Edited notes.");
  });

  it("building the packet never mutates review state", () => {
    const state = recordDeficiency(draftState(), { recordedAt: T1 });
    const withNotes = reduceSession(
      state,
      { type: "set-case-notes", notes: "Draft notes." },
      T1,
    );
    const before = JSON.stringify(withNotes);
    buildExportSnapshot(inputFor(withNotes));
    expect(JSON.stringify(withNotes)).toBe(before);
  });

  it("uses different media bytes per item without cross-attachment", () => {
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
    state = reduceSession(
      state,
      {
        type: "capture-media",
        itemId: "demo-interior-air",
        mediaId: "media-2",
        mediaHash: HASH_C,
        capturedAt: T0,
      },
      T0,
    );
    state = reduceSession(
      state,
      {
        type: "record-deficiency",
        itemId: "demo-water-supply",
        issueDescription: "Supply issue.",
        correctiveAction: "Supply action.",
        recordedAt: T1,
      },
      T1,
    );
    state = reduceSession(
      state,
      {
        type: "record-deficiency",
        itemId: "demo-interior-air",
        issueDescription: "Air issue.",
        correctiveAction: "Air action.",
        recordedAt: T1,
      },
      T1,
    );
    const snapshot = buildExportSnapshot(
      inputFor(state, {
        mediaById: {
          "media-1": { bytes: fakePng(), mime: "image/png" },
          "media-2": { bytes: new Uint8Array([1, 2, 3, 4]), mime: "image/jpeg" },
        },
      }),
    );
    expect(snapshot.deficiencies.length).toBe(2);
    const supply = snapshot.deficiencies.find((d) => d.itemId === "demo-water-supply");
    const air = snapshot.deficiencies.find((d) => d.itemId === "demo-interior-air");
    expect(supply?.deficiency.mediaId).toBe("media-1");
    expect(air?.deficiency.mediaId).toBe("media-2");
    expect(supply?.deficiency.issueDescription).toBe("Supply issue.");
    expect(air?.deficiency.issueDescription).toBe("Air issue.");
  });
});

function htmlContainsAll(html: string, needles: string[]): boolean {
  return needles.every((needle) => html.includes(needle));
}
