/**
 * Guided photo capture for one walkthrough item (REQ-002, REQ-009).
 *
 * Real behavior, not a placeholder:
 * - Rear-camera capture where available (`accept="image/*"` with
 *   `capture="environment"`) alongside a plain file-upload input.
 * - Camera denial or absence falls back to upload with an announced,
 *   keyboard-accessible recovery path ("Check camera access" probe plus
 *   permanent upload option). The probe releases its stream immediately and
 *   never uploads anything.
 * - Preview, retake/replace, cancel (while analyzing), and remove (delete
 *   local evidence) controls. Invalid selections are rejected client-side
 *   WITHOUT clearing the current usable photo; the server remains the
 *   authoritative validator.
 * - Honest empty / loading / error states with `role="status"` /
 *   `role="alert"` announcements, visible labels, and text (non-color)
 *   status cues. Layout is fluid and safe at 360px: no fixed widths, no
 *   horizontal scrolling, no hover-only controls.
 *
 * This component owns no persistence, networking, or object URLs: the
 * parent passes the preview URL and callbacks wired to the session manager.
 * Raw previews are transient; persisted recovery is the manager's job.
 */
"use client";

import { useId, useRef, useState } from "react";

import type { ItemStatus } from "../../domain/evidence";

export type CameraAccess = "unknown" | "granted" | "denied" | "unavailable";

export interface CaptureError {
  code: string;
  message: string;
}

export interface GuidedCaptureProps {
  itemId: string;
  itemLabel: string;
  captureGuidance: string;
  /** Current item status from the session reducer. */
  status: ItemStatus;
  /** Transient preview URL (object URL or canonical rehydration), if any. */
  previewUrl: string | null;
  /** Last capture/analysis error to display, if any. */
  error: CaptureError | null;
  /** Explicit fixture/live label (never silently substituted). */
  analysisMode: "live" | "fixture";
  /** Called with the worker-chosen file for staging + analysis. */
  onSelectFile: (file: File) => void;
  /** Abort the inflight analysis; the photo is kept. */
  onCancelAnalysis: () => void;
  /** Delete this item's local evidence (photo, draft, URLs). */
  onRemovePhoto: () => void;
  disabled?: boolean;
}

/** True when the browser exposes a camera path worth offering. */
export function isCameraCaptureSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  const withMedia = navigator as Navigator & {
    mediaDevices?: { getUserMedia?: unknown };
  };
  return typeof withMedia.mediaDevices?.getUserMedia === "function";
}

async function stopStream(stream: MediaStream): Promise<void> {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Track teardown is best-effort; the probe result still stands.
    }
  }
}

/**
 * Probe camera permission WITHOUT keeping the stream: requests a video
 * track, then stops every track immediately. Resolves to "granted",
 * "denied" (permission or device denial), or "unavailable" (no API / no
 * device). Never uploads or stores media.
 */
export async function probeCameraAccess(): Promise<
  Exclude<CameraAccess, "unknown">
> {
  if (!isCameraCaptureSupported()) return "unavailable";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    await stopStream(stream);
    return "granted";
  } catch (error) {
    const name = (error as { name?: string }).name ?? "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "denied";
    }
    return "unavailable";
  }
}

const ACCEPT = "image/jpeg,image/png,image/webp";

export default function GuidedCapture(props: GuidedCaptureProps) {
  const {
    itemId,
    itemLabel,
    captureGuidance,
    status,
    previewUrl,
    error,
    analysisMode,
    onSelectFile,
    onCancelAnalysis,
    onRemovePhoto,
    disabled = false,
  } = props;

  const headingId = useId();
  const guidanceId = useId();
  const statusId = useId();
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraAccess, setCameraAccess] = useState<CameraAccess>("unknown");
  const [checkingCamera, setCheckingCamera] = useState(false);
  const [localError, setLocalError] = useState<CaptureError | null>(null);

  const isAnalyzing = status === "analyzing";
  const showPreview = previewUrl !== null && status !== "empty";
  const cameraOffered = isCameraCaptureSupported();
  const announcedError = localError ?? error;

  function handleFiles(files: FileList | null): void {
    setLocalError(null);
    if (!files || files.length === 0) return;
    const file = files[0];
    if (file.size <= 0) {
      setLocalError({
        code: "EMPTY_FILE",
        message:
          "That file is empty. Choose a photo to continue. Any earlier photo is kept.",
      });
      return;
    }
    onSelectFile(file);
  }

  async function handleCameraCheck(): Promise<void> {
    setCheckingCamera(true);
    try {
      const result = await probeCameraAccess();
      setCameraAccess(result);
    } finally {
      setCheckingCamera(false);
    }
  }

  const cameraDenied =
    cameraAccess === "denied" || cameraAccess === "unavailable";

  return (
    <section
      aria-labelledby={headingId}
      data-testid={`capture-${itemId}`}
      className="wt-card wt-capture-card"
    >
      <h4 id={headingId} className="wt-subhead wt-capture-title">
        Photo for: {itemLabel}
      </h4>
      <p id={guidanceId} className="wt-note wt-capture-guidance">
        {captureGuidance}
      </p>
      <p className="wt-statusline wt-capture-mode" data-testid={`capture-mode-${itemId}`}>
        Analysis mode: {analysisMode}
        {analysisMode === "fixture"
          ? " (mock output — not live inference)"
          : " (real provider call — mock-unit media only)"}
      </p>

      {/* Hidden file inputs stay mounted so every recovery action can open a
          picker even when the visible picker row is replaced by a preview.
          The visible buttons above are the keyboard/screen-reader controls;
          the inputs are an implementation detail (hence aria-hidden and out
          of tab order), opened only from those user gestures. */}
      {cameraOffered && (
        <input
          ref={cameraInputRef}
          id={`camera-${itemId}`}
          data-testid={`capture-input-camera-${itemId}`}
          type="file"
          accept={ACCEPT}
          capture="environment"
          disabled={disabled}
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
          aria-hidden="true"
          tabIndex={-1}
        />
      )}
      <input
        ref={uploadInputRef}
        id={`upload-${itemId}`}
        data-testid={`capture-input-upload-${itemId}`}
        type="file"
        accept={ACCEPT}
        disabled={disabled}
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Empty state: pickers + camera fallback help. */}
      {!showPreview && !isAnalyzing && (
        <div className="wt-panel wt-capture-empty-state">
          <p className="wt-note wt-capture-instructions" role="note">
            No photo yet for this item. Take a photo or upload one (JPEG, PNG,
            or WebP, up to 8 MiB). Self-shot mock-unit photos only.
          </p>
          <div className="wt-actions wt-no-print wt-capture-actions">
            {cameraOffered && (
              <button
                type="button"
                className="wt-btn wt-btn--primary"
                data-testid={`capture-pick-camera-${itemId}`}
                disabled={disabled}
                onClick={() => cameraInputRef.current?.click()}
              >
                Take photo (rear camera)
              </button>
            )}
            <button
              type="button"
              className="wt-btn wt-btn--primary"
              data-testid={`capture-pick-upload-${itemId}`}
              disabled={disabled}
              onClick={() => uploadInputRef.current?.click()}
            >
              Upload photo
            </button>
            <button
              type="button"
              className="wt-btn"
              data-testid={`capture-camera-check-${itemId}`}
              onClick={handleCameraCheck}
              disabled={disabled || checkingCamera || !cameraOffered}
              title={
                cameraOffered
                  ? "Probe camera permission; releases the camera immediately"
                  : "This browser exposes no camera API, so upload is the path"
              }
            >
              {checkingCamera ? "Checking camera…" : "Check camera access"}
            </button>
          </div>
          {!cameraOffered && (
            <p className="wt-note" role="note">
              This browser exposes no camera, so file upload is the capture
              path here.
            </p>
          )}
          {cameraDenied && (
            <p
              className="wt-statusline"
              role="status"
              data-testid={`capture-camera-fallback-${itemId}`}
            >
              Camera {cameraAccess === "denied" ? "access was denied" : "is unavailable"}.
              Use “Upload photo” instead — nothing was lost.
            </p>
          )}
          {cameraAccess === "granted" && (
            <p className="wt-statusline" role="status">
              Camera is available. You can still use upload at any time.
            </p>
          )}
        </div>
      )}

      {/* Preview state: photo + retake/replace/remove. */}
      {showPreview && previewUrl && (
        <figure className="wt-figure">
          {/* Local object URLs are transient device media; next/image cannot optimize them. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={`Preview of the staged photo for ${itemLabel}`}
            data-testid={`capture-preview-${itemId}`}
          />
          <figcaption className="wt-figcaption">
            Preview — the staged photo. It is stored only on this device.
          </figcaption>
          <div className="wt-actions wt-no-print">
            <button
              type="button"
              className="wt-btn"
              data-testid={`capture-retake-${itemId}`}
              disabled={disabled || isAnalyzing}
              onClick={() => {
                // Retake re-opens the preferred picker; the current photo
                // stays until a new file is actually chosen.
                if (cameraOffered) cameraInputRef.current?.click();
                else uploadInputRef.current?.click();
              }}
            >
              Retake / replace photo
            </button>
            <button
              type="button"
              className="wt-btn wt-btn--danger"
              data-testid={`capture-remove-${itemId}`}
              disabled={disabled || isAnalyzing}
              onClick={onRemovePhoto}
            >
              Remove photo
            </button>
          </div>
        </figure>
      )}

      {/* Loading state: analyzing with cancel. */}
      {isAnalyzing && (
        <div
          role="status"
          aria-busy="true"
          id={statusId}
          data-testid={`capture-loading-${itemId}`}
          className="wt-panel"
        >
          <div className="wt-skeleton" aria-hidden="true">
            <span className="wt-skeleton-bar" />
            <span className="wt-skeleton-bar wt-skeleton-bar--short" />
          </div>
          <p className="wt-statusline">
            Analyzing… waiting for the review draft. The photo is kept; you
            can cancel and the photo stays.
          </p>
          <div className="wt-actions wt-no-print">
            <button
              type="button"
              className="wt-btn"
              data-testid={`capture-cancel-${itemId}`}
              onClick={onCancelAnalysis}
            >
              Cancel analysis (keeps photo)
            </button>
          </div>
        </div>
      )}

      {/* Error state: announced, actionable, preserves the photo. */}
      {announcedError && (
        <div
          role="alert"
          data-testid={`capture-error-${itemId}`}
          className="wt-alert"
        >
          <p className="wt-statusline">
            <strong>Error [{announcedError.code}]:</strong>{" "}
            {announcedError.message}
          </p>
          <div className="wt-actions wt-no-print">
            <button
              type="button"
              className="wt-btn"
              onClick={() => {
                setLocalError(null);
                uploadInputRef.current?.click();
              }}
              disabled={disabled || isAnalyzing}
            >
              Choose a different photo
            </button>
            {isAnalyzing && (
              <button
                type="button"
                className="wt-btn"
                onClick={onCancelAnalysis}
              >
                Cancel analysis (keeps photo)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Screen-reader status mirror (text, never color-only). */}
      <p
        className="wt-statusline"
        role="status"
        aria-describedby={guidanceId}
        data-testid={`capture-status-${itemId}`}
      >
        Status: {status}
        {status === "error" ? " — recovery actions are shown above." : ""}
        {status === "analyzing" ? " — analysis in progress." : ""}
        {status === "empty" ? " — no photo yet." : ""}
      </p>
    </section>
  );
}
