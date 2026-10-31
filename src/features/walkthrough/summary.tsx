/**
 * Printable review-only summary for one walkthrough session
 * (REQ-005, REQ-006, REQ-008, REQ-009).
 *
 * Real behavior, not a placeholder:
 * - Renders from a stable `ExportSnapshot` (built by
 *   `src/export/summary.ts`): the component never reads live reducer state,
 *   so late async work cannot rewrite the page mid-print, and rendering
 *   never changes review state.
 * - Shows the review-only banner plus the demo notice and the explicit
 *   fixture/live mode on screen and in print; completed items show the
 *   worker-approved note, unresolved items show an explicit reason with NO
 *   draft text.
 * - Photos render from embedded data: URLs only (never blob: or remote
 *   URLs). Missing media shows an explicit omission reason.
 * - Honest empty / error / unresolved states with role="status" / role="alert"
 *   announcements, text (non-color) cues, and keyboard-accessible print and
 *   download controls. Fluid layout safe at 360px; no hover-only controls.
 * - Never claims an approved inspection, a completed inspection, or an HMIS
 *   submission: an unresolved export says so plainly.
 *
 * This component owns no persistence, networking, or object URLs. The parent
 * passes the snapshot and wires `onPrint` / `onDownloadHtml`.
 */
"use client";

import {
  EXPORT_REVIEW_BANNER,
  type ExportSnapshot,
} from "../../export/summary";

export interface ExportSummaryProps {
  /** Stable snapshot or null when no exportable session is loaded yet. */
  snapshot: ExportSnapshot | null;
  /** Storage/recovery problem to announce; null when storage is healthy. */
  storageError?: string | null;
  onPrint?: () => void;
  /** Download the self-contained HTML (parent serializes the snapshot). */
  onDownloadHtml?: () => void;
  disabled?: boolean;
}

function defaultPrint(): void {
  if (typeof window !== "undefined" && typeof window.print === "function") {
    window.print();
  }
}

export default function ExportSummary(props: ExportSummaryProps) {
  const {
    snapshot,
    storageError = null,
    onPrint,
    onDownloadHtml,
    disabled = false,
  } = props;
  const handlePrint = onPrint ?? defaultPrint;

  if (snapshot === null) {
    return (
      <section
        id="export-summary"
        aria-labelledby="export-summary-heading"
        data-testid="export-summary"
        data-export-state="empty"
        className="wt-card"
      >
        <h3 id="export-summary-heading" className="wt-subhead">
          Review-only export
        </h3>
        <p className="wt-note" role="note" data-testid="export-empty">
          No exportable session yet. Capture a photo, obtain a draft, and
          record worker review and manual checks first — unreviewed content
          can never export as completed.
        </p>
        {storageError && (
          <p className="wt-statusline" role="alert" data-testid="export-error">
            Storage problem: {storageError} Recovery: reload, or reset storage
            to start a fresh local session.
          </p>
        )}
      </section>
    );
  }

  const modeText =
    snapshot.analysisMode === "fixture"
      ? "fixture (mock output — not live inference)"
      : "live (real provider call — mock-unit media only)";

  return (
    <section
      id="export-summary"
      aria-labelledby="export-summary-heading"
      data-testid="export-summary"
      data-export-state={snapshot.canClaimCompleted ? "completed" : "unresolved"}
      className="wt-card"
    >
      <h3 id="export-summary-heading" className="wt-subhead">
        Review-only export
      </h3>
      <p className="wt-note" role="note" data-testid="export-banner">
        {EXPORT_REVIEW_BANNER}
      </p>
      <p className="wt-note" data-testid="export-demo-notice">
        {snapshot.demoNotice}
      </p>
      <p className="wt-statusline" role="status" data-testid="export-mode">
        Analysis mode: {modeText}
      </p>
      <p className="wt-note" data-testid="export-meta">
        Session {snapshot.sessionId} · Catalog {snapshot.catalogId}{" "}
        {snapshot.catalogVersion} ({snapshot.catalogMode}) · Exported{" "}
        {snapshot.generatedAt}
      </p>

      {storageError && (
        <p className="wt-statusline" role="alert" data-testid="export-error">
          Storage problem: {storageError} The export below is a stable
          snapshot and is unchanged, but new work may not persist until
          storage recovers.
        </p>
      )}

      <p
        className="wt-statusline"
        role="status"
        data-testid="export-completion"
      >
        {snapshot.canClaimCompleted
          ? `Reviewed items: ${snapshot.completedCount} of ${snapshot.items.length}. All required checks recorded as performed. This remains a worker-review draft — not an approved inspection or HMIS submission.`
          : `Reviewed items: ${snapshot.completedCount} of ${snapshot.items.length}. Unresolved items: ${snapshot.unresolved.length}. This export is still a worker-review draft, not a finished inspection or HMIS submission.`}
      </p>

      {!snapshot.canClaimCompleted && (
        <div
          className="wt-alert"
          role="alert"
          data-testid="export-unresolved-summary"
        >
          <p className="wt-statusline">
            <strong>
              Cannot export as completed — {snapshot.unresolved.length}{" "}
              unresolved item(s).
            </strong>{" "}
            Pending, rejected, and failed items list below without draft text.
          </p>
          <ul className="wt-list">
            {snapshot.unresolved.map((entry) => (
              <li key={entry.itemId}>
                <strong>{entry.itemId}</strong> — {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="wt-actions wt-no-print">
        <button
          type="button"
          className="wt-btn wt-btn--primary"
          data-testid="export-print"
          disabled={disabled}
          onClick={handlePrint}
        >
          Print / save as PDF
        </button>
        {onDownloadHtml && (
          <button
            type="button"
            className="wt-btn"
            data-testid="export-download"
            disabled={disabled}
            onClick={onDownloadHtml}
          >
            Download self-contained HTML
          </button>
        )}
      </div>
      <p className="wt-note" role="note">
        Printing uses the browser print dialog. The review-only banner repeats
        on every printed page. Local export only — nothing is submitted
        anywhere.
      </p>

      {snapshot.items.map((item) => (
        <article
          key={item.itemId}
          data-testid={`export-item-${item.itemId}`}
          data-completed={item.completed ? "true" : "false"}
          className="wt-panel wt-export-item"
        >
          <p className="wt-note" role="note">
            {EXPORT_REVIEW_BANNER}
          </p>
          <h4 className="wt-subhead">{item.label}</h4>
          <p
            className="wt-statusline"
            role="status"
            data-testid={`export-item-status-${item.itemId}`}
          >
            {item.completed
              ? `Status: reviewed (${item.disposition}) — completed.`
              : `Status: ${item.status} (${item.disposition}) — unresolved: ${item.unresolvedReason ?? "unresolved"}.`}
          </p>
          {item.photoDataUrl ? (
            <figure className="wt-figure">
              {/* Embedded data URLs are printable local evidence; next/image cannot optimize them. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.photoDataUrl}
                alt={`Normalized photo for ${item.label}`}
                data-testid={`export-photo-${item.itemId}`}
              />
            </figure>
          ) : (
            <p
              className="wt-note"
              role="note"
              data-testid={`export-photo-missing-${item.itemId}`}
            >
              {item.photoOmittedReason ?? "No photo available."}
            </p>
          )}
          {item.completed ? (
            <div data-testid={`export-note-${item.itemId}`}>
              <p className="wt-statusline">
                <strong>Reviewed note (worker-approved):</strong>
              </p>
              <p className="wt-statusline">{item.reviewedNote ?? ""}</p>
              {item.unknowns.length > 0 && (
                <div>
                  <p className="wt-statusline">
                    <strong>What the photo cannot establish:</strong>
                  </p>
                  <ul className="wt-list">
                    {item.unknowns.map((line, index) => (
                      <li key={`${index}-${line}`}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p
              className="wt-note"
              role="note"
              data-testid={`export-unresolved-${item.itemId}`}
            >
              Unresolved — no approved note. Draft text is never exported for
              unresolved items.
            </p>
          )}
          <dl
            data-testid={`export-provenance-${item.itemId}`}
            className="wt-panel"
          >
            <dt className="wt-label">Evidence provenance</dt>
            <dd className="wt-kv">
              {item.provenance.map((row) => (
                <span key={row.label} className="wt-kv-row">
                  {row.label}: <code>{row.value}</code>
                </span>
              ))}
            </dd>
          </dl>
          <div data-testid={`export-checks-${item.itemId}`}>
            <p className="wt-statusline">
              <strong>Manual checks</strong>
            </p>
            <ul className="wt-list">
              {item.manualChecks.map((check) => (
                <li key={check.checkId}>
                  <strong>{check.instruction}</strong>{" "}
                  <span>
                    [
                    {check.outcome === "pending"
                      ? "pending — unresolved"
                      : check.outcome === "performed"
                        ? "performed"
                        : "not performed — unresolved"}
                    {check.note ? ` — “${check.note}”` : ""}
                    {check.recordedAt
                      ? ` (recorded ${check.recordedAt})`
                      : ""}
                    ]
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </article>
      ))}
    </section>
  );
}

export { EXPORT_REVIEW_BANNER };
