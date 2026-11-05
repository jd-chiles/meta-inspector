/**
 * Building pre-screen pipeline (REQ-R1 live path). Optimal shape for free
 * public records: one geocode call fans out into five independent keyless
 * source queries that run in parallel, each degrading on its own so a slow
 * dataset never blocks the others. Total budget is roughly two source
 * timeouts (geocode, then the slowest fan-out leg).
 *
 * Privacy: the queried address is sent only to the allowlisted public-record
 * endpoints in ./sources (plus api.sam.gov only when SAM_API_KEY is set),
 * never persisted, never logged, and never traced.
 * This route intentionally has no Langfuse instrumentation: addresses are
 * PII-adjacent and do not belong in traces.
 */
import { parseAnalysisMode } from "../meta/adapter";
import { checkAppOrigin } from "../request-origin";
import {
  geocodeAddress,
  queryDisasters,
  queryEpaTri,
  queryFloodZone,
  queryHudAssisted,
  queryLadbsCases,
  queryLahdViolations,
  queryLeadIndex,
  querySamEntity,
  querySamExclusion,
  type FetchLike,
  type PrescreenQuery,
  type PrescreenSourceResult,
} from "./sources";

export interface PrescreenReport {
  mode: "live" | "fixture";
  matchedAddress: string;
  coords: { lat: number; lon: number } | null;
  tract: string | null;
  county: string | null;
  sources: {
    ladbs: PrescreenSourceResult;
    lahd: PrescreenSourceResult;
    flood: PrescreenSourceResult;
    lead: PrescreenSourceResult;
    disasters: PrescreenSourceResult;
    hudAssisted: PrescreenSourceResult;
    epaTri: PrescreenSourceResult;
    sam: PrescreenSourceResult;
    samEntity: PrescreenSourceResult;
  };
  fixtureNotice?: string;
}

export interface PrescreenPipelineDeps {
  fetchImpl?: FetchLike;
  /** Server-only free SAM.gov key; absent means the SAM source reports skipped. */
  samApiKey?: string | null;
  /** Owner name for the SAM checks; overrides the query owner when set (tests). */
  ownerName?: string | null;
}

function failure(status: number, code: string, message: string) {
  return { status, body: { error: { code, message } } };
}


function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

function parseRequest(value: unknown): PrescreenQuery | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["street", "city", "state", "zip", "owner"].includes(key))) return null;
  const street = boundedString(record.street, 200);
  if (!street) return null;
  const city = boundedString(record.city, 100) ?? "";
  const state = boundedString(record.state, 100) ?? "";
  const zip = boundedString(record.zip, 20) ?? "";
  // An overlong owner name rejects the request instead of silently
  // dropping to skipped, so the sender knows the name never ran.
  if (record.owner !== undefined && boundedString(record.owner, 100) === null) return null;
  const owner = boundedString(record.owner, 100) ?? "";
  return { street, city, state, zip, owner };
}

/** Deterministic canned report for fixture mode and tests. Labeled, never live. */
export function fixturePrescreen(query: PrescreenQuery): PrescreenReport {
  const street = query.street.trim();
  return {
    mode: "fixture",
    matchedAddress: `${street}, ${query.city || "Los Angeles"}, ${query.state || "CA"} ${query.zip || "90012"}`.trim(),
    coords: { lat: 34.0516, lon: -118.2456 },
    tract: "06037207306",
    county: "Los Angeles County",
    fixtureNotice: "Sample pre-screen — not live public records.",
    sources: {
      ladbs: {
        status: "ok",
        summary: "1 open code-enforcement case at this street number (City of LA).",
        records: [{ address: "200 N SPRING ST", type: "HAB", status: "O", opened: "2024-05-01" }],
        sourceUrl: "https://data.lacity.org/Housing-and-Real-Estate/Building-and-Safety-Code-Enforcement-Case-Open-N-/u82d-eh7z",
      },
      lahd: {
        status: "empty",
        summary: "No LAHD violations found for this address.",
        records: [],
        sourceUrl: "https://data.lacity.org/Housing-and-Real-Estate/LAHD-Propery-Look-Up-for-Violations/cr8f-uc4j",
      },
      flood: {
        status: "ok",
        summary: "Flood Zone X — AREA OF MINIMAL FLOOD HAZARD.",
        records: [{ zone: "X", detail: "AREA OF MINIMAL FLOOD HAZARD" }],
        sourceUrl: "https://hazards.fema.gov/femaportal/resources/flood_map_svc.htm",
      },
      lead: {
        status: "empty",
        summary: "No HUD lead-risk record for this census tract.",
        records: [],
        sourceUrl: "https://catalog.data.gov/dataset/deteriorated-paint-index-by-tract",
      },
      disasters: {
        status: "ok",
        summary: "3 most recent federal disaster declarations in CA.",
        records: [{ title: "SEVERE WINTER STORMS", type: "Storm", date: "2024-04-01", area: "Los Angeles (County)" }],
        sourceUrl: "https://www.fema.gov/about/reports-and-data/openfema",
      },
      hudAssisted: {
        status: "ok",
        summary: "2 assisted properties within 1 km, none flagged troubled.",
        records: [{ property: "Sample Assisted Homes", address: "100 S MAIN ST Los Angeles CA 90012", units: "60/61 assisted", reac: "90", troubled: "No", risk: "Low" }],
        sourceUrl: "https://catalog.data.gov/dataset/multifamily-housing-physical-inspection-scores",
      },
      epaTri: {
        status: "ok",
        summary: "1 TRI-reporting facility in ZIP 90012 (emissions context, not a disqualifier).",
        records: [{ facility: "SAMPLE METAL WORKS", id: "90012SMPL12345" }],
        sourceUrl: "https://www.epa.gov/enviro/web-services",
      },
      sam: {
        status: "skipped",
        summary: "Federal exclusion check needs a free SAM.gov API key on the server.",
        detail: "Any registered SAM.gov user generates one free on Account Details; set it as SAM_API_KEY.",
        records: [],
        sourceUrl: "https://open.gsa.gov/api/exclusions-api/",
      },
      samEntity: {
        status: "skipped",
        summary: "Owner identity check needs a free SAM.gov API key on the server.",
        detail: "Any registered SAM.gov user generates one free on Account Details; set it as SAM_API_KEY.",
        records: [],
        sourceUrl: "https://open.gsa.gov/api/entity-api/",
      },
    },
  };
}

/** Live pipeline: geocode once, then fan out to every free source in parallel. */
export async function runPrescreen(
  query: PrescreenQuery,
  deps: PrescreenPipelineDeps = {},
  signal?: AbortSignal,
): Promise<PrescreenReport> {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const hit = await geocodeAddress(query, fetchImpl, signal);
  if (!hit) {
    const skipped = (summary: string): PrescreenSourceResult => ({
      status: "skipped",
      summary,
      records: [],
      sourceUrl: "https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html",
    });
    return {
      mode: "live",
      matchedAddress: `${query.street}, ${query.city}, ${query.state} ${query.zip}`.trim(),
      coords: null,
      tract: null,
      county: null,
      sources: {
        ladbs: skipped("Address could not be located, so the case search was skipped."),
        lahd: skipped("Address could not be located, so the LAHD search was skipped."),
        flood: skipped("Address could not be located, so the flood check was skipped."),
        lead: skipped("Address could not be located, so the lead check was skipped."),
        disasters: skipped("Address could not be located, so the disaster check was skipped."),
        hudAssisted: skipped("Address could not be located, so the assisted-housing lookup was skipped."),
        epaTri: skipped("Address could not be located, so the emissions lookup was skipped."),
        sam: skipped("Address could not be located, so the exclusion check was skipped."),
        samEntity: skipped("Address could not be located, so the owner identity check was skipped."),
      },
    };
  }
  const samApiKey = deps.samApiKey !== undefined ? deps.samApiKey : (process.env.SAM_API_KEY ?? null);
  const ownerName = deps.ownerName !== undefined ? deps.ownerName : (query.owner?.trim() ? query.owner : null);
  const [ladbs, lahd, flood, lead, disasters, hudAssisted, epaTri, sam, samEntity] = await Promise.all([
    queryLadbsCases(query, fetchImpl, signal),
    queryLahdViolations(query, fetchImpl, signal),
    queryFloodZone(hit, fetchImpl, signal),
    queryLeadIndex(hit, fetchImpl, signal),
    queryDisasters(hit.state ?? query.state.slice(0, 2).toUpperCase(), fetchImpl, signal),
    queryHudAssisted(hit, fetchImpl, signal),
    queryEpaTri(query.zip, fetchImpl, signal),
    querySamExclusion(ownerName, samApiKey, fetchImpl, signal),
    querySamEntity(ownerName, samApiKey, { street: query.street, zip: query.zip }, fetchImpl, signal),
  ]);
  return {
    mode: "live",
    matchedAddress: hit.matchedAddress,
    coords: { lat: hit.lat, lon: hit.lon },
    tract: hit.tract,
    county: hit.county,
    sources: { ladbs, lahd, flood, lead, disasters, hudAssisted, epaTri, sam, samEntity },
  };
}

export interface PrescreenHandlerDeps extends PrescreenPipelineDeps {
  mode?: "fixture" | "live";
  analysisModeEnv?: string | undefined;
  appPublicOrigin?: string | undefined;
}

/** POST /api/prescreen: free public-record pre-screen for one address. */
export async function handlePrescreenRequest(
  request: Request,
  deps: PrescreenHandlerDeps = {},
): Promise<{ status: number; body: unknown }> {
  const originCheck = checkAppOrigin(request, deps.appPublicOrigin ?? process.env.APP_PUBLIC_ORIGIN);
  if (originCheck.configError) return failure(503, "SETUP_REQUIRED", "The server origin is misconfigured.");
  if (!originCheck.allowed) return failure(403, "ORIGIN_FORBIDDEN", "Cross-origin requests are rejected.");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return failure(400, "INVALID_REQUEST", "Send a JSON pre-screen address.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 4096) {
    return failure(413, "INVALID_REQUEST", "The pre-screen request is too large.");
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return failure(400, "INVALID_REQUEST", "The pre-screen request could not be read.");
  }
  if (raw.length > 4096) return failure(413, "INVALID_REQUEST", "The pre-screen request is too large.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failure(400, "INVALID_REQUEST", "The pre-screen request is not valid JSON.");
  }
  const input = parseRequest(parsed);
  if (!input) return failure(400, "INVALID_REQUEST", "Enter a street address to screen.");
  const mode = deps.mode ?? parseAnalysisMode(deps.analysisModeEnv ?? process.env.APP_ANALYSIS_MODE);
  if (mode === null) return failure(503, "SETUP_REQUIRED", "The server analysis mode is not configured.");

  if (mode === "fixture") {
    return { status: 200, body: fixturePrescreen(input) };
  }
  try {
    const report = await runPrescreen(input, deps, request.signal);
    return { status: 200, body: report };
  } catch {
    // Per-source failures degrade inside the report; only a total pipeline
    // collapse lands here. Never echo the address back in an error.
    return failure(502, "PRESCREEN_UNAVAILABLE", "The pre-screen is unavailable right now. Nothing was saved.");
  }
}
