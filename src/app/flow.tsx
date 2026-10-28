/**
 * Client walkthrough flow island (REQ-001 … REQ-009).
 *
 * Real behavior, not a placeholder: this is the component the guided
 * capture / worker review / review-only export UI is composed from. It owns
 * one `WalkthroughSessionManager` (attempt-identity guards, IndexedDB with
 * an explicit in-memory fallback, canonical media bytes) and binds it to the
 * already-built presentational components:
 * - `GuidedCapture` per catalog item (rear-camera + upload, preview,
 *   retake/replace/remove, cancel-while-analyzing, honest empty/loading/
 *   error states),
 * - `WorkerReview` per catalog item (draft/edit/accept/reject plus required
 *   manual checks with provenance),
 * - `ExportSummary` (stable printable snapshot with the review-only banner).
 *
 * Request-time values that must never be recomputed in the browser (the
 * fixture/live mode badge) arrive as props from the server component
 * (`page.tsx`). No secrets, provider keys, or request bodies are read here:
 * fixture mode never calls live, and the analysis fetch sends no
 * credentials. Canonical export bytes are harvested from the server's own
 * normalized-media response (never from remote URLs); when bytes are
 * unavailable the export names the omission instead of a broken reference.
 *
 * Layout is fluid (no fixed widths) and safe at 360px; status is announced
 * as text via role="status"/role="alert", never color alone; every control
 * is a native keyboard-operable button/input/link.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import catalogJson from "../data/catalog.demo.json";
import { validateCatalog, type Catalog } from "../domain/catalog";
import type { ItemRecord } from "../domain/evidence";
import {
  buildExportSnapshot,
  exportFilename,
  renderExportHtml,
  type ExportMediaInput,
  type ExportSnapshot,
} from "../export/summary";
import GuidedCapture from "../features/walkthrough/capture";
import WorkerReview from "../features/walkthrough/review";
import ExportSummary from "../features/walkthrough/summary";
import {
  WalkthroughSessionManager,
  decodeBase64ToBytes,
  type AnalyzeErrorBody,
  type AnalyzeSuccessBody,
  type SessionManagerSnapshot,
} from "../features/walkthrough/session";

/** Stable local session id so a reload recovers the same evidence. */
const SESSION_ID = "demo-walkthrough-session";

const CATALOG_RESULT = validateCatalog(catalogJson);

export interface WalkthroughFlowProps {
  /** Request-time fixture/live label from the server; never recomputed here. */
  analysisMode: "live" | "fixture";
}

interface FlowError {
  code: string;
  message: string;
}

function itemSummary(record: ItemRecord | null): string {
  if (!record || record.deleted) return "no photo yet";
  switch (record.status) {
    case "empty":
      return "no photo yet";
    case "captured":
      return "photo captured, awaiting analysis";
    case "analyzing":
      return "analysis in progress";
    case "draft":
      return "draft awaiting worker review";
    case "reviewed":
      return `reviewed (${record.disposition})`;
    case "rejected":
      return "draft rejected — unresolved";
    case "error":
      return `analysis failed${record.error ? ` [${record.error.code}]` : ""}`;
    default:
      return record.status;
  }
}

/** Selector-card presentation for one checklist item (status text kept verbatim). */
function pickTone(record: ItemRecord | null): string {
  if (!record || record.deleted || record.status === "empty")
    return "wt-pick--empty";
  if (record.status === "error" || record.status === "rejected")
    return "wt-pick--attention";
  if (
    record.status === "reviewed" &&
    (record.disposition === "accepted" ||
      record.disposition === "accepted-edited")
  )
    return "wt-pick--done";
  return "wt-pick--active";
}

function chipTone(record: ItemRecord | null): string {
  if (!record || record.deleted || record.status === "empty")
    return "wt-chip--empty";
  if (record.status === "error" || record.status === "rejected")
    return "wt-chip--attention";
  if (
    record.status === "reviewed" &&
    (record.disposition === "accepted" ||
      record.disposition === "accepted-edited")
  )
    return "wt-chip--done";
  return "wt-chip--active";
}

export default function WalkthroughFlow(props: WalkthroughFlowProps) {
  const { analysisMode } = props;

  const catalog: Catalog | null = CATALOG_RESULT.ok
    ? CATALOG_RESULT.value
    : null;

  const mediaBytesRef = useRef(new Map<string, ExportMediaInput>());
  const [mediaVersion, setMediaVersion] = useState(0);
  // Same-item analyze serialization: at most one analyze() per item is ever
  // inflight from this UI, so a newer photo always starts from the settled
  // identity of the previous one and its server result (including a rejection
  // for corrupt bytes) can never be discarded as stale by an older request
  // that staged later.
  const pendingAnalyzeRef = useRef(new Map<string, Promise<unknown>>());

  // One manager for the lifetime of the page: identity guards, URL lifecycle,
  // and inflight tracking all live here, never in render state.
  const [manager] = useState(
    () =>
      new WalkthroughSessionManager({
        analyzeFetch: async (form, signal) => {
          const response = await fetch("/api/analyze", {
            method: "POST",
            body: form,
            signal,
          });
          const raw = (await response.json()) as unknown;
          if (response.ok) {
            const normalized = (
              raw as {
                normalizedMedia?: {
                  mediaId?: unknown;
                  base64?: unknown;
                  mime?: unknown;
                };
              }
            ).normalizedMedia;
            if (
              normalized &&
              typeof normalized.mediaId === "string" &&
              typeof normalized.base64 === "string" &&
              typeof normalized.mime === "string"
            ) {
              try {
                const bytes = decodeBase64ToBytes(normalized.base64);
                mediaBytesRef.current.set(normalized.mediaId, {
                  bytes,
                  mime: normalized.mime,
                });
                setMediaVersion((version) => version + 1);
              } catch {
                // Bytes stay unharvested; the export names the omission.
              }
            }
          }
          return {
            status: response.status,
            body: raw as AnalyzeSuccessBody | AnalyzeErrorBody,
          };
        },
      }),
  );

  const [snap, setSnap] = useState<SessionManagerSnapshot | null>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, FlowError>>({});

  const catalogSnapshot = useMemo(
    () =>
      catalog
        ? {
            catalogId: catalog.catalogId,
            catalogVersion: catalog.version,
            itemIds: catalog.items.map((entry) => entry.id),
          }
        : null,
    [catalog],
  );

  useEffect(() => {
    if (!catalogSnapshot) return;
    // Live subscription: every manager transition (begin-analysis, cancel,
    // fail, success, delete, storage recovery) re-renders immediately instead
    // of waiting for the settling await, so mid-flight states like
    // "analyzing" and their cancel controls appear. Registered once alongside
    // init; the post-await setSnap calls below stay as harmless redundancy.
    const unsubscribe = manager.subscribe((next) => {
      setSnap(next);
    });
    let cancelled = false;
    manager
      .init(SESSION_ID, catalogSnapshot)
      .then((next) => {
        if (!cancelled) setSnap(next);
      })
      .catch(() => {
        if (!cancelled) setSnap(manager.snapshot());
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [manager, catalogSnapshot]);

  function clearLocalError(itemId: string): void {
    setLocalErrors((current) => {
      if (!current[itemId]) return current;
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  function reportLocalError(itemId: string, error: FlowError): void {
    setLocalErrors((current) => ({ ...current, [itemId]: error }));
  }

  const state = snap?.state ?? null;
  const storage = snap?.storage ?? {
    kind: "loading" as const,
    message: "Loading the local session…",
    inMemory: false,
  };
  const ready = state !== null;

  async function runAnalyze(
    itemId: string,
    file: File,
  ): Promise<
    | { ok: true; analysisId: string }
    | { ok: false; code: string; message: string; retryable: boolean }
  > {
    const previous = pendingAnalyzeRef.current.get(itemId);
    if (previous) {
      // A previous upload for this item is still settling: cancel its
      // inflight work and wait for it to settle so this photo starts from a
      // clean identity. The cancel aborts the fetch, so even a gated server
      // response cannot hang this wait.
      setSnap(await manager.cancel(itemId));
      try {
        await previous;
      } catch {
        // Settle-only; the new upload proceeds regardless.
      }
    }
    // Replacement while analyzing: cancel the inflight request first so the
    // new photo wins and the late first response is discarded as stale.
    if (manager.snapshot().inflight.some((entry) => entry.itemId === itemId)) {
      setSnap(await manager.cancel(itemId));
    }
    const task = manager.analyze(itemId, file);
    pendingAnalyzeRef.current.set(itemId, task);
    try {
      return await task;
    } finally {
      if (pendingAnalyzeRef.current.get(itemId) === task) {
        pendingAnalyzeRef.current.delete(itemId);
      }
    }
  }

  async function handleSelectFile(itemId: string, file: File): Promise<void> {
    clearLocalError(itemId);
    const result = await runAnalyze(itemId, file);
    setSnap(manager.snapshot());
    if (!result.ok) {
      if (result.code === "STALE_RESPONSE" || result.code === "CANCELLED") {
        return;
      }
      // A failure the reducer stamped onto the item is already surfaced once
      // by WorkerReview (review-error-*) with its retry affordances; a local
      // alert would announce the same outcome twice. Only failures that
      // stamped no item error (client-side validation, NO_SESSION, …) need
      // the local alert path.
      if (manager.item(itemId)?.error) {
        return;
      }
      reportLocalError(itemId, {
        code: result.code,
        message: `${result.message} The current photo is kept.`,
      });
    }
  }

  async function handleCancel(itemId: string): Promise<void> {
    clearLocalError(itemId);
    setSnap(await manager.cancel(itemId));
  }

  async function handleRemove(itemId: string): Promise<void> {
    clearLocalError(itemId);
    setSnap(await manager.deleteItemEvidence(itemId));
  }

  async function handleAccept(itemId: string): Promise<void> {
    clearLocalError(itemId);
    const result = await manager.acceptReview(itemId);
    setSnap(manager.snapshot());
    if (!result.ok) {
      reportLocalError(itemId, { code: result.code, message: result.message });
    }
  }

  async function handleAcceptEdited(
    itemId: string,
    revisedText: string,
  ): Promise<void> {
    clearLocalError(itemId);
    const result = await manager.acceptEditedReview(itemId, revisedText);
    setSnap(manager.snapshot());
    if (!result.ok) {
      reportLocalError(itemId, { code: result.code, message: result.message });
    }
  }

  async function handleReject(itemId: string, reason: string): Promise<void> {
    clearLocalError(itemId);
    const result = await manager.rejectReview(itemId, reason);
    setSnap(manager.snapshot());
    if (!result.ok) {
      reportLocalError(itemId, { code: result.code, message: result.message });
    }
  }

  async function handleRecordManualCheck(
    itemId: string,
    requiredCheckIds: string[],
    checkId: string,
    outcome: "performed" | "not-performed",
    note: string,
  ): Promise<void> {
    clearLocalError(itemId);
    const result = await manager.recordManualCheck(
      itemId,
      checkId,
      outcome,
      note,
      requiredCheckIds,
    );
    setSnap(manager.snapshot());
    if (!result.ok) {
      reportLocalError(itemId, { code: result.code, message: result.message });
    }
  }

  async function handleReanalyze(itemId: string): Promise<void> {
    clearLocalError(itemId);
    // Prefer a true fresh analysis of the current photo: refetch the staged
    // bytes from the live preview URL and analyze them. When the bytes are
    // unavailable (revoked URL, missing blob), fall back to resetting the
    // review so the worker can capture again — never a silent no-op.
    const record = manager.item(itemId);
    const previewUrl = record?.mediaId
      ? manager.previewUrlFor(record.mediaId)
      : null;
    if (previewUrl) {
      try {
        const fetched = await fetch(previewUrl);
        if (!fetched.ok) throw new Error("preview fetch failed");
        const blob = await fetched.blob();
        if (blob.size <= 0) throw new Error("preview blob is empty");
        const file = new File(
          [blob],
          "reanalysis-photo.png",
          blob.type ? { type: blob.type } : undefined,
        );
        const result = await runAnalyze(itemId, file);
        setSnap(manager.snapshot());
        if (!result.ok) {
          if (
            result.code !== "STALE_RESPONSE" &&
            result.code !== "CANCELLED" &&
            // Same single-error rule as handleSelectFile: the reducer-stamped
            // item error (review-error-*) already surfaces this outcome.
            !manager.item(itemId)?.error
          ) {
            reportLocalError(itemId, {
              code: result.code,
              message: result.message,
            });
          }
        }
        return;
      } catch {
        // Fall through to the plain reset below.
      }
    }
    const result = await manager.reanalyzeItem(itemId);
    setSnap(manager.snapshot());
    // Reanalyze failures stamp no item error, so the local alert is the only
    // surface — unless the item still carries a previous stamped error that
    // WorkerReview already shows (review-error-*).
    if (!result.ok && !manager.item(itemId)?.error) {
      reportLocalError(itemId, { code: result.code, message: result.message });
    }
  }

  async function handleRetryLoad(): Promise<void> {
    if (!catalogSnapshot) return;
    setSnap(await manager.init(SESSION_ID, catalogSnapshot));
  }

  async function handleResetStorage(): Promise<void> {
    if (!catalogSnapshot) return;
    mediaBytesRef.current.clear();
    setMediaVersion((version) => version + 1);
    setLocalErrors({});
    setSnap(await manager.resetStorage(SESSION_ID, catalogSnapshot));
  }

  // Stable printable snapshot: built from the current reducer state plus the
  // harvested canonical bytes. Building never mutates review state, and later
  // async work cannot rewrite an already-built snapshot object.
  const exportSnapshot: ExportSnapshot | null = useMemo(() => {
    if (!state || !catalog) return null;
    // Read the ref through `mediaVersion` so harvested bytes refresh the
    // snapshot without storing binary data in React state.
    void mediaVersion;
    const mediaById: Record<string, ExportMediaInput> = {};
    for (const [mediaId, entry] of mediaBytesRef.current) {
      mediaById[mediaId] = entry;
    }
    return buildExportSnapshot({
      state,
      catalog,
      mediaById,
      analysisMode,
      generatedAt: state.updatedAt,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, catalog, analysisMode, mediaVersion]);

  function handlePrint(): void {
    if (typeof window !== "undefined" && typeof window.print === "function") {
      window.print();
    }
  }

  function handleDownloadHtml(): void {
    if (!exportSnapshot || typeof document === "undefined") return;
    const html = renderExportHtml(exportSnapshot);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFilename(
      exportSnapshot.sessionId,
      exportSnapshot.generatedAt,
    );
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const storageAlert =
    storage.kind === "error" ||
    storage.kind === "corrupt" ||
    storage.kind === "needs-reset";

  const storageErrorForExport =
    storageAlert || storage.kind === "in-memory" ? storage.message : null;

  // Live step progress (text + shape, never color alone).
  const itemCount = catalog?.items.length ?? 0;
  const photosCaptured =
    state && catalog
      ? catalog.items.filter((entry) => {
          const record = state.items[entry.id];
          return record && !record.deleted && record.mediaId !== null;
        }).length
      : 0;
  const draftsDecided =
    state && catalog
      ? catalog.items.filter((entry) => {
          const record = state.items[entry.id];
          return (
            record &&
            !record.deleted &&
            (record.disposition === "accepted" ||
              record.disposition === "accepted-edited" ||
              record.disposition === "rejected")
          );
        }).length
      : 0;
  const exportReady = exportSnapshot?.canClaimCompleted ?? false;
  const exportUnresolved = exportSnapshot?.unresolved.length ?? itemCount;
  const unresolvedNoun = exportUnresolved === 1 ? "item" : "items";

  if (!catalog || !catalogSnapshot) {
    return (
      <section aria-labelledby="flow-fatal-heading" className="wt-card">
        <h2 id="flow-fatal-heading" className="wt-section-title">
          Walkthrough unavailable
        </h2>
        <p role="alert" className="wt-statusline">
          The bundled demo catalog failed validation and the walkthrough
          cannot start:{" "}
          {CATALOG_RESULT.ok
            ? "unknown catalog problem"
            : CATALOG_RESULT.errors.join("; ")}
          Recovery: reload the page; if this persists, the app bundle is
          corrupt and must be rebuilt. No evidence was captured.
        </p>
      </section>
    );
  }

  return (
    <div className="wt">
      <section aria-labelledby="flow-status-heading">
        <h2 id="flow-status-heading" className="wt-section-title">
          Session status
        </h2>
        {storageAlert ? (
          <div role="alert" className="wt-alert" data-testid="flow-storage-error">
            <p className="wt-statusline">
              <strong>Storage problem:</strong> {storage.message}
            </p>
            <div className="wt-actions wt-no-print">
              <button
                type="button"
                className="wt-btn"
                onClick={() => void handleRetryLoad()}
              >
                Retry loading the session
              </button>
              <button
                type="button"
                className="wt-btn"
                onClick={() => void handleResetStorage()}
              >
                Reset storage and start a fresh local session
              </button>
            </div>
          </div>
        ) : (
          <p
            role="status"
            className="wt-statusline"
            data-testid="flow-storage-status"
          >
            Status: {storage.message}
          </p>
        )}
        {!ready && !storageAlert && (
          <p role="status" className="wt-statusline">
            Loading the checklist — capture, review, and export appear as soon
            as the local session is ready.
          </p>
        )}
      </section>

      {ready && state && (
        <section aria-labelledby="flow-steps-heading" className="wt-section">
          <h2 id="flow-steps-heading" className="wt-section-title">
            Your progress: 1 Capture → 2 Review → 3 Export
          </h2>
          <ol className="wt-steps">
            <li
              className={`wt-step ${photosCaptured === itemCount && itemCount > 0 ? "wt-step--done" : "wt-step--current"}`}
            >
              <span className="wt-step-num" aria-hidden="true">
                1
              </span>
              <div>
                <p className="wt-step-name">
                  <a href="#flow-checklist">Capture</a>
                </p>
                <p className="wt-step-detail" role="status">
                  Step 1 of 3 — {photosCaptured} of {itemCount} photos captured
                  {photosCaptured === itemCount && itemCount > 0
                    ? " — complete."
                    : "."}
                </p>
              </div>
            </li>
            <li
              className={`wt-step ${draftsDecided === itemCount && itemCount > 0 ? "wt-step--done" : "wt-step--current"}`}
            >
              <span className="wt-step-num" aria-hidden="true">
                2
              </span>
              <div>
                <p className="wt-step-name">
                  <a href={`#item-${catalog.items[0].id}`}>Review</a>
                </p>
                <p className="wt-step-detail" role="status">
                  Step 2 of 3 — {draftsDecided} of {itemCount} drafts decided
                  {draftsDecided === itemCount && itemCount > 0
                    ? " — complete."
                    : "."}
                </p>
              </div>
            </li>
            <li
              className={`wt-step ${exportReady ? "wt-step--done" : "wt-step--current"}`}
            >
              <span className="wt-step-num" aria-hidden="true">
                3
              </span>
              <div>
                <p className="wt-step-name">
                  <a href="#export-summary">Export</a>
                </p>
                <p className="wt-step-detail" role="status">
                  Step 3 of 3 —{" "}
                  {exportReady
                    ? "all items completed; export is ready."
                    : `${exportUnresolved} ${unresolvedNoun} still unresolved; export stays a draft.`}
                </p>
              </div>
            </li>
          </ol>
        </section>
      )}

      {ready && state && (
        <nav aria-label="Checklist items" className="wt-section">
          <h2 id="flow-checklist" className="wt-section-title">
            Checklist
          </h2>
          <p className="wt-section-sub">
            Four demo items. Each card shows what to photograph and its current
            state — open an item to capture and review it below.
          </p>
          <ol className="wt-pick-grid">
            {catalog.items.map((entry, index) => {
              const record = state.items[entry.id] ?? null;
              return (
                <li key={entry.id} className={`wt-pick ${pickTone(record)}`}>
                  <p className="wt-pick-label">
                    Item {index + 1} of {itemCount}: {entry.label}
                  </p>
                  <p className="wt-pick-guidance">{entry.captureGuidance}</p>
                  <div className="wt-pick-row">
                    <span className={`wt-chip ${chipTone(record)}`}>
                      {itemSummary(record)}
                    </span>
                    <a className="wt-btn" href={`#item-${entry.id}`}>Open item →</a>
                  </div>
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      {ready &&
        state &&
        catalog.items.map((catalogItem, index) => {
          const record: ItemRecord | null =
            state.items[catalogItem.id] ?? null;
          if (!record) {
            return (
              <article
                key={catalogItem.id}
                id={`item-${catalogItem.id}`}
                className="wt-card wt-item wt-section"
              >
                <h2 className="wt-item-title">{catalogItem.label}</h2>
                <p role="note" className="wt-note">
                  This catalog entry has no session record yet. Reload the
                  session; if this persists, reset storage to start a fresh
                  local session.
                </p>
              </article>
            );
          }
          const requiredCheckIds = catalogItem.manualChecks.map(
            (check) => check.id,
          );
          const previewUrl = manager.previewUrlFor(record.mediaId);
          // The persisted item error is surfaced exactly once, by
          // WorkerReview (review-error-*) with its reanalyze affordance.
          // The reducer always stamps the error together with status "error",
          // so forwarding it to GuidedCapture as well would render a second
          // identical alert (capture-error-*) for the same outcome. The
          // capture panel therefore receives no item error and only announces
          // its own client-side validation (e.g. empty file) via
          // capture-error-*.
          const captureError = null;
          const flowError = localErrors[catalogItem.id] ?? null;
          return (
            <article
              key={catalogItem.id}
              id={`item-${catalogItem.id}`}
              aria-label={catalogItem.label}
              className="wt-card wt-item wt-section"
            >
              <div className="wt-item-head">
                <p className="wt-item-kicker">
                  Item {index + 1} of {itemCount}
                </p>
                <h2 className="wt-item-title">{catalogItem.label}</h2>
                <span className={`wt-chip ${chipTone(record)}`}>
                  {itemSummary(record)}
                </span>
              </div>
              {flowError && !record.error && (
                <p
                  role="alert"
                  className="wt-statusline"
                  data-testid={`flow-error-${catalogItem.id}`}
                >
                  <strong>Error [{flowError.code}]:</strong>{" "}
                  {flowError.message}
                </p>
              )}
              <div className="wt-item-sub">
                <h3 className="wt-subhead">Step 1 — Photo</h3>
                <GuidedCapture
                  itemId={catalogItem.id}
                  itemLabel={catalogItem.label}
                  captureGuidance={catalogItem.captureGuidance}
                  status={record.status}
                  previewUrl={previewUrl}
                  error={captureError}
                  analysisMode={analysisMode}
                  onSelectFile={(file) =>
                    void handleSelectFile(catalogItem.id, file)
                  }
                  onCancelAnalysis={() =>
                    void handleCancel(catalogItem.id)
                  }
                  onRemovePhoto={() => void handleRemove(catalogItem.id)}
                  disabled={!ready}
                />
              </div>
              <div className="wt-item-sub">
                <h3 className="wt-subhead">Step 2 — Worker review</h3>
                <WorkerReview
                  item={record}
                  catalogItem={catalogItem}
                  sessionId={state.sessionId}
                  catalogVersion={state.catalogVersion}
                  previewUrl={previewUrl}
                  analysisMode={analysisMode}
                  onAccept={() => void handleAccept(catalogItem.id)}
                  onAcceptEdited={(revisedText) =>
                    void handleAcceptEdited(catalogItem.id, revisedText)
                  }
                  onReject={(reason) =>
                    void handleReject(catalogItem.id, reason)
                  }
                  onRecordManualCheck={(checkId, outcome, note) =>
                    void handleRecordManualCheck(
                      catalogItem.id,
                      requiredCheckIds,
                      checkId,
                      outcome,
                      note,
                    )
                  }
                  onReanalyze={() => void handleReanalyze(catalogItem.id)}
                  onCancelAnalysis={() => void handleCancel(catalogItem.id)}
                  disabled={!ready}
                />
              </div>
            </article>
          );
        })}

      <div className="wt-section">
        <h2 className="wt-section-title">Step 3 — Review-only export</h2>
        <ExportSummary
          snapshot={exportSnapshot}
          storageError={storageErrorForExport}
          onPrint={handlePrint}
          onDownloadHtml={exportSnapshot ? handleDownloadHtml : undefined}
          disabled={!ready}
        />
      </div>
    </div>
  );
}
