/**
 * Free public-record sources for the building pre-screen. Every source here
 * was verified live (keyless HTTPS, real records) before it was wired:
 *
 * - Census Geocoder: address → coordinates + tract + county (no key)
 * - LA LADBS open code-enforcement cases, Socrata u82d-eh7z (no key)
 * - LAHD violations (incl. SCEP), Socrata cr8f-uc4j (no key)
 * - FEMA NFHL flood zones, Layer 28 (no key)
 * - HUD Deteriorated Paint Index by tract (no key)
 * - OpenFEMA disaster declarations (no key)
 * - HUD assisted multifamily properties nearby (no key)
 * - EPA TRI facilities by ZIP (no key)
 * - SAM.gov exclusions by owner name (free key, server env SAM_API_KEY;
 *   dormant until the key exists AND an owner name is available — parcel
 *   coverage for owner identity is unverified, so this reports skipped)
 *
 * Each source builds a fixed allowlisted URL from validated inputs (the
 * client never supplies a URL), fetches with a bounded timeout, and parses
 * defensively: any unexpected shape degrades that source to "unavailable"
 * instead of failing the whole report. Nothing here persists or logs the
 * queried address.
 */

import { fetchWithTimeout } from "../../features/walkthrough/fetch-timeout";
import { parseStreetAddress, streetPrefixFor } from "./address";

export const PRESCREEN_SOURCE_TIMEOUT_MS = 8000;

/** Largest upstream body we will read; public-record rows are small. */
const MAX_UPSTREAM_BYTES = 262_144;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type PrescreenSourceStatus = "ok" | "empty" | "unavailable" | "skipped";

export interface PrescreenSourceResult {
  status: PrescreenSourceStatus;
  /** One-line human summary, always present. */
  summary: string;
  /** Bounded display-ready rows (string maps); empty unless status is ok. */
  records: Record<string, string>[];
  /** Human link to the dataset behind this source. */
  sourceUrl: string;
  /** Why unavailable/skipped; absent otherwise. */
  detail?: string;
}

export interface GeocodeHit {
  lat: number;
  lon: number;
  /** 11-digit census tract GEOID, e.g. "06037207306". */
  tract: string | null;
  county: string | null;
  state: string | null;
  matchedAddress: string;
}

export interface PrescreenQuery {
  street: string;
  city: string;
  state: string;
  zip: string;
}

/** Body-read budget: headers arriving must not let a trickling body hang the route. */
const READ_TIMEOUT_MS = 5000;

async function readBoundedText(response: Response): Promise<string | null> {
  try {
    const text = (await Promise.race([
      response.text(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS)),
    ])) as string | null;
    if (text === null || text.length > MAX_UPSTREAM_BYTES) return null;
    return text;
  } catch {
    return null;
  }
}

async function fetchJson(
  url: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<unknown | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(url, { signal }, PRESCREEN_SOURCE_TIMEOUT_MS, fetchImpl as typeof fetch);
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const text = await readBoundedText(response);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function stringField(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

/** Stage 1: Census Geocoder turns the address into coords + tract + county. */
export async function geocodeAddress(
  query: PrescreenQuery,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<GeocodeHit | null> {
  const params = new URLSearchParams({
    street: query.street,
    city: query.city,
    state: query.state,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    format: "json",
  });
  if (query.zip.trim().length > 0) params.set("zip", query.zip.trim());
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/address?${params.toString()}`;
  const data = await fetchJson(url, fetchImpl, signal);
  if (typeof data !== "object" || data === null) return null;
  const matches = (data as { result?: { addressMatches?: unknown } }).result?.addressMatches;
  if (!Array.isArray(matches) || matches.length === 0) return null;
  const match = matches[0] as {
    coordinates?: { x?: unknown; y?: unknown };
    matchedAddress?: unknown;
    geographies?: { "Census Tracts"?: Array<{ GEOID?: unknown }>; Counties?: Array<{ NAME?: unknown }>; States?: Array<{ STUSAB?: unknown }> };
  };
  const lon = typeof match.coordinates?.x === "number" ? match.coordinates.x : null;
  const lat = typeof match.coordinates?.y === "number" ? match.coordinates.y : null;
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const tracts = match.geographies?.["Census Tracts"];
  const tractRaw = Array.isArray(tracts) && typeof tracts[0]?.GEOID === "string" ? (tracts[0].GEOID as string) : null;
  const tract = tractRaw && /^\d{11}$/.test(tractRaw) ? tractRaw : null;
  const counties = match.geographies?.Counties;
  const county = Array.isArray(counties) ? stringField(counties[0]?.NAME, 100) : null;
  const states = match.geographies?.States;
  const state = Array.isArray(states) ? stringField(states[0]?.STUSAB, 2) : null;
  return {
    lat,
    lon,
    tract,
    county,
    state,
    matchedAddress: stringField(match.matchedAddress, 300) ?? `${query.street}, ${query.city}, ${query.state} ${query.zip}`.trim(),
  };
}

const LADBS_DATASET_URL = "https://data.lacity.org/resource/u82d-eh7z.json";
const LADBS_HUMAN_URL = "https://data.lacity.org/Housing-and-Real-Estate/Building-and-Safety-Code-Enforcement-Case-Open-N-/u82d-eh7z";

/** Stage 2a: open LADBS code-enforcement cases for the parsed street (City of LA). */
export async function queryLadbsCases(
  query: PrescreenQuery,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<PrescreenSourceResult> {
  const base = { sourceUrl: LADBS_HUMAN_URL, records: [] as Record<string, string>[] };
  const parsed = parseStreetAddress(query.street);
  if (!parsed) {
    return { ...base, status: "skipped", summary: "Street address could not be parsed for the case search.", detail: "Enter a numbered street address such as 200 N Spring St." };
  }
  const params = new URLSearchParams({
    stno: parsed.number,
    stname: parsed.name,
    $limit: "25",
    $select: "stno,predir,stname,suffix,zip,aptype,stat,adddttm",
  });
  if (parsed.predir) params.set("predir", parsed.predir);
  if (parsed.suffix) params.set("suffix", parsed.suffix);
  const data = await fetchJson(`${LADBS_DATASET_URL}?${params.toString()}`, fetchImpl, signal);
  if (!Array.isArray(data)) {
    return { ...base, status: "unavailable", summary: "Code-enforcement cases could not be checked right now.", detail: "The City of LA dataset did not answer. Try again later." };
  }
  const rows = data.slice(0, 10).map((row) => {
    const record = row as Record<string, unknown>;
    const address = [record.stno, record.predir, record.stname, record.suffix].filter((part) => typeof part === "string" && part.length > 0).join(" ");
    return {
      address: address.slice(0, 120),
      type: stringField(record.aptype, 40) ?? "—",
      status: stringField(record.stat, 10) ?? "—",
      opened: typeof record.adddttm === "string" ? record.adddttm.slice(0, 10) : "—",
    };
  });
  if (rows.length === 0) {
    return { ...base, status: "empty", summary: "No open code-enforcement cases found for this street number." };
  }
  return {
    ...base,
    status: "ok",
    summary: `${rows.length} open code-enforcement case${rows.length === 1 ? "" : "s"} at this street number (City of LA).`,
    records: rows,
  };
}

const LAHD_DATASET_URL = "https://data.lacity.org/resource/cr8f-uc4j.json";
const LAHD_HUMAN_URL = "https://data.lacity.org/Housing-and-Real-Estate/LAHD-Propery-Look-Up-for-Violations/cr8f-uc4j";

/** Stage 2b: LAHD violations (incl. SCEP) matching the street prefix. */
export async function queryLahdViolations(
  query: PrescreenQuery,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<PrescreenSourceResult> {
  const base = { sourceUrl: LAHD_HUMAN_URL, records: [] as Record<string, string>[] };
  const parsed = parseStreetAddress(query.street);
  if (!parsed) {
    return { ...base, status: "skipped", summary: "Street address could not be parsed for the LAHD search.", detail: "Enter a numbered street address such as 200 N Spring St." };
  }
  const prefix = streetPrefixFor(parsed).replace(/'/g, "''");
  const params = new URLSearchParams({
    $where: `starts_with(address,'${prefix}')`,
    $limit: "50",
    $select: "apn,address,violationtype,violations_cited,violations_cleared,criscase,casetype,opendate",
  });
  const data = await fetchJson(`${LAHD_DATASET_URL}?${params.toString()}`, fetchImpl, signal);
  if (!Array.isArray(data)) {
    return { ...base, status: "unavailable", summary: "LAHD violations could not be checked right now.", detail: "The City of LA dataset did not answer. Try again later." };
  }
  const rows = data.slice(0, 10).map((row) => {
    const record = row as Record<string, unknown>;
    const cleared = record.violations_cleared;
    return {
      apn: stringField(record.apn, 20) ?? "—",
      address: stringField(record.address, 140) ?? "—",
      violation: stringField(record.violationtype, 80) ?? "—",
      cited: typeof record.violations_cited === "string" ? record.violations_cited.slice(0, 10) : "—",
      cleared: typeof cleared === "string" && cleared !== "0" ? cleared.slice(0, 10) : "Open",
      case: stringField(record.criscase, 20) ?? "—",
    };
  });
  if (rows.length === 0) {
    return { ...base, status: "empty", summary: "No LAHD violations found for this address." };
  }
  const open = (data as Array<Record<string, unknown>>).filter((row) => row.violations_cleared === "0").length;
  return {
    ...base,
    status: "ok",
    summary: open > 0
      ? `${open} open LAHD violation${open === 1 ? "" : "s"} (${data.length} cited overall).`
      : `${data.length} cited LAHD violation${data.length === 1 ? "" : "s"}, all cleared.`,
    records: rows,
  };
}

const NFHL_HUMAN_URL = "https://hazards.fema.gov/femaportal/resources/flood_map_svc.htm";

/** Stage 2c: FEMA flood zone for the coordinates (effective data only). */
export async function queryFloodZone(
  hit: GeocodeHit,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<PrescreenSourceResult> {
  const base = { sourceUrl: NFHL_HUMAN_URL, records: [] as Record<string, string>[] };
  const params = new URLSearchParams({
    geometry: `${hit.lon},${hit.lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "FLD_ZONE,ZONE_SUBTY",
    returnGeometry: "false",
    f: "json",
  });
  const data = await fetchJson(
    `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?${params.toString()}`,
    fetchImpl,
    signal,
  );
  const features = typeof data === "object" && data !== null ? (data as { features?: unknown }).features : null;
  if (!Array.isArray(features)) {
    return { ...base, status: "unavailable", summary: "Flood zone could not be checked right now.", detail: "FEMA NFHL did not answer. Try again later." };
  }
  if (features.length === 0) {
    return { ...base, status: "empty", summary: "No FEMA flood zone found at this location." };
  }
  const attrs = (features[0] as { attributes?: Record<string, unknown> }).attributes ?? {};
  const zone = stringField(attrs.FLD_ZONE, 20) ?? "—";
  const subtype = stringField(attrs.ZONE_SUBTY, 100) ?? "";
  const highRisk = /^(A|V)/i.test(zone);
  return {
    ...base,
    status: "ok",
    summary: highRisk
      ? `Flood Zone ${zone}: high-risk area${subtype ? ` (${subtype})` : ""}.`
      : `Flood Zone ${zone}${subtype ? ` — ${subtype}` : ""}.`,
    records: [{ zone, detail: subtype || "—" }],
  };
}

const DPI_HUMAN_URL = "https://catalog.data.gov/dataset/deteriorated-paint-index-by-tract";

/** Stage 2d: HUD lead-risk index for the census tract. */
export async function queryLeadIndex(
  hit: GeocodeHit,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<PrescreenSourceResult> {
  const base = { sourceUrl: DPI_HUMAN_URL, records: [] as Record<string, string>[] };
  if (!hit.tract) {
    return { ...base, status: "skipped", summary: "No census tract for this address, so lead risk was skipped." };
  }
  const params = new URLSearchParams({
    where: `GEOID='${hit.tract}'`,
    outFields: "GEOID,Percent_,AGE_ALL,AGE_0_5,AGE_0_5_RATE",
    returnGeometry: "false",
    f: "json",
  });
  const data = await fetchJson(
    `https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Deteriorated_Paint_Index_Tract/FeatureServer/2/query?${params.toString()}`,
    fetchImpl,
    signal,
  );
  const features = typeof data === "object" && data !== null ? (data as { features?: unknown }).features : null;
  if (!Array.isArray(features)) {
    return { ...base, status: "unavailable", summary: "Lead risk could not be checked right now.", detail: "The HUD index did not answer. Try again later." };
  }
  if (features.length === 0) {
    return { ...base, status: "empty", summary: "No HUD lead-risk record for this census tract." };
  }
  const attrs = (features[0] as { attributes?: Record<string, unknown> }).attributes ?? {};
  const percent = typeof attrs.Percent_ === "number" && Number.isFinite(attrs.Percent_) ? attrs.Percent_ : null;
  const young = typeof attrs.AGE_0_5 === "number" ? String(attrs.AGE_0_5) : "—";
  return {
    ...base,
    status: "ok",
    summary: percent === null
      ? "HUD lead-risk record found for this tract."
      : `Lead-risk index ${percent.toFixed(1)}% of pre-1980 households with deteriorated paint in this tract.`,
    records: [{ tract: hit.tract, index: percent === null ? "—" : `${percent.toFixed(1)}%`, childrenUnder6: young }],
  };
}

const HUD_ASSISTED_HUMAN_URL = "https://catalog.data.gov/dataset/multifamily-housing-physical-inspection-scores";

/** Assisted multifamily properties within 1 km: subsidy, REAC score, troubled flag. */
export async function queryHudAssisted(
  hit: GeocodeHit,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<PrescreenSourceResult> {
  const base = { sourceUrl: HUD_ASSISTED_HUMAN_URL, records: [] as Record<string, string>[] };
  const params = new URLSearchParams({
    geometry: `${hit.lon},${hit.lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: "1000",
    units: "esriSRUnit_Meter",
    outFields: [
      "PROPERTY_NAME_TEXT",
      "STD_ADDR",
      "STD_CITY",
      "STD_ST",
      "STD_ZIP5",
      "TOTAL_ASSISTED_UNIT_COUNT",
      "TOTAL_UNIT_COUNT",
      "REAC_LAST_INSPECTION_SCORE",
      "TROUBLED_CODE",
      "OPIIS_RISK_CATEGORY",
      "PROGRAM_TYPE1",
      "HAS_ACTIVE_ASSISTANCE_IND",
    ].join(","),
    returnGeometry: "false",
    resultRecordCount: "10",
    f: "json",
  });
  const data = await fetchJson(
    `https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/MULTIFAMILY_PROPERTIES_ASSISTED/FeatureServer/0/query?${params.toString()}`,
    fetchImpl,
    signal,
  );
  const features = typeof data === "object" && data !== null ? (data as { features?: unknown }).features : null;
  if (!Array.isArray(features)) {
    return { ...base, status: "unavailable", summary: "Assisted-housing lookup could not run right now.", detail: "The HUD service did not answer. Try again later." };
  }
  if (features.length === 0) {
    return { ...base, status: "empty", summary: "No HUD-assisted multifamily properties within 1 km." };
  }
  const rows = features.slice(0, 5).map((feature) => {
    const attrs = (feature as { attributes?: Record<string, unknown> }).attributes ?? {};
    const assisted = typeof attrs.TOTAL_ASSISTED_UNIT_COUNT === "number" ? String(attrs.TOTAL_ASSISTED_UNIT_COUNT) : "—";
    const total = typeof attrs.TOTAL_UNIT_COUNT === "number" ? String(attrs.TOTAL_UNIT_COUNT) : "—";
    return {
      property: stringField(attrs.PROPERTY_NAME_TEXT, 80) ?? "—",
      address: [attrs.STD_ADDR, attrs.STD_CITY, attrs.STD_ST, attrs.STD_ZIP5]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join(" ").replace(/\s+/g, " ").slice(0, 140) || "—",
      units: `${assisted}/${total} assisted`,
      reac: stringField(attrs.REAC_LAST_INSPECTION_SCORE, 10) ?? "—",
      troubled: attrs.TROUBLED_CODE === "Y" ? "Yes" : "No",
      risk: stringField(attrs.OPIIS_RISK_CATEGORY, 20) ?? "—",
    };
  });
  const troubled = (features as Array<{ attributes?: Record<string, unknown> }>)
    .filter((feature) => feature.attributes?.TROUBLED_CODE === "Y").length;
  return {
    ...base,
    status: "ok",
    summary: troubled > 0
      ? `${features.length} assisted ${features.length === 1 ? "property" : "properties"} within 1 km — ${troubled} flagged troubled.`
      : `${features.length} assisted ${features.length === 1 ? "property" : "properties"} within 1 km, none flagged troubled.`,
    records: rows,
  };
}

const EPA_TRI_HUMAN_URL = "https://www.epa.gov/enviro/web-services";

/** Toxics Release Inventory facilities reporting in the ZIP (emissions context). */
export async function queryEpaTri(
  zip: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<PrescreenSourceResult> {
  const base = { sourceUrl: EPA_TRI_HUMAN_URL, records: [] as Record<string, string>[] };
  const cleanZip = zip.trim().slice(0, 5);
  if (!/^\d{5}$/.test(cleanZip)) {
    return { ...base, status: "skipped", summary: "Emissions lookup needs a 5-digit ZIP for this address." };
  }
  const data = await fetchJson(
    `https://data.epa.gov/dmapservice/tri.tri_facility/zip_code/equals/${cleanZip}/1:25/JSON`,
    fetchImpl,
    signal,
  );
  if (!Array.isArray(data)) {
    return { ...base, status: "unavailable", summary: "Emissions lookup could not run right now.", detail: "EPA Envirofacts did not answer. Try again later." };
  }
  if (data.length === 0) {
    return { ...base, status: "empty", summary: `No TRI-reporting facilities in ZIP ${cleanZip}.` };
  }
  return {
    ...base,
    status: "ok",
    summary: `${data.length} TRI-reporting ${data.length === 1 ? "facility" : "facilities"} in ZIP ${cleanZip} (emissions context, not a disqualifier).`,
    records: data.slice(0, 5).map((row) => {
      const record = row as Record<string, unknown>;
      return {
        facility: stringField(record.facility_name, 80) ?? "—",
        id: stringField(record.tri_facility_id, 30) ?? "—",
      };
    }),
  };
}

const SAM_HUMAN_URL = "https://open.gsa.gov/api/exclusions-api/";
const ASSESSOR_PORTAL_URL = "https://portal.assessor.lacounty.gov/";

/**
 * Federal exclusion check for the property owner. Dormant until two gates
 * clear: a free SAM.gov API key on the server (SAM_API_KEY) and an owner
 * name (parcel coverage unverified — see module note). Either missing
 * reports skipped with the exact remedy; nothing is guessed.
 */
export async function querySamExclusion(
  ownerName: string | null,
  apiKey: string | null,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<PrescreenSourceResult> {
  const base = { sourceUrl: SAM_HUMAN_URL, records: [] as Record<string, string>[] };
  if (!apiKey || apiKey.trim().length === 0) {
    return {
      ...base,
      status: "skipped",
      summary: "Federal exclusion check needs a free SAM.gov API key on the server.",
      detail: "Any registered SAM.gov user generates one free on Account Details; set it as SAM_API_KEY.",
    };
  }
  if (!ownerName || ownerName.trim().length === 0) {
    return {
      ...base,
      status: "skipped",
      summary: "Federal exclusion check needs the property owner name.",
      detail: `Owner identity is not in a verified free API. Look it up at ${ASSESSOR_PORTAL_URL} first.`,
    };
  }
  const params = new URLSearchParams({
    api_key: apiKey.trim(),
    q: ownerName.trim().slice(0, 100),
    page: "0",
    size: "10",
  });
  const data = await fetchJson(
    `https://api.sam.gov/entity-information/v4/exclusions?${params.toString()}`,
    fetchImpl,
    signal,
  );
  const root = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  const total = root && typeof root.totalRecords === "number" ? root.totalRecords : null;
  const records = root && Array.isArray(root.exclusionRecords) ? root.exclusionRecords : null;
  if (total === null || records === null) {
    return { ...base, status: "unavailable", summary: "Federal exclusion check could not run right now.", detail: "SAM.gov did not return usable records. Try again later." };
  }
  if (total === 0 || records.length === 0) {
    return { ...base, status: "empty", summary: `No federal exclusions found matching "${ownerName.trim().slice(0, 60)}".` };
  }
  return {
    ...base,
    status: "ok",
    summary: `${total} federal exclusion ${total === 1 ? "record" : "records"} matching the owner name — verify identity before relying on it.`,
    records: records.slice(0, 5).map((row) => {
      const record = row as Record<string, unknown>;
      return {
        name: stringField(record.name ?? record.entityName, 80) ?? "—",
        type: stringField(record.exclusionType, 60) ?? "—",
        effective: typeof record.effectiveDate === "string" ? record.effectiveDate.slice(0, 10) : "—",
      };
    }),
  };
}

const OPENFEMA_HUMAN_URL = "https://www.fema.gov/about/reports-and-data/openfema";

/** Stage 2e: recent federal disaster declarations for the state (context). */
export async function queryDisasters(
  state: string | null,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<PrescreenSourceResult> {
  const base = { sourceUrl: OPENFEMA_HUMAN_URL, records: [] as Record<string, string>[] };
  if (!state || state.length !== 2) {
    return { ...base, status: "skipped", summary: "Disaster history needs a US state for this address." };
  }
  const params = new URLSearchParams({
    $filter: `state eq '${state}'`,
    $top: "3",
    $orderby: "declarationDate desc",
    $select: "femaDeclarationString,incidentType,declarationTitle,declarationDate,designatedArea",
  });
  const data = await fetchJson(
    `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?${params.toString()}`,
    fetchImpl,
    signal,
  );
  const rows = typeof data === "object" && data !== null
    ? (data as { DisasterDeclarationsSummaries?: unknown }).DisasterDeclarationsSummaries
    : null;
  if (!Array.isArray(rows)) {
    return { ...base, status: "unavailable", summary: "Disaster history could not be checked right now.", detail: "OpenFEMA did not answer. Try again later." };
  }
  if (rows.length === 0) {
    return { ...base, status: "empty", summary: `No federal disaster declarations on record for ${state}.` };
  }
  return {
    ...base,
    status: "ok",
    summary: `${rows.length} most recent federal disaster declaration${rows.length === 1 ? "" : "s"} in ${state}.`,
    records: rows.slice(0, 3).map((row) => {
      const record = row as Record<string, unknown>;
      return {
        title: stringField(record.declarationTitle, 120) ?? "—",
        type: stringField(record.incidentType, 40) ?? "—",
        date: typeof record.declarationDate === "string" ? record.declarationDate.slice(0, 10) : "—",
        area: stringField(record.designatedArea, 80) ?? "—",
      };
    }),
  };
}
