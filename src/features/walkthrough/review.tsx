/**
 * Worker review and manual-check UI for one walkthrough item
 * (REQ-004, REQ-005, REQ-006, REQ-009).
 *
 * Real behavior, not a placeholder:
 * - Draft, unknowns, required checks, and provenance stay visible together
 *   in one section so the worker never reviews text without its context.
 * - Accept / edit-and-accept / reject call back to the session manager, which
 *   creates a new revision through the pure reducer; accepting text never
 *   touches manual-check responses, so accepting a draft cannot mark a
 *   physical test performed (that separation is enforced in the reducer and
 *   re-asserted in unit tests — this component only presents both honestly).
 * - Required catalog checks are always shown and can never be cleared by
 *   model suggestions; each check records performed/not-performed plus a
 *   worker note, and "not-performed" stays visibly unresolved.
 * - Honest empty / loading / error / rejected states with role="status" /
 *   role="alert" announcements, visible text (non-color) cues, and
 *   keyboard-accessible recovery (reanalyze, cancel, retry a check, choose a
 *   different photo via the capture step). No hover-only controls; fluid
 *   layout safe at 360px; explicit fixture/live mode labels.
 *
 * This component owns no persistence, networking, or object URLs: the parent
 * passes the item record, catalog item, preview URL, and callbacks wired to
 * the session manager. Raw model text is rendered as text (React escapes by
 * default) and never interpreted.
 */
"use client";

import { useId, useState } from "react";

import {
  effectiveManualChecks,
  type CatalogItem,
} from "../../domain/catalog";
import {
  unresolvedRequiredChecks,
  type ItemRecord,
  type ManualOutcome,
} from "../../domain/evidence";

export type AnalysisModeLabel = "live" | "fixture";

export interface WorkerReviewProps {
  item: ItemRecord;
  /** Catalog entry for required checks; null renders an explicit gap state. */
  catalogItem: CatalogItem | null;
  sessionId: string;
  catalogVersion: string;
  /** Transient preview URL (object URL or canonical rehydration), if any. */
  previewUrl: string | null;
  /** Explicit fixture/live label (never silently substituted). */
  analysisMode: AnalysisModeLabel;
  /** Accept the current draft verbatim as the worker note. */
  onAccept: () => void;
  /** Accept the draft with worker-edited text; original draft is preserved. */
  onAcceptEdited: (revisedText: string) => void;
  /** Reject the current draft with a worker reason. */
  onReject: (reason: string) => void;
  /** Record one manual check (performed/not-performed plus worker note). */
  onRecordManualCheck: (
    checkId: string,
    outcome: ManualOutcome,
    note: string,
  ) => void;
  /** Record (create or edit) the worker-only finding for this item. Worker
   * text only — never populated from model output. */
  onRecordDeficiency: (input: {
    issueDescription: string;
    correctiveAction: string;
    responsibleParty?: string;
    targetDate?: string;
  }) => void;
  /** Clear the recorded worker finding for this item. */
  onClearDeficiency: () => void;
  /** Invalidate the current review/draft and request a fresh analysis. */
  onReanalyze: () => void;
  /** Abort inflight analysis; the photo is kept. Rendered while analyzing. */
  onCancelAnalysis?: () => void;
  disabled?: boolean;
}

/** Screen-reader and test-stable panel kinds derived from item status. */
export type ReviewPanelKind =
  | "empty"
  | "loading"
  | "awaiting-review"
  | "reviewed"
  | "rejected"
  | "error";

/** Map reducer status to the review panel kind shown to the worker. */
export function reviewPanelKind(item: Pick<ItemRecord, "status">): ReviewPanelKind {
  switch (item.status) {
    case "analyzing":
      return "loading";
    case "draft":
      return "awaiting-review";
    case "reviewed":
      return "reviewed";
    case "rejected":
      return "rejected";
    case "error":
      return "error";
    default:
      return "empty";
  }
}

/** Required check IDs that still lack a resolving "performed" response. */
export function reviewUnresolvedIds(
  requiredCheckIds: string[],
  item: Pick<ItemRecord, "manualChecks">,
): string[] {
  return unresolvedRequiredChecks(requiredCheckIds, item.manualChecks);
}

/** One provenance row for the visible-together evidence header. */
export interface ProvenanceRow {
  label: string;
  value: string;
}

/**
 * Provenance rows for an item: every row binds the evidence to its session,
 * item, catalog version, normalized media identity, attempt, and review
 * revision (REQ-006). Pure helper so unit tests can assert the exact
 * identity surface without rendering.
 */
export function reviewProvenanceRows(
  item: ItemRecord,
  sessionId: string,
  catalogVersion: string,
  analysisMode: AnalysisModeLabel,
): ProvenanceRow[] {
  return [
    { label: "Session", value: sessionId },
    { label: "Item", value: item.itemId },
    { label: "Catalog version", value: catalogVersion },
    { label: "Media ID", value: item.mediaId ?? "none yet" },
    { label: "Media digest", value: item.mediaHash ?? "none yet" },
    { label: "Attempt", value: String(item.attempt) },
    { label: "Review revision", value: String(item.revision) },
    {
      label: "Disposition",
      value:
        item.dispositionAt !== null
          ? `${item.disposition} (recorded ${item.dispositionAt})`
          : item.disposition,
    },
    { label: "Analysis mode", value: analysisMode },
  ];
}

function shortHash(hash: string | null): string {
  if (!hash || hash === "none yet") return "none yet";
  return hash.length > 20 ? `${hash.slice(0, 12)}…${hash.slice(-6)}` : hash;
}

export default function WorkerReview(props: WorkerReviewProps) {
  const {
    item,
    catalogItem,
    sessionId,
    catalogVersion,
    previewUrl,
    analysisMode,
    onAccept,
    onAcceptEdited,
    onReject,
    onRecordManualCheck,
    onRecordDeficiency,
    onClearDeficiency,
    onReanalyze,
    onCancelAnalysis,
    disabled = false,
  } = props;

  const headingId = useId();
  const editId = useId();
  const rejectId = useId();
  const deficiencyIssueId = useId();
  const deficiencyActionId = useId();
  const deficiencyPartyId = useId();
  const deficiencyDateId = useId();
  const kind = reviewPanelKind(item);
  const requiredIds = catalogItem ? catalogItem.manualChecks.map((c) => c.id) : [];
  const unresolved = reviewUnresolvedIds(requiredIds, item);
  const effective = catalogItem
    ? effectiveManualChecks(catalogItem, item.draft?.suggestedManualChecks ?? [])
    : [];
  const provenance = reviewProvenanceRows(item, sessionId, catalogVersion, analysisMode);

  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [checkError, setCheckError] = useState<string | null>(null);
  const [deficiencyOpen, setDeficiencyOpen] = useState(false);
  const [deficiencyIssue, setDeficiencyIssue] = useState("");
  const [deficiencyAction, setDeficiencyAction] = useState("");
  const [deficiencyParty, setDeficiencyParty] = useState("");
  const [deficiencyDate, setDeficiencyDate] = useState("");
  const [deficiencyError, setDeficiencyError] = useState<string | null>(null);

  const itemLabel = catalogItem ? catalogItem.label : item.itemId;
  const controlsDisabled = disabled || kind === "loading";

  function handleAcceptEdited(): void {
    setEditError(null);
    const trimmed = editText.trim();
    if (trimmed.length === 0) {
      setEditError("Edited text cannot be empty. Describe what you verified in your own words.");
      return;
    }
    if (trimmed.length > 2000) {
      setEditError("Edited text must be at most 2000 characters.");
      return;
    }
    onAcceptEdited(editText);
    setEditOpen(false);
  }

  function handleReject(): void {
    setRejectError(null);
    if (rejectReason.trim().length === 0) {
      setRejectError("A rejection reason is required so the next worker knows what was wrong.");
      return;
    }
    onReject(rejectReason);
    setRejectOpen(false);
  }

  function handleRecordCheck(checkId: string, outcome: ManualOutcome): void {
    setCheckError(null);
    const note = (notes[checkId] ?? "").trim();
    if (note.length === 0) {
      setCheckError(
        "A worker note is required for every manual check — the check stays pending without one.",
      );
      return;
    }
    onRecordManualCheck(checkId, outcome, notes[checkId] ?? "");
  }

  function openDeficiencyEditor(): void {
    setDeficiencyError(null);
    // Prefill only from the worker's own previously recorded finding.
    // The AI draft is never copied here.
    const current = item.deficiency;
    setDeficiencyIssue(current?.issueDescription ?? "");
    setDeficiencyAction(current?.correctiveAction ?? "");
    setDeficiencyParty(current?.responsibleParty ?? "");
    setDeficiencyDate(current?.targetDate ?? "");
    setDeficiencyOpen(true);
  }

  function handleSaveDeficiency(): void {
    setDeficiencyError(null);
    const issue = deficiencyIssue.trim();
    const action = deficiencyAction.trim();
    const party = deficiencyParty.trim();
    const date = deficiencyDate.trim();
    if (issue.length === 0) {
      setDeficiencyError(
        "Describe the issue in your own words — this field is required.",
      );
      return;
    }
    if (issue.length > 1000) {
      setDeficiencyError("The issue description must be at most 1000 characters.");
      return;
    }
    if (action.length === 0) {
      setDeficiencyError(
        "Describe the corrective action in your own words — this field is required.",
      );
      return;
    }
    if (action.length > 1000) {
      setDeficiencyError("The corrective action must be at most 1000 characters.");
      return;
    }
    if (party.length > 200) {
      setDeficiencyError("The responsible party must be at most 200 characters.");
      return;
    }
    if (date.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setDeficiencyError("The target date must use YYYY-MM-DD format, or be left empty.");
      return;
    }
    if (date.length > 0 && Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) {
      setDeficiencyError("That target date is not a real calendar date.");
      return;
    }
    onRecordDeficiency({
      issueDescription: deficiencyIssue,
      correctiveAction: deficiencyAction,
      ...(party.length > 0 ? { responsibleParty: party } : {}),
      ...(date.length > 0 ? { targetDate: date } : {}),
    });
    setDeficiencyOpen(false);
  }

  function handleClearDeficiency(): void {
    setDeficiencyError(null);
    onClearDeficiency();
    setDeficiencyOpen(false);
  }

  const deficiency = item.deficiency ?? null;
  const deficiencyHasPhoto = item.mediaId !== null;

  return (
    <section
      aria-labelledby={headingId}
      data-testid={`review-${item.itemId}`}
      data-panel-kind={kind}
      className="wt-card"
    >
      <h4 id={headingId} className="wt-subhead">
        Worker review for: {itemLabel}
      </h4>
      <p className="wt-statusline" data-testid={`review-mode-${item.itemId}`}>
        Analysis mode: {analysisMode}
        {analysisMode === "fixture"
          ? " (mock output — not live inference)"
          : " (real provider call — mock-unit media only)"}
      </p>
      <p className="wt-note" role="note">
        Draft for worker review — not an approved inspection or HMIS
        submission. Accepting text never completes a physical test: record
        each required check separately below.
      </p>

      {previewUrl && (
        <figure className="wt-figure">
          {/* Local object URLs are transient device media; next/image cannot optimize them. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={`Staged photo under review for ${itemLabel}`}
            data-testid={`review-photo-${item.itemId}`}
          />
        </figure>
      )}

      {/* Provenance stays visible with the draft (REQ-006). */}
      <dl
        data-testid={`review-provenance-${item.itemId}`}
        className="wt-panel"
      >
        <dt className="wt-label">Evidence provenance</dt>
        <dd className="wt-kv">
          {provenance.map((row) => (
            <span key={row.label} className="wt-kv-row">
              {row.label}:{" "}
              <code>
                {row.label === "Media digest" ? shortHash(row.value) : row.value}
              </code>
              {row.label === "Media digest" && row.value !== "none yet" && (
                <span
                  className="wt-note"
                  style={{ display: "block" }}
                  title={row.value}
                >
                  Full digest: <code className="wt-kv-row">{row.value}</code>
                </span>
              )}
            </span>
          ))}
        </dd>
      </dl>

      {/* Review status mirror (text, never color-only). */}
      <p
        className="wt-statusline"
        role="status"
        data-testid={`review-status-${item.itemId}`}
      >
        Review status: {item.disposition} (item status: {item.status}
        {kind === "awaiting-review" ? " — unreviewed draft ready" : ""}
        {kind === "reviewed" ? " — worker decision recorded" : ""}
        {kind === "rejected" ? " — draft rejected, unresolved" : ""})
      </p>

      {/* Empty state: no draft yet. */}
      {kind === "empty" && (
        <div className="wt-panel" role="note" data-testid={`review-empty-${item.itemId}`}>
          <p className="wt-statusline">
            No draft yet for this item. Capture a photo and run analysis in
            the capture step above; the draft, unknowns, and checks will
            appear here together for review.
          </p>
        </div>
      )}

      {/* Loading state: analysis inflight, review locked with recovery. */}
      {kind === "loading" && (
        <div
          className="wt-panel"
          role="status"
          aria-busy="true"
          data-testid={`review-loading-${item.itemId}`}
        >
          <div className="wt-skeleton" aria-hidden="true">
            <span className="wt-skeleton-bar" />
            <span className="wt-skeleton-bar wt-skeleton-bar--short" />
          </div>
          <p className="wt-statusline">
            Analysis in progress — waiting for the draft. Review controls are
            locked until it arrives; the photo is kept.
          </p>
          {onCancelAnalysis && (
            <div className="wt-actions wt-no-print">
              <button
                type="button"
                className="wt-btn"
                data-testid={`review-cancel-${item.itemId}`}
                onClick={onCancelAnalysis}
                disabled={disabled}
              >
                Cancel analysis (keeps photo)
              </button>
            </div>
          )}
        </div>
      )}

      {/* Error state: announced with recovery. */}
      {kind === "error" && item.error && (
        <div
          className="wt-alert"
          role="alert"
          data-testid={`review-error-${item.itemId}`}
        >
          <p className="wt-statusline">
            <strong>Error [{item.error.code}]:</strong> {item.error.message}{" "}
            The photo is kept.
          </p>
          <div className="wt-actions wt-no-print">
            <button
              type="button"
              className="wt-btn wt-btn--primary"
              data-testid={`review-reanalyze-${item.itemId}`}
              onClick={onReanalyze}
              disabled={disabled}
            >
              Request fresh analysis (clears error)
            </button>
          </div>
        </div>
      )}

      {/* Draft block: observation, evidence, unknowns stay together. */}
      {item.draft && (
        <div className="wt-panel" data-testid={`review-draft-${item.itemId}`}>
          <p className="wt-statusline">
            <strong>AI draft observation (unreviewed until you accept):</strong>
          </p>
          <blockquote className="wt-quote" data-testid={`review-observation-${item.itemId}`}>
            {item.draft.observation}
          </blockquote>
          {item.draft.visibleEvidence.length > 0 && (
            <div>
              <p className="wt-statusline">
                <strong>Visible evidence:</strong>
              </p>
              <ul className="wt-list">
                {item.draft.visibleEvidence.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          <div data-testid={`review-unknowns-${item.itemId}`}>
            <p className="wt-statusline">
              <strong>What the photo cannot establish (unknowns):</strong>
            </p>
            {item.draft.unknowns.length > 0 ? (
              <ul className="wt-list">
                {item.draft.unknowns.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="wt-statusline">No unknowns listed by the model.</p>
            )}
          </div>
          {item.draft.suggestedManualChecks.length > 0 && (
            <div>
              <p className="wt-statusline">
                <strong>Model-suggested follow-ups (suggestions only):</strong>
              </p>
              <ul className="wt-list">
                {item.draft.suggestedManualChecks.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {item.workerRevision && (
            <div data-testid={`review-worker-revision-${item.itemId}`}>
              <p className="wt-statusline">
                <strong>
                  Worker revision ({item.disposition}
                  {item.dispositionAt ? `, recorded ${item.dispositionAt}` : ""}):
                </strong>
              </p>
              <p className="wt-statusline">{item.workerRevision}</p>
              <p className="wt-note">
                Original model draft above is preserved for audit.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Required + suggested manual checks (REQ-005). */}
      <div className="wt-panel" data-testid={`review-checks-${item.itemId}`}>
        <p className="wt-statusline">
          <strong>Manual checks</strong> — every required check needs a worker
          outcome plus a note. “Not performed” stays unresolved.
        </p>
        {catalogItem === null && (
          <p className="wt-note" role="note">
            Catalog entry missing for this item, so required checks cannot be
            listed. Recovery: reload the session; if this persists, reset
            storage to restore the versioned catalog.
          </p>
        )}
        {catalogItem !== null && effective.length === 0 && (
          <p className="wt-note" role="note">
            No manual checks listed for this item.
          </p>
        )}
        {effective.map((check) => {
          const response = item.manualChecks.find((r) => r.checkId === check.id);
          const resolved =
            response !== undefined &&
            response.outcome === "performed" &&
            response.note.trim().length > 0;
          const required = check.source === "required";
          return (
            <div
              key={check.id}
              data-testid={`review-check-${item.itemId}-${check.id}`}
              className="wt-check"
            >
              <p className="wt-statusline">
                <strong>{check.instruction}</strong>{" "}
                <span className={`wt-chip ${resolved ? "wt-chip--done" : "wt-chip--empty"}`}>
                  [{required ? "Required check" : "Model suggestion"}
                  {resolved ? "; recorded as performed" : "; unresolved"}]
                </span>
              </p>
              {response ? (
                <p className="wt-statusline" role="status">
                  Last response: {response.outcome} — “{response.note}”
                  (recorded {response.recordedAt})
                  {response.outcome === "not-performed"
                    ? " — still unresolved; perform the test and record it, or leave the item unresolved."
                    : ""}
                </p>
              ) : (
                <p className="wt-statusline" role="status">
                  No worker response yet — pending.
                </p>
              )}
              {required ? (
                <div className="wt-field">
                  <label htmlFor={`note-${item.itemId}-${check.id}`} className="wt-label">
                    Worker note for this check (required):
                  </label>
                  <input
                    id={`note-${item.itemId}-${check.id}`}
                    data-testid={`review-check-note-${item.itemId}-${check.id}`}
                    type="text"
                    value={notes[check.id] ?? ""}
                    onChange={(event) =>
                      setNotes((current) => ({
                        ...current,
                        [check.id]: event.target.value,
                      }))
                    }
                    disabled={controlsDisabled}
                    maxLength={500}
                    placeholder="e.g. Ran both taps; basin drained."
                    className="wt-input"
                  />
                  <div className="wt-actions wt-no-print">
                    <button
                      type="button"
                      className="wt-btn wt-btn--primary"
                      data-testid={`review-check-performed-${item.itemId}-${check.id}`}
                      disabled={controlsDisabled}
                      onClick={() => handleRecordCheck(check.id, "performed")}
                    >
                      Record performed
                    </button>
                    <button
                      type="button"
                      className="wt-btn"
                      data-testid={`review-check-notperformed-${item.itemId}-${check.id}`}
                      disabled={controlsDisabled}
                      onClick={() => handleRecordCheck(check.id, "not-performed")}
                    >
                      Record not performed
                    </button>
                  </div>
                </div>
              ) : (
                <p className="wt-note">
                  Model suggestion only — it never replaces a required check.
                </p>
              )}
            </div>
          );
        })}
        {checkError && (
          <p className="wt-statusline" role="alert">
            {checkError}
          </p>
        )}
        <p className="wt-statusline" role="status">
          {requiredIds.length === 0
            ? "No required checks to resolve."
            : unresolved.length === 0
              ? `All ${requiredIds.length} required check(s) recorded as performed.`
              : `Unresolved required checks: ${unresolved.length} of ${requiredIds.length} (${unresolved.join(", ")}). Accepting draft text does not resolve these.`}
        </p>
      </div>

      {/* Worker-only finding (REQ-005). Never prefilled from the AI draft. */}
      <div className="wt-panel" data-testid={`review-deficiency-${item.itemId}`}>
        <p className="wt-statusline">
          <strong>Worker finding (optional).</strong> Recorded by you only —
          nothing here is filled in from the AI draft, and this is not an
          inspection outcome.
        </p>
        {!deficiency && (
          <p
            className="wt-note"
            role="note"
            data-testid={`review-deficiency-empty-${item.itemId}`}
          >
            No worker finding recorded for this item. Describe what you saw
            and what should happen next, in your own words.
          </p>
        )}
        {deficiency && (
          <div
            data-testid={`review-deficiency-display-${item.itemId}`}
            role="status"
          >
            <p className="wt-statusline">
              <strong>Issue:</strong> {deficiency.issueDescription}
            </p>
            <p className="wt-statusline">
              <strong>Corrective action:</strong> {deficiency.correctiveAction}
            </p>
            {deficiency.responsibleParty && (
              <p className="wt-statusline">
                <strong>Responsible party:</strong> {deficiency.responsibleParty}
              </p>
            )}
            {deficiency.targetDate && (
              <p className="wt-statusline">
                <strong>Target date:</strong> {deficiency.targetDate}
              </p>
            )}
            <p className="wt-note">Recorded {deficiency.recordedAt}.</p>
            {deficiency.needsConfirmation && (
              <p
                className="wt-statusline"
                role="alert"
                data-testid={`review-deficiency-stale-${item.itemId}`}
              >
                The photo changed after this finding was recorded — review and
                save it again to confirm it still applies.
              </p>
            )}
          </div>
        )}
        {!deficiencyHasPhoto && (
          <p className="wt-note" role="note">
            Capture a photo first — a finding is recorded against the current
            photo.
          </p>
        )}
        <div className="wt-actions wt-no-print">
          <button
            type="button"
            className="wt-btn"
            data-testid={`review-deficiency-open-${item.itemId}`}
            disabled={controlsDisabled || !deficiencyHasPhoto}
            onClick={() => {
              if (deficiencyOpen) {
                setDeficiencyError(null);
                setDeficiencyOpen(false);
              } else {
                openDeficiencyEditor();
              }
            }}
            aria-expanded={deficiencyOpen}
          >
            {deficiencyOpen
              ? "Close finding editor"
              : deficiency
                ? "Edit finding"
                : "Record a finding"}
          </button>
          {deficiency && (
            <button
              type="button"
              className="wt-btn"
              data-testid={`review-deficiency-clear-${item.itemId}`}
              disabled={controlsDisabled}
              onClick={handleClearDeficiency}
            >
              Clear finding
            </button>
          )}
        </div>
        {deficiencyOpen && (
          <div className="wt-field">
            <label htmlFor={deficiencyIssueId} className="wt-label">
              Issue you observed (required, your own words):
            </label>
            <textarea
              id={deficiencyIssueId}
              data-testid={`review-deficiency-issue-${item.itemId}`}
              value={deficiencyIssue}
              onChange={(event) => setDeficiencyIssue(event.target.value)}
              disabled={controlsDisabled}
              rows={3}
              maxLength={1000}
              className="wt-textarea"
              placeholder="e.g. Bathroom faucet drips continuously."
            />
            <label htmlFor={deficiencyActionId} className="wt-label">
              Corrective action (required, your own words):
            </label>
            <textarea
              id={deficiencyActionId}
              data-testid={`review-deficiency-action-${item.itemId}`}
              value={deficiencyAction}
              onChange={(event) => setDeficiencyAction(event.target.value)}
              disabled={controlsDisabled}
              rows={3}
              maxLength={1000}
              className="wt-textarea"
              placeholder="e.g. Asked occupant to report to maintenance; will recheck."
            />
            <label htmlFor={deficiencyPartyId} className="wt-label">
              Responsible party (optional):
            </label>
            <input
              id={deficiencyPartyId}
              data-testid={`review-deficiency-party-${item.itemId}`}
              type="text"
              value={deficiencyParty}
              onChange={(event) => setDeficiencyParty(event.target.value)}
              disabled={controlsDisabled}
              maxLength={200}
              className="wt-input"
              placeholder="e.g. Maintenance team"
            />
            <label htmlFor={deficiencyDateId} className="wt-label">
              Target date (optional, YYYY-MM-DD):
            </label>
            <input
              id={deficiencyDateId}
              data-testid={`review-deficiency-date-${item.itemId}`}
              type="text"
              inputMode="numeric"
              value={deficiencyDate}
              onChange={(event) => setDeficiencyDate(event.target.value)}
              disabled={controlsDisabled}
              maxLength={10}
              className="wt-input"
              placeholder="YYYY-MM-DD"
            />
            {deficiencyError && (
              <p
                className="wt-statusline"
                role="alert"
                data-testid={`review-deficiency-error-${item.itemId}`}
              >
                {deficiencyError}
              </p>
            )}
            <div className="wt-actions wt-no-print">
              <button
                type="button"
                className="wt-btn wt-btn--primary"
                data-testid={`review-deficiency-save-${item.itemId}`}
                disabled={controlsDisabled}
                onClick={handleSaveDeficiency}
              >
                Save finding
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Accept / edit / reject — only for an unreviewed draft. */}
      {kind === "awaiting-review" && (
        <div className="wt-panel" data-testid={`review-actions-${item.itemId}`}>
          <p className="wt-statusline">
            <strong>Decide on this draft.</strong> Accepting text records a
            worker note only — required checks above stay exactly as they are.
          </p>
          <div className="wt-actions wt-no-print">
            <button
              type="button"
              className="wt-btn wt-btn--primary"
              data-testid={`review-accept-${item.itemId}`}
              disabled={controlsDisabled}
              onClick={onAccept}
            >
              Accept draft as worker note
            </button>
            <button
              type="button"
              className="wt-btn"
              data-testid={`review-edit-open-${item.itemId}`}
              disabled={controlsDisabled}
              onClick={() => {
                setEditError(null);
                setEditText(item.workerRevision ?? item.draft?.observation ?? "");
                setEditOpen((open) => !open);
              }}
              aria-expanded={editOpen}
            >
              {editOpen ? "Close editor" : "Edit and accept"}
            </button>
            <button
              type="button"
              className="wt-btn"
              data-testid={`review-reject-open-${item.itemId}`}
              disabled={controlsDisabled}
              onClick={() => {
                setRejectError(null);
                setRejectOpen((open) => !open);
              }}
              aria-expanded={rejectOpen}
            >
              {rejectOpen ? "Close rejection" : "Reject draft"}
            </button>
            <button
              type="button"
              className="wt-btn"
              data-testid={`review-reanalyze-draft-${item.itemId}`}
              disabled={controlsDisabled}
              onClick={onReanalyze}
            >
              Request fresh analysis
            </button>
          </div>
          {editOpen && (
            <div className="wt-field">
              <label htmlFor={editId} className="wt-label">
                Edited worker note (original draft is preserved):
              </label>
              <textarea
                id={editId}
                data-testid={`review-edit-text-${item.itemId}`}
                value={editText}
                onChange={(event) => setEditText(event.target.value)}
                disabled={controlsDisabled}
                rows={4}
                maxLength={2000}
                className="wt-textarea"
              />
              {editError && (
                <p className="wt-statusline" role="alert">
                  {editError}
                </p>
              )}
              <div className="wt-actions wt-no-print">
                <button
                  type="button"
                  className="wt-btn wt-btn--primary"
                  data-testid={`review-edit-accept-${item.itemId}`}
                  disabled={controlsDisabled}
                  onClick={handleAcceptEdited}
                >
                  Accept edited text
                </button>
              </div>
            </div>
          )}
          {rejectOpen && (
            <div className="wt-field">
              <label htmlFor={rejectId} className="wt-label">Rejection reason (required):</label>
              <input
                id={rejectId}
                data-testid={`review-reject-reason-${item.itemId}`}
                type="text"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                disabled={controlsDisabled}
                maxLength={2000}
                placeholder="e.g. Photo too dark to use."
                className="wt-input"
              />
              {rejectError && (
                <p className="wt-statusline" role="alert">
                  {rejectError}
                </p>
              )}
              <div className="wt-actions wt-no-print">
                <button
                  type="button"
                  className="wt-btn wt-btn--danger"
                  data-testid={`review-reject-${item.itemId}`}
                  disabled={controlsDisabled}
                  onClick={handleReject}
                >
                  Reject this draft
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reviewed state: decision recorded, change via reanalysis. */}
      {kind === "reviewed" && (
        <div
          className="wt-panel"
          role="status"
          data-testid={`review-reviewed-${item.itemId}`}
        >
          <p className="wt-statusline">
            <strong>
              Reviewed — {item.disposition}
              {item.dispositionAt ? ` (recorded ${item.dispositionAt})` : ""}.
            </strong>{" "}
            Revision {item.revision}. To change this decision, request a fresh
            analysis: reanalysis clears the review and manual checks so the
            new draft starts unreviewed.
          </p>
          <div className="wt-actions wt-no-print">
            <button
              type="button"
              className="wt-btn"
              data-testid={`review-reanalyze-${item.itemId}`}
              disabled={disabled}
              onClick={onReanalyze}
            >
              Request fresh analysis (clears review)
            </button>
          </div>
        </div>
      )}

      {/* Rejected state: reason visible with recovery. */}
      {kind === "rejected" && (
        <div
          className="wt-alert"
          role="alert"
          data-testid={`review-rejected-${item.itemId}`}
        >
          <p className="wt-statusline">
            <strong>Rejected — not accepted.</strong>{" "}
            {item.workerRevision
              ? `Worker reason: “${item.workerRevision}”`
              : "No reason recorded."}{" "}
            Rejection never counts as acceptance; this item exports as
            unresolved until a fresh draft is reviewed.
          </p>
          <div className="wt-actions wt-no-print">
            <button
              type="button"
              className="wt-btn"
              data-testid={`review-reanalyze-${item.itemId}`}
              disabled={disabled}
              onClick={onReanalyze}
            >
              Request fresh analysis (clears rejection)
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
