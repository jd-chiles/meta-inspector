import type { EvaluatorDecision, MoveInReadyElementId } from "../../domain/move-in-ready";

/**
 * Risk-ranked landlord fix list (Form 1083 order ignored on purpose).
 * Tier 1 is life and safety first; Tier 3 is condition.
 */
export interface FixListTier {
  tier: 1 | 2 | 3;
  label: string;
  elementIds: readonly MoveInReadyElementId[];
}

export const FIX_LIST_TIERS: readonly FixListTier[] = [
  {
    tier: 1,
    label: "Tier 1 · Life and safety",
    elementIds: ["demo-smoke-co", "demo-item-06", "demo-item-07", "demo-water-supply"],
  },
  {
    tier: 2,
    label: "Tier 2 · Health and function",
    elementIds: ["demo-interior-air", "demo-item-08", "demo-item-09", "demo-lighting-electric"],
  },
  {
    tier: 3,
    label: "Tier 3 · Condition",
    elementIds: ["demo-item-05", "demo-item-10", "demo-item-11"],
  },
];

export function fixListTier(elementId: MoveInReadyElementId): FixListTier {
  return FIX_LIST_TIERS.find((entry) => entry.elementIds.includes(elementId)) ?? FIX_LIST_TIERS[2]!;
}

export interface RankedDeficiency {
  elementId: MoveInReadyElementId;
  decision: Extract<EvaluatorDecision, { status: "D" }>;
  tier: 1 | 2 | 3;
  tierLabel: string;
}

/** D decisions only, risk-ranked, never in form order. */
export function rankDeficiencies(
  decisions: Partial<Record<MoveInReadyElementId, EvaluatorDecision>>,
): RankedDeficiency[] {
  const ranked: RankedDeficiency[] = [];
  for (const tier of FIX_LIST_TIERS) {
    for (const elementId of tier.elementIds) {
      const decision = decisions[elementId];
      if (decision?.status === "D") {
        ranked.push({ elementId, decision, tier: tier.tier, tierLabel: tier.label });
      }
    }
  }
  return ranked;
}

const REINSPECTION_CHECKLIST: Record<string, string> = {
  "demo-water-supply": "After the fix, re-film the faucet running for 5 seconds to close this item.",
  "demo-interior-air": "After the fix, re-film the fan spinning for 5 seconds to close this item.",
  "demo-item-07": "After the fix, re-film the door locking and unlocking to close this item.",
  "demo-smoke-co": "After the fix, re-film the detector test beep to close this item.",
  "demo-item-06": "After the fix, re-film the secondary exit unblocked to close this item.",
};

/** What to re-film or re-check before a D item can be closed. */
export function reinspectionChecklist(elementId: MoveInReadyElementId): string {
  return REINSPECTION_CHECKLIST[elementId] ??
    "After the fix, re-check in person and attach a new dated still to close this item.";
}
