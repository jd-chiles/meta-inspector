import { describe, expect, it } from "vitest";

import {
  MOVE_IN_READY_ELEMENTS,
  MOVE_IN_READY_ELEMENT_IDS,
} from "../../../src/domain/move-in-ready";
import { MOVE_IN_READY_ELEMENT_CRITERIA } from "../../../src/domain/element-criteria";

describe("Move-in Ready video criteria reference", () => {
  it("provides displayable checklist criteria for each stable element", () => {
    expect(Object.keys(MOVE_IN_READY_ELEMENT_CRITERIA)).toEqual(MOVE_IN_READY_ELEMENT_IDS);
    expect(MOVE_IN_READY_ELEMENTS.map(({ id }) => id)).toEqual(MOVE_IN_READY_ELEMENT_IDS);
    expect(Object.values(MOVE_IN_READY_ELEMENT_CRITERIA).every(({ checklistItems }) => checklistItems.length > 0)).toBe(true);
    expect(Object.values(MOVE_IN_READY_ELEMENT_CRITERIA).flatMap(({ checklistItems }) => checklistItems)).toEqual([
      "The building feels safe and structurally sound, with no indication that it may collapse.",
      "Access is possible without entering another person’s private property.",
      "A usable fire-escape option is available other than the front door.",
      "Each resident has adequate space and security for themselves and their belongings.",
      "Each resident has an acceptable place to sleep and doors that lock.",
      "Every room or space has natural or mechanical ventilation through windows, a fan, or air conditioning.",
      "Operate the fan or air conditioning to confirm it works.",
      "Water supply is free from contamination.",
      "Operate all faucets and confirm the water is working, hot, and clear.",
      "Sufficient sanitary facilities are in proper working condition, usable in privacy, and adequate for personal cleanliness.",
      "Include shared-space sanitary facilities in the in-person check.",
      "Adequate heating or cooling facilities are in proper operating condition.",
      "Operate the available heating or cooling equipment to confirm it works.",
      "Natural or artificial light supports normal indoor activities and health and safety.",
      "There are enough safe electrical outlets for essential appliances without creating a fire hazard.",
      "Food-preparation areas have suitable space and equipment to store, prepare, and serve food sanitarily.",
      "Inspect shared food-preparation space and confirm suitable refuse disposal.",
      "The housing and its equipment are maintained in sanitary condition.",
      "11a · Unit: working smoke and carbon monoxide detectors on every occupied unit level; smoke detectors in a hallway adjacent to a bedroom where practicable; the Form 1083 alarm provision where applicable, without recording health details.",
      "11b · Public/common areas: sufficient smoke detectors, with at least one in each area, including shared laundry rooms, hallways, and stairwells.",
    ]);
  });
});
