"use client";

/**
 * Building pre-screen card (REQ-R1). The demo literal still answers from a
 * labeled example; any other address runs the free public-record pipeline
 * (Census geocode, then LADBS cases, LAHD violations, FEMA flood, HUD lead
 * index, OpenFEMA disasters, HUD assisted housing, and EPA emissions in
 * parallel — all keyless — plus a key-gated SAM exclusion check). The query is
 * never persisted: it lives in component state, is sent only to the
 * same-origin /api/prescreen route, and never enters the inspection record.
 */
import { useRef, useState } from "react";

/** The only address with an (illustrative) answer. */
export const DEMO_PRESREEN_ADDRESS = "123 Demo St (example)";

/** Banner shown with every illustrative answer. */
export const PRESCREEN_ILLUSTRATIVE_BANNER = "Illustrative example — live records not connected.";

/** Notice shown with every fixture-mode report. */
export const PRESCREEN_FIXTURE_BANNER = "Sample pre-screen — not live public records.";

export type PrescreenDecision =
  | { kind: "empty" }
  | { kind: "example" }
  | { kind: "live" };

/** Pure address routing: demo literal → example, blank → explainer, else live. */
export function prescreenDecisionForAddress(address: string): PrescreenDecision {
  const normalized = address.trim().toLowerCase();
  if (normalized.length === 0) return { kind: "empty" };
  if (normalized === DEMO_PRESREEN_ADDRESS.toLowerCase()) return { kind: "example" };
  return { kind: "live" };
}

type SourceStatus = "ok" | "empty" | "unavailable" | "skipped";

interface SourceResult {
  status: SourceStatus;
  summary: string;
  records: Record<string, string>[];
  sourceUrl: string;
  detail?: string;
}

interface PrescreenReport {
  mode: "live" | "fixture";
  matchedAddress: string;
  tract: string | null;
  county: string | null;
  sources: {
    ladbs: SourceResult;
    lahd: SourceResult;
    flood: SourceResult;
    lead: SourceResult;
    disasters: SourceResult;
    hudAssisted: SourceResult;
    epaTri: SourceResult;
    sam: SourceResult;
  };
  fixtureNotice?: string;
}

const STATUSES: SourceStatus[] = ["ok", "empty", "unavailable", "skipped"];

function parseSource(value: unknown): SourceResult | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!STATUSES.includes(record.status as SourceStatus)) return null;
  if (typeof record.summary !== "string") return null;
  if (!Array.isArray(record.records)) return null;
  if (typeof record.sourceUrl !== "string") return null;
  const records: Record<string, string>[] = [];
  for (const row of record.records.slice(0, 10)) {
    if (typeof row !== "object" || row === null) return null;
    const clean: Record<string, string> = {};
    for (const [key, entry] of Object.entries(row as Record<string, unknown>)) {
      if (typeof entry !== "string") return null;
      clean[key] = entry.slice(0, 200);
    }
    records.push(clean);
  }
  return {
    status: record.status as SourceStatus,
    summary: record.summary.slice(0, 500),
    records,
    sourceUrl: record.sourceUrl.slice(0, 300),
    detail: typeof record.detail === "string" ? record.detail.slice(0, 300) : undefined,
  };
}

function parseReport(value: unknown): PrescreenReport | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.mode !== "live" && record.mode !== "fixture") return null;
  if (typeof record.matchedAddress !== "string") return null;
  const sources = record.sources as Record<string, unknown> | null;
  if (typeof sources !== "object" || sources === null) return null;
  const ladbs = parseSource(sources.ladbs);
  const lahd = parseSource(sources.lahd);
  const flood = parseSource(sources.flood);
  const lead = parseSource(sources.lead);
  const disasters = parseSource(sources.disasters);
  const hudAssisted = parseSource(sources.hudAssisted);
  const epaTri = parseSource(sources.epaTri);
  const sam = parseSource(sources.sam);
  if (!ladbs || !lahd || !flood || !lead || !disasters || !hudAssisted || !epaTri || !sam) return null;
  return {
    mode: record.mode,
    matchedAddress: record.matchedAddress.slice(0, 300),
    tract: typeof record.tract === "string" ? record.tract : null,
    county: typeof record.county === "string" ? record.county : null,
    sources: { ladbs, lahd, flood, lead, disasters, hudAssisted, epaTri, sam },
    fixtureNotice: typeof record.fixtureNotice === "string" ? record.fixtureNotice : undefined,
  };
}

const SOURCE_META: Array<{ key: keyof PrescreenReport["sources"]; title: string }> = [
  { key: "ladbs", title: "Open code-enforcement cases" },
  { key: "lahd", title: "LAHD violations" },
  { key: "hudAssisted", title: "Assisted housing nearby" },
  { key: "flood", title: "Flood zone" },
  { key: "lead", title: "Lead risk" },
  { key: "epaTri", title: "Nearby emissions" },
  { key: "disasters", title: "Disaster history" },
  { key: "sam", title: "Federal exclusions" },
];

function statusLabel(status: SourceStatus): string {
  switch (status) {
    case "ok": return "Found";
    case "empty": return "None found";
    case "unavailable": return "Unavailable";
    case "skipped": return "Skipped";
  }
}

export default function BuildingPrescreen(): React.JSX.Element {
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("Los Angeles");
  const [state, setState] = useState("CA");
  const [zip, setZip] = useState("");
  const [decision, setDecision] = useState<PrescreenDecision>({ kind: "empty" });
  const [report, setReport] = useState<PrescreenReport | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  async function runLiveCheck(): Promise<void> {
    const sequence = requestRef.current + 1;
    requestRef.current = sequence;
    setPending(true);
    setError("");
    setReport(null);
    try {
      const response = await fetch("/api/prescreen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ street: street.trim(), city: city.trim(), state: state.trim(), zip: zip.trim() }),
      });
      const body = (await response.json()) as unknown;
      if (sequence !== requestRef.current) return;
      if (!response.ok) {
        const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
        const nested = typeof record.error === "object" && record.error !== null ? (record.error as Record<string, unknown>) : {};
        throw new Error(typeof nested.message === "string" ? nested.message : "The pre-screen could not run. Nothing was saved.");
      }
      const parsed = parseReport(body);
      if (!parsed) throw new Error("The pre-screen returned an unusable response. Nothing was saved.");
      setReport(parsed);
    } catch (caught) {
      if (sequence !== requestRef.current) return;
      setError(caught instanceof Error ? caught.message : "The pre-screen is unavailable. Nothing was saved.");
    } finally {
      if (sequence === requestRef.current) setPending(false);
    }
  }

  return (
    <div data-testid="building-prescreen">
      <p>
        Check whether a building has open habitability cases before you visit. Free public
        records only — the address is looked up, never saved.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const next = prescreenDecisionForAddress(street);
          setDecision(next);
          setError("");
          if (next.kind === "live") void runLiveCheck();
          else setReport(null);
        }}
      >
        <label htmlFor="prescreen-address">Street address</label>
        <input
          id="prescreen-address"
          data-testid="prescreen-address"
          value={street}
          maxLength={200}
          placeholder={DEMO_PRESREEN_ADDRESS}
          autoComplete="off"
          onChange={(event) => setStreet(event.currentTarget.value)}
        />
        <label htmlFor="prescreen-city">City</label>
        <input
          id="prescreen-city"
          data-testid="prescreen-city"
          value={city}
          maxLength={100}
          autoComplete="off"
          onChange={(event) => setCity(event.currentTarget.value)}
        />
        <label htmlFor="prescreen-state">State</label>
        <input
          id="prescreen-state"
          data-testid="prescreen-state"
          value={state}
          maxLength={100}
          autoComplete="off"
          onChange={(event) => setState(event.currentTarget.value)}
        />
        <label htmlFor="prescreen-zip">ZIP (optional)</label>
        <input
          id="prescreen-zip"
          data-testid="prescreen-zip"
          value={zip}
          maxLength={20}
          autoComplete="off"
          inputMode="numeric"
          onChange={(event) => setZip(event.currentTarget.value)}
        />
        <button type="submit" data-testid="prescreen-check" disabled={pending}>
          {pending ? "Checking…" : "Check building"}
        </button>
      </form>
      {error !== "" && <p role="alert" data-testid="prescreen-error">{error}</p>}
      {decision.kind === "example" && (
        <div data-testid="prescreen-result" role="status">
          <p><strong>{PRESCREEN_ILLUSTRATIVE_BANNER}</strong></p>
          <p>Example result for {DEMO_PRESREEN_ADDRESS}:</p>
          <ul>
            <li>Open code-enforcement cases (example): 2</li>
            <li>Oldest open case (example): peeling paint, opened 2024-05-01</li>
            <li>Last inspection (example): 2024-05-01 — passed with 1 minor correction</li>
          </ul>
        </div>
      )}
      {decision.kind === "live" && report && (
        <div data-testid="prescreen-result" role="status">
          {report.mode === "fixture" && <p><strong>{PRESCREEN_FIXTURE_BANNER}</strong></p>}
          <p data-testid="prescreen-matched">Matched: {report.matchedAddress}</p>
          {report.county && <p>County: {report.county}{report.tract ? ` · Tract ${report.tract}` : ""}</p>}
          {SOURCE_META.map(({ key, title }) => {
            const source = report.sources[key];
            return (
              <section key={key} aria-label={title} data-testid={`prescreen-source-${key}`}>
                <h3>{title} — {statusLabel(source.status)}</h3>
                <p>{source.summary}</p>
                {source.detail && <p>{source.detail}</p>}
                {source.records.length > 0 && (
                  <ul>
                    {source.records.map((row, index) => (
                      <li key={index}>{Object.entries(row).map(([field, value]) => `${field}: ${value}`).join(" · ")}</li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          <p>Free public records, checked just now. A clean screen is not a clearance — verify against the linked sources before relying on it.</p>
        </div>
      )}
    </div>
  );
}
