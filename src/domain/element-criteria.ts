import type { MoveInReadyElementId } from "./move-in-ready";

/**
 * Read-only reference criteria based on product-brief.pdf and the
 * owner-confirmed LAHSA Form 1083. These are not evaluator outcomes or
 * evidence that a physical test passed.
 */
export interface MoveInReadyElementCriteria {
  checklistItems: readonly [string, ...string[]];
}

export const MOVE_IN_READY_ELEMENT_CRITERIA = {
  "demo-item-05": {
    checklistItems: ["The building feels safe and structurally sound, with no indication that it may collapse."],
  },
  "demo-item-06": {
    checklistItems: ["Access is possible without entering another person’s private property.", "A usable fire-escape option is available other than the front door."],
  },
  "demo-item-07": {
    checklistItems: ["Each resident has adequate space and security for themselves and their belongings.", "Each resident has an acceptable place to sleep and doors that lock."],
  },
  "demo-interior-air": {
    checklistItems: ["Every room or space has natural or mechanical ventilation through windows, a fan, or air conditioning.", "Operate the fan or air conditioning to confirm it works."],
  },
  "demo-water-supply": {
    checklistItems: ["Water supply is free from contamination.", "Operate all faucets and confirm the water is working, hot, and clear."],
  },
  "demo-item-08": {
    checklistItems: ["Sufficient sanitary facilities are in proper working condition, usable in privacy, and adequate for personal cleanliness.", "Include shared-space sanitary facilities in the in-person check."],
  },
  "demo-item-09": {
    checklistItems: ["Adequate heating or cooling facilities are in proper operating condition.", "Operate the available heating or cooling equipment to confirm it works."],
  },
  "demo-lighting-electric": {
    checklistItems: ["Natural or artificial light supports normal indoor activities and health and safety.", "There are enough safe electrical outlets for essential appliances without creating a fire hazard."],
  },
  "demo-item-10": {
    checklistItems: ["Food-preparation areas have suitable space and equipment to store, prepare, and serve food sanitarily.", "Inspect shared food-preparation space and confirm suitable refuse disposal."],
  },
  "demo-item-11": {
    checklistItems: ["The housing and its equipment are maintained in sanitary condition."],
  },
  "demo-smoke-co": {
    checklistItems: [
      "11a · Unit: working smoke and carbon monoxide detectors on every occupied unit level; smoke detectors in a hallway adjacent to a bedroom where practicable; the Form 1083 alarm provision where applicable, without recording health details.",
      "11b · Public/common areas: sufficient smoke detectors, with at least one in each area, including shared laundry rooms, hallways, and stairwells.",
    ],
  },
} as const satisfies Record<MoveInReadyElementId, MoveInReadyElementCriteria>;
