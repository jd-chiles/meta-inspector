import { getCatalogItem, type Catalog } from "../domain/catalog";
import {
  GUIDE_ACTIONS,
  GUIDE_STAGES,
  type GuideAction,
  type GuideDraft,
  type GuideStage,
} from "../domain/guide";
import { getServerCatalog } from "./catalog";
import {
  callMetaGuide,
  isMetaCallError,
  parseAnalysisMode,
  requireLiveConfig,
  resolveMetaConfig,
  type FetchImpl,
} from "./meta/adapter";

interface GuideRequest {
  itemId: string;
  action: GuideAction;
  stage: GuideStage;
}

export interface GuideDeps {
  catalog?: Catalog;
  mode?: "fixture" | "live";
  metaEnv?: Record<string, string | undefined>;
  fetchImpl?: FetchImpl;
}

const ACTION_PROMPTS: Record<GuideAction, string> = {
  next: "What should I do next?",
  photo: "How should I frame the photo?",
  check: "What in-person check do I need to do?",
  correction: "How do I record a correction?",
};

function failure(status: number, code: string, message: string) {
  return { status, body: { error: { code, message } } };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeOriginHost(hostname: string): string {
  const host = hostname.trim().toLowerCase();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null || origin.trim().length === 0) return true;
  try {
    const originUrl = new URL(origin);
    const targetUrl = new URL(request.url);
    if (originUrl.origin === targetUrl.origin) return true;
    // Local dev servers can report a different loopback alias than the page
    // used. Keep the exception limited to the same scheme and port.
    return originUrl.protocol === targetUrl.protocol &&
      originUrl.port === targetUrl.port &&
      LOOPBACK_HOSTS.has(normalizeOriginHost(originUrl.hostname)) &&
      LOOPBACK_HOSTS.has(normalizeOriginHost(targetUrl.hostname));
  } catch {
    return false;
  }
}

function parseRequest(value: unknown): GuideRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["itemId", "action", "stage"].includes(key))) return null;
  if (typeof record.itemId !== "string" || record.itemId.length > 100) return null;
  if (!GUIDE_ACTIONS.includes(record.action as GuideAction)) return null;
  if (!GUIDE_STAGES.includes(record.stage as GuideStage)) return null;
  return {
    itemId: record.itemId,
    action: record.action as GuideAction,
    stage: record.stage as GuideStage,
  };
}

function fixtureGuide(input: GuideRequest, item: NonNullable<ReturnType<typeof getCatalogItem>>): GuideDraft {
  if (input.action === "photo") {
    return {
      message: "Use this framing prompt for the selected Form 1083 area.",
      actionPlan: [item.captureGuidance, "Exclude people and identifying details."],
    };
  }
  if (input.action === "check") {
    return {
      message: "Complete the listed in-person check yourself and record what you observed.",
      actionPlan: item.manualChecks.slice(0, 1).map((check) => check.instruction),
    };
  }
  if (input.action === "correction") {
    return {
      message: "If you observed a problem, record your own description and the follow-up you propose. The photo model cannot create a worker correction.",
      actionPlan: ["Open the worker correction fields below.", "Enter only what you observed and the next step."],
    };
  }
  const stagePlans: Record<GuideStage, { message: string; actionPlan: string[] }> = {
    start: {
      message: "Start with this area's photo. Then review the unapproved observation and complete the in-person check.",
      actionPlan: ["Capture a photo.", "Review the photo observation.", "Record the in-person check."],
    },
    "photo-saved": {
      message: "The photo is saved locally. Run the photo review, then record your own in-person check.",
      actionPlan: ["Review the photo observation.", "Edit or reject it as needed.", "Record the physical check."],
    },
    "analysis-ready": {
      message: "An AI observation is waiting for your review. It is a draft and cannot replace the physical check.",
      actionPlan: ["Read and edit or reject the observation.", "Record the listed in-person check."],
    },
    "worker-reviewed": {
      message: "Your worker review is recorded. Finish the in-person check before moving to the next area.",
      actionPlan: ["Complete the required in-person check.", "Record what you observed or mark it not performed."],
    },
    complete: {
      message: "This area has a worker-reviewed note and recorded in-person check. You can continue to another area.",
      actionPlan: ["Continue to the next Form 1083 area.", "Review the correction packet when the walkthrough is finished."],
    },
    blocked: {
      message: "The photo review needs attention. Your photo and existing local work remain unchanged.",
      actionPlan: ["Retry the photo review or replace the photo.", "Record the physical check when you are ready."],
    },
  };
  return stagePlans[input.stage];
}

/** POST /api/guide: text-only, enum-driven guidance; no free text or session data. */
export async function handleGuideRequest(
  request: Request,
  deps: GuideDeps = {},
): Promise<{ status: number; body: unknown }> {
  if (!sameOrigin(request)) return failure(403, "ORIGIN_FORBIDDEN", "Cross-origin requests are rejected.");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return failure(400, "INVALID_REQUEST", "Send a JSON guide action.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 4096) {
    return failure(413, "INVALID_REQUEST", "The guide request is too large.");
  }
  let raw: string;
  try {
    const reader = request.body?.getReader();
    if (!reader) return failure(400, "INVALID_REQUEST", "The guide request has no body.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.length;
      if (total > 4096) {
        await reader.cancel();
        return failure(413, "INVALID_REQUEST", "The guide request is too large.");
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    raw = new TextDecoder().decode(bytes);
  } catch {
    return failure(400, "INVALID_REQUEST", "The guide request could not be read.");
  }
  if (raw.length > 4096) return failure(413, "INVALID_REQUEST", "The guide request is too large.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failure(400, "INVALID_REQUEST", "The guide request is not valid JSON.");
  }
  const input = parseRequest(parsed);
  if (!input) return failure(400, "INVALID_REQUEST", "Choose one of the available guide actions.");
  let catalog: Catalog;
  try {
    catalog = deps.catalog ?? getServerCatalog();
  } catch {
    return failure(503, "SETUP_REQUIRED", "The Form 1083 guide is unavailable.");
  }
  const item = getCatalogItem(catalog, input.itemId);
  if (!item) return failure(409, "ITEM_MISMATCH", "That Form 1083 area is no longer available. Refresh the walkthrough.");
  const mode = deps.mode ?? parseAnalysisMode(deps.metaEnv?.APP_ANALYSIS_MODE ?? process.env.APP_ANALYSIS_MODE);
  if (mode === null) return failure(503, "SETUP_REQUIRED", "The server analysis mode is not configured.");

  if (mode === "fixture") {
    return {
      status: 200,
      body: {
        mode: "fixture",
        model: "guided-checklist",
        fixtureNotice: "Scripted guide response — not live inference.",
        prompt: ACTION_PROMPTS[input.action],
        guide: fixtureGuide(input, item),
      },
    };
  }

  try {
    const config = resolveMetaConfig(deps.metaEnv ?? process.env);
    requireLiveConfig(config);
    const response = await callMetaGuide({
      config,
      action: input.action,
      stage: input.stage,
      itemLabel: item.label,
      captureGuidance: item.captureGuidance,
      manualCheck: item.manualChecks[0]?.instruction ?? "Follow the Form 1083 instructions.",
      fetchImpl: deps.fetchImpl,
      signal: request.signal,
    });
    return {
      status: 200,
      body: {
        mode: response.mode,
        model: response.model,
        requestId: response.requestId,
        latencyMs: response.latencyMs,
        prompt: ACTION_PROMPTS[input.action],
        guide: response.guide,
      },
    };
  } catch (error) {
    if (isMetaCallError(error)) return failure(error.status, error.code, error.message);
    return failure(502, "PROVIDER_UNAVAILABLE", "The guide service is unavailable. Your walkthrough progress is unchanged.");
  }
}
