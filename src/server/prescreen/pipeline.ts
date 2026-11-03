/**
 * Building pre-screen pipeline (REQ-R1 live path). Optimal shape for free
 * public records: one geocode call fans out into five independent keyless
 * source queries that run in parallel, each degrading on its own so a slow
 * dataset never blocks the others. Total budget is roughly two source
 * timeouts (geocode, then the slowest fan-out leg).
 *
 * Privacy: the queried address is sent only to the allowlisted public-record
 * endpoints in ./sources, never persisted, never logged, and never traced.
 * This route intentionally has no Langfuse instrumentation: addresses are
 * PII-adjacent and do not belong in traces.
 */
import { parseAnalysisMode } from "../meta/adapter";
import {
  geocodeAddress,
  queryDisasters,
  queryFloodZone,
  queryLadbsCases,
  queryLahdViolations,
  queryLeadIndex,
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
  };
  fixtureNotice?: string;
}

export interface PrescreenPipelineDeps {
  fetchImpl?: FetchLike;
}

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
    return originUrl.protocol === targetUrl.protocol &&
      originUrl.port === targetUrl.port &&
      LOOPBACK_HOSTS.has(normalizeOriginHost(originUrl.hostname)) &&
      LOOPBACK_HOSTS.has(normalizeOriginHost(targetUrl.hostname));
  } catch {
    return false;
  }
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
  if (Object.keys(record).some((key) => !["street", "city", "state", "zip"].includes(key))) return null;
  const street = boundedString(record.street, 200);
  if (!street) return null;
  const city = boundedString(record.city, 100) ?? "";
  const state = boundedString(record.state, 100) ?? "";
  const zip = boundedString(record.zip, 20) ?? "";
  return { street, city, state, zip };
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
      },
    };
  }
  const [ladbs, lahd, flood, lead, disasters] = await Promise.all([
    queryLadbsCases(query, fetchImpl, signal),
    queryLahdViolations(query, fetchImpl, signal),
    queryFloodZone(hit, fetchImpl, signal),
    queryLeadIndex(hit, fetchImpl, signal),
    queryDisasters(hit.state ?? query.state.slice(0, 2).toUpperCase(), fetchImpl, signal),
  ]);
  return {
    mode: "live",
    matchedAddress: hit.matchedAddress,
    coords: { lat: hit.lat, lon: hit.lon },
    tract: hit.tract,
    county: hit.county,
    sources: { ladbs, lahd, flood, lead, disasters },
  };
}

export interface PrescreenHandlerDeps extends PrescreenPipelineDeps {
  mode?: "fixture" | "live";
  analysisModeEnv?: string | undefined;
}

/** POST /api/prescreen: free public-record pre-screen for one address. */
export async function handlePrescreenRequest(
  request: Request,
  deps: PrescreenHandlerDeps = {},
): Promise<{ status: number; body: unknown }> {
  if (!sameOrigin(request)) return failure(403, "ORIGIN_FORBIDDEN", "Cross-origin requests are rejected.");
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
