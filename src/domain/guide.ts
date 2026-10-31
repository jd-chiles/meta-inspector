import type { ValidationResult } from "./catalog";

export const GUIDE_ACTIONS = ["next", "photo", "check", "correction"] as const;
export type GuideAction = (typeof GUIDE_ACTIONS)[number];

export const GUIDE_STAGES = [
  "start",
  "photo-saved",
  "analysis-ready",
  "worker-reviewed",
  "complete",
  "blocked",
] as const;
export type GuideStage = (typeof GUIDE_STAGES)[number];

/** Short, untrusted guide copy plus a suggested action card. No verdict field. */
export interface GuideDraft {
  message: string;
  actionPlan: string[];
}

const MAX_MESSAGE_LENGTH = 800;
const MAX_ACTION_LENGTH = 180;
const MAX_ACTIONS = 3;
const VERDICT_LANGUAGE =
  /\b(pass(?:es|ed)?|fail(?:s|ed|ure)?|safe|unsafe|compliant|noncompliant|deficient|approved|certified|habitable|uninhabitable)\b/i;

/** Validate model output before it can enter the walkthrough chat. */
export function validateGuideDraft(value: unknown): ValidationResult<GuideDraft> {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: ["guide: must be an object"] };
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "message" && key !== "actionPlan") {
      errors.push(`guide: unexpected field "${key}"`);
    }
  }
  const message = record.message;
  if (
    typeof message !== "string" ||
    message.trim().length === 0 ||
    message.length > MAX_MESSAGE_LENGTH
  ) {
    errors.push(`guide: "message" must be 1–${MAX_MESSAGE_LENGTH} characters`);
  } else if (VERDICT_LANGUAGE.test(message)) {
    errors.push("guide: message contains prohibited inspection-verdict language");
  }
  const actionPlan = record.actionPlan;
  if (!Array.isArray(actionPlan) || actionPlan.length === 0 || actionPlan.length > MAX_ACTIONS) {
    errors.push(`guide: "actionPlan" must contain 1–${MAX_ACTIONS} actions`);
  } else {
    actionPlan.forEach((action, index) => {
      if (typeof action !== "string" || action.trim().length === 0 || action.length > MAX_ACTION_LENGTH) {
        errors.push(`guide: actionPlan[${index}] must be 1–${MAX_ACTION_LENGTH} characters`);
      } else if (VERDICT_LANGUAGE.test(action)) {
        errors.push(`guide: actionPlan[${index}] contains prohibited inspection-verdict language`);
      }
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      message: message as string,
      actionPlan: (actionPlan as string[]).slice(),
    },
  };
}
