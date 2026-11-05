"use client";

/**
 * Detector test-button prompt (REQ-R3). Renders below the detector presence
 * check on its room-check card: the evaluator presses the detector's test
 * button, then captures a still from the live camera preview as Fire Safety
 * evidence. The camera starts only after an explicit tap — never on card
 * open — and "Skip still" records no claim. The captured still never
 * substitutes for the human's chirp yes/no answer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DETECTOR_TEST_PROMPT, DETECTOR_TEST_PROMPT_ES } from "./detector-test";
import flowStyles from "./move-in-ready-flow.module.css";

export interface CapturedDetectorStill {
  blob: Blob;
  width: number;
  height: number;
}

interface DetectorTestCaptureProps {
  language: "en" | "es";
  saving: boolean;
  saveError: string | null;
  alreadyCaptured: boolean;
  onCapture: (still: CapturedDetectorStill) => void;
  onSkip: () => void;
}

const MAX_STILL_DIMENSION = 1280;
const MAX_STILL_PIXELS = 1_000_000;
const MAX_STILL_BYTES = 512 * 1024;

function fitStillDimensions(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const scale = Math.min(
    1,
    MAX_STILL_DIMENSION / Math.max(sourceWidth, sourceHeight),
    Math.sqrt(MAX_STILL_PIXELS / Math.max(1, sourceWidth * sourceHeight)),
  );
  return {
    width: Math.max(2, Math.floor(sourceWidth * scale)),
    height: Math.max(2, Math.floor(sourceHeight * scale)),
  };
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
    } catch {
      resolve(null);
    }
  });
}

export default function DetectorTestCapture({
  language,
  saving,
  saveError,
  alreadyCaptured,
  onCapture,
  onSkip,
}: DetectorTestCaptureProps): React.JSX.Element {
  const es = language === "es";
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const stopPreview = useCallback(() => {
    setPreview((current) => {
      current?.getTracks().forEach((track) => track.stop());
      return null;
    });
  }, []);

  useEffect(() => stopPreview, [stopPreview]);

  useEffect(() => {
    if (videoRef.current && preview) {
      videoRef.current.srcObject = preview;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [preview]);

  if (alreadyCaptured) {
    return (
      <p className={flowStyles.statusText} role="status" data-testid="detector-test-saved">
        {es ? "Imagen del detector guardada como evidencia." : "Detector still saved as evidence."}
      </p>
    );
  }

  const startPreview = async (): Promise<void> => {
    setCameraError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unavailable");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setPreview(stream);
    } catch {
      setCameraError(es
        ? "La cámara no está disponible. Omita la imagen o inténtelo de nuevo."
        : "Camera unavailable. Skip the still or try again.");
    }
  };

  const saveStill = async (): Promise<void> => {
    const video = videoRef.current;
    if (!video || video.videoWidth < 2 || video.videoHeight < 2) {
      setCameraError(es ? "La vista previa aún no está lista." : "The preview is not ready yet.");
      return;
    }
    const { width, height } = fitStillDimensions(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError(es ? "Este navegador no puede guardar la imagen." : "This browser cannot save the still.");
      return;
    }
    context.drawImage(video, 0, 0, width, height);
    for (const quality of [0.86, 0.7, 0.55]) {
      const blob = await canvasToJpeg(canvas, quality);
      if (blob && blob.size > 0 && blob.size <= MAX_STILL_BYTES) {
        stopPreview();
        onCapture({ blob, width, height });
        return;
      }
    }
    setCameraError(es
      ? "La imagen excede el límite de tamaño."
      : "The still exceeded the size limit.");
  };

  return (
    <div data-testid="detector-test">
      <p><strong>{es ? DETECTOR_TEST_PROMPT_ES : DETECTOR_TEST_PROMPT}</strong></p>
      <p className={flowStyles.helpText}>
        {es
          ? "La imagen es solo evidencia. Responda la pregunta del detector de arriba."
          : "The still is evidence only. Answer the detector check above."}
      </p>
      {preview ? (
        <div data-testid="detector-preview">
          <video ref={videoRef} playsInline muted aria-label={es ? "Vista previa de la cámara" : "Camera preview"} />
          <div className={flowStyles.voiceTapRow}>
            <button
              className={flowStyles.button}
              type="button"
              data-testid="detector-save"
              disabled={saving}
              onClick={() => void saveStill()}
            >
              {saving ? (es ? "Guardando…" : "Saving…") : (es ? "Guardar imagen" : "Save still")}
            </button>
            <button
              className={flowStyles.secondaryButton}
              type="button"
              data-testid="detector-cancel"
              disabled={saving}
              onClick={stopPreview}
            >
              {es ? "Cancelar" : "Cancel"}
            </button>
          </div>
        </div>
      ) : (
        <div className={flowStyles.voiceTapRow}>
          <button
            className={flowStyles.button}
            type="button"
            data-testid="detector-capture"
            disabled={saving}
            onClick={() => void startPreview()}
          >
            {es ? "Capturar imagen" : "Capture still"}
          </button>
          <button
            className={flowStyles.textButton}
            type="button"
            data-testid="detector-skip"
            onClick={onSkip}
          >
            {es ? "Omitir imagen" : "Skip still"}
          </button>
        </div>
      )}
      {cameraError && <p className={flowStyles.inlineError} role="alert">{cameraError}</p>}
      {saveError && <p className={flowStyles.inlineError} role="alert">{saveError}</p>}
    </div>
  );
}
