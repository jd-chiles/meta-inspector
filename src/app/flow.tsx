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
import GuidePanel from "../features/walkthrough/guide";
import {
  DeferredInstallPrompt,
  clearQueuedForSession,
  createQueuedIntent,
  describeOfflineState,
  describePendingItem,
  detectInstallPlatform,
  enqueueOfflineAnalysis,
  getInstallAffordance,
  isItemQueued,
  isNavigatorOnline,
  isStandaloneDisplay,
  loadOfflineQueue,
  manualInstallSteps,
  pendingForSession,
  registerAppServiceWorker,
  removeQueuedForItem,
  requestInstall,
  saveOfflineQueue,
  subscribeConnectivity,
  type BeforeInstallPromptEventLike,
  type InstallPlatform,
  type OfflineQueue,
} from "../features/walkthrough/offline";
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

type WorkspaceView = "overview" | "walkthrough" | "notes" | "packet" | "settings";

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
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("overview");
  const [selectedItemId, setSelectedItemId] = useState(
    () => catalog?.items[0]?.id ?? "",
  );
  const [mobileReviewOpen, setMobileReviewOpen] = useState(false);
  const [mobileGuideOpen, setMobileGuideOpen] = useState(false);

  // Offline-first PWA wiring (REQ-007, REQ-009, REQ-013): a pending-only
  // analysis queue, service-worker shell status, and an install affordance
  // with manual-guidance fallback. The queue carries identities only
  // (session/item/attempt/mediaId); bytes stay in IndexedDB under the
  // session manager. Nothing here synthesizes a draft or implies a verdict
  // while offline — reconnect requires an explicit per-item retry through
  // the existing reanalyze control.
  const [deferredPrompt] = useState(() => new DeferredInstallPrompt());
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueue>([]);
  const queueRef = useRef<OfflineQueue>([]);
  const [online, setOnline] = useState<boolean>(true);
  const [swMessage, setSwMessage] = useState<string>(
    "Checking the offline shell…",
  );
  const [installPromptAvailable, setInstallPromptAvailable] =
    useState<boolean>(false);
  const [installStandalone, setInstallStandalone] = useState<boolean>(false);
  const [installPlatform, setInstallPlatform] =
    useState<InstallPlatform>("unknown");
  const [installAccepted, setInstallAccepted] = useState<boolean>(false);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const [caseNotesDraft, setCaseNotesDraft] = useState<string>("");
  const [caseNotesEditing, setCaseNotesEditing] = useState<boolean>(false);
  const [caseNotesError, setCaseNotesError] = useState<string | null>(null);
  const [caseNotesNotice, setCaseNotesNotice] = useState<string | null>(null);

  function persistQueue(next: OfflineQueue): void {
    queueRef.current = next;
    setOfflineQueue(next);
    saveOfflineQueue(next);
  }

  function currentSessionId(): string {
    return manager.snapshot().state?.sessionId ?? SESSION_ID;
  }

  function enqueuePendingIntent(itemId: string): void {
    const record = manager.item(itemId);
    const intent = createQueuedIntent({
      sessionId: currentSessionId(),
      itemId,
      attempt: record?.attempt ?? 0,
      mediaId: record?.mediaId ?? null,
      stagedAt: new Date().toISOString(),
    });
    persistQueue(enqueueOfflineAnalysis(queueRef.current, intent));
  }

  function dequeueItemIntent(itemId: string): void {
    const next = removeQueuedForItem(
      queueRef.current,
      currentSessionId(),
      itemId,
    );
    if (next.length !== queueRef.current.length) persistQueue(next);
  }

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

  // Connectivity transitions plus the persisted pending-only queue. The
  // queue never auto-runs: every entry waits for an explicit per-item
  // retry after reconnect.
  useEffect(() => {
    setOnline(isNavigatorOnline());
    const loaded = loadOfflineQueue();
    queueRef.current = loaded.queue;
    setOfflineQueue(loaded.queue);
    if (loaded.hadCorruptRows) {
      setQueueNotice(
        "A corrupt offline-queue entry was dropped and never applied. Photos already on screen are unaffected; retry any pending item explicitly.",
      );
    }
    return subscribeConnectivity(setOnline);
  }, []);

  // App-shell service worker: caches shell/assets only, never evidence
  // bytes, provider payloads, keys, or media.
  useEffect(() => {
    let cancelled = false;
    registerAppServiceWorker().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSwMessage(
          `Offline shell ready${result.scope ? ` (scope ${result.scope})` : ""}. The installed shell opens your saved local progress; analyses still need a connection and never run automatically.`,
        );
      } else {
        setSwMessage(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Install affordance: capture the single-use prompt when the browser
  // offers it; otherwise (and after a dismissal) degrade to manual steps.
  useEffect(() => {
    setInstallStandalone(isStandaloneDisplay());
    setInstallPlatform(detectInstallPlatform());
    const onBeforeInstallPrompt = (event: Event): void => {
      event.preventDefault();
      deferredPrompt.capture(event as unknown as BeforeInstallPromptEventLike);
      setInstallPromptAvailable(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    };
  }, [deferredPrompt]);

  async function handleInstall(): Promise<void> {
    const result = await requestInstall(deferredPrompt);
    setInstallPromptAvailable(false);
    if (result.outcome === "accepted") {
      setInstallAccepted(true);
    } else {
      setInstallPlatform(result.platform);
    }
  }

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
      if (result.code === "PROVIDER_UNAVAILABLE") {
        // Offline transport failure: keep the photo and record a
        // pending-only intent (no draft, no verdict). The worker retries
        // explicitly via the item's reanalyze control after reconnect.
        enqueuePendingIntent(itemId);
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
      return;
    }
    dequeueItemIntent(itemId);
  }

  async function handleCancel(itemId: string): Promise<void> {
    clearLocalError(itemId);
    setSnap(await manager.cancel(itemId));
  }

  async function handleRemove(itemId: string): Promise<void> {
    clearLocalError(itemId);
    setSnap(await manager.deleteItemEvidence(itemId));
    // Deleted evidence must never be analyzed later by a stale queue entry.
    dequeueItemIntent(itemId);
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

  async function handleRecordDeficiency(
    itemId: string,
    input: {
      issueDescription: string;
      correctiveAction: string;
      responsibleParty?: string;
      targetDate?: string;
    },
  ): Promise<void> {
    clearLocalError(itemId);
    const result = await manager.recordDeficiency(itemId, {
      issueDescription: input.issueDescription,
      correctiveAction: input.correctiveAction,
      responsibleParty: input.responsibleParty ?? null,
      targetDate: input.targetDate ?? null,
    });
    setSnap(manager.snapshot());
    if (!result.ok) {
      reportLocalError(itemId, { code: result.code, message: result.message });
    }
  }

  async function handleClearDeficiency(itemId: string): Promise<void> {
    clearLocalError(itemId);
    const result = await manager.clearDeficiency(itemId);
    setSnap(manager.snapshot());
    if (!result.ok) {
      reportLocalError(itemId, { code: result.code, message: result.message });
    }
  }

  async function handleSaveCaseNotes(): Promise<void> {
    setCaseNotesError(null);
    setCaseNotesNotice(null);
    const trimmed = caseNotesDraft.trim();
    if (trimmed.length === 0) {
      setCaseNotesError(
        "Enter 1–2000 characters of worker draft text, or clear the notes.",
      );
      return;
    }
    if (trimmed.length > 2000) {
      setCaseNotesError("Case notes must be at most 2000 characters.");
      return;
    }
    const result = await manager.setCaseNotes(caseNotesDraft);
    setSnap(manager.snapshot());
    if (!result.ok) {
      setCaseNotesError(result.message);
      return;
    }
    setCaseNotesNotice("Case notes saved as a worker draft.");
    setCaseNotesEditing(false);
  }

  async function handleClearCaseNotes(): Promise<void> {
    setCaseNotesError(null);
    const result = await manager.clearCaseNotes();
    setSnap(manager.snapshot());
    if (!result.ok) {
      setCaseNotesNotice(null);
      setCaseNotesError(result.message);
      return;
    }
    setCaseNotesNotice("Case notes cleared.");
    setCaseNotesDraft("");
    setCaseNotesEditing(false);
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
          if (result.code === "PROVIDER_UNAVAILABLE") {
            enqueuePendingIntent(itemId);
          }
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
        } else {
          dequeueItemIntent(itemId);
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
    if (result.ok) dequeueItemIntent(itemId);
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
    // A storage reset discards every staged photo, so no queued intent may
    // outlive the evidence it points at.
    persistQueue(clearQueuedForSession(queueRef.current, SESSION_ID));
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
  const exportUnresolved = exportSnapshot?.unresolved.length ?? itemCount;
  const unresolvedNoun = exportUnresolved === 1 ? "item" : "items";
  const completedCount = exportSnapshot?.completedCount ?? 0;
  const activeItem =
    catalog?.items.find((entry) => entry.id === selectedItemId) ??
    catalog?.items[0] ?? {
      id: "",
      label: "",
      captureGuidance: "",
      manualChecks: [],
    };
  const activeItemIndex = Math.max(0, catalog?.items.findIndex((entry) => entry.id === activeItem.id) ?? 0);
  const activeRecord = state?.items[activeItem.id] ?? null;
  const performedCheckCount = activeRecord?.manualChecks.filter((check) => check.outcome === "performed").length ?? 0;

  useEffect(() => {
    const reviewAvailable = ["draft", "reviewed", "rejected", "error"].includes(activeRecord?.status ?? "");
    setMobileReviewOpen(reviewAvailable);
    setMobileGuideOpen(false);
    if (reviewAvailable && window.matchMedia("(max-width: 48rem)").matches) {
      window.requestAnimationFrame(() => {
        document.getElementById("active-item-review")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [activeItem.id, activeRecord?.status]);
  const activeGuideStage =
    activeRecord?.status === "error" || activeRecord?.status === "rejected"
      ? "blocked"
      : activeRecord?.status === "draft"
        ? "analysis-ready"
        : activeRecord?.status === "reviewed"
          ? performedCheckCount >= activeItem.manualChecks.length
            ? "complete"
            : "worker-reviewed"
          : activeRecord?.mediaId
            ? "photo-saved"
            : "start";

  function guideCopy(): string {
    if (activeRecord?.status === "analyzing") {
      return "I’m checking the photo for visible details. This step cannot determine whether the area passes or fails.";
    }
    if (activeRecord?.status === "error") {
      return "The photo review did not finish. The photo is still saved locally; retry the review or replace the photo.";
    }
    if (activeRecord?.status === "draft" || activeRecord?.status === "rejected") {
      return "An AI observation is ready as an unreviewed draft. Read it, correct or reject it, and then complete the in-person check below.";
    }
    if (activeRecord?.status === "reviewed") {
      const checks = activeRecord.manualChecks.filter((check) => check.outcome === "performed").length;
      if (checks < activeItem.manualChecks.length) {
        return "Your worker review is saved. Complete the required in-person check below before moving on.";
      }
      return "This area has a worker-reviewed note and recorded physical check. You can continue to the next area.";
    }
    if (activeRecord?.mediaId) {
      return "The photo is saved. Finish the AI observation, review it in your own words, and record the in-person check.";
    }
    return "Let’s work through one Form 1083 area at a time. Start with a photo of the relevant feature, then review the observation and do the required in-person check.";
  }

  // Pending-only offline queue depth for this session, and the install
  // affordance (prompt when captured, manual guidance otherwise).
  const pendingCount = state
    ? pendingForSession(offlineQueue, state.sessionId).length
    : 0;
  const installAffordance = getInstallAffordance({
    standalone: installStandalone,
    deferredPromptAvailable: installPromptAvailable,
    platform: installPlatform,
  });
  // Guidance steps stay available even when the helper resolves another
  // mode: the install path must always degrade to manual steps, never to
  // silence.
  const installSteps =
    installAffordance.mode === "guidance"
      ? installAffordance.steps
      : manualInstallSteps(installPlatform);

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
      <nav className="wt-workspace-nav" aria-label="Walkthrough sections">
        {([
          ["overview", "Overview", "Home"],
          ["walkthrough", "Walkthrough", "Inspect"],
          ["notes", "Case notes", "Notes"],
          ["packet", "Correction packet", "Packet"],
          ["settings", "Offline & settings", "Offline"],
        ] as const).map(([view, label, mobileLabel]) => (
          <button
            key={view}
            type="button"
            className={"wt-nav-button" + (workspaceView === view ? " wt-nav-button--active" : "")}
            aria-current={workspaceView === view ? "page" : undefined}
            aria-label={label}
            data-testid={"nav-" + view}
            onClick={() => setWorkspaceView(view)}
          >
            <span className="wt-nav-full-label">{label}</span>
            <span className="wt-nav-mobile-label">{mobileLabel}</span>
          </button>
        ))}
      </nav>

      {storageAlert && (
        <div role="alert" className="wt-alert wt-storage-alert" data-testid="flow-storage-error">
          <p className="wt-statusline"><strong>Local session needs attention.</strong> {storage.message}</p>
          <div className="wt-actions wt-no-print">
            {storage.kind !== "needs-reset" && (
              <button type="button" className="wt-btn" onClick={() => void handleRetryLoad()}>
                Retry loading
              </button>
            )}
            <button type="button" className="wt-btn wt-btn--primary" onClick={() => void handleResetStorage()}>
              Reset local session
            </button>
          </div>
        </div>
      )}

      {workspaceView === "overview" && (
        <section className="wt-dashboard" aria-labelledby="overview-heading">
          <div className="wt-dashboard-hero">
            <div>
              <p className="wt-eyebrow">LAHSA · Form 1083 walkthrough</p>
              <h2 id="overview-heading">One area at a time</h2>
              <p className="wt-lede">Capture evidence, review the photo observation, record each in-person check, then prepare a local draft packet.</p>
            </div>
            <button
              type="button"
              className="wt-btn wt-btn--primary wt-start-button"
              data-testid="start-walkthrough"
              disabled={!ready}
              onClick={() => setWorkspaceView("walkthrough")}
            >
              {photosCaptured > 0 ? "Continue walkthrough" : "Start walkthrough"}
            </button>
          </div>

          <div className="wt-progress-card">
            <div className="wt-progress-heading">
              <div>
                <p className="wt-card-kicker">Local session progress</p>
                <h3>{completedCount} of {itemCount} areas ready for the draft packet</h3>
              </div>
              <span className="wt-chip wt-chip--active">{photosCaptured} photos</span>
            </div>
            <progress aria-label="Completed Form 1083 areas" max={itemCount} value={completedCount} />
            <p className="wt-note">Worker review and required physical checks must both be recorded for an area to count as complete.</p>
          </div>

          <div className="wt-overview-grid">
            <section className="wt-area-board" aria-labelledby="areas-heading">
              <div className="wt-section-heading-row">
                <div>
                  <p className="wt-card-kicker">Inspection areas</p>
                  <h3 id="areas-heading">Form 1083 checklist</h3>
                </div>
                <button type="button" className="wt-text-button" onClick={() => setWorkspaceView("walkthrough")}>
                  Open guided view
                </button>
              </div>
              <details className="wt-area-disclosure" data-testid="overview-area-disclosure">
                <summary>
                  <span>Show all {itemCount} inspection areas</span>
                  <span className="wt-disclosure-meta">{completedCount} of {itemCount} complete</span>
                </summary>
                <ol className="wt-overview-list">
                  {catalog.items.map((entry, index) => {
                    const record = state?.items[entry.id] ?? null;
                    const complete = exportSnapshot?.items.find((item) => item.itemId === entry.id)?.completed ?? false;
                    return (
                      <li key={entry.id} className="wt-overview-item">
                        <button
                          type="button"
                          className="wt-overview-button"
                          data-testid={"overview-item-" + entry.id}
                          onClick={() => {
                            setSelectedItemId(entry.id);
                            setWorkspaceView("walkthrough");
                          }}
                        >
                          <span className="wt-area-number">{String(index + 1).padStart(2, "0")}</span>
                          <span className="wt-overview-copy">
                            <strong>{entry.label}</strong>
                            <span>{complete ? "Worker-reviewed and physical check recorded" : itemSummary(record)}</span>
                          </span>
                          <span className={"wt-area-state" + (complete ? " wt-area-state--done" : "")} aria-label={complete ? "Complete" : "Needs work"}>
                            {complete ? "✓" : "›"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </details>
            </section>

            <aside className="wt-next-card" aria-labelledby="next-up-heading">
              <p className="wt-card-kicker">Next up</p>
              <h3 id="next-up-heading">{catalog.items.find((entry) => !exportSnapshot?.items.find((item) => item.itemId === entry.id)?.completed)?.label ?? "Review your draft packet"}</h3>
              <p className="wt-note">AI output stays an unreviewed observation. You decide what to keep and record the physical check yourself.</p>
              <button type="button" className="wt-btn" onClick={() => {
                const nextItem = catalog.items.find((entry) => !exportSnapshot?.items.find((item) => item.itemId === entry.id)?.completed);
                if (nextItem) setSelectedItemId(nextItem.id);
                setWorkspaceView(nextItem ? "walkthrough" : "packet");
              }}>
                Continue with next step
              </button>
            </aside>
          </div>
        </section>
      )}

      {workspaceView === "walkthrough" && (
        <section className="wt-guided-layout" aria-labelledby="active-area-heading">
          <aside className="wt-area-sidebar" aria-label="Form 1083 areas">
            <div className="wt-sidebar-heading">
              <p className="wt-card-kicker">Walkthrough</p>
              <h2>{completedCount}/{itemCount} complete</h2>
            </div>
            <ol className="wt-sidebar-list">
              {catalog.items.map((entry, index) => {
                const record = state?.items[entry.id] ?? null;
                const complete = exportSnapshot?.items.find((item) => item.itemId === entry.id)?.completed ?? false;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={"wt-sidebar-item" + (entry.id === activeItem.id ? " wt-sidebar-item--active" : "")}
                      aria-current={entry.id === activeItem.id ? "step" : undefined}
                      data-testid={"area-nav-" + entry.id}
                      data-item-id={entry.id}
                      onClick={() => {
                        setSelectedItemId(entry.id);
                      }}
                    >
                      <span className="wt-area-number">{String(index + 1).padStart(2, "0")}</span>
                      <span className="wt-sidebar-copy">{entry.label}</span>
                      <span className={"wt-sidebar-state" + (complete ? " wt-sidebar-state--done" : "")}>
                        {complete ? "✓" : record?.mediaId ? "•" : "—"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>

          <div className="wt-guided-content">
            <div className="wt-mobile-area-picker">
              <span className="wt-mobile-area-count">Area {activeItemIndex + 1} of {itemCount}</span>
              <label className="sr-only" htmlFor="mobile-area-select">Choose a Form 1083 area</label>
              <select
                id="mobile-area-select"
                data-testid="mobile-area-select"
                value={activeItem.id}
                onChange={(event) => setSelectedItemId(event.target.value)}
              >
                {catalog.items.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.label}</option>
                ))}
              </select>
            </div>
            <div className="wt-area-header">
              <div>
                <p className="wt-card-kicker">Area {activeItemIndex + 1} of {itemCount}</p>
                <h2 id="active-area-heading">{activeItem.label}</h2>
                <p className="wt-lede">{activeItem.captureGuidance}</p>
              </div>
              <span className={"wt-chip " + chipTone(activeRecord)}>{itemSummary(activeRecord)}</span>
            </div>

            <div className="wt-guided-columns">
              <div className="wt-work-column">
                {isItemQueued(offlineQueue, state?.sessionId ?? SESSION_ID, activeItem.id) && (
                  <p role="status" className="wt-note" data-testid={`offline-pending-${activeItem.id}`}>{describePendingItem(activeItem.label)}</p>
                )}
                {localErrors[activeItem.id] && !activeRecord?.error && (
                  <p role="alert" className="wt-alert"><strong>Error [{localErrors[activeItem.id].code}]:</strong> {localErrors[activeItem.id].message}</p>
                )}
                <div className="wt-panel-heading">
                  <span className="wt-panel-step">01</span>
                  <div><h3>Capture evidence</h3><p>Use a clear photo of this area.</p></div>
                </div>
                <GuidedCapture
                  itemId={activeItem.id}
                  itemLabel={activeItem.label}
                  captureGuidance={activeItem.captureGuidance}
                  status={activeRecord?.status ?? "empty"}
                  previewUrl={manager.previewUrlFor(activeRecord?.mediaId ?? null)}
                  error={null}
                  analysisMode={analysisMode}
                  onSelectFile={(file) => void handleSelectFile(activeItem.id, file)}
                  onCancelAnalysis={() => void handleCancel(activeItem.id)}
                  onRemovePhoto={() => void handleRemove(activeItem.id)}
                  disabled={!ready}
                />
                <div className="wt-panel-heading wt-review-heading">
                  <span className="wt-panel-step">02</span>
                  <div><h3>Review and check</h3><p>Keep AI notes and your inspection decisions separate.</p></div>
                </div>
                <button
                  type="button"
                  className="wt-mobile-panel-toggle"
                  aria-expanded={mobileReviewOpen}
                  aria-controls="active-item-review"
                  data-testid="mobile-review-toggle"
                  onClick={() => setMobileReviewOpen((open) => !open)}
                >
                  <span>Review and physical checks</span>
                  <span className="wt-mobile-panel-status">{itemSummary(activeRecord)}</span>
                </button>
                <div className={"wt-mobile-review-content" + (mobileReviewOpen ? " wt-mobile-review-content--open" : "")}>
                {activeRecord ? (
                  <div id="active-item-review">
                    <WorkerReview
                      item={activeRecord}
                      catalogItem={activeItem}
                      sessionId={state?.sessionId ?? SESSION_ID}
                      catalogVersion={state?.catalogVersion ?? catalog.version}
                      previewUrl={manager.previewUrlFor(activeRecord.mediaId)}
                      analysisMode={analysisMode}
                      onAccept={() => void handleAccept(activeItem.id)}
                      onAcceptEdited={(revisedText) => void handleAcceptEdited(activeItem.id, revisedText)}
                      onReject={(reason) => void handleReject(activeItem.id, reason)}
                      onRecordManualCheck={(checkId, outcome, note) => void handleRecordManualCheck(activeItem.id, activeItem.manualChecks.map((check) => check.id), checkId, outcome, note)}
                      onRecordDeficiency={(input) => void handleRecordDeficiency(activeItem.id, input)}
                      onClearDeficiency={() => void handleClearDeficiency(activeItem.id)}
                      onReanalyze={() => void handleReanalyze(activeItem.id)}
                      onCancelAnalysis={() => void handleCancel(activeItem.id)}
                      disabled={!ready}
                    />
                  </div>
                ) : (
                  <p role="status" className="wt-note">Loading this area’s saved record…</p>
                )}
                </div>
                <div className="wt-area-pager">
                  <button type="button" className="wt-btn" disabled={activeItemIndex === 0} onClick={() => {
                    setSelectedItemId(catalog.items[Math.max(0, activeItemIndex - 1)].id);
                  }}>Previous area</button>
                  <button type="button" className="wt-btn wt-btn--primary" disabled={activeItemIndex === itemCount - 1} onClick={() => {
                    setSelectedItemId(catalog.items[Math.min(itemCount - 1, activeItemIndex + 1)].id);
                  }}>Next area</button>
                </div>
              </div>

              <div className="wt-mobile-guide-shell">
                <button
                  type="button"
                  className="wt-mobile-panel-toggle wt-mobile-guide-toggle"
                  aria-expanded={mobileGuideOpen}
                  aria-controls="mobile-guide-panel"
                  data-testid="mobile-guide-toggle"
                  onClick={() => setMobileGuideOpen((open) => !open)}
                >
                  <span>Need help?</span>
                  <span className="wt-mobile-panel-status">Guide and saved artifacts</span>
                </button>
                <div id="mobile-guide-panel" className={"wt-mobile-guide-content" + (mobileGuideOpen ? " wt-mobile-guide-content--open" : "")}>
                  <GuidePanel
                    key={activeItem.id}
                    itemId={activeItem.id}
                    stage={activeGuideStage}
                    initialMessage={guideCopy()}
                  >
                  <div className="wt-artifact-stack" aria-label="Generated walkthrough artifacts">
                  <p className="wt-card-kicker">Artifacts</p>
                  {activeRecord?.draft && !activeRecord.deleted ? (
                    <article className="wt-artifact-card" data-testid="guide-observation-artifact">
                      <span className="wt-artifact-label">AI photo observation · draft</span>
                      <p>{activeRecord.draft.observation}</p>
                      <button type="button" className="wt-text-button" onClick={() => document.getElementById("active-item-review")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Review observation</button>
                    </article>
                  ) : (
                    <p className="wt-artifact-empty">Your photo observation will appear here after analysis.</p>
                  )}
                  {activeRecord?.manualChecks.map((check) => (
                    <article className="wt-artifact-card wt-artifact-card--check" key={check.checkId}>
                      <span className="wt-artifact-label">Worker check · {check.outcome === "performed" ? "recorded" : "not performed"}</span>
                      <p>{check.note}</p>
                    </article>
                  ))}
                  {activeRecord?.deficiency && (
                    <article className="wt-artifact-card wt-artifact-card--correction" data-testid="guide-correction-artifact">
                      <span className="wt-artifact-label">Worker correction draft</span>
                      <p>{activeRecord.deficiency.issueDescription}</p>
                      <p><strong>Follow-up:</strong> {activeRecord.deficiency.correctiveAction}</p>
                    </article>
                  )}
                  </div>
                  </GuidePanel>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {workspaceView === "notes" && (
        <section className="wt-utility-view" aria-labelledby="case-notes-heading" data-testid="case-notes-section">
          <p className="wt-card-kicker">Session workspace</p>
          <h2 id="case-notes-heading">Case notes</h2>
          <p className="wt-lede">Worker-authored notes saved locally for this walkthrough. Notes are not filled from AI output and are not inspection outcomes.</p>
          {ready && state?.caseNotes && !caseNotesEditing && <div className="wt-note-card" data-testid="case-notes-display"><p>{state.caseNotes}</p></div>}
          {ready && state && !state.caseNotes && !caseNotesEditing && <p className="wt-empty-card" role="note" data-testid="case-notes-empty">No case notes recorded. Add a short worker draft if needed.</p>}
          {(!ready || !state) && <p className="wt-note" role="status">Case notes load with the local session.</p>}
          {caseNotesNotice && <p className="wt-statusline" role="status" data-testid="case-notes-notice">{caseNotesNotice}</p>}
          {ready && state && caseNotesEditing && (
            <div className="wt-field">
              <label htmlFor="case-notes-input" className="wt-label">Case notes (your own words, up to 2000 characters):</label>
              <textarea id="case-notes-input" data-testid="case-notes-input" value={caseNotesDraft} onChange={(event) => setCaseNotesDraft(event.target.value)} rows={5} maxLength={2000} className="wt-textarea" placeholder="Add a worker-authored note for this local session." />
              {caseNotesError && <p className="wt-statusline" role="alert" data-testid="case-notes-error">{caseNotesError}</p>}
              <div className="wt-actions wt-no-print">
                <button type="button" className="wt-btn wt-btn--primary" data-testid="case-notes-save" onClick={() => void handleSaveCaseNotes()}>Save notes</button>
                <button type="button" className="wt-btn" data-testid="case-notes-cancel" onClick={() => { setCaseNotesEditing(false); setCaseNotesError(null); }}>Cancel</button>
              </div>
            </div>
          )}
          {ready && state && !caseNotesEditing && (
            <div className="wt-actions wt-no-print">
              <button type="button" className="wt-btn wt-btn--primary" data-testid="case-notes-edit" onClick={() => { setCaseNotesError(null); setCaseNotesNotice(null); setCaseNotesDraft(state.caseNotes ?? ""); setCaseNotesEditing(true); }}>{state.caseNotes ? "Edit case notes" : "Add case notes"}</button>
              {state.caseNotes && <button type="button" className="wt-btn" data-testid="case-notes-clear" onClick={() => void handleClearCaseNotes()}>Clear case notes</button>}
            </div>
          )}
        </section>
      )}

      {workspaceView === "packet" && (
        <section className="wt-utility-view" aria-labelledby="packet-heading">
          <p className="wt-card-kicker">Local export</p>
          <h2 id="packet-heading">Correction packet</h2>
          <p className="wt-lede">Print or download a review-only packet with worker-recorded corrections, unresolved physical checks, and evidence provenance. Draft text is omitted for unresolved items.</p>
          <div className="wt-packet-summary">
            <div><strong>{exportSnapshot?.deficiencies.length ?? 0}</strong><span>worker correction drafts</span></div>
            <div><strong>{exportSnapshot?.unresolvedChecks.length ?? itemCount}</strong><span>physical checks still open</span></div>
            <div><strong>{exportUnresolved}</strong><span>{unresolvedNoun} unresolved</span></div>
          </div>
          <ExportSummary snapshot={exportSnapshot} storageError={storageErrorForExport} onPrint={handlePrint} onDownloadHtml={exportSnapshot ? handleDownloadHtml : undefined} disabled={!ready} />
        </section>
      )}

      {workspaceView === "settings" && (
        <section className="wt-utility-view" aria-labelledby="settings-heading">
          <p className="wt-card-kicker">Local app</p>
          <h2 id="settings-heading">Offline and settings</h2>
          <div className="wt-settings-grid">
            <article className="wt-setting-card">
              <h3>Connection</h3>
              <p role="status" className="wt-statusline" data-testid="offline-status">{describeOfflineState({ online, pendingCount })}</p>
              {queueNotice && <p role="note" className="wt-note" data-testid="offline-queue-notice">{queueNotice}</p>}
              <p role="status" className="wt-note" data-testid="sw-status">{swMessage}</p>
            </article>
            <article className="wt-setting-card" data-testid="pwa-install">
              <h3>Install for quick access</h3>
              {installStandalone || installAccepted ? (
                <p role="note" className="wt-note" data-testid="pwa-install-installed">Installed. Saved local progress opens from your home screen; analysis still needs a connection and an explicit retry.</p>
              ) : installAffordance.mode === "prompt" ? (
                <button type="button" className="wt-btn wt-btn--primary" data-testid="pwa-install-button" onClick={() => void handleInstall()}>Install walkthrough</button>
              ) : (
                <div data-testid="pwa-install-guidance">
                  <p className="wt-note">Add this walkthrough to your home screen. When the browser offers no install button, follow these steps:</p>
                  <ol className="wt-list">{installSteps.map((step) => <li key={step}>{step}</li>)}</ol>
                </div>
              )}
            </article>
            <article className="wt-setting-card">
              <h3>Session storage</h3>
              <p role="status" className="wt-statusline" data-testid="flow-storage-status">{storage.message}</p>
              <p className="wt-note">Photos, worker notes, and draft records stay in this browser. Reset removes local data only and does not delete provider copies or downloaded exports.</p>
              <div className="wt-actions wt-no-print">
                <button type="button" className="wt-btn" onClick={() => void handleRetryLoad()}>Reload local session</button>
                <button type="button" className="wt-btn wt-btn--danger" onClick={() => void handleResetStorage()}>Delete local session and start fresh</button>
              </div>
            </article>
            <article className="wt-setting-card">
              <h3>Analysis mode</h3>
              <p className="wt-statusline">{analysisMode === "fixture" ? "Fixture mode — sample photo observations, no live model call." : "Live mode — real provider analysis for mock-unit photos only."}</p>
              <p className="wt-note">No addresses, tenant details, or identifying information should be entered or uploaded.</p>
            </article>
          </div>
        </section>
      )}
    </div>
  );
}
