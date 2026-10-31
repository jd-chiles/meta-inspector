/**
 * Review-only printable export (REQ-005, REQ-006, REQ-008).
 *
 * Safety rules enforced here (never in the UI layer alone):
 * 1. The export is built from a stable snapshot: inputs are deep-copied at
 *    build time so later async work (late drafts, replacements, deletions)
 *    cannot change already-exported content, and building never mutates
 *    review state.
 * 2. Unapproved draft text is never exported. Only items with status
 *    "reviewed" (accepted / accepted-edited) AND every required manual check
 *    resolved carry a reviewed note plus draft context. Pending, rejected,
 *    failed, analyzing, captured, empty, and deleted items appear only as
 *    unresolved entries with a reason — no observation, evidence, unknowns,
 *    suggestion, or worker-revision text.
 * 3. All worker/model text is HTML-escaped at render time; photos embed as
 *    data: URLs (canonical normalized bytes only) so the document makes no
 *    remote image requests. Oversized or non-image media is omitted with an
 *    explicit reason instead of a broken reference.
 * 4. No secrets or debug data: the snapshot carries only safe IDs, timings,
 *    and provenance. Keys, provider bodies, and request payloads are never
 *    accepted as inputs and never rendered.
 * 5. The review-only banner repeats in the header, before every item, and in
 *    the footer (plus a fixed print header), and nothing in the export claims
 *    an approved inspection, a completed inspection, or an HMIS submission.
 *    An entirely unreviewed session (or any unresolved item) cannot read as
 *    completed: `canClaimCompleted` is false unless every listed item is
 *    completed.
 * 6. Worker-authored content (per-item deficiency notes, session case notes,
 *    manual-check notes) may export even for unresolved items because it is
 *    worker text, not model output — but it is always labeled as an
 *    unreviewed worker record, never as a finding, verdict, or submission.
 *    Unresolved required checks list in their own section, separate from the
 *    worker deficiency list: a missing check is absent evidence, not a
 *    finding. The item labels follow the project-owner-confirmed Form 1083
 *    workflow; this app does not claim verbatim form wording or submission.
 */

import type { Catalog } from "../domain/catalog";
import {
  isCheckResolved,
  unresolvedRequiredChecks,
  type AnalysisMode,
  type ItemRecord,
  type SessionState,
  type WorkerDeficiency,
} from "../domain/evidence";

/** Verbatim banner required on every export page/surface. */
export const EXPORT_REVIEW_BANNER =
  "Draft for worker review — not an approved inspection or HMIS submission.";

/** Upper bound for an embedded photo (encoded bytes), per design § Contracts. */
export const EXPORT_MAX_EMBED_BYTES = 2 * 1024 * 1024;

export const EXPORT_ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ExportMode = AnalysisMode;

export interface ExportMediaInput {
  bytes: Uint8Array;
  mime: string;
}

export interface ExportManualCheckRow {
  checkId: string;
  instruction: string;
  requiresPhysicalTest: boolean;
  photoCannotEstablish: boolean;
  outcome: "performed" | "not-performed" | "pending";
  note: string | null;
  recordedAt: string | null;
  resolved: boolean;
}

export interface ExportDeficiencySnapshot {
  issueDescription: string;
  correctiveAction: string;
  responsibleParty: string | null;
  targetDate: string | null;
  recordedAt: string;
  mediaId: string;
  needsConfirmation: boolean;
}

export interface ExportDeficiencyEntry {
  itemId: string;
  label: string;
  deficiency: ExportDeficiencySnapshot;
}

export interface ExportUnresolvedCheckEntry {
  itemId: string;
  label: string;
  checkId: string;
  instruction: string;
  outcome: "performed" | "not-performed" | "pending";
  reason: string;
}

export interface ExportProvenanceRow {
  label: string;
  value: string;
}

export interface ExportItemSnapshot {
  itemId: string;
  label: string;
  status: ItemRecord["status"];
  disposition: ItemRecord["disposition"];
  dispositionAt: string | null;
  attempt: number;
  revision: number;
  catalogVersion: string;
  mediaId: string | null;
  mediaHash: string | null;
  capturedAt: string | null;
  analysisMode: ExportMode;
  /** True only when reviewed AND every required check is resolved. */
  completed: boolean;
  /** Set for every non-completed item; null for completed items. */
  unresolvedReason: string | null;
  /** Worker-approved note; null for every unresolved item (never draft text). */
  reviewedNote: string | null;
  /**
   * Original model observation for completed items only; null for every
   * unresolved item and when the worker accepted without editing (where it
   * duplicates reviewedNote). Kept separate so an edited approval cannot
   * silently drop the model text it replaced, and so the renderer can escape
   * both. Never populated for unresolved/rejected/failed items.
   */
  originalObservation: string | null;
  /** Draft context below is populated ONLY for completed items. */
  visibleEvidence: string[];
  unknowns: string[];
  suggestedManualChecks: string[];
  photoDataUrl: string | null;
  photoOmittedReason: string | null;
  manualChecks: ExportManualCheckRow[];
  provenance: ExportProvenanceRow[];
  /**
   * Worker-recorded deficiency intent for this item (worker text, never model
   * output). Null when none was recorded or the evidence was deleted.
   * Unlike reviewed notes, a deficiency may export for unresolved items
   * because it is worker-authored — always labeled as an unreviewed worker
   * record, never as a finding or verdict.
   */
  deficiency: ExportDeficiencySnapshot | null;
}

export interface ExportUnresolvedEntry {
  itemId: string;
  reason: string;
}

export interface ExportSnapshot {
  sessionId: string;
  catalogId: string;
  catalogVersion: string;
  catalogMode: Catalog["mode"];
  demoNotice: string;
  generatedAt: string;
  analysisMode: ExportMode;
  items: ExportItemSnapshot[];
  unresolved: ExportUnresolvedEntry[];
  /**
   * Worker-recorded deficiencies across items, listed separately from
   * unresolved checks: a deficiency is a worker note, an unresolved check
   * is absent evidence. Never verdicts, never HMIS data.
   */
  deficiencies: ExportDeficiencyEntry[];
  /** Session-level worker draft notes (worker text, unreviewed). Null when none. */
  caseNotes: string | null;
  /**
   * Required manual checks with no resolving worker record, across all
   * items. Kept separate from `deficiencies` and from the per-item
   * `unresolved` entries: this section answers "which physical checks are
   * still open", not "which items lack approval".
   */
  unresolvedChecks: ExportUnresolvedCheckEntry[];
  completedCount: number;
  /** True only when at least one item is completed and none are unresolved. */
  canClaimCompleted: boolean;
}

export interface BuildExportInput {
  state: SessionState;
  catalog: Catalog;
  /** Normalized media bytes by mediaId (canonical server bytes). */
  mediaById: Record<string, ExportMediaInput>;
  analysisMode: ExportMode;
  generatedAt?: string;
}

/** Escape text for interpolation into printable HTML. */
export function escapeHtml(value: unknown): string {
  if (typeof value !== "string") {
    // A missing field must never throw during render: null/undefined render
    // as "", other non-strings stringify first. Callers still pass defined
    // strings with explicit fallbacks so output stays meaningful.
    if (value === null || value === undefined) return "";
    return escapeHtml(String(value));
  }
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Runtime-agnostic base64 encoding (Node Buffer or browser btoa). */
export function bytesToBase64(bytes: Uint8Array): string {
  const runtime = globalThis as {
    Buffer?: { from(data: Uint8Array): { toString(encoding: string): string } };
  };
  if (runtime.Buffer) {
    return runtime.Buffer.from(bytes).toString("base64");
  }
  if (typeof btoa !== "undefined") {
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const slice = bytes.subarray(i, i + CHUNK);
      let piece = "";
      for (let j = 0; j < slice.length; j += 1) {
        piece += String.fromCharCode(slice[j]);
      }
      binary += piece;
    }
    return btoa(binary);
  }
  throw new Error("No base64 encoder available in this runtime.");
}

function mediaToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") out.push(entry);
  }
  return out;
}

function unresolvedReasonFor(
  deleted: boolean,
  status: ItemRecord["status"],
  unresolvedChecks: string[],
  errorCode: string | null,
): string {
  if (deleted) return "evidence deleted locally — unresolved";
  if (status === "empty") return "no photo yet — unresolved";
  if (status === "captured") return "photo captured, no draft yet — unresolved";
  if (status === "analyzing") return "analysis in progress — unresolved";
  if (status === "draft") return "draft unreviewed — unresolved";
  if (status === "rejected") return "draft rejected — unresolved";
  if (status === "error") {
    return errorCode
      ? `analysis failed [${errorCode}] — unresolved`
      : "analysis failed — unresolved";
  }
  if (status === "reviewed" && unresolvedChecks.length > 0) {
    return `unresolved manual checks: ${unresolvedChecks.join(", ")}`;
  }
  return "unresolved";
}

function unresolvedCheckReason(
  outcome: ExportManualCheckRow["outcome"],
): string {
  if (outcome === "pending") return "no worker record yet — unresolved";
  if (outcome === "not-performed")
    return "recorded not-performed — unresolved";
  return "recorded without a resolving note — unresolved";
}

/** Deep-copy a worker deficiency into snapshot shape (never by reference). */
function copyDeficiency(
  deficiency: WorkerDeficiency | null | undefined,
): ExportDeficiencySnapshot | null {
  if (!deficiency) return null;
  return {
    issueDescription: `${deficiency.issueDescription}`,
    correctiveAction: `${deficiency.correctiveAction}`,
    responsibleParty:
      deficiency.responsibleParty === undefined ||
      deficiency.responsibleParty === null
        ? null
        : `${deficiency.responsibleParty}`,
    targetDate:
      deficiency.targetDate === undefined || deficiency.targetDate === null
        ? null
        : `${deficiency.targetDate}`,
    recordedAt: `${deficiency.recordedAt}`,
    mediaId: `${deficiency.mediaId}`,
    needsConfirmation: deficiency.needsConfirmation === true,
  };
}

/**
 * Build a stable, self-contained export snapshot. The result is a deep copy:
 * later reducer transitions, late drafts, replacements, or deletions cannot
 * alter it, and this function never writes to review state. Draft text is
 * copied only for completed items; unresolved items carry no draft strings.
 */
export function buildExportSnapshot(input: BuildExportInput): ExportSnapshot {
  const { state, catalog, mediaById, analysisMode } = input;
  const generatedAt = input.generatedAt ?? nowIso();

  const requiredByItem: Record<string, string[]> = {};
  const labelByItem: Record<string, string> = {};
  for (const catalogItem of catalog.items) {
    requiredByItem[catalogItem.id] = catalogItem.manualChecks.map((c) => c.id);
    labelByItem[catalogItem.id] = catalogItem.label;
  }

  const items: ExportItemSnapshot[] = catalog.items.map((catalogItem) => {
    const record = state.items[catalogItem.id] ?? null;
    const status: ItemRecord["status"] = record ? record.status : "empty";
    const deleted = record?.deleted ?? true;
    const requiredIds = requiredByItem[catalogItem.id] ?? [];
    const responses = record && !deleted ? [...record.manualChecks] : [];
    const unresolvedChecks =
      record && !deleted
        ? unresolvedRequiredChecks(requiredIds, responses)
        : [...requiredIds];

    const disposition = record && !deleted ? record.disposition : "unreviewed";
    const completed =
      !deleted &&
      record !== null &&
      status === "reviewed" &&
      (disposition === "accepted" || disposition === "accepted-edited") &&
      unresolvedChecks.length === 0;

    // Worker-authored deficiency intent (never model output). Copied by value
    // so later worker edits cannot change built content; exported for
    // unresolved items too, like manual-check notes, and always labeled as
    // an unreviewed worker record at render time.
    const deficiency =
      record && !deleted ? copyDeficiency(record.deficiency) : null;

    // Reviewed note + draft context only for completed items. Everything
    // else exports as unresolved without any model draft text. Worker-
    // authored notes (manual-check notes, deficiency intent) export
    // separately under explicit worker labels — never as approved content.
    let reviewedNote: string | null = null;
    let originalObservation: string | null = null;
    let visibleEvidence: string[] = [];
    let unknowns: string[] = [];
    let suggestedManualChecks: string[] = [];
    if (completed && record) {
      if (disposition === "accepted-edited") {
        reviewedNote = record.workerRevision ? `${record.workerRevision}` : null;
        // Preserve the replaced model observation as reviewed context so an
        // edited approval cannot drop hostile model text from the export.
        // It stays null for every unresolved item (strict policy intact).
        originalObservation = record.draft ? `${record.draft.observation}` : null;
        // Avoid duplicating empty or identical text in the renderer.
        if (
          originalObservation !== null &&
          reviewedNote !== null &&
          originalObservation === reviewedNote
        ) {
          originalObservation = null;
        }
      } else {
        reviewedNote = record.draft ? `${record.draft.observation}` : null;
      }
      visibleEvidence = record.draft ? [...record.draft.visibleEvidence] : [];
      unknowns = record.draft ? [...record.draft.unknowns] : [];
      suggestedManualChecks = record.draft
        ? [...record.draft.suggestedManualChecks]
        : [];
    }

    const manualChecks: ExportManualCheckRow[] = catalogItem.manualChecks.map(
      (check) => {
        const response = responses.find((r) => r.checkId === check.id) ?? null;
        const resolved = response
          ? isCheckResolved(responses, check.id)
          : false;
        return {
          checkId: check.id,
          instruction: check.instruction,
          requiresPhysicalTest: check.requiresPhysicalTest,
          photoCannotEstablish: check.photoCannotEstablish,
          outcome: response ? response.outcome : "pending",
          note: response ? `${response.note}` : null,
          recordedAt: response ? `${response.recordedAt}` : null,
          resolved,
        };
      },
    );

    // Photos embed from canonical normalized bytes only — never object URLs
    // (blob:) or remote URLs. Missing/oversized/non-image media is reported
    // with an explicit reason instead of a broken reference.
    let photoDataUrl: string | null = null;
    let photoOmittedReason: string | null = null;
    const mediaId = record && !deleted ? record.mediaId : null;
    if (mediaId === null) {
      photoOmittedReason = "No photo on file for this item.";
    } else {
      const media = mediaById[mediaId];
      if (!media) {
        photoOmittedReason =
          "Photo bytes unavailable locally; no remote copy is fetched.";
      } else if (
        !(EXPORT_ALLOWED_MIMES as readonly string[]).includes(media.mime)
      ) {
        photoOmittedReason = `Photo omitted: unsupported media type (${media.mime}).`;
      } else if (media.bytes.length > EXPORT_MAX_EMBED_BYTES) {
        photoOmittedReason =
          "Photo omitted: normalized bytes exceed the 2 MiB embed bound.";
      } else {
        photoDataUrl = mediaToDataUrl(media.bytes, media.mime);
      }
    }

    const provenance: ExportProvenanceRow[] = [
      { label: "Session", value: state.sessionId },
      { label: "Item", value: catalogItem.id },
      { label: "Catalog version", value: state.catalogVersion },
      { label: "Media ID", value: mediaId ?? "none yet" },
      {
        label: "Media digest",
        value:
          record && !deleted && record.mediaHash ? record.mediaHash : "none yet",
      },
      {
        label: "Captured at",
        value:
          record && !deleted && record.capturedAt ? record.capturedAt : "—",
      },
      { label: "Attempt", value: String(record && !deleted ? record.attempt : 0) },
      {
        label: "Review revision",
        value: String(record && !deleted ? record.revision : 0),
      },
      {
        label: "Disposition",
        value:
          record && !deleted && record.dispositionAt
            ? `${disposition} (recorded ${record.dispositionAt})`
            : disposition,
      },
      { label: "Analysis mode", value: analysisMode },
    ];

    const unresolvedReason = completed
      ? null
      : unresolvedReasonFor(
          deleted,
          deleted ? "empty" : status,
          unresolvedChecks,
          record?.error?.code ?? null,
        );

    return {
      itemId: catalogItem.id,
      label: labelByItem[catalogItem.id] ?? catalogItem.id,
      status: deleted ? "empty" : status,
      disposition,
      dispositionAt: record && !deleted ? record.dispositionAt : null,
      attempt: record && !deleted ? record.attempt : 0,
      revision: record && !deleted ? record.revision : 0,
      catalogVersion: state.catalogVersion,
      mediaId,
      mediaHash: record && !deleted ? record.mediaHash : null,
      capturedAt: record && !deleted ? record.capturedAt : null,
      analysisMode,
      completed,
      unresolvedReason,
      reviewedNote,
      originalObservation,
      visibleEvidence,
      unknowns,
      suggestedManualChecks,
      photoDataUrl,
      photoOmittedReason,
      manualChecks,
      provenance,
      deficiency,
    };
  });

  const unresolved: ExportUnresolvedEntry[] = items
    .filter((item) => !item.completed)
    .map((item) => ({
      itemId: item.itemId,
      reason: item.unresolvedReason ?? "unresolved",
    }));

  // Worker deficiency list: one entry per item carrying worker-recorded
  // intent. Kept separate from unresolved checks below — a deficiency is a
  // worker note, an unresolved check is absent evidence.
  const deficiencies: ExportDeficiencyEntry[] = items
    .filter((item) => item.deficiency !== null)
    .map((item) => ({
      itemId: item.itemId,
      label: item.label,
      deficiency: item.deficiency as ExportDeficiencySnapshot,
    }));

  // Required checks with no resolving worker record, across all items.
  // Rendered as its own section so open physical checks stay distinct from
  // both worker deficiency notes and per-item unresolved entries.
  const unresolvedChecks: ExportUnresolvedCheckEntry[] = [];
  for (const item of items) {
    for (const check of item.manualChecks) {
      if (!check.resolved) {
        unresolvedChecks.push({
          itemId: item.itemId,
          label: item.label,
          checkId: check.checkId,
          instruction: check.instruction,
          outcome: check.outcome,
          reason: unresolvedCheckReason(check.outcome),
        });
      }
    }
  }

  // Session-level worker draft notes. Worker text, copied by value;
  // rendered only under an explicit "worker draft — unreviewed" label.
  const caseNotes =
    typeof state.caseNotes === "string" ? `${state.caseNotes}` : null;

  const completedCount = items.filter((item) => item.completed).length;
  // An entirely unreviewed session — or any unresolved item — can never read
  // as completed. `canClaimCompleted` requires every listed item completed.
  const canClaimCompleted =
    items.length > 0 && completedCount === items.length && unresolved.length === 0;

  // Deep-clone through JSON so the caller cannot mutate the snapshot through
  // shared references (Uint8Array-free by construction: photos are data URLs).
  const snapshot: ExportSnapshot = {
    sessionId: state.sessionId,
    catalogId: catalog.catalogId,
    catalogVersion: catalog.version,
    catalogMode: catalog.mode,
    demoNotice: catalog.demoNotice,
    generatedAt,
    analysisMode,
    items,
    unresolved,
    deficiencies,
    caseNotes,
    unresolvedChecks,
    completedCount,
    canClaimCompleted,
  };
  return JSON.parse(JSON.stringify(snapshot)) as ExportSnapshot;
}

/** True when the snapshot may be described as fully reviewed. */
export function canExportCompleted(snapshot: ExportSnapshot): boolean {
  return snapshot.canClaimCompleted;
}

/** Safe filename for a downloaded export document. */
export function exportFilename(sessionId: string, generatedAt: string): string {
  const safeSession = sessionId.replace(/[^a-zA-Z0-9-]+/g, "-").slice(0, 60);
  const safeDate = generatedAt.replace(/[^0-9]/g, "").slice(0, 14);
  return `walkthrough-${safeSession || "session"}-${safeDate || "export"}.html`;
}

const EXPORT_CSS = [
  ":root{color-scheme:light}",
  "body{font-family:'Public Sans',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.6;margin:0;color:#1c2530;background:#fff;overflow-wrap:break-word}",
  ".export-page{width:100%;max-width:56rem;margin:0 auto;padding:1rem}",
  ".export-banner{margin:0 0 1rem;padding:.625rem .875rem;font-weight:700;color:#3f2d01;background:#fef3c7;border:.125rem solid #3f2d01;border-radius:.375rem}",
  ".export-print-banner{display:none}",
  "img{max-width:100%;height:auto}",
  ".export-card{border:1px solid #c3cede;border-radius:.625rem;padding:.75rem 1rem;margin:0 0 1rem;display:grid;gap:.5rem;max-width:100%}",
  ".export-item{break-inside:avoid}",
  ".export-section{break-inside:avoid}",
  ".export-meta{margin:0;font-size:.9rem}",
  "dl.export-prov{margin:0;display:grid;gap:.25rem}",
  "@media print{",
  "  .export-page{max-width:none;padding:0}",
  "  .export-print-banner{display:block;position:fixed;top:0;left:0;right:0;padding:.4rem .6rem;font-weight:700;font-size:.8rem;color:#000;background:#fff;border-bottom:.125rem solid #000}",
  "  body{padding-top:2.2rem}",
  "  .export-item{break-inside:avoid;page-break-inside:avoid}",
  "  .export-section{break-inside:avoid;page-break-inside:avoid}",
  "  .export-screen-only{display:none}",
  "}",
].join("\n");

/**
 * Render a self-contained printable HTML document from a stable snapshot.
 * Every interpolated value is escaped; images embed as data: URLs only, so
 * the document makes no remote requests. The review-only banner appears in
 * the fixed print header, the document header, before every item, and in the
 * footer — every printed page carries it. Nothing claims approval, a
 * completed inspection, or an HMIS submission.
 */
export function renderExportHtml(snapshot: ExportSnapshot): string {
  const esc = escapeHtml;
  const banner = esc(EXPORT_REVIEW_BANNER);
  const modeLabel =
    snapshot.analysisMode === "fixture"
      ? "fixture (mock output — not live inference)"
      : "live (real provider call — mock-unit media only)";
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const unresolvedEntries = Array.isArray(snapshot.unresolved)
    ? snapshot.unresolved
    : [];
  const deficiencies = Array.isArray(snapshot.deficiencies)
    ? snapshot.deficiencies
    : [];
  const unresolvedChecks = Array.isArray(snapshot.unresolvedChecks)
    ? snapshot.unresolvedChecks
    : [];
  const caseNotes =
    typeof snapshot.caseNotes === "string" ? snapshot.caseNotes : null;
  const completedCount =
    typeof snapshot.completedCount === "number"
      ? snapshot.completedCount
      : items.filter((entry) => entry.completed).length;
  const summaryLine = snapshot.canClaimCompleted
    ? `Reviewed items: ${completedCount} of ${items.length}. All required checks recorded as performed.`
    : `Reviewed items: ${completedCount} of ${items.length}. Unresolved items: ${unresolvedEntries.length}. This export is still a worker-review draft, not a finished inspection or HMIS submission.`;

  const itemSections = items
    .map((item) => {
      const visibleEvidence = Array.isArray(item.visibleEvidence)
        ? item.visibleEvidence
        : [];
      const unknowns = Array.isArray(item.unknowns) ? item.unknowns : [];
      const suggested = Array.isArray(item.suggestedManualChecks)
        ? item.suggestedManualChecks
        : [];
      const manualChecks = Array.isArray(item.manualChecks)
        ? item.manualChecks
        : [];
      const provenanceRows = Array.isArray(item.provenance)
        ? item.provenance
        : [];
      const statusLine = item.completed
        ? `Status: reviewed (${esc(item.disposition ?? "unreviewed")}) — completed.`
        : `Status: ${esc(item.status ?? "unknown")} (${esc(item.disposition ?? "unreviewed")}) — unresolved: ${esc(item.unresolvedReason ?? "unresolved")}.`;
      const photo = item.photoDataUrl && item.photoDataUrl.startsWith("data:image/")
      ? `<img src="${esc(item.photoDataUrl)}" alt="Normalized photo for ${esc(item.label ?? item.itemId ?? "unknown-item")}" />`
      : `<p class="export-meta">${esc(item.photoOmittedReason ?? "No photo available.")}</p>`;
      const noteBlock = item.completed
        ? `<h3>Reviewed note (worker-approved)</h3>` +
          `<p>${esc(item.reviewedNote ?? "")}</p>` +
          (item.originalObservation
            ? `<h4>Original model observation (reviewed context)</h4><p>${esc(item.originalObservation)}</p>`
            : "") +
          (visibleEvidence.length > 0
            ? `<h4>Visible evidence (reviewed)</h4><ul>${visibleEvidence.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`
            : "") +
          (unknowns.length > 0
            ? `<h4>What the photo cannot establish (reviewed)</h4><ul>${unknowns.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`
            : "") +
          (suggested.length > 0
            ? `<h4>Model-suggested follow-ups (suggestions only, reviewed)</h4><ul>${suggested.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`
            : "")
        : `<h3>Unresolved — no approved note</h3>` +
          `<p class="export-meta">This item has no worker-approved note. Draft text is never exported for unresolved items.</p>`;
      // Worker deficiency intent (worker text, never model output). It may
      // appear for unresolved items — like manual-check notes — but stays
      // labeled as an unreviewed worker record, never a finding or verdict.
      const itemDeficiency = item.deficiency ?? null;
      const deficiencyBlock =
        itemDeficiency !== null && typeof itemDeficiency === "object"
          ? `<h3>Worker deficiency (worker-recorded, unreviewed)</h3>` +
            `<p>${esc(itemDeficiency.issueDescription ?? "")}</p>` +
            `<p class="export-meta">Corrective action: ${esc(itemDeficiency.correctiveAction ?? "")}</p>` +
            (itemDeficiency.responsibleParty
              ? `<p class="export-meta">Responsible party: ${esc(itemDeficiency.responsibleParty)}</p>`
              : "") +
            (itemDeficiency.targetDate
              ? `<p class="export-meta">Target date: ${esc(itemDeficiency.targetDate)}</p>`
              : "") +
            `<p class="export-meta">Recorded ${esc(itemDeficiency.recordedAt ?? "")} against media ${esc(itemDeficiency.mediaId ?? "")}${itemDeficiency.needsConfirmation ? " — photo changed since recorded; worker must re-confirm" : ""}.</p>` +
            `<p class="export-meta">A worker note only — never a verdict, approved finding, or submission.</p>`
          : `<h3>Worker deficiency</h3>` +
            `<p class="export-meta">No worker deficiency recorded for this item.</p>`;
      const checks = manualChecks
        .map((check) => {
          const stateText =
            check.outcome === "pending"
              ? "pending — unresolved"
              : check.outcome === "performed"
                ? `performed${check.resolved ? "" : " (note missing — unresolved)"}`
                : "not performed — unresolved";
          const note = check.note ? ` — “${esc(check.note)}”` : "";
          const recorded = check.recordedAt ? ` (recorded ${esc(check.recordedAt)})` : "";
          return `<li><strong>${esc(check.instruction ?? "")}</strong> <span>[${check.requiresPhysicalTest ? "Required check" : "Check"}; ${esc(stateText)}]${note}${recorded}</span></li>`;
        })
        .join("");
      const provenance = provenanceRows
        .map(
          (row) =>
            `<span>${esc(row.label ?? "")}: <code>${esc(row.value ?? "")}</code></span>`,
        )
        .join("");
      return (
        `<section class="export-card export-item">` +
        `<p class="export-banner">${banner}</p>` +
        `<h2>${esc(item.label ?? item.itemId ?? "unknown-item")}</h2>` +
        `<p class="export-meta" role="status">${statusLine}</p>` +
        `${photo}` +
        `${noteBlock}` +
        `${deficiencyBlock}` +
        `<h3>Evidence provenance</h3><dl class="export-prov"><dd style="margin:0;display:grid;gap:.25rem">${provenance}</dd></dl>` +
        `<h3>Manual checks</h3><ul>${checks}</ul>` +
        `</section>`
      );
    })
    .join("\n");

  const unresolvedList =
    unresolvedEntries.length === 0
      ? `<p class="export-meta">No unresolved items.</p>`
      : `<ul>${unresolvedEntries.map((entry) => `<li><strong>${esc(entry.itemId ?? "unknown-item")}</strong> — ${esc(entry.reason ?? "unresolved")}</li>`).join("")}</ul>`;

  // Worker deficiency list: worker-recorded notes only, separate from
  // unresolved checks. Never approved findings, verdicts, or submissions.
  const deficiencyList =
    deficiencies.length === 0
      ? `<p class="export-meta">No worker deficiencies recorded.</p>`
      : `<ul>${deficiencies
          .map((entry) => {
            const detail =
              entry.deficiency !== null &&
              typeof entry.deficiency === "object"
                ? `issue: ${esc(entry.deficiency.issueDescription ?? "")}; action: ${esc(entry.deficiency.correctiveAction ?? "")}` +
                  (entry.deficiency.responsibleParty
                    ? `; responsible party: ${esc(entry.deficiency.responsibleParty)}`
                    : "") +
                  (entry.deficiency.targetDate
                    ? `; target date: ${esc(entry.deficiency.targetDate)}`
                    : "") +
                  ` (recorded ${esc(entry.deficiency.recordedAt ?? "")} against media ${esc(entry.deficiency.mediaId ?? "")}${entry.deficiency.needsConfirmation ? "; photo changed since recorded — worker must re-confirm" : ""})`
                : "record unavailable";
            return `<li><strong>${esc(entry.label ?? entry.itemId ?? "unknown-item")}</strong> — ${detail}</li>`;
          })
          .join("")}</ul>`;
  const deficiencySection =
    `<section class="export-card export-section">\n` +
    `<h2>Worker deficiency list (${deficiencies.length})</h2>\n` +
    `<p class="export-meta">Worker-recorded notes only — never approved findings, never verdicts, and never HMIS submissions.</p>\n` +
    `${deficiencyList}\n</section>`;

  // Session case notes: session-level worker draft text, always labeled
  // unreviewed, never an approved record.
  const caseNotesSection =
    `<section class="export-card export-section">\n` +
    `<h2>Session case notes (worker draft — unreviewed)</h2>\n` +
    (caseNotes !== null
      ? `<p>${esc(caseNotes)}</p>\n`
      : `<p class="export-meta">No session case notes recorded.</p>\n`) +
    `<p class="export-meta">Unreviewed worker draft — not an approved record and not a submission anywhere.</p>\n` +
    `</section>`;

  // Unresolved required checks: required physical checks with no resolving
  // worker record. Missing evidence only — not worker findings (those list
  // above), and not per-item approval state (that lists below in items).
  const unresolvedChecksList =
    unresolvedChecks.length === 0
      ? `<p class="export-meta">No unresolved required checks.</p>`
      : `<ul>${unresolvedChecks
          .map((entry) => {
            const stateText =
              entry.outcome === "pending"
                ? "pending — unresolved"
                : entry.outcome === "performed"
                  ? "performed without a resolving note — unresolved"
                  : "not performed — unresolved";
            return `<li><strong>${esc(entry.label ?? entry.itemId ?? "unknown-item")}</strong> — ${esc(entry.instruction ?? "")} <span>[${esc(entry.checkId ?? "")}; ${esc(stateText)}] — ${esc(entry.reason ?? "unresolved")}</span></li>`;
          })
          .join("")}</ul>`;
  const unresolvedChecksSection =
    `<section class="export-card export-section">\n` +
    `<h2>Unresolved required checks (${unresolvedChecks.length})</h2>\n` +
    `<p class="export-meta">Required physical checks with no resolving worker record. Missing evidence only — not worker findings; see the worker deficiency list for those.</p>\n` +
    `${unresolvedChecksList}\n</section>`;

  // Guard the raw snapshot JSON: stringify then escape so even hostile
  // worker/model text inside the JSON cannot break out of the script block.
  const snapshotJson = JSON.stringify(snapshot)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  return (
    `<!doctype html>\n` +
    `<html lang="en">\n<head>\n<meta charset="utf-8" />\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
    `<title>Walkthrough review-only export — ${esc(snapshot.sessionId ?? "unknown-session")}</title>\n` +
    `<style>\n${EXPORT_CSS}\n</style>\n</head>\n<body>\n` +
    `<div class="export-print-banner" role="note">${banner}</div>\n` +
    `<div class="export-page">\n` +
    `<p class="export-banner" role="note">${banner}</p>\n` +
    `<header class="export-card">\n` +
    `<h1>Habitability walkthrough — review-only export</h1>\n` +
    `<p class="export-meta">${esc(snapshot.demoNotice ?? "")}</p>\n` +
    `<p class="export-meta">Analysis mode: ${esc(modeLabel)}</p>\n` +
    `<p class="export-meta">Session ${esc(snapshot.sessionId ?? "unknown-session")} · Catalog ${esc(snapshot.catalogId ?? "unknown-catalog")} ${esc(snapshot.catalogVersion ?? "unknown-version")} (${esc(snapshot.catalogMode ?? "unknown-mode")}) · Exported ${esc(snapshot.generatedAt ?? "")}</p>\n` +
    `<p class="export-meta" role="status">${esc(summaryLine)}</p>\n` +
    `</header>\n` +
    `<section class="export-card">\n<h2>Unresolved items (${unresolvedEntries.length})</h2>\n${unresolvedList}\n</section>\n` +
    `${deficiencySection}\n` +
    `${caseNotesSection}\n` +
    `${unresolvedChecksSection}\n` +
    `${itemSections}\n` +
    `<footer class="export-card">\n<p class="export-banner" role="note">${banner}</p>\n` +
    `<p class="export-meta">Local export only — stored on this device, not submitted anywhere. Local deletion removes local records; it does not claim provider deletion.</p>\n` +
    `</footer>\n</div>\n` +
    `<script type="application/json" id="walkthrough-export-snapshot">${snapshotJson}</script>\n` +
    `</body>\n</html>`
  );
}

/** True when a value looks like an export snapshot (never trusted blindly). */
export function isExportSnapshot(value: unknown): value is ExportSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.sessionId === "string" &&
    Array.isArray(value.items) &&
    Array.isArray(value.unresolved) &&
    typeof value.canClaimCompleted === "boolean"
  );
}

export const __testOnly = {
  safeStringList,
  EXPORT_CSS,
};
