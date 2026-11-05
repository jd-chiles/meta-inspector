import { describe, expect, it } from "vitest";
import {
  buildInspectionLocation,
  createUnreviewedEvaluatorDecisions,
  deriveFinalInspectionResult,
  roundCoordinate,
  validateInspectionLocation,
  type EvaluatorDecision,
  type MoveInReadyElementId,
} from "../../../src/domain/move-in-ready";
import {
  createInitialInspectionRecord,
  validateInspectionRecord,
} from "../../../src/features/walkthrough/inspection-store";

const NOW = "2026-11-01T00:00:00.000Z";
const EVALUATOR = "Rae Evaluator";

describe("inspection location coordinates (REQ-L3)", () => {
  it("rounds coordinates to 3 decimals (~100 m)", () => {
    expect(roundCoordinate(34.05223)).toBe(34.052);
    expect(roundCoordinate(-118.24368)).toBe(-118.244);
    expect(roundCoordinate(34)).toBe(34);
    expect(roundCoordinate(0.0004)).toBe(0);
  });

  it("never stores negative zero", () => {
    expect(Object.is(roundCoordinate(-0.0001), -0)).toBe(false);
    expect(roundCoordinate(-0.0001)).toBe(0);
  });

  it("builds a storable location with rounded coordinates", () => {
    expect(buildInspectionLocation({
      lat: 34.05223,
      lng: -118.24368,
      accuracyM: 12.5,
      capturedAt: NOW,
    })).toEqual({ lat: 34.052, lng: -118.244, accuracyM: 12.5, capturedAt: NOW });
  });

  it("nulls missing or invalid accuracy instead of storing it", () => {
    expect(buildInspectionLocation({ lat: 34, lng: -118, accuracyM: undefined, capturedAt: NOW }).accuracyM).toBeNull();
    expect(buildInspectionLocation({ lat: 34, lng: -118, accuracyM: -4, capturedAt: NOW }).accuracyM).toBeNull();
    expect(buildInspectionLocation({ lat: 34, lng: -118, accuracyM: Number.NaN, capturedAt: NOW }).accuracyM).toBeNull();
  });

  it("validates stored locations and rejects out-of-range or unknown fields", () => {
    const valid = { lat: 34.052, lng: -118.244, accuracyM: null, capturedAt: NOW };
    expect(validateInspectionLocation(valid).ok).toBe(true);
    expect(validateInspectionLocation({ ...valid, lat: 91 }).ok).toBe(false);
    expect(validateInspectionLocation({ ...valid, lng: 181 }).ok).toBe(false);
    expect(validateInspectionLocation({ ...valid, accuracyM: -1 }).ok).toBe(false);
    expect(validateInspectionLocation({ ...valid, capturedAt: "tomorrow" }).ok).toBe(false);
    expect(validateInspectionLocation({ ...valid, address: "123 Main" }).ok).toBe(false);
    expect(validateInspectionLocation(null).ok).toBe(false);
  });
});

describe("inspection location on the record (REQ-L3)", () => {
  it("starts null and defaults on legacy records", () => {
    expect(createInitialInspectionRecord("geo-1", NOW).inspectionLocation).toBeNull();
    const record = createInitialInspectionRecord("geo-2", NOW);
    const legacy = { ...record } as unknown as Record<string, unknown>;
    delete legacy.inspectionLocation;
    delete legacy.analysisQueue;
    const validated = validateInspectionRecord(legacy, "geo-2");
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.record.inspectionLocation).toBeNull();
  });

  it("round-trips a recorded location and rejects an invalid one", () => {
    const location = buildInspectionLocation({ lat: 34.05223, lng: -118.24368, accuracyM: 9, capturedAt: NOW });
    const record = { ...createInitialInspectionRecord("geo-3", NOW), inspectionLocation: location };
    const validated = validateInspectionRecord(record, "geo-3");
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.record.inspectionLocation).toEqual({ ...location, lat: 34.052, lng: -118.244 });

    const bad = { ...createInitialInspectionRecord("geo-4", NOW), inspectionLocation: { lat: 34, lng: -118 } };
    expect(validateInspectionRecord(bad as unknown as Record<string, unknown>, "geo-4").ok).toBe(false);
  });

  it("never blocks completion: identical verdicts with and without a location", () => {
    const decisions = createUnreviewedEvaluatorDecisions();
    for (const elementId of Object.keys(decisions) as MoveInReadyElementId[]) {
      const decision: EvaluatorDecision = {
        status: "A",
        evaluatorName: EVALUATOR,
        decidedAt: NOW,
        inPersonCheckAcknowledgment: { evaluatorName: EVALUATOR, completedAt: NOW },
        rationale: "Checked in person.",
        evidence: [],
        analysisIdentity: null,
        ...(elementId === "demo-smoke-co"
          ? { fireSafetyAssessment: { unitDetectors: "A", publicAreaDetectors: "A" } as const }
          : {}),
      };
      decisions[elementId] = decision;
    }
    const signoff = { evaluatorName: EVALUATOR, typedSignature: EVALUATOR, attested: true, signedAt: NOW };
    const input = {
      fundingType: "lahsa" as const,
      capturedRoomIds: ["kitchen"],
      expectedRoomIds: ["kitchen"],
      evaluatorDecisions: decisions,
      signoff,
    };
    // The location field is not an input to completion at all: the same
    // record completes whether a location was captured or denied.
    expect(deriveFinalInspectionResult(input)).toMatchObject({ status: "complete", result: "approved" });
    const withDeniedLocation = {
      ...createInitialInspectionRecord("geo-5", NOW),
      evaluatorName: EVALUATOR,
      decisions,
      signoff,
      inspectionLocation: null,
    };
    expect(validateInspectionRecord(withDeniedLocation, "geo-5").ok).toBe(true);
  });
});
