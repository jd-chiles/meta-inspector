import { useCallback, useEffect, useRef, useState } from "react";
import type { EvidenceReference, MoveInReadyElementId, MoveInReadyRoomId } from "../../domain/move-in-ready";
import { WALKTHROUGH_CLIENT_HEADER, WALKTHROUGH_CLIENT_ID } from "../../domain/walkthrough-client";
import type { StoredRoomClipIdentity } from "./inspection-store";
import {
  createStoredElementClip,
  type StoredVideoClip,
  type VideoClipStore,
} from "./video-store";
import { sha256Blob } from "./video-utils";
import styles from "./live-capture.module.css";

export interface LiveElementClipResult {
  identity: StoredRoomClipIdentity;
  transcriptExcerpt: string | null;
  trackedFrameCount: number;
  totalFrameCount: number;
}

interface LiveCaptureProps {
  sessionId: string;
  elementId: MoveInReadyElementId;
  elementLabel: string;
  /** Fixed server-side SAM concept, never free text. */
  concept: string;
  /** Short display noun, e.g. "faucet". */
  conceptLabel: string;
  /** Copilot instruction for what to show and do. */
  prompt: string;
  /** Recovery hint when tracking fails, e.g. "pan up toward the ceiling". */
  recoveryHint: string;
  roomId: MoveInReadyRoomId;
  roomLabel: string;
  schemaVersion: number;
  catalogVersion: string;
  clipStore: VideoClipStore;
  transcriptLines: readonly string[];
  existingIdentity?: StoredRoomClipIdentity;
  onSaved: (result: LiveElementClipResult) => void;
  onNeedsHumanCheck: (reason: string) => void;
}

type Phase = "idle" | "preview" | "recording" | "saving" | "done" | "error";

interface TrackBoxView {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

interface BestFrame {
  blob: Blob;
  width: number;
  height: number;
  elapsedMs: number;
}

const MIN_CLIP_SECONDS = 5;
const MAX_CLIP_SECONDS = 10;
const TRACK_INTERVAL_MS = 1000;
const TRACK_SNAPSHOT_WIDTH = 640;
const TRACK_JPEG_QUALITY = 0.72;
const UNTRACKED_RECOVERY_STREAK = 3;

export default function LiveCapture(props: LiveCaptureProps): React.JSX.Element {
  const {
    sessionId, elementId, elementLabel, concept, conceptLabel, prompt, recoveryHint,
    roomId, roomLabel, schemaVersion, catalogVersion, clipStore, transcriptLines,
    existingIdentity, onSaved, onNeedsHumanCheck,
  } = props;
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<string>("Camera is off. Start the live proof when you are ready.");
  const [boxes, setBoxes] = useState<TrackBoxView[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [trackStats, setTrackStats] = useState({ tracked: 0, total: 0 });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const trackTimerRef = useRef<number | null>(null);
  const clockTimerRef = useRef<number | null>(null);
  const trackInFlightRef = useRef(false);
  const untrackedStreakRef = useRef(0);
  const trackedCountRef = useRef(0);
  const totalCountRef = useRef(0);
  const bestFrameRef = useRef<BestFrame | null>(null);
  const recordingStartedAtRef = useRef(0);
  const generationRef = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  const stopTimers = useCallback((): void => {
    if (trackTimerRef.current !== null) {
      window.clearInterval(trackTimerRef.current);
      trackTimerRef.current = null;
    }
    if (clockTimerRef.current !== null) {
      window.clearInterval(clockTimerRef.current);
      clockTimerRef.current = null;
    }
  }, []);

  const stopStream = useCallback((): void => {
    stopTimers();
    trackInFlightRef.current = false;
    const stream = streamRef.current;
    streamRef.current = null;
    recorderRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Track release is best-effort during teardown.
        }
      }
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [stopTimers]);

  useEffect(() => stopStream, [stopStream]);

  // Reset when the copilot moves to another element: a delayed track response
  // must never draw boxes or save a clip for the previous element.
  useEffect(() => {
    generationRef.current += 1;
    stopStream();
    setBoxes([]);
    setElapsedSeconds(0);
    setError(null);
    setTrackStats({ tracked: 0, total: 0 });
    trackedCountRef.current = 0;
    totalCountRef.current = 0;
    untrackedStreakRef.current = 0;
    bestFrameRef.current = null;
    chunksRef.current = [];
    setPhase("idle");
    setStatus("Camera is off. Start the live proof when you are ready.");
  }, [elementId, sessionId, stopStream]);

  const startPreview = useCallback(async (): Promise<void> => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setError(null);
    setBoxes([]);
    if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setError("This browser cannot open the camera. Use a phone browser with camera access.");
      setPhase("error");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
    } catch {
      // Audio helps prove beeps and fan hum, but a denied microphone must not
      // block the visual proof.
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        setStatus("Microphone unavailable. Filming video only; narrate what you hear.");
      } catch {
        if (generationRef.current !== generation) return;
        setError("The camera could not be opened. Check camera permission and try again.");
        setPhase("error");
        return;
      }
    }
    if (generationRef.current !== generation) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Best-effort release for a superseded stream.
        }
      }
      return;
    }
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => undefined);
    }
    setPhase("preview");
    setStatus(`Aim at the ${conceptLabel}, then start the ${MIN_CLIP_SECONDS}-${MAX_CLIP_SECONDS} second proof clip.`);
  }, [conceptLabel]);

  const sendTrackFrame = useCallback(async (generation: number): Promise<void> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0) return;
    if (trackInFlightRef.current) return;
    trackInFlightRef.current = true;
    try {
      const scale = Math.min(1, TRACK_SNAPSHOT_WIDTH / video.videoWidth);
      const width = Math.max(MIN_TRACK_SIDE, Math.round(video.videoWidth * scale));
      const height = Math.max(MIN_TRACK_SIDE, Math.round(video.videoHeight * scale));
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, width, height);
      const frameBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", TRACK_JPEG_QUALITY);
      });
      if (!frameBlob || frameBlob.size === 0 || generationRef.current !== generation) return;
      const dataUrl = await blobToDataUrl(frameBlob);
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const response = await fetch("/api/video/track", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [WALKTHROUGH_CLIENT_HEADER]: WALKTHROUGH_CLIENT_ID,
        },
        body: JSON.stringify({ imageBase64: base64, mimeType: "image/jpeg", width, height, concept }),
      });
      if (generationRef.current !== generation || phaseRef.current !== "recording") return;
      if (!response.ok) {
        untrackedStreakRef.current += 1;
        totalCountRef.current += 1;
        setTrackStats({ tracked: trackedCountRef.current, total: totalCountRef.current });
        setStatus(`Tracking paused (server ${response.status}). Hold the ${conceptLabel} steady.`);
        return;
      }
      const payload = (await response.json()) as {
        ok?: boolean; tracked?: boolean;
        width?: number; height?: number;
        boxes?: Array<{ left: number; top: number; right: number; bottom: number }>;
      };
      if (payload.ok !== true || generationRef.current !== generation || phaseRef.current !== "recording") return;
      totalCountRef.current += 1;
      const frameWidth = typeof payload.width === "number" && payload.width > 0 ? payload.width : width;
      const frameHeight = typeof payload.height === "number" && payload.height > 0 ? payload.height : height;
      if (payload.tracked === true && Array.isArray(payload.boxes) && payload.boxes.length > 0) {
        trackedCountRef.current += 1;
        untrackedStreakRef.current = 0;
        bestFrameRef.current = {
          blob: frameBlob,
          width,
          height,
          elapsedMs: Date.now() - recordingStartedAtRef.current,
        };
        setBoxes(payload.boxes.slice(0, 16).map((box) => ({
          leftPct: clampPct((box.left / frameWidth) * 100),
          topPct: clampPct((box.top / frameHeight) * 100),
          widthPct: clampPct(((box.right - box.left) / frameWidth) * 100),
          heightPct: clampPct(((box.bottom - box.top) / frameHeight) * 100),
        })));
        setStatus(`Tracking the ${conceptLabel}. ${prompt}`);
      } else {
        untrackedStreakRef.current += 1;
        setBoxes([]);
        setStatus(untrackedStreakRef.current >= UNTRACKED_RECOVERY_STREAK
          ? `I can't see the ${conceptLabel}. ${recoveryHint}.`
          : `Looking for the ${conceptLabel}. Hold steady.`);
      }
      setTrackStats({ tracked: trackedCountRef.current, total: totalCountRef.current });
    } catch {
      if (generationRef.current !== generation || phaseRef.current !== "recording") return;
      untrackedStreakRef.current += 1;
      totalCountRef.current += 1;
      setTrackStats({ tracked: trackedCountRef.current, total: totalCountRef.current });
      setStatus("Tracking lost connection. The clip keeps recording; hold steady.");
    } finally {
      trackInFlightRef.current = false;
    }
  }, [concept, conceptLabel, prompt, recoveryHint]);

  const saveRecording = useCallback(async (generation: number, blob: Blob, mime: string): Promise<void> => {
    setPhase("saving");
    setStatus("Saving the proof clip on this device.");
    setBoxes([]);
    try {
      const elapsedMs = Date.now() - recordingStartedAtRef.current;
      const durationSeconds = Math.max(1, Math.min(30, Math.round(elapsedMs / 100) / 10));
      const video = videoRef.current;
      const width = video && video.videoWidth > 0 ? video.videoWidth : TRACK_SNAPSHOT_WIDTH;
      const height = video && video.videoHeight > 0 ? video.videoHeight : Math.round((TRACK_SNAPSHOT_WIDTH * 9) / 16);
      const normalizedMime = mime.includes("quicktime") ? "video/quicktime" : mime.includes("webm") ? "video/webm" : "video/mp4";
      const sourceSha256 = await sha256Blob(blob);
      const best = bestFrameRef.current;
      if (!best) {
        if (generationRef.current !== generation) return;
        setPhase("preview");
        setStatus("No tracked frame was captured. Try again, or mark needs human check.");
        onNeedsHumanCheck(`No ${conceptLabel} frame was tracked during the live clip.`);
        return;
      }
      const capturedAt = new Date().toISOString();
      const clip: StoredVideoClip = createStoredElementClip({
        sessionId,
        elementId,
        roomId,
        roomLabel,
        fileName: `live-${elementId}-${Date.now()}.${normalizedMime === "video/webm" ? "webm" : "mp4"}`,
        mime: normalizedMime,
        sizeBytes: blob.size,
        durationSeconds,
        width,
        height,
        video: blob,
        sourceSha256,
        stills: [{
          timestampSeconds: Math.max(0, Math.min(durationSeconds, best.elapsedMs / 1000)),
          blob: best.blob,
          width: best.width,
          height: best.height,
        }],
        capturedAt,
      });
      await clipStore.put(clip);
      if (generationRef.current !== generation) return;
      const videoId = makeLiveId("video");
      const stillId = makeLiveId("still");
      const stillHash = await sha256Blob(best.blob);
      const timestampMs = Math.max(0, Math.min(Math.floor(durationSeconds * 1000) - 1, best.elapsedMs));
      const evidence: EvidenceReference = {
        schemaVersion,
        catalogVersion,
        videoId,
        videoRevision: 1,
        roomId,
        stillId,
        timestampMs,
        frameIndex: null,
        stillHash,
      };
      const identity: StoredRoomClipIdentity = {
        roomId,
        schemaVersion,
        catalogVersion,
        videoId,
        videoRevision: 1,
        videoHash: sourceSha256,
        capturedAt,
        durationSeconds,
        sizeBytes: blob.size,
        evidence: [evidence],
      };
      const excerpt = transcriptLines.length > 0
        ? transcriptLines.slice(-2).join(" ").slice(0, 300)
        : null;
      setPhase("done");
      setStatus(`Proof clip saved (${durationSeconds}s, ${trackedCountRef.current} tracked frames). Confirm it or retake.`);
      onSaved({
        identity,
        transcriptExcerpt: excerpt,
        trackedFrameCount: trackedCountRef.current,
        totalFrameCount: totalCountRef.current,
      });
    } catch (saveError) {
      if (generationRef.current !== generation) return;
      setPhase("error");
      setError(saveError instanceof Error && saveError.message ? saveError.message : "The proof clip could not be saved on this device.");
    }
  }, [catalogVersion, clipStore, conceptLabel, elementId, onNeedsHumanCheck, onSaved, roomId, roomLabel, schemaVersion, sessionId, transcriptLines]);

  const stopRecording = useCallback((generation: number): void => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    stopTimers();
    setStatus("Finishing the proof clip.");
    recorder.onstop = () => {
      const chunks = chunksRef.current;
      chunksRef.current = [];
      const mime = recorder.mimeType || "video/mp4";
      const blob = new Blob(chunks, { type: mime });
      if (generationRef.current !== generation) return;
      if (blob.size === 0) {
        setPhase("preview");
        setStatus("No video data was captured. Try recording again.");
        return;
      }
      void saveRecording(generation, blob, mime);
    };
    try {
      recorder.stop();
    } catch {
      setPhase("preview");
      setStatus("The recording stopped unexpectedly. Try again.");
    }
  }, [saveRecording, stopTimers]);

  const startRecording = useCallback((): void => {
    const stream = streamRef.current;
    if (!stream || phaseRef.current !== "preview") return;
    const mimeType = chooseLiveRecorderMimeType();
    if (!mimeType) {
      setError("This browser cannot record a proof clip in-page. Use a phone browser with camera recording.");
      setPhase("error");
      return;
    }
    const generation = generationRef.current;
    try {
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      chunksRef.current = [];
      trackedCountRef.current = 0;
      totalCountRef.current = 0;
      untrackedStreakRef.current = 0;
      bestFrameRef.current = null;
      setTrackStats({ tracked: 0, total: 0 });
      setBoxes([]);
      recordingStartedAtRef.current = Date.now();
      setElapsedSeconds(0);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        if (generationRef.current !== generation) return;
        stopTimers();
        setPhase("preview");
        setStatus("The camera stopped unexpectedly. Try recording again.");
      };
      recorder.start(500);
      setPhase("recording");
      setStatus(`Recording. ${prompt}`);
      trackTimerRef.current = window.setInterval(() => {
        void sendTrackFrame(generation);
      }, TRACK_INTERVAL_MS);
      clockTimerRef.current = window.setInterval(() => {
        if (generationRef.current !== generation || phaseRef.current !== "recording") return;
        const elapsed = (Date.now() - recordingStartedAtRef.current) / 1000;
        setElapsedSeconds(Math.floor(elapsed));
        if (elapsed >= MAX_CLIP_SECONDS) stopRecording(generation);
      }, 250);
    } catch {
      setError("Recording could not start. Check camera permission and try again.");
      setPhase("error");
    }
  }, [prompt, sendTrackFrame, stopRecording, stopTimers]);

  const retake = useCallback((): void => {
    generationRef.current += 1;
    stopTimers();
    setError(null);
    setBoxes([]);
    setElapsedSeconds(0);
    setTrackStats({ tracked: 0, total: 0 });
    trackedCountRef.current = 0;
    totalCountRef.current = 0;
    untrackedStreakRef.current = 0;
    bestFrameRef.current = null;
    chunksRef.current = [];
    if (!streamRef.current) {
      void startPreview();
      return;
    }
    setPhase("preview");
    setStatus(`Aim at the ${conceptLabel}, then start the ${MIN_CLIP_SECONDS}-${MAX_CLIP_SECONDS} second proof clip.`);
  }, [conceptLabel, startPreview, stopTimers]);

  const canStop = phase === "recording" && elapsedSeconds >= MIN_CLIP_SECONDS;
  const remaining = Math.max(0, MAX_CLIP_SECONDS - elapsedSeconds);
  const lastTranscript = transcriptLines.length > 0 ? transcriptLines[transcriptLines.length - 1] : null;

  return (
    <section className={styles.liveCapture} aria-label={`Live proof for ${elementLabel}`} data-testid="live-capture">
      <div className={styles.promptCard}>
        <p className={styles.eyebrow}>Live proof · {elementLabel}</p>
        <p className={styles.prompt}>{prompt}</p>
        <p className={styles.status} role="status" data-testid="live-status">{status}</p>
        {phase === "recording" && (
          <p className={styles.clock} data-testid="live-clock">
            {elapsedSeconds}s · {trackStats.tracked}/{trackStats.total} frames tracked · stops in {remaining}s
          </p>
        )}
      </div>

      <div className={styles.viewfinder}>
        <video ref={videoRef} className={styles.video} autoPlay muted playsInline aria-label={`Live camera for ${elementLabel}`} />
        <canvas ref={canvasRef} className={styles.snapshotCanvas} aria-hidden="true" />
        <div className={styles.boxLayer} data-testid="live-boxes" aria-hidden="true">
          {boxes.map((box, index) => (
            <span
              key={`${index}-${box.leftPct}-${box.topPct}`}
              className={styles.trackBox}
              style={{ left: `${box.leftPct}%`, top: `${box.topPct}%`, width: `${box.widthPct}%`, height: `${box.heightPct}%` }}
            />
          ))}
        </div>
        {phase === "recording" && <span className={styles.recBadge} data-testid="live-rec">REC</span>}
      </div>

      {lastTranscript && (
        <p className={styles.transcript} data-testid="live-transcript">
          <span className={styles.transcriptLabel}>Heard:</span> {lastTranscript}
        </p>
      )}

      {error && (
        <p className={styles.error} role="alert">{error}</p>
      )}

      {existingIdentity && phase !== "done" && (
        <p className={styles.savedNote} data-testid="live-saved-note">
          Saved proof: {existingIdentity.durationSeconds}s clip, {formatClock(existingIdentity.evidence[0]?.timestampMs ?? 0)} still.
        </p>
      )}

      <div className={styles.actions}>
        {(phase === "idle" || phase === "error") && (
          <button className={styles.primaryButton} type="button" data-testid="live-start" onClick={() => void startPreview()}>
            Start live proof
          </button>
        )}
        {phase === "preview" && (
          <button className={styles.primaryButton} type="button" data-testid="live-record" onClick={startRecording}>
            Record {MIN_CLIP_SECONDS}-{MAX_CLIP_SECONDS}s proof
          </button>
        )}
        {phase === "recording" && (
          <button className={styles.primaryButton} type="button" data-testid="live-stop" disabled={!canStop} onClick={() => stopRecording(generationRef.current)}>
            {canStop ? "Stop & save proof" : `Keep filming (${MIN_CLIP_SECONDS - elapsedSeconds}s)`}
          </button>
        )}
        {phase === "saving" && (
          <button className={styles.primaryButton} type="button" disabled>Saving proof clip</button>
        )}
        {phase === "done" && (
          <button className={styles.secondaryButton} type="button" data-testid="live-retake" onClick={retake}>
            Retake clip
          </button>
        )}
        {phase !== "saving" && (
          <button
            className={styles.secondaryButton}
            type="button"
            data-testid="live-needs-check"
            onClick={() => {
              stopTimers();
              onNeedsHumanCheck(`Inspector marked ${elementLabel} for a human check during live capture.`);
            }}
          >
            Needs human check
          </button>
        )}
      </div>
    </section>
  );
}

const MIN_TRACK_SIDE = 160;

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function chooseLiveRecorderMimeType(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return null;
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null;
}

function makeLiveId(prefix: string): string {
  const token = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${token}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("frame read failed"));
    reader.readAsDataURL(blob);
  });
}

function formatClock(timestampMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
