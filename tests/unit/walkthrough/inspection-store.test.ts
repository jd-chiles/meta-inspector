import { afterEach, describe, expect, it, vi } from "vitest";

const { openDBMock } = vi.hoisted(() => ({ openDBMock: vi.fn() }));

vi.mock("idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb")>();
  return { ...actual, openDB: openDBMock as typeof actual.openDB };
});

import {
  createInitialInspectionRecord,
  createInspectionStore,
  INSPECTION_MEMORY_ONLY_WARNING,
  validateInspectionRecord,
} from "../../../src/features/walkthrough/inspection-store";
import { MOVE_IN_READY_SCHEMA_VERSION, type EvidenceReference, type VideoAnalysisIdentity } from "../../../src/domain/move-in-ready";

const NOW = "2026-10-29T09:15:00.000Z";
const EVIDENCE: EvidenceReference = {
  schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
  catalogVersion: "0.3.0-demo.3",
  videoId: "video-kitchen-1",
  videoRevision: 1,
  roomId: "kitchen",
  stillId: "still-kitchen-12s",
  timestampMs: 12_000,
  frameIndex: null,
  stillHash: "a".repeat(64),
};
const MODEL_EVIDENCE: EvidenceReference = { ...EVIDENCE, frameIndex: 240 };
const ANALYSIS_IDENTITY: VideoAnalysisIdentity = {
  sessionId: "session-1",
  roomId: "kitchen",
  schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
  videoId: EVIDENCE.videoId,
  videoRevision: EVIDENCE.videoRevision,
  expectedSourceHash: "b".repeat(64),
  analysisId: "analysis-1",
  attempt: 1,
  catalogVersion: "0.3.0-demo.3",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function recordWithEvidence() {
  const record = createInitialInspectionRecord("session-1", NOW);
  record.fundingType = "lahsa";
  record.pseudonym = "Mock Unit 04";
  record.evaluatorName = "Alex Morgan";
  record.clipIdentities.kitchen = {
    roomId: "kitchen",
    schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
    catalogVersion: "0.3.0-demo.3",
    videoId: EVIDENCE.videoId,
    videoRevision: EVIDENCE.videoRevision,
    videoHash: "b".repeat(64),
    capturedAt: NOW,
    durationSeconds: 20,
    sizeBytes: 1024,
    evidence: [{ ...EVIDENCE }],
  };
  record.proposals["demo-water-supply"] = {
    elementId: "demo-water-supply",
    state: "draft-proposal",
    modelSuggestion: "A",
    observation: "A mock-unit sink and faucet are visible.",
    confidence: 78,
    evidence: [{ ...MODEL_EVIDENCE }],
    analysisIdentity: { ...ANALYSIS_IDENTITY },
  };
  record.decisions["demo-water-supply"] = {
    status: "A",
    evaluatorName: "Alex Morgan",
    decidedAt: NOW,
    inPersonCheckAcknowledgment: { evaluatorName: "Alex Morgan", completedAt: NOW },
    rationale: "I checked the mock-unit water supply in person.",
    evidence: [{ ...MODEL_EVIDENCE }],
    analysisIdentity: { ...ANALYSIS_IDENTITY },
  };
  return record;
}

describe("local inspection record validation", () => {
  it("uses bounded per-store memory for get, put, and delete when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const store = createInspectionStore();
    expect(store.isMemoryOnly()).toBe(true);
    expect(INSPECTION_MEMORY_ONLY_WARNING).toContain("memory only");
    expect(INSPECTION_MEMORY_ONLY_WARNING).toContain("reload");

    const record = createInitialInspectionRecord("memory-session-1", NOW);
    await store.put(record);
    expect(await store.get(record.sessionId)).toEqual(record);

    const separateStore = createInspectionStore();
    expect(separateStore.isMemoryOnly()).toBe(true);
    expect(await separateStore.get(record.sessionId)).toBeNull();

    await store.delete(record.sessionId);
    expect(await store.get(record.sessionId)).toBeNull();
    store.close();
    separateStore.close();
  });

  it("enforces the inspection count bound in memory-only mode", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const store = createInspectionStore();
    for (let index = 0; index < 20; index += 1) {
      await store.put(createInitialInspectionRecord(`memory-session-${index}`, NOW));
    }
    await expect(store.put(createInitialInspectionRecord("memory-session-overflow", NOW)))
      .rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(await store.get("memory-session-0")).not.toBeNull();
  });

  it("preserves the active inspection in bounded memory after an IndexedDB quota failure", async () => {
    vi.stubGlobal("indexedDB", {});
    openDBMock.mockReset();
    openDBMock.mockResolvedValue({
      put: vi.fn().mockRejectedValue(Object.assign(new Error("Storage quota is exhausted."), { name: "QuotaExceededError" })),
      close: vi.fn(),
    });
    const store = createInspectionStore();
    const record = createInitialInspectionRecord("quota-session", NOW);
    record.pseudonym = "Mock Unit 04";

    await store.put(record);

    expect(store.isMemoryOnly()).toBe(true);
    expect(INSPECTION_MEMORY_ONLY_WARNING).toContain("memory only");
    expect(INSPECTION_MEMORY_ONLY_WARNING).toContain("reload");
    expect(await store.get(record.sessionId)).toMatchObject({ pseudonym: "Mock Unit 04" });

    const updated = { ...record, pseudonym: "Mock Unit 05" };
    await store.put(updated);
    expect(await store.get(record.sessionId)).toMatchObject({ pseudonym: "Mock Unit 05" });
    store.close();
  });

  it("removes the stale persistent row after an IndexedDB quota failure switches the store to memory", async () => {
    vi.stubGlobal("indexedDB", {});
    openDBMock.mockReset();
    const saved = createInitialInspectionRecord("quota-delete-session", NOW);
    const rows = new Map([[saved.sessionId, saved]]);
    const database = {
      get: vi.fn(async (_store: string, key: string) => rows.get(key)),
      put: vi.fn().mockRejectedValue(Object.assign(new Error("Storage quota is exhausted."), { name: "QuotaExceededError" })),
      delete: vi.fn(async (_store: string, key: string) => { rows.delete(key); }),
      close: vi.fn(),
    };
    openDBMock.mockResolvedValue(database);
    const store = createInspectionStore();

    expect(await store.get(saved.sessionId)).toEqual(saved);
    const replacement = { ...saved, pseudonym: "Updated Mock Unit" };
    await store.put(replacement);
    expect(store.isMemoryOnly()).toBe(true);
    expect(await store.get(saved.sessionId)).toMatchObject({ pseudonym: "Updated Mock Unit" });

    await store.delete(saved.sessionId);
    expect(database.delete).toHaveBeenCalledWith("inspections", saved.sessionId);
    expect(rows.has(saved.sessionId)).toBe(false);
    expect(await store.get(saved.sessionId)).toBeNull();
    store.close();
  });

  it("does not claim deletion when IndexedDB could not be opened to check persistent data", async () => {
    vi.stubGlobal("indexedDB", {});
    openDBMock.mockReset();
    openDBMock.mockRejectedValue(Object.assign(new Error("Storage access is denied."), { name: "SecurityError" }));
    const store = createInspectionStore();
    const record = createInitialInspectionRecord("denied-delete-session", NOW);

    await expect(store.get(record.sessionId)).resolves.toBeNull();
    await store.put(record);
    await expect(store.delete(record.sessionId)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringContaining("removal from this device could not be confirmed"),
    });
    expect(await store.get(record.sessionId)).toEqual(record);
    store.close();
  });

  it("releases memory-only inspection records when the store closes", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const store = createInspectionStore();
    const record = createInitialInspectionRecord("closed-memory-session", NOW);
    await store.put(record);

    store.close();

    expect(await store.get(record.sessionId)).toBeNull();
  });

  it("preserves a valid clip identity, human decision, and evidence-backed proposal", () => {
    const result = validateInspectionRecord(recordWithEvidence(), "session-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.decisions["demo-water-supply"].status).toBe("A");
      expect(result.record.proposals["demo-water-supply"]?.evidence).toEqual([MODEL_EVIDENCE]);
      expect(result.record.proposals["demo-water-supply"]?.analysisIdentity).toEqual(ANALYSIS_IDENTITY);
      expect(result.record.decisions["demo-water-supply"]).toMatchObject({ analysisIdentity: ANALYSIS_IDENTITY });
    }
  });

  it("persists the AI correction plan separately from the evaluator decision", () => {
    const record = recordWithEvidence();
    record.proposals["demo-water-supply"] = {
      elementId: "demo-water-supply",
      state: "draft-proposal",
      modelSuggestion: "D",
      observation: "The drain fitting looks loose.",
      confidence: 81,
      evidence: [MODEL_EVIDENCE],
      analysisIdentity: ANALYSIS_IDENTITY,
      deficiencySuggestion: {
        deficientArea: "Kitchen sink drain",
        correction: "Secure the fitting and verify drainage.",
        completionDate: "2026-11-12",
        reinspectionDate: "2026-11-15",
      },
    };

    const result = validateInspectionRecord(record, "session-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.proposals["demo-water-supply"]?.deficiencySuggestion?.deficientArea).toBe("Kitchen sink drain");
      expect(result.record.decisions["demo-water-supply"]).toMatchObject({ status: "A", rationale: "I checked the mock-unit water supply in person." });
    }
  });

  it("normalizes the earlier schema-1 record without an evaluator name", () => {
    const oldRecord = createInitialInspectionRecord("session-1", NOW) as unknown as Record<string, unknown>;
    delete oldRecord.evaluatorName;
    const result = validateInspectionRecord(oldRecord, "session-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record.evaluatorName).toBe("");
  });

  it("persists room prompt completion independently from proposals and evaluator decisions", () => {
    const record = recordWithEvidence();
    record.completedPromptIdsByRoom.kitchen = ["kitchen-walkthrough"];

    const result = validateInspectionRecord(record, "session-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.completedPromptIdsByRoom.kitchen).toEqual([
        "kitchen-walkthrough",
      ]);
      expect(result.record.proposals["demo-water-supply"]?.modelSuggestion).toBe("A");
      expect(result.record.decisions["demo-water-supply"]).toMatchObject({ status: "A" });
    }
  });

  it("normalizes earlier schema-1 records without room prompt completion", () => {
    const oldRecord = createInitialInspectionRecord("session-1", NOW) as unknown as Record<string, unknown>;
    delete oldRecord.completedPromptIdsByRoom;

    const result = validateInspectionRecord(oldRecord, "session-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record.completedPromptIdsByRoom).toEqual({});
  });

  it("migrates schema-1 intake, prompt completion, and clips while invalidating unprovable review state", () => {
    const oldRecord = recordWithEvidence() as unknown as Record<string, unknown>;
    oldRecord.schemaVersion = 1;
    oldRecord.completedPromptIdsByRoom = { kitchen: ["kitchen-walkthrough"] };
    oldRecord.signoff = {
      evaluatorName: "Alex Morgan",
      typedSignature: "Alex Morgan",
      attested: true,
      signedAt: NOW,
    };
    delete oldRecord.pendingAnalysisIntent;
    const oldClipIdentities = oldRecord.clipIdentities as Record<string, Record<string, unknown>>;
    oldClipIdentities.kitchen!.evidence = [
      { videoId: EVIDENCE.videoId, videoRevision: 1, roomId: "kitchen", stillId: EVIDENCE.stillId, timestampMs: 12_000, stillHash: EVIDENCE.stillHash },
    ];

    const result = validateInspectionRecord(oldRecord, "session-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.schemaVersion).toBe(MOVE_IN_READY_SCHEMA_VERSION);
    expect(result.record.pseudonym).toBe("Mock Unit 04");
    expect(result.record.completedPromptIdsByRoom.kitchen).toEqual(["kitchen-walkthrough"]);
    expect(result.record.clipIdentities.kitchen?.videoHash).toBe("b".repeat(64));
    expect(result.record.clipIdentities.kitchen?.evidence[0]?.frameIndex).toBeNull();
    expect(result.record.proposals).toEqual({});
    expect(result.record.decisions["demo-water-supply"].status).toBe("unreviewed");
    expect(result.record.signoff).toBeNull();
    expect(result.record.pendingAnalysisIntent).toBeNull();
  });

  it("fails closed on prior-schema analysis proposals and decisions while preserving source clips", () => {
    const priorRecord = recordWithEvidence() as unknown as Record<string, unknown>;
    priorRecord.schemaVersion = 2;
    delete priorRecord.catalogVersion;
    const oldClip = (priorRecord.clipIdentities as Record<string, Record<string, unknown>>).kitchen!;
    delete oldClip.schemaVersion;
    delete oldClip.catalogVersion;
    for (const evidence of oldClip.evidence as Record<string, unknown>[]) {
      delete evidence.schemaVersion;
      delete evidence.catalogVersion;
    }
    const oldProposal = (priorRecord.proposals as Record<string, Record<string, unknown>>)["demo-water-supply"]!;
    const oldAnalysisIdentity = oldProposal.analysisIdentity as Record<string, unknown>;
    delete oldAnalysisIdentity.schemaVersion;
    const oldModelEvidence = (oldProposal.evidence as Record<string, unknown>[])[0]!;
    delete oldModelEvidence.schemaVersion;
    delete oldModelEvidence.catalogVersion;
    const priorDecisions = priorRecord.decisions as Record<string, Record<string, unknown>>;
    delete priorDecisions["demo-water-supply"]!.inPersonCheckAcknowledgment;
    priorDecisions["demo-item-05"] = {
      status: "D",
      evaluatorName: "Alex Morgan",
      decidedAt: NOW,
      rationale: "The kitchen surface is damaged.",
      evidence: [MODEL_EVIDENCE],
      analysisIdentity: null,
      deficiency: {
        issueDescription: "The kitchen surface is damaged.",
        correction: "Replace the damaged surface.",
        completionDate: "2026-11-12",
        reinspectionDate: "2026-11-15",
      },
    };
    const priorClip = (priorRecord.clipIdentities as Record<string, unknown>).kitchen;
    priorRecord.signoff = {
      evaluatorName: "Alex Morgan",
      typedSignature: "Alex Morgan",
      attested: true,
      signedAt: NOW,
    };

    const result = validateInspectionRecord(priorRecord, "session-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.record.schemaVersion).toBe(MOVE_IN_READY_SCHEMA_VERSION);
    expect(result.record.decisions["demo-water-supply"]).toEqual({ status: "unreviewed" });
    expect(result.record.decisions["demo-item-05"]).toEqual({ status: "unreviewed" });
    expect(result.record.clipIdentities.kitchen?.videoHash).toBe((priorClip as Record<string, unknown>).videoHash);
    expect(result.record.proposals).toEqual({});
    expect(result.record.decisions).toEqual(createInitialInspectionRecord("session-1", NOW).decisions);
    expect(result.record.signoff).toBeNull();
  });

  it("migrates schema-3 form fields and reopens Fire Safety until sections 11a and 11b are assessed", () => {
    const priorRecord = recordWithEvidence() as unknown as Record<string, unknown>;
    priorRecord.schemaVersion = 3;
    delete priorRecord.catalogVersion;
    const oldClip = (priorRecord.clipIdentities as Record<string, Record<string, unknown>>).kitchen!;
    delete oldClip.schemaVersion;
    delete oldClip.catalogVersion;
    for (const evidence of oldClip.evidence as Record<string, unknown>[]) {
      delete evidence.schemaVersion;
      delete evidence.catalogVersion;
    }
    const priorProposal = (priorRecord.proposals as Record<string, Record<string, unknown>>)["demo-water-supply"]!;
    delete (priorProposal.analysisIdentity as Record<string, unknown>).schemaVersion;
    for (const evidence of priorProposal.evidence as Record<string, unknown>[]) {
      delete evidence.schemaVersion;
      delete evidence.catalogVersion;
    }
    (priorRecord.decisions as Record<string, unknown>)["demo-smoke-co"] = {
      status: "A",
      evaluatorName: "Alex Morgan",
      decidedAt: NOW,
      inPersonCheckAcknowledgment: { evaluatorName: "Alex Morgan", completedAt: NOW },
      rationale: "I checked the detectors in person.",
      evidence: [],
      analysisIdentity: null,
    };
    priorRecord.signoff = {
      evaluatorName: "Alex Morgan",
      typedSignature: "Alex Morgan",
      attested: true,
      signedAt: NOW,
    };
    delete priorRecord.evaluatorAgencyName;
    delete priorRecord.landlordDiscussion;
    delete priorRecord.landlordDiscussionDate;
    delete priorRecord.leadershipNameAndTitle;
    delete priorRecord.leadershipSignedAt;

    const result = validateInspectionRecord(priorRecord, "session-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.schemaVersion).toBe(MOVE_IN_READY_SCHEMA_VERSION);
    expect(result.record.decisions["demo-water-supply"].status).toBe("unreviewed");
    expect(result.record.decisions["demo-smoke-co"].status).toBe("unreviewed");
    expect(result.record.proposals).toEqual({});
    expect(result.record.clipIdentities.kitchen?.videoHash).toBe("b".repeat(64));
    expect(result.record.evaluatorAgencyName).toBe("");
    expect(result.record.landlordDiscussion).toBe("");
    expect(result.record.leadershipNameAndTitle).toBe("");
    expect(result.record.signoff).toBeNull();
  });

  it("resets acknowledgment-less decisions to unreviewed during acknowledgment migration while retaining clips and proposals", () => {
    const legacyRecord = recordWithEvidence() as unknown as Record<string, unknown>;
    // Schema 2 introduced the in-person acknowledgment requirement. Versions are
    // current throughout, so only the acknowledgment migration applies here —
    // the stale-version wipe (which clears proposals) must not trigger.
    legacyRecord.schemaVersion = 2;
    const legacyDecisions = legacyRecord.decisions as Record<string, Record<string, unknown>>;
    delete legacyDecisions["demo-water-supply"]!.inPersonCheckAcknowledgment;
    legacyRecord.signoff = {
      evaluatorName: "Alex Morgan",
      typedSignature: "Alex Morgan",
      attested: true,
      signedAt: NOW,
    };
    const beforeProposal = (legacyRecord.proposals as Record<string, unknown>)["demo-water-supply"];

    const result = validateInspectionRecord(legacyRecord, "session-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.schemaVersion).toBe(MOVE_IN_READY_SCHEMA_VERSION);
    expect(result.record.decisions["demo-water-supply"]).toEqual({ status: "unreviewed" });
    expect(result.record.signoff).toBeNull();
    expect(result.record.proposals["demo-water-supply"]).toEqual(beforeProposal);
    expect(result.record.clipIdentities.kitchen?.videoHash).toBe("b".repeat(64));
  });

  it("defaults older schema-4 inspection notes and bounds new local notes", () => {
    const priorRecord = createInitialInspectionRecord("session-1", NOW) as unknown as Record<string, unknown>;
    priorRecord.schemaVersion = 4;
    delete priorRecord.catalogVersion;
    delete priorRecord.inspectionNote;

    const migrated = validateInspectionRecord(priorRecord, "session-1");
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.record.inspectionNote).toBe("");

    expect(validateInspectionRecord({ ...priorRecord, inspectionNote: "x".repeat(2001) }, "session-1").ok).toBe(false);
    expect(validateInspectionRecord({ ...priorRecord, inspectionNote: "A short staged-unit note." }, "session-1").ok).toBe(true);
  });

  it("rejects duplicate prompt completion and prompt IDs from another room", () => {
    const duplicate = createInitialInspectionRecord("session-1", NOW);
    duplicate.completedPromptIdsByRoom.kitchen = ["kitchen-walkthrough", "kitchen-walkthrough"];
    expect(validateInspectionRecord(duplicate, "session-1").ok).toBe(false);

    const wrongRoom = createInitialInspectionRecord("session-1", NOW);
    wrongRoom.completedPromptIdsByRoom.kitchen = ["bathroom-walkthrough"];
    expect(validateInspectionRecord(wrongRoom, "session-1").ok).toBe(false);
  });

  it("rejects evidence whose clip revision or room differs from its stored identity", () => {
    const record = recordWithEvidence();
    record.clipIdentities.kitchen!.videoRevision = 2;
    const result = validateInspectionRecord(record, "session-1");
    expect(result.ok).toBe(false);
  });

  it("accepts the bounded room still set used for manual evidence selection", () => {
    const record = recordWithEvidence();
    record.clipIdentities.kitchen!.evidence = Array.from({ length: 30 }, (_, index) =>
      index === 24 ? EVIDENCE : {
        ...EVIDENCE,
        stillId: `still-kitchen-${index}`,
        timestampMs: index * 500,
      });
    expect(validateInspectionRecord(record, "session-1").ok).toBe(true);
    record.clipIdentities.kitchen!.evidence.push({
      ...EVIDENCE,
      stillId: "still-kitchen-30",
      timestampMs: 15_000,
    });
    expect(validateInspectionRecord(record, "session-1").ok).toBe(false);
  });

  it("rejects a decision that points to a still absent from the current clip identity", () => {
    const record = recordWithEvidence();
    record.clipIdentities.kitchen!.evidence = [];
    const result = validateInspectionRecord(record, "session-1");
    expect(result.ok).toBe(false);
  });

  it("rejects analysis identities that differ from the current clip or reviewed proposal", () => {
    const staleClip = recordWithEvidence();
    staleClip.proposals["demo-water-supply"]!.analysisIdentity = {
      ...ANALYSIS_IDENTITY,
      expectedSourceHash: "c".repeat(64),
    };
    expect(validateInspectionRecord(staleClip, "session-1").ok).toBe(false);

    const staleReview = recordWithEvidence();
    staleReview.decisions["demo-water-supply"] = {
      ...staleReview.decisions["demo-water-supply"]!,
      analysisIdentity: { ...ANALYSIS_IDENTITY, attempt: 2 },
    } as typeof staleReview.decisions["demo-water-supply"];
    expect(validateInspectionRecord(staleReview, "session-1").ok).toBe(false);
  });

  it("validates that pending analysis intent names the current room clip", () => {
    const record = recordWithEvidence();
    record.pendingAnalysisIntent = {
      roomId: "kitchen",
      schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
      videoId: EVIDENCE.videoId,
      videoRevision: EVIDENCE.videoRevision,
      videoHash: "b".repeat(64),
      catalogVersion: "0.3.0-demo.3",
      requestedAt: NOW,
    };
    expect(validateInspectionRecord(record, "session-1").ok).toBe(true);

    record.pendingAnalysisIntent = { ...record.pendingAnalysisIntent, videoHash: "c".repeat(64) };
    expect(validateInspectionRecord(record, "session-1").ok).toBe(false);
  });

  it.each([
    ["schemaVersion", MOVE_IN_READY_SCHEMA_VERSION - 1],
    ["catalogVersion", "older-catalog"],
  ] as const)("invalidates persisted proposals, decisions, and queued work with stale %s", (versionKey, staleVersion) => {
    const record = recordWithEvidence();
    const staleIdentity: VideoAnalysisIdentity = versionKey === "schemaVersion"
      ? { ...ANALYSIS_IDENTITY, schemaVersion: staleVersion as number }
      : { ...ANALYSIS_IDENTITY, catalogVersion: staleVersion as string };
    record.proposals["demo-water-supply"]!.analysisIdentity = staleIdentity;
    record.decisions["demo-water-supply"] = {
      ...record.decisions["demo-water-supply"]!,
      analysisIdentity: staleIdentity,
    } as typeof record.decisions["demo-water-supply"];
    record.pendingAnalysisIntent = versionKey === "schemaVersion" ? {
      roomId: "kitchen",
      schemaVersion: staleVersion as number,
      videoId: EVIDENCE.videoId,
      videoRevision: EVIDENCE.videoRevision,
      videoHash: "b".repeat(64),
      catalogVersion: "0.3.0-demo.3",
      requestedAt: NOW,
    } : {
      roomId: "kitchen",
      schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
      videoId: EVIDENCE.videoId,
      videoRevision: EVIDENCE.videoRevision,
      videoHash: "b".repeat(64),
      catalogVersion: staleVersion as string,
      requestedAt: NOW,
    };
    record.signoff = {
      evaluatorName: "Alex Morgan",
      typedSignature: "Alex Morgan",
      attested: true,
      signedAt: NOW,
    };

    const result = validateInspectionRecord(record, "session-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.proposals).toEqual({});
    expect(result.record.decisions).toEqual(createInitialInspectionRecord("session-1", NOW).decisions);
    expect(result.record.pendingAnalysisIntent).toBeNull();
    expect(result.record.signoff).toBeNull();
    expect(result.record.clipIdentities.kitchen?.videoHash).toBe("b".repeat(64));
  });

  it("invalidates versioned review state when the stored top-level catalog changes while retaining clip evidence", () => {
    const record = recordWithEvidence();
    record.catalogVersion = "older-catalog";
    record.pendingAnalysisIntent = {
      roomId: "kitchen",
      schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
      videoId: EVIDENCE.videoId,
      videoRevision: EVIDENCE.videoRevision,
      videoHash: "b".repeat(64),
      catalogVersion: "older-catalog",
      requestedAt: NOW,
    };
    record.signoff = {
      evaluatorName: "Alex Morgan",
      typedSignature: "Alex Morgan",
      attested: true,
      signedAt: NOW,
    };

    const result = validateInspectionRecord(record, "session-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.catalogVersion).toBe("0.3.0-demo.3");
    expect(result.record.proposals).toEqual({});
    expect(result.record.decisions).toEqual(createInitialInspectionRecord("session-1", NOW).decisions);
    expect(result.record.pendingAnalysisIntent).toBeNull();
    expect(result.record.signoff).toBeNull();
    expect(result.record.clipIdentities.kitchen?.videoHash).toBe("b".repeat(64));
    expect(result.record.clipIdentities.kitchen?.evidence).toEqual([EVIDENCE]);
  });

  it("rejects out-of-range SAM frame indexes while allowing local null indexes", () => {
    const local = recordWithEvidence();
    local.clipIdentities.kitchen!.evidence[0]!.frameIndex = 15_000;
    expect(validateInspectionRecord(local, "session-1").ok).toBe(false);

    const proposal = recordWithEvidence();
    proposal.proposals["demo-water-supply"]!.evidence[0]!.frameIndex = 15_000;
    expect(validateInspectionRecord(proposal, "session-1").ok).toBe(false);
  });

  it("rejects a proposal with unsupported approval-like fields", () => {
    const record = recordWithEvidence();
    record.proposals["demo-water-supply"] = {
      ...record.proposals["demo-water-supply"]!,
      approved: true,
    } as unknown as typeof record.proposals["demo-water-supply"];
    const result = validateInspectionRecord(record, "session-1");
    expect(result.ok).toBe(false);
  });

  it("rejects proposals or decisions tied to an evaluator identity that changed", () => {
    const record = recordWithEvidence();
    record.evaluatorName = "Jordan Lee";
    const result = validateInspectionRecord(record, "session-1");
    expect(result.ok).toBe(false);
  });
});
