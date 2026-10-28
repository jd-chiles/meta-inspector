// Server component only. Reads the non-secret server env APP_ANALYSIS_MODE so the
// fixture/live label stays visible without leaking credentials. Never read
// META_API_KEY (or any NEXT_PUBLIC_* secret) here: keys are server-only and must
// never enter the client bundle, logs, or exports (REQ-003, REQ-010, REQ-012).

import Flow from "./flow";

// Read the mode at request time so a production server started in fixture mode
// (npm run test:e2e) keeps fixture labeling even if the build ran elsewhere.
export const dynamic = "force-dynamic";

const DEMO_BANNER = "Demo checklist — not a verified Form 1083 mapping.";
const REVIEW_BANNER =
  "Draft for worker review — not an approved inspection or HMIS submission.";

export default function WalkthroughPage() {
  // Explicit fixture default: safe to render (and run browser acceptance) with no
  // Meta key configured. Live labeling appears only when the server opts in.
  const rawMode = process.env.APP_ANALYSIS_MODE;
  const analysisMode = rawMode === "live" ? "live" : "fixture";

  return (
    <>
      <header className="site-header">
        <div className="container">
          <p className="demo-banner" data-testid="demo-banner" role="note">
            {DEMO_BANNER}
          </p>
          <div className="wt-header-row">
            <div>
              <p className="wt-eyebrow">
                TLS-RRH · Housing navigator walkthrough tool
              </p>
              <h1 data-testid="walkthrough-heading">
                Habitability Walkthrough Companion
              </h1>
              <p className="subtitle">
                Capture mock-unit photos, review a neutral AI draft, record the
                hands-on checks a photo can never prove, and export a
                review-only summary for the file.
              </p>
            </div>
            <p
              className={`mode-badge mode-badge--${analysisMode}`}
              data-testid="analysis-mode"
              role="status"
            >
              Analysis mode: {analysisMode}
              {analysisMode === "fixture"
                ? " (mock output — not live inference)"
                : " (real provider call — mock-unit media only)"}
            </p>
          </div>
        </div>
      </header>

      <main id="main-content" className="container">
        <section aria-labelledby="about-heading">
          <h2 id="about-heading">How this walkthrough works</h2>
          <p className="wt-section-sub">
            Work top to bottom: capture one photo per item, decide on each
            draft, then export. The model drafts observations only — it never
            decides pass/fail or certifies habitability.
          </p>
        </section>

        <Flow analysisMode={analysisMode} />

        <section aria-labelledby="before-heading" className="wt-section">
          <h2 id="before-heading" className="wt-section-title">
            Before you begin
          </h2>
          <ul className="wt-list">
            <li>Use self-shot mock-unit photos only. No people, addresses, or tenant data.</li>
            <li>If the camera is unavailable or denied, file upload is offered instead.</li>
            <li>Everything on this page works with a keyboard; status is announced as text, not color alone.</li>
          </ul>
        </section>

        <section aria-labelledby="recovery-heading" className="wt-section">
          <h2 id="recovery-heading" className="wt-section-title">
            If something goes wrong
          </h2>
          <ul className="wt-list">
            <li>Reloading keeps this page; saved sessions recover from local storage, or explain their absence.</li>
            <li>Analysis errors name a safe code and a next action — never a key or provider body.</li>
            <li>Local deletion removes local media and drafts; it does not claim to delete provider copies.</li>
          </ul>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <p className="review-banner" role="note">
            {REVIEW_BANNER}
          </p>
        </div>
      </footer>
    </>
  );
}
