/**
 * Deterministic US street parser for the building pre-screen. City open-data
 * portals (Socrata) store addresses as parts (street number, pre-direction,
 * street name, suffix, ZIP), so the query layer needs the same split. Pure
 * string work: no network, no model, no guessing beyond a fixed
 * direction/suffix vocabulary. Unparseable input returns null and the caller
 * degrades that source honestly instead of querying with a guess.
 */

export interface ParsedStreet {
  /** House/building number as written, e.g. "200", "9035", "123-A". */
  number: string;
  /** Pre-direction normalized to N/S/E/W, or null. */
  predir: string | null;
  /** Street name in upper case without suffix, e.g. "SPRING", "TOPANGA CANYON". */
  name: string;
  /** Suffix normalized to its short form, e.g. "ST", "BLVD", or null. */
  suffix: string | null;
  /** Post-direction normalized to N/S/E/W, or null. */
  postdir: string | null;
}

const DIRECTIONS: Record<string, string> = {
  N: "N",
  NORTH: "N",
  S: "S",
  SOUTH: "S",
  E: "E",
  EAST: "E",
  W: "W",
  WEST: "W",
};

const SUFFIXES: Record<string, string> = {
  ST: "ST",
  STREET: "ST",
  AVE: "AVE",
  AVENUE: "AVE",
  BLVD: "BLVD",
  BOULEVARD: "BLVD",
  DR: "DR",
  DRIVE: "DR",
  LN: "LN",
  LANE: "LN",
  RD: "RD",
  ROAD: "RD",
  CT: "CT",
  COURT: "CT",
  PL: "PL",
  PLACE: "PL",
  TER: "TER",
  TERRACE: "TER",
  WAY: "WAY",
  CIR: "CIR",
  CIRCLE: "CIR",
  PKWY: "PKWY",
  PARKWAY: "PKWY",
};

/** Tokens that start a unit designator; everything from here is dropped. */
const UNIT_MARKERS = new Set(["APT", "UNIT", "STE", "SUITE", "#", "FL", "FLOOR", "RM", "ROOM"]);

function directionOf(token: string): string | null {
  return DIRECTIONS[token] ?? null;
}

function suffixOf(token: string): string | null {
  return SUFFIXES[token] ?? null;
}

/** Parse "200 N Spring St" into query parts. Returns null when unparseable. */
export function parseStreetAddress(input: string): ParsedStreet | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return null;
  let tokens = cleaned.split(" ");
  const unitAt = tokens.findIndex((token) => UNIT_MARKERS.has(token.replace(/^#+/, "")) || token.startsWith("#"));
  if (unitAt >= 0) tokens = tokens.slice(0, unitAt);
  if (tokens.length < 2) return null;
  const first = tokens[0] as string;
  if (!/^\d[\dA-Z-]*$/.test(first)) return null;
  const rest = tokens.slice(1);
  if (rest.length === 0) return null;

  let predir: string | null = null;
  let nameTokens = rest;
  const maybePredir = directionOf(rest[0] as string);
  if (maybePredir && rest.length >= 2) {
    predir = maybePredir;
    nameTokens = rest.slice(1);
  }
  if (nameTokens.length === 0) return null;

  let suffix: string | null = null;
  let postdir: string | null = null;
  const last = nameTokens[nameTokens.length - 1] as string;
  const maybePostdir = directionOf(last);
  if (maybePostdir && nameTokens.length >= 2) {
    postdir = maybePostdir;
    nameTokens = nameTokens.slice(0, -1);
  }
  const tail = nameTokens[nameTokens.length - 1] as string;
  const maybeSuffix = tail ? suffixOf(tail) : null;
  if (maybeSuffix && nameTokens.length >= 2) {
    suffix = maybeSuffix;
    nameTokens = nameTokens.slice(0, -1);
  }
  if (nameTokens.length === 0) return null;
  return { number: first, predir, name: nameTokens.join(" "), suffix, postdir };
}

/** Uppercase street line for prefix matching (LAHD stores one address string). */
export function streetPrefixFor(parsed: ParsedStreet): string {
  const parts = [parsed.number];
  if (parsed.predir) parts.push(parsed.predir);
  parts.push(parsed.name);
  if (parsed.suffix) parts.push(parsed.suffix);
  return parts.join(" ");
}
