"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import "./landing.css";

type SourceStatus = "ok" | "empty" | "unavailable" | "skipped";
type SourceResult = {
  status: SourceStatus;
  summary: string;
  records: Record<string, string>[];
  sourceUrl: string;
  detail?: string;
};
type PrescreenReport = {
  mode: "live" | "fixture";
  matchedAddress: string;
  tract: string | null;
  county: string | null;
  sources: {
    ladbs: SourceResult; lahd: SourceResult; flood: SourceResult; lead: SourceResult;
    disasters: SourceResult; hudAssisted: SourceResult; epaTri: SourceResult; sam: SourceResult; samEntity: SourceResult;
  };
  fixtureNotice?: string;
};

const SOURCE_META: Array<{ key: keyof PrescreenReport["sources"]; title: string; blurb: string }> = [
  { key: "ladbs", title: "Open code-enforcement cases", blurb: "City of LA LADBS — open N-cases at the street number" },
  { key: "lahd", title: "LAHD violations", blurb: "Housing Dept. violations + SCEP history" },
  { key: "hudAssisted", title: "HUD assisted housing", blurb: "Subsidized properties within 1km — REAC + troubled flag" },
  { key: "flood", title: "Flood zone", blurb: "FEMA NFHL — effective flood designation" },
  { key: "lead", title: "Lead risk", blurb: "HUD deteriorated-paint index by census tract" },
  { key: "epaTri", title: "Nearby emissions", blurb: "EPA TRI facilities in the ZIP — context, not a disqualifier" },
  { key: "disasters", title: "Disaster history", blurb: "OpenFEMA — recent federal declarations for the state" },
  { key: "sam", title: "Federal exclusions", blurb: "SAM.gov — is the owner excluded from federal programs?" },
  { key: "samEntity", title: "Owner identity", blurb: "SAM.gov entity — registration, UEI, and address match" },
];

function pillClass(s: SourceStatus): string {
  return `lp-pill ${s}`;
}
function statusLabel(s: SourceStatus): string {
  return s === "ok" ? "Found" : s === "empty" ? "None found" : s === "unavailable" ? "Unavailable" : "Skipped";
}

export default function LandingClient({ analysisMode }: { analysisMode: "live" | "fixture" | "unconfigured" }) {
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("Los Angeles");
  const [state, setState] = useState("CA");
  const [zip, setZip] = useState("");
  const [owner, setOwner] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [leadOk, setLeadOk] = useState(false);
  const [report, setReport] = useState<PrescreenReport | null>(null);
  const [showAll, setShowAll] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setReport(null); setLeadOk(false);
    const emailTrim = email.trim();
    // Email is the capture hook — required for landing
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) { setError("Enter a valid work email to receive the full report."); return; }
    if (!consent) { setError("Please check the contact consent to continue."); return; }
    if (!street.trim() || !city.trim() || !state.trim()) { setError("Enter street, city, and state to screen."); return; }
    setPending(true);
    try {
      // 1) capture lead — never includes address (privacy: leads = contact only)
      const leadRes = await fetch("/api/leads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailTrim, name: name.trim(), org: org.trim(),
          consent: true, source: "landing-prescreen",
          zip5: zip.trim().slice(0,5),
          ownerChecked: owner.trim().length > 0,
        }),
      });
      if (!leadRes.ok) {
        const j = await leadRes.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? "Could not save your contact. Try again.");
      }
      setLeadOk(true);

      // 2) run prescreen — address only, never saved
      const prescreenRes = await fetch("/api/prescreen", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          street: street.trim(), city: city.trim(), state: state.trim(),
          zip: zip.trim(), ...(owner.trim() ? { owner: owner.trim() } : {}),
        }),
      });
      const body = await prescreenRes.json().catch(() => null) as PrescreenReport & { error?: { message: string } } | null;
      if (!prescreenRes.ok) throw new Error((body as { error?: { message: string } })?.error?.message ?? "The pre-screen could not run. Nothing was saved.");
      if (!body || typeof body !== "object" || !("sources" in body)) throw new Error("The pre-screen returned an unusable response.");
      setReport(body as PrescreenReport);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally { setPending(false); }
  }

  const isLive = analysisMode === "live";
  return (
    <div className="lp" data-testid="landing-page">
      <header className="lp-header">
        <div className="lp-header-inner">
          <Link className="lp-brand" href="/welcome">
            <span className="lp-mark" aria-hidden="true">WK</span>
            <span>
              <h1>WalkthroughKit</h1>
              <small>Meta Inspect · LAHSA Form 1083 Companion</small>
            </span>
          </Link>
          <nav className="lp-nav" aria-label="Primary">
            <Link href="/">Open app</Link>
            <a className="lp-cta" href="#prescreen">Check a building</a>
          </nav>
        </div>
      </header>

      <section className="lp-hero">
        <div>
          <p className="lp-eyebrow">Pre-inspection · Free public records</p>
          <h2>Know the building <em>before</em> you walk in.</h2>
          <p className="lede">
            A 30-second pre-screen for LA housing navigators. Paste an address — we pull 9 public datasets in parallel:
            open LADBS cases, LAHD violations, FEMA flood, HUD lead &amp; assisted housing, EPA emissions, disaster history, and <strong>SAM.gov federal exclusions + entity identity</strong> when you add the owner.
            <br /><strong>The address is looked up, never saved.</strong>
          </p>
          <div className="lp-badges">
            <span className={`lp-badge ${isLive ? "live" : ""}`}>{isLive ? "● Live records connected" : "○ Sample mode in this preview"}</span>
            <span className="lp-badge">LADBS · LAHD · FEMA · HUD · EPA · SAM.gov</span>
            <span className="lp-badge">Privacy-first · No storage</span>
          </div>
        </div>
        <div className="lp-hero-card">
          <h3>What you get — instantly</h3>
          <ol>
            <li><strong>Matched address + tract/county</strong> from Census Geocoder</li>
            <li><strong>2 LA case sources</strong> — open code-enforcement + LAHD violations with dates</li>
            <li><strong>5 housing-context sources</strong> — flood zone, lead index, assisted properties, TRI emissions, disaster history</li>
            <li><strong>2 SAM.gov checks</strong> — federal exclusion + owner entity identity (needs owner name + server key)</li>
          </ol>
          <p className="hint" style={{ margin: 0, color: "var(--lp-muted)", fontSize: "0.82rem" }}>A clean screen is not a clearance — verify against the linked source before relying on it. Not a legal determination.</p>
          <a className="lp-mini-link" href="#how-it-works">How it works →</a>
        </div>
      </section>

      <div className="lp-shell" id="prescreen">
        <section className="lp-panel" aria-labelledby="prescreen-heading">
          <h3 id="prescreen-heading">Building pre-screen — free</h3>
          <p className="hint">Try it now. Enter the address and your email to get the full report. We email you the summary and let you know when the full walkthrough app is ready for your team. Address is sent only to the public-record endpoints and is never stored.</p>
          <form className="lp-form" onSubmit={onSubmit}>
            <div className="lp-field">
              <label htmlFor="lp-street">Street address *</label>
              <input id="lp-street" value={street} onChange={e => setStreet(e.target.value)} placeholder="200 N Spring St" maxLength={200} autoComplete="street-address" required />
            </div>
            <div className="lp-grid2">
              <div className="lp-field"><label htmlFor="lp-city">City *</label><input id="lp-city" value={city} onChange={e => setCity(e.target.value)} maxLength={100} autoComplete="address-level2" required /></div>
              <div className="lp-field"><label htmlFor="lp-state">State *</label><input id="lp-state" value={state} onChange={e => setState(e.target.value)} maxLength={100} autoComplete="address-level1" required /></div>
            </div>
            <div className="lp-grid2">
              <div className="lp-field"><label htmlFor="lp-zip">ZIP (optional, improves EPA/TRI)</label><input id="lp-zip" value={zip} onChange={e => setZip(e.target.value)} maxLength={20} inputMode="numeric" placeholder="90012" /></div>
              <div className="lp-field"><label htmlFor="lp-owner">Owner name (optional, enables SAM.gov)</label><input id="lp-owner" value={owner} onChange={e => setOwner(e.target.value)} maxLength={100} placeholder="As listed with county assessor" /><small>Find it at the <a href="https://portal.assessor.lacounty.gov/" target="_blank" rel="noopener noreferrer">LA County Assessor Portal</a></small></div>
            </div>

            <hr className="lp-divider" />
            <div className="lp-field"><label htmlFor="lp-email">Work email * (to receive the report)</label><input id="lp-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@org.org" maxLength={254} autoComplete="email" required /></div>
            <div className="lp-grid2">
              <div className="lp-field"><label htmlFor="lp-name">Your name (optional)</label><input id="lp-name" value={name} onChange={e => setName(e.target.value)} maxLength={100} autoComplete="name" /></div>
              <div className="lp-field"><label htmlFor="lp-org">Organization (optional)</label><input id="lp-org" value={org} onChange={e => setOrg(e.target.value)} maxLength={100} placeholder="Housing navigation team" /></div>
            </div>
            <label className="lp-check">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required />
              <span>I agree to be contacted about WalkthroughKit and the pre-screen results. I understand the address is never saved and <a href="#privacy">my contact info is only used for follow-up</a>. *</span>
            </label>

            <button className="lp-btn" type="submit" disabled={pending}>{pending ? "Checking…" : "Check building — free, instant"}</button>
            {error && <p className="lp-status lp-status--err" role="alert">{error}</p>}
            {leadOk && !error && !report && <p className="lp-status lp-status--info">Contact saved. Running public-record checks…</p>}
            <p className="hint">Free forever for the pre-screen. Full walkthrough (4 rooms, AI drafts, 11-element review, 3 PDFs) is free in the pilot at <Link href="/">/</Link>. No spam — one follow-up, unsubscribe anytime.</p>
          </form>
        </section>

        <div className="lp-results" ref={resultsRef} aria-live="polite">
          {!report && (
            <div className="lp-panel">
              <h3>Your results will appear here</h3>
              <p className="hint">Each source runs independently — a slow dataset never blocks the others. Typical end-to-end is ~2–4s for the geocode + parallel fan-out.</p>
              {!isLive && <p className="lp-status lp-status--info">This preview is in <strong>sample mode</strong> — live Census/LADBS/LAHD/FEMA/HUD/EPA/SAM will connect when <code>APP_ANALYSIS_MODE=live</code> is set on the server (already live on walkthroughkit.com).</p>}
              <div className="lp-source">
                <h4>Preview — what a live result looks like</h4>
                <ul>
                  <li><strong>Open cases:</strong> 1 open LADBS habitability case at this street number — opened 2024-05-01</li>
                  <li><strong>LAHD:</strong> No LAHD violations found for this address</li>
                  <li><strong>Flood:</strong> Zone X — minimal flood hazard</li>
                  <li><strong>SAM.gov:</strong> Needs owner name — paste from the assessor portal to run both federal checks</li>
                </ul>
                <p className="lp-proof">Real results link directly to the source dataset for verification.</p>
              </div>
            </div>
          )}
          {report && (
            <>
              <div className="lp-panel">
                <h3>Matched: {report.matchedAddress}</h3>
                {(report.county || report.tract) && <p className="hint">{report.county}{report.tract ? ` · Tract ${report.tract}` : ""}</p>}
                {report.mode === "fixture" && <p className="lp-status lp-status--info"><strong>Sample pre-screen — not live public records.</strong> Set <code>APP_ANALYSIS_MODE=live</code> on the server for live Census/LA/FEMA/HUD/EPA/SAM.</p>}
                {report.mode === "live" && <p className="lp-status lp-status--ok">Live public records, checked just now. A clean screen is not a clearance — verify against the linked sources.</p>}
                <p className="lp-proof" id="privacy">Privacy: this address was sent only to the allowlisted public-record endpoints (Census, LA City Socrata, FEMA, HUD, EPA, and SAM.gov when enabled). It was never persisted, never logged, and never traced. Your email is stored separately for follow-up — it is not joined to the address.</p>
              </div>
              {(showAll ? SOURCE_META : SOURCE_META.slice(0, 4)).map(({ key, title, blurb }) => {
                const s = report.sources[key];
                return (
                  <section key={key} className="lp-source" data-testid={`prescreen-source-${key}`}>
                    <div className="lp-source-head"><h4>{title}</h4><span className={pillClass(s.status)}>{statusLabel(s.status)}</span></div>
                    <p>{s.summary}</p>
                    {s.detail && <p><em>{s.detail}</em></p>}
                    {s.records.length > 0 && <ul>{s.records.map((row, i) => <li key={i}>{Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(" · ")}</li>)}</ul>}
                    <p className="hint"><a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">Open source dataset ↗</a> · {blurb}</p>
                  </section>
                );
              })}
              {!showAll && report && <button className="lp-btn lp-btn-secondary" type="button" onClick={() => setShowAll(true)}>Show all 9 sources (HUD · EPA · SAM.gov)</button>}
              {showAll && (
                <div className="lp-panel">
                  <h3>What next?</h3>
                  <p className="hint">Decide to visit, bring evidence cues, or share the summary with your team. When you&apos;re ready to walk the unit, the full app films 4 rooms, drafts the 11 LAHSA Form 1083 elements against your video evidence, and exports local PDFs + JSON for your manual workflow.</p>
                  <Link className="lp-btn" href="/">Open the full walkthrough app →</Link>
                  <a className="lp-btn lp-btn-secondary" href="#prescreen" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Check another address</a>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <section className="lp-section" id="how-it-works">
        <h3>How it works</h3>
        <p className="section-lede">No account. No saving. One geocode → nine checks in parallel, each degrading gracefully so a slow dataset never blocks you.</p>
        <div className="lp-steps">
          <div className="lp-step-card"><h4>Enter address + owner</h4><p>Census Geocoder resolves the building to lat/lon, tract, and county. Add owner from the assessor portal to unlock SAM.gov federal exclusions + entity identity.</p></div>
          <div className="lp-step-card"><h4>9 public datasets — live</h4><p>LADBS open cases · LAHD violations · FEMA flood · HUD lead · HUD assisted housing · OpenFEMA disasters · EPA TRI · SAM.gov exclusions · SAM.gov entity. All keyless except SAM (free key).</p></div>
          <div className="lp-step-card"><h4>Decide, then walk</h4><p>See the cleanest summary your phone can give before you spend staff time on-site. Bring the full walkthrough app for timestamped evidence + Form 1083 review when you go.</p></div>
        </div>
      </section>

      <section className="lp-section">
        <h3>Why SAM.gov matters</h3>
        <p className="section-lede">Funders may require that the property owner is not federally excluded and that the entity identity matches the address you&apos;re visiting. That check is free but gated — SAM.gov issues a personal API key to any registered user; we cache results 24h so you don&apos;t burn quota, and we tell you exactly when a key is missing, rejected, or rate-limited (429).</p>
        <div className="lp-cards">
          <div className="lp-card-mini"><h4>Federal exclusion check</h4><p>Runs only when the server has <code>SAM_API_KEY</code> AND you supply an owner name. Returns name/type/effective date — verify identity before relying on a match.</p></div>
          <div className="lp-card-mini"><h4>Owner identity + address match</h4><p>SAM.gov entity registration, UEI, registration status, and whether the registered physical address matches the screened property — the disambiguator for same-name entities.</p></div>
          <div className="lp-card-mini"><h4>Assessor lookup</h4><p>LA County Assessor Portal is the honest source for the owner string. Link is in the form — never guess, never invent an owner/API key.</p></div>
        </div>
      </section>

      <section className="lp-section">
        <h3>Built for housing navigators</h3>
        <p className="section-lede">WalkthroughKit is the public front door to <strong>Meta Inspect — Move-in Ready</strong>: a mobile-first, offline-tolerant LAHSA Form 1083 companion. Film 4 rooms, get unreviewed AI drafts tied to actual video stills, record your own A/D decisions, sign, and export 3 local PDFs + JSON for your manual HMIS workflow. Mock-unit pilot only — no direct submission, no automated verdict.</p>
        <div className="lp-cards">
          <div className="lp-card-mini"><h4>Before the visit</h4><p>Pre-screen any LA building for open habitability cases — free.</p></div>
          <div className="lp-card-mini"><h4>During the walk</h4><p>Voice-guided capture with room prompts (faucet, fan, lock, detector) — one take per room.</p></div>
          <div className="lp-card-mini"><h4>After</h4><p>Review 11 elements against timestamped evidence, sign-off (evaluator + participant), and download client, fix-list, and Form 1083 PDFs.</p></div>
        </div>
      </section>

      <div className="lp-cta-band">
        <div><h3>Ready to screen a building?</h3><p>Free, instant, and private. We&apos;ll send you the summary and one follow-up about the full walkthrough — then leave you alone unless you opt in.</p></div>
        <a className="lp-btn" href="#prescreen" onClick={(e) => { e.preventDefault(); document.getElementById("prescreen")?.scrollIntoView({ behavior: "smooth" }); }}>Check a building now</a>
      </div>

      <footer className="lp-footer">
        <div><strong>WalkthroughKit</strong> · walkthroughkit.com · Built for LAHSA Form 1083 mock-unit walkthroughs. Not an HMIS submission. Not affiliated with LAHD, LADBS, FEMA, HUD, EPA, or GSA — we just query their free public records.</div>
        <div>Full app: <Link href="/">/</Link> · Source datasets linked per result · File a correction with the source agency — we surface, they decide.</div>
        <div>Contact: reply to the report email or leave your org in the form above. <span id="privacy">Privacy:</span> address is looked up and never saved; contact info is stored separately for follow-up and never joined to an address. To delete: reply &quot;delete&quot;.</div>
        <div style={{ color: "#9fb3ac" }}>Meta Inspect · {analysisMode} mode{isLive ? " · Census + LA City + FEMA + HUD + EPA + SAM.gov" : ""}</div>
      </footer>
    </div>
  );
}
