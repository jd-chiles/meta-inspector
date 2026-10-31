/** Mobile-first room video capture and local persistence for a walkthrough. */
"use client";

import {
  Camera,
  Check,
  CirclePause,
  CirclePlay,
  CircleStop,
  ChevronDown,
  Droplet,
  Fan,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";

import {
  MOVE_IN_READY_ROOM_PROMPT_IDS,
  isMoveInReadyRoomId,
  type MoveInReadyPromptId,
} from "../../domain/move-in-ready";
import styles from "./video-capture.module.css";
import {
  VIDEO_ALLOWED_MIME_TYPES,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_DURATION_SECONDS,
  formatMiB,
  formatTimestamp,
  prepareVideoReview,
  normalizeVideoForCapture,
  sha256Blob,
  validateVideoContainer,
  validateVideoFileBasics,
  type VideoStill,
} from "./video-utils";
import {
  canAppendRecorderChunk,
  getEffectiveRecordingDurationSeconds,
  getRecordingStopDelayMs,
  WALKTHROUGH_VIDEO_BITS_PER_SECOND,
} from "./recorder-limits";
import {
  createStoredVideoClip,
  createVideoClipStore,
  makeVideoClipId,
  type StoredVideoClip,
  type VideoClipStore,
  type StoredVideoStill,
} from "./video-store";

export interface WalkthroughRoomOption {
  id: string;
  label: string;
}

export interface WalkthroughVideoCaptureProps {
  /** Identity for this local-only mock-unit walkthrough. */
  sessionId: string;
  rooms: readonly WalkthroughRoomOption[];
  /** Controlled room selector. Each room has an independent saved clip. */
  roomId: string;
  /** Count shown beside the focused room selector. */
  capturedRoomCount?: number;
  /** Room identities with a locally saved clip. */
  capturedRoomIds?: readonly string[];
  onRoomChange: (roomId: string) => void;
  /** Optional concise prompts; defaults are selected from the room id. */
  prompts?: readonly string[];
  /** Completed room prompts are stored with the inspection, separate from evaluator decisions. */
  completedPromptIds?: readonly MoveInReadyPromptId[];
  onPromptCompletionChange?: (promptId: MoveInReadyPromptId, completed: boolean) => void;
  /** Recommended validation clip and per-room recording limit (default: 30s). */
  maxDurationSeconds?: number;
  /** Local storage bound (default: 60 MiB). */
  maxFileBytes?: number;
  disabled?: boolean;
  /** Locks workflow navigation until an active capture has been saved or discarded. */
  onRecordingStateChange?: (recording: boolean) => void;
  /** Fires only after a clip is loaded, committed, or removed from local storage. */
  onClipChange?: (clip: StoredVideoClip | null, roomId: string) => void | Promise<void>;
  /** Keeps the combined clip and analysis disclosure open across workflow steps. */
  detailsExpanded?: boolean;
  onDetailsExpandedChange?: (expanded: boolean) => void;
  children?: ReactNode;
}

export const DEFAULT_ROOM_PROMPTS: Readonly<Record<string, readonly string[]>> = {
  kitchen: [
    "Run faucet; show water flow and drainage.",
    "Show sink, counters, outlets, and the running fan.",
    "Open the kitchen entry and test its lock.",
    "Show the smoke or CO detector and its indicator.",
  ],
  bathroom: [
    "Run faucet or shower; show flow and drainage.",
    "Turn on the exhaust fan and show the vent.",
    "Show toilet, bath or shower, and test the lock.",
    "Show the smoke or CO detector and its indicator.",
  ],
  bedroom: [
    "Show the room, windows, and visible openings.",
    "Include the smoke or carbon monoxide detector in frame.",
    "Show the door and how its lock operates.",
  ],
  "bedroom-living": [
    "Pan the bedroom and living area. Show floors and outlets.",
    "Show windows in both areas and visible openings.",
    "Show detectors and operate the entry lock.",
  ],
  living: [
    "Pan slowly across the room and visible outlets.",
    "Include windows and any smoke or carbon monoxide detector.",
    "Show the entry and how its lock operates.",
  ],
  hallway: [
    "Show the clear floor path from both ends.",
    "Show unit and common-area detectors; keep people out of frame.",
    "Show the unit entry and test its lock.",
  ],
  default: [
    "Pan slowly to show the whole room and visible openings.",
    "Hold the camera steady on each fixture or concern.",
    "Show the entry and how its lock operates, if present.",
  ],
};

function PromptIcon({ prompt }: { prompt: string }) {
  if (/water|faucet|drain|shower|toilet|bath/i.test(prompt)) {
    return <Droplet aria-hidden="true" />;
  }
  if (/fan|vent/i.test(prompt)) return <Fan aria-hidden="true" />;
  if (/lock|door|entry/i.test(prompt)) return <LockKeyhole aria-hidden="true" />;
  if (/detector|smoke|carbon monoxide/i.test(prompt)) {
    return <ShieldCheck aria-hidden="true" />;
  }
  return <Video aria-hidden="true" />;
}

type StoreStatus = "loading" | "ready" | "error";

export default function WalkthroughVideoCapture(props: WalkthroughVideoCaptureProps) {
  const {
    sessionId,
    rooms,
    roomId,
    capturedRoomCount = 0,
    capturedRoomIds = [],
    onRoomChange,
    prompts,
    completedPromptIds = [],
    onPromptCompletionChange,
    maxDurationSeconds = VIDEO_MAX_DURATION_SECONDS,
    maxFileBytes = VIDEO_MAX_BYTES,
    disabled = false,
    onRecordingStateChange,
    onClipChange,
    detailsExpanded,
    onDetailsExpandedChange,
    children,
  } = props;
  const effectiveMaxDurationSeconds = getEffectiveRecordingDurationSeconds(maxDurationSeconds);

  const room = rooms.find((candidate) => candidate.id === roomId);
  const roomIndex = Math.max(0, rooms.findIndex((candidate) => candidate.id === roomId));
  const scopeKey = useMemo(() => makeVideoClipId(sessionId, roomId), [sessionId, roomId]);
  const headingId = useId();
  const promptsId = useId();
  const cameraInputId = useId();
  const uploadInputId = useId();
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingChunkBytesRef = useRef(0);
  const recordingExceededSizeLimitRef = useRef(false);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingElapsedBeforeSegmentMsRef = useRef(0);
  const scopeKeyRef = useRef(scopeKey);
  const operationRef = useRef(0);
  const filePreparationAbortRef = useRef<AbortController | null>(null);
  const cancelFilePreparationRef = useRef<() => void>(() => undefined);
  const storeRef = useRef<VideoClipStore | null>(null);
  const cancelRecordingRef = useRef<() => void>(() => undefined);
  const onClipChangeRef = useRef(onClipChange);
  const onRecordingStateChangeRef = useRef(onRecordingStateChange);
  const onPromptCompletionChangeRef = useRef(onPromptCompletionChange);
  const pendingPromptIdsRef = useRef<MoveInReadyPromptId[]>([]);

  const [clip, setClip] = useState<StoredVideoClip | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [storeStatus, setStoreStatus] = useState<StoreStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [stillsExpanded, setStillsExpanded] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cameraIssue, setCameraIssue] = useState<string | null>(null);
  const [pendingPromptIds, setPendingPromptIds] = useState<MoveInReadyPromptId[]>([]);
  const [showAllPrompts, setShowAllPrompts] = useState(false);
  const [showRoomPicker, setShowRoomPicker] = useState(false);

  scopeKeyRef.current = scopeKey;
  onClipChangeRef.current = onClipChange;
  onRecordingStateChangeRef.current = onRecordingStateChange;
  onPromptCompletionChangeRef.current = onPromptCompletionChange;
  if (!storeRef.current) storeRef.current = createVideoClipStore();
  const store = storeRef.current;
  cancelFilePreparationRef.current = () => {
    const controller = filePreparationAbortRef.current;
    filePreparationAbortRef.current = null;
    controller?.abort();
  };
  cancelRecordingRef.current = () => {
    cancelFilePreparationRef.current();
    if (recording || mediaRecorderRef.current || mediaStreamRef.current) discardRecording();
  };

  const roomPrompts = prompts ?? getRoomPrompts(roomId);
  const roomPromptIds = !prompts && isMoveInReadyRoomId(roomId)
    ? MOVE_IN_READY_ROOM_PROMPT_IDS[roomId]
    : [];
  const currentPromptIndex = roomPrompts.findIndex((_, index) => {
    const promptId = roomPromptIds[index];
    return !promptId || (!completedPromptIds.includes(promptId) && !pendingPromptIds.includes(promptId));
  });
  const collapsedPromptCount = Math.min(3, roomPrompts.length);
  const lastCollapsedStart = Math.max(0, roomPrompts.length - collapsedPromptCount);
  const collapsedPromptStart = currentPromptIndex < 0
    ? lastCollapsedStart
    : Math.min(Math.max(0, currentPromptIndex - 1), lastCollapsedStart);
  const visiblePromptIndexes = showAllPrompts || roomPrompts.length <= collapsedPromptCount
    ? roomPrompts.map((_, index) => index)
    : roomPrompts.slice(collapsedPromptStart, collapsedPromptStart + collapsedPromptCount).map((_, offset) => collapsedPromptStart + offset);
  const supportsInAppRecording = hasMp4MediaRecorder();
  const capturedPromptCount = completedPromptIds.length + pendingPromptIds.filter((id) => !completedPromptIds.includes(id)).length;
  const promptProgressPercent = roomPrompts.length === 0
    ? 0
    : Math.min(100, Math.round((capturedPromptCount / roomPrompts.length) * 100));
  const posterStill = clip?.stills[0]?.blob ?? null;

  useEffect(() => {
    if (!posterStill) {
      setPosterUrl(null);
      return;
    }
    const nextPosterUrl = URL.createObjectURL(posterStill);
    setPosterUrl(nextPosterUrl);
    return () => URL.revokeObjectURL(nextPosterUrl);
  }, [posterStill]);

  useEffect(() => {
    pendingPromptIdsRef.current = pendingPromptIds;
  }, [pendingPromptIds]);

  useEffect(() => {
    const desktopViewport = window.matchMedia("(min-width: 960px)");
    const syncPromptDensity = () => setShowAllPrompts(desktopViewport.matches);
    syncPromptDensity();
    desktopViewport.addEventListener("change", syncPromptDensity);
    return () => desktopViewport.removeEventListener("change", syncPromptDensity);
  }, []);

  useEffect(() => {
    const operation = ++operationRef.current;
    setClip(null);
    setPreviewUrl(null);
    setStoreStatus("loading");
    setLocalError(null);
    setNotice(null);
    const savedScope = scopeKey;

    void store.get(sessionId, roomId).then((saved) => {
      if (operation !== operationRef.current || scopeKeyRef.current !== savedScope) return;
      setClip(saved);
      setStoreStatus("ready");
      if (saved) {
        const url = URL.createObjectURL(saved.video);
        previewUrlRef.current = url;
        setPreviewUrl(url);
      }
      void onClipChangeRef.current?.(saved, roomId);
    }).catch((error: unknown) => {
      if (operation !== operationRef.current || scopeKeyRef.current !== savedScope) return;
      setStoreStatus("error");
      setLocalError(safeErrorMessage(error, "Could not read the saved room clip."));
    });

    return () => {
      operationRef.current += 1;
      cancelRecordingRef.current();
      revokePreview();
    };
    // The store is stable for this mounted component; changes only when the
    // session/room changes. Parent callbacks are kept in refs to avoid reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, roomId, scopeKey]);

  useEffect(() => () => {
    cancelRecordingRef.current();
    revokePreview();
    store.close();
  }, [store]);

  useEffect(() => {
    const video = liveVideoRef.current;
    const stream = mediaStreamRef.current;
    if (!recording || !video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [recording]);

  async function processSelectedFile(
    file: File,
    sourceScope = scopeKeyRef.current,
    promptsCapturedDuringRecording: readonly MoveInReadyPromptId[] = [],
  ): Promise<void> {
    cancelFilePreparationRef.current();
    const operation = ++operationRef.current;
    setBusy(true);
    setLocalError(null);
    setNotice(null);
    const currentRoom = rooms.find((candidate) => makeVideoClipId(sessionId, candidate.id) === sourceScope);
    if (!currentRoom || sourceScope !== scopeKeyRef.current) {
      setBusy(false);
      return;
    }
    const basic = validateVideoFileBasics(file, maxFileBytes);
    if (!basic.ok) {
      setLocalError(basic.message);
      setBusy(false);
      return;
    }

    const controller = new AbortController();
    filePreparationAbortRef.current = controller;
    try {
      const container = await validateVideoContainer(file);
      if (!container.ok) throw new Error(container.message);
      const normalized = await normalizeVideoForCapture(file, container.mime, {
        maxBytes: maxFileBytes,
        maxDurationSeconds: effectiveMaxDurationSeconds,
        signal: controller.signal,
      });
      if (!isCurrentOperation(operation, sourceScope) || controller.signal.aborted) return;
      const sourceSha256 = await sha256Blob(normalized.video);
      if (!isCurrentOperation(operation, sourceScope) || controller.signal.aborted) return;
      const prepared = await prepareVideoReview(normalized.video, {
        maxDurationSeconds: effectiveMaxDurationSeconds,
        signal: controller.signal,
      });
      const { metadata, stills: extracted } = prepared;
      if (!isCurrentOperation(operation, sourceScope) || controller.signal.aborted) return;

      const stored = createStoredVideoClip({
        sessionId,
        roomId: currentRoom.id,
        roomLabel: currentRoom.label,
        fileName: getNormalizedFileName(file.name, currentRoom.id, normalized.converted),
        mime: normalized.mime,
        sizeBytes: normalized.video.size,
        durationSeconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        video: normalized.video,
        sourceSha256,
        stills: extracted,
      });
      await store.put(stored);
      if (!isCurrentOperation(operation, sourceScope)) return;

      const nextUrl = URL.createObjectURL(normalized.video);
      revokePreview();
      previewUrlRef.current = nextUrl;
      setPreviewUrl(nextUrl);
      setClip(stored);
      setStoreStatus("ready");
      setNotice("Clip saved on this device. Review stills are frames from the video at the timestamps shown.");
      await onClipChangeRef.current?.(stored, currentRoom.id);
      if (!isCurrentOperation(operation, sourceScope)) return;
      for (const promptId of promptsCapturedDuringRecording) {
        onPromptCompletionChangeRef.current?.(promptId, true);
      }
      pendingPromptIdsRef.current = [];
      setPendingPromptIds([]);
    } catch (error) {
      if (!isCurrentOperation(operation, sourceScope)) return;
      pendingPromptIdsRef.current = [];
      setPendingPromptIds([]);
      setLocalError(safeErrorMessage(error, "Could not prepare this room clip. Any earlier clip is kept."));
    } finally {
      if (filePreparationAbortRef.current === controller) filePreparationAbortRef.current = null;
      if (isCurrentOperation(operation, sourceScope)) setBusy(false);
    }
  }

  function isCurrentOperation(operation: number, sourceScope: string): boolean {
    return operation === operationRef.current && sourceScope === scopeKeyRef.current;
  }

  async function startCameraRecording(): Promise<void> {
    setCameraIssue(null);
    setLocalError(null);
    pendingPromptIdsRef.current = [];
    setPendingPromptIds([]);
    if (!supportsInAppRecording) {
      setCameraIssue("This browser cannot record MP4 in-page. Use “Record video” to open the phone camera, or upload an MP4/MOV file.");
      return;
    }
    const requestedScope = scopeKeyRef.current;
    const requestGeneration = operationRef.current;
    let acquiredStream: MediaStream | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      acquiredStream = stream;
      if (scopeKeyRef.current !== requestedScope || operationRef.current !== requestGeneration) {
        stopStream(stream);
        return;
      }
      const mimeType = chooseMp4RecorderMimeType();
      if (!mimeType) {
        stopStream(stream);
        setCameraIssue("This browser’s camera recorder cannot produce an MP4 clip. Use “Record video” or upload a MOV file.");
        return;
      }
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: WALKTHROUGH_VIDEO_BITS_PER_SECOND,
      });
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recordingChunkBytesRef.current = 0;
      recordingExceededSizeLimitRef.current = false;
      recordingElapsedBeforeSegmentMsRef.current = 0;
      recordingStartedAtRef.current = Date.now();
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        void liveVideoRef.current.play().catch(() => undefined);
      }
      recorder.ondataavailable = (event) => {
        if (recordingExceededSizeLimitRef.current || event.data.size === 0) return;
        if (!canAppendRecorderChunk(recordingChunkBytesRef.current, event.data.size, maxFileBytes)) {
          recordingExceededSizeLimitRef.current = true;
          recordingChunksRef.current = [];
          recordingChunkBytesRef.current = 0;
          setLocalError(`Recording stopped because it would exceed the ${formatMiB(maxFileBytes)} MiB local video limit. The recording was discarded; any earlier room clip is kept.`);
          stopCameraRecording();
          return;
        }
        recordingChunkBytesRef.current += event.data.size;
        recordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setCameraIssue("The camera stopped unexpectedly. Try recording again or use the phone camera picker.");
        pendingPromptIdsRef.current = [];
        setPendingPromptIds([]);
        discardRecording();
      };
      recorder.onstop = () => {
        resetRecordingClock();
        setRecording(false);
        setRecordingPaused(false);
        const exceededSizeLimit = recordingExceededSizeLimitRef.current;
        recordingExceededSizeLimitRef.current = false;
        recordingChunkBytesRef.current = 0;
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        const recordedMime = recorder.mimeType || mimeType;
        const promptsCapturedDuringRecording = [...pendingPromptIdsRef.current];
        stopStream(mediaStreamRef.current);
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
        if (exceededSizeLimit) {
          pendingPromptIdsRef.current = [];
          setPendingPromptIds([]);
          onRecordingStateChangeRef.current?.(false);
          return;
        }
        const blob = new Blob(chunks, { type: recordedMime });
        if (blob.size === 0) {
          pendingPromptIdsRef.current = [];
          setPendingPromptIds([]);
          setLocalError("No video data was captured. Try recording again.");
          onRecordingStateChangeRef.current?.(false);
          return;
        }
        const extension = recordedMime.includes("quicktime") ? "mov" : "mp4";
        const file = new File([blob], `walkthrough-${roomId}-${Date.now()}.${extension}`, { type: recordedMime });
        void processSelectedFile(file, scopeKey, promptsCapturedDuringRecording)
          .finally(() => onRecordingStateChangeRef.current?.(false));
      };
      recorder.start(1000);
      setRecording(true);
      setRecordingPaused(false);
      setElapsedSeconds(0);
      onRecordingStateChangeRef.current?.(true);
      startRecordingClock();
    } catch (error) {
      stopStream(acquiredStream);
      stopStream(mediaStreamRef.current);
      mediaStreamRef.current = null;
      const name = (error as { name?: string } | null)?.name ?? "";
      const message = name === "NotAllowedError" || name === "SecurityError"
        ? "Camera access is blocked. Allow camera access in the browser settings, or use “Record video” or upload an MP4/MOV file."
        : name === "NotFoundError" || name === "DevicesNotFoundError"
          ? "No camera was found. Use “Record video” or upload an MP4/MOV file."
          : "The camera could not start. Check that another app is not using it, or use “Record video” or upload an MP4/MOV file.";
      setCameraIssue(message);
    }
  }

  function stopCameraRecording(): void {
    clearRecordingInterval();
    setRecording(false);
    setRecordingPaused(false);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      if (recorder.state === "recording") {
        recordingElapsedBeforeSegmentMsRef.current += Math.max(0, Date.now() - (recordingStartedAtRef.current ?? Date.now()));
      }
      recorder.stop();
    } else {
      stopStream(mediaStreamRef.current);
      mediaStreamRef.current = null;
      resetRecordingClock();
      onRecordingStateChangeRef.current?.(false);
    }
  }

  function pauseCameraRecording(): void {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recordingElapsedBeforeSegmentMsRef.current += Math.max(0, Date.now() - (recordingStartedAtRef.current ?? Date.now()));
    clearRecordingInterval();
    recordingStartedAtRef.current = null;
    setElapsedSeconds(Math.min(Math.floor(recordingElapsedBeforeSegmentMsRef.current / 1000), effectiveMaxDurationSeconds));
    try {
      recorder.pause();
      setRecordingPaused(true);
    } catch {
      recordingStartedAtRef.current = Date.now();
      startRecordingClock();
      setCameraIssue("Recording could not pause on this device. The timer has resumed.");
    }
  }

  function resumeCameraRecording(): void {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    try {
      recorder.resume();
      recordingStartedAtRef.current = Date.now();
      setRecordingPaused(false);
      startRecordingClock();
    } catch {
      setCameraIssue("Recording could not resume on this device. Stop and save this clip, or discard it.");
    }
  }

  function discardRecording(): void {
    clearRecordingInterval();
    setRecording(false);
    setRecordingPaused(false);
    onRecordingStateChangeRef.current?.(false);
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // A stopped device can throw while the track is being torn down.
      }
    }
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    recordingChunksRef.current = [];
    recordingChunkBytesRef.current = 0;
    recordingExceededSizeLimitRef.current = false;
    resetRecordingClock();
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
  }

  async function removeClip(): Promise<void> {
    cancelFilePreparationRef.current();
    operationRef.current += 1;
    if (!clip) return;
    setBusy(true);
    setLocalError(null);
    try {
      await store.remove(sessionId, roomId);
      revokePreview();
      setClip(null);
      setPreviewUrl(null);
      setNotice("The room clip and its review stills were removed from this device.");
      await onClipChangeRef.current?.(null, roomId);
    } catch (error) {
      setLocalError(safeErrorMessage(error, "Could not remove the local room clip."));
    } finally {
      setBusy(false);
    }
  }

  function openCameraPicker(): void {
    cameraInputRef.current?.click();
  }

  function openUploadPicker(): void {
    uploadInputRef.current?.click();
  }

  function handleVideoInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0];
    if (file) void processSelectedFile(file);
    event.currentTarget.value = "";
  }

  function markPromptCaptured(promptId: MoveInReadyPromptId, captured: boolean): void {
    if (!roomPromptIds.some((id) => id === promptId)) return;
    if (!captured) {
      const isPending = pendingPromptIdsRef.current.includes(promptId);
      if (isPending) {
        const next = pendingPromptIdsRef.current.filter((id) => id !== promptId);
        pendingPromptIdsRef.current = next;
        setPendingPromptIds(next);
      } else {
        onPromptCompletionChangeRef.current?.(promptId, false);
      }
      return;
    }
    if (!recording && !clip) return;
    if (recording && !clip) {
      const next = [...new Set([...pendingPromptIdsRef.current, promptId])];
      pendingPromptIdsRef.current = next;
      setPendingPromptIds(next);
    } else {
      onPromptCompletionChangeRef.current?.(promptId, true);
    }
  }

  function renderPromptRows(indexes: readonly number[]) {
    return indexes.map((index) => {
      const prompt = roomPrompts[index];
      if (prompt === undefined) return null;
      const promptId = roomPromptIds[index];
      const isPending = Boolean(promptId && pendingPromptIds.includes(promptId));
      const isCaptured = Boolean(promptId && completedPromptIds.includes(promptId));
      const isDone = isPending || isCaptured;
      const isCurrent = index === currentPromptIndex;
      const canMarkCurrentPrompt = isCurrent && (recording || Boolean(clip));
      const status = isPending
        ? "Marked"
        : isCaptured
          ? "Captured"
          : isCurrent
            ? "Current prompt"
            : "Up next";

      return (
        <li
          className={styles.promptRow}
          aria-current={isCurrent ? "step" : undefined}
          data-captured={isDone ? "true" : undefined}
          data-current={isCurrent ? "true" : undefined}
          data-markable={isDone || canMarkCurrentPrompt ? "true" : "false"}
          key={promptId ?? `${roomId}-${index}`}
        >
          <span className={styles.promptIcon} aria-hidden="true"><PromptIcon prompt={prompt} /></span>
          <div className={styles.promptRowCopy}>
            <p>{prompt}</p>
            <span>{status}</span>
          </div>
          {promptId && onPromptCompletionChange && isDone ? (
            <button
              type="button"
              className={styles.promptCompletion}
              aria-label={`Undo captured: ${prompt}`}
              onClick={() => markPromptCaptured(promptId, false)}
              disabled={disabled}
            >
              <Check size={16} aria-hidden="true" /> Undo
            </button>
          ) : promptId && onPromptCompletionChange && canMarkCurrentPrompt ? (
            <button
              type="button"
              className={styles.promptCompletion}
              aria-label={`Mark captured: ${prompt}`}
              onClick={() => markPromptCaptured(promptId, true)}
              disabled={disabled}
            >
              Mark
            </button>
          ) : null}
        </li>
      );
    });
  }

  const showingLiveCamera = recording && mediaStreamRef.current !== null;

  return (
    <section className={styles.capture} aria-labelledby={headingId} data-testid="walkthrough-video-capture">
      <h2 id={headingId} className="sr-only">Record a room</h2>

      <div className={styles.roomHeader}>
        <div className={styles.roomHeadingCopy}>
          <span>ROOM {roomIndex + 1} OF {rooms.length}</span>
          <h3>{room?.label ?? "Room walkthrough"}</h3>
        </div>
        <div className={styles.roomHeaderActions}>
          <span className={styles.roomSaved}>{capturedRoomCount} of {rooms.length} clips saved</span>
          <button
            type="button"
            className={styles.roomPickerToggle}
            data-testid="room-picker-toggle"
            aria-label={`Change room, current room ${room?.label ?? "Room walkthrough"}`}
            aria-controls={`${headingId}-room-selection`}
            aria-expanded={showRoomPicker}
            onClick={() => setShowRoomPicker((visible) => !visible)}
            disabled={disabled || busy || recording}
          >
            Change room <ChevronDown size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div id={`${headingId}-room-selection`} className={styles.roomSteps} data-open={showRoomPicker} role="group" aria-label="Room selection">
        {rooms.map((option, index) => {
          const current = option.id === roomId;
          const saved = capturedRoomIds.includes(option.id);
          const shortLabel = option.id === "bathroom"
            ? "Bath"
            : option.id === "bedroom-living"
              ? "Bed/Liv"
              : option.id === "hallway"
                ? "Hall"
                : option.label;
          return <button
            key={option.id}
            type="button"
            className={`${styles.roomStep} ${current ? styles.roomStepCurrent : ""} ${saved ? styles.roomStepSaved : ""}`}
            data-testid={`room-step-${option.id}`}
            aria-label={`Room ${index + 1}: ${option.label}${current ? ", selected" : ""}${saved ? ", clip saved" : ", no clip saved"}`}
            aria-pressed={current}
            disabled={disabled || busy || recording}
            onClick={() => {
              if (current) return;
              cancelFilePreparationRef.current();
              operationRef.current += 1;
              setShowRoomPicker(false);
              onRoomChange(option.id);
            }}
          >
            <span className={styles.roomStepNumber}>{saved ? <Check aria-hidden="true" size={12} /> : index + 1}</span>
            <span className={styles.roomStepName}>{shortLabel}</span>
          </button>;
        })}
      </div>

      <input
        ref={cameraInputRef}
        id={cameraInputId}
        className={styles.hiddenInput}
        type="file"
        accept={VIDEO_ALLOWED_MIME_TYPES.join(",")}
        capture="environment"
        disabled={disabled || busy || recording || storeStatus === "loading"}
        onChange={handleVideoInputChange}
        aria-label="Record a room video with the phone camera"
      />
      <input
        ref={uploadInputRef}
        id={uploadInputId}
        className={styles.hiddenInput}
        type="file"
        accept={VIDEO_ALLOWED_MIME_TYPES.join(",")}
        disabled={disabled || busy || recording || storeStatus === "loading"}
        onChange={handleVideoInputChange}
        aria-label="Upload an MP4 or MOV room video"
      />

      <div className={styles.previewFrame}>
        {showingLiveCamera ? (
          <>
            <video ref={liveVideoRef} className={styles.video} autoPlay muted playsInline aria-label={`Live camera preview for ${room?.label ?? "room"}`} />
            <div className={styles.recordingBadge} aria-live="polite">
              <div className={styles.recordingBadgeHeading}>
                <span className={styles.recordingDot} />
                <strong>{room?.label ?? "Room"} · {recordingPaused ? "Paused" : "Recording"}</strong>
                <span>{formatTimestamp(elapsedSeconds)} / {formatTimestamp(effectiveMaxDurationSeconds)}</span>
              </div>
            <div className={styles.recordingProgressCopy}>
              <span>Room progress · {capturedPromptCount}/{roomPrompts.length} prompts</span>
              <strong>{promptProgressPercent}%</strong>
            </div>
            <div
              className={styles.recordingProgressTrack}
              role="progressbar"
              aria-label={`${room?.label ?? "Room"} filming prompts completed`}
              aria-valuemin={0}
              aria-valuemax={roomPrompts.length}
              aria-valuenow={Math.min(capturedPromptCount, roomPrompts.length)}
            >
              <span style={{ width: `${promptProgressPercent}%` }} />
            </div>
            </div>
          </>
        ) : previewUrl ? (
          <video
            className={styles.video}
            src={previewUrl}
            controls
            playsInline
            preload="none"
            poster={posterUrl ?? undefined}
            aria-label={`${room?.label ?? "Room"} walkthrough clip preview`}
          />
        ) : (
          <div className={styles.emptyPreview}>
            <Video className={styles.emptyIcon} aria-hidden="true" />
            <p>{storeStatus === "loading" ? "Loading this room’s saved clip…" : "No video recorded for this room yet."}</p>
          <span>MP4 or MOV · up to {formatMiB(maxFileBytes)} MiB · {effectiveMaxDurationSeconds} seconds</span>
          </div>
        )}
        {recording && (
          <div className={styles.recordingControls}>
            <div className={styles.recordingControlGroup}>
              <button
                type="button"
                className={`${styles.primaryButton} ${styles.recordingButton}`}
                onClick={recordingPaused ? resumeCameraRecording : pauseCameraRecording}
                disabled={busy}
                aria-label={recordingPaused ? "Resume recording" : "Pause recording"}
              >
                {recordingPaused ? <CirclePlay aria-hidden="true" size={21} /> : <CirclePause aria-hidden="true" size={21} />}
              </button>
              <button
                type="button"
                className={`${styles.dangerButton} ${styles.recordingButton}`}
                onClick={stopCameraRecording}
                disabled={busy}
                aria-label="Stop recording and save clip"
              >
                <CircleStop aria-hidden="true" size={23} />
              </button>
            </div>
            <span className={styles.recordingActionLabel}>{recordingPaused ? "Resume" : "Pause"} · Stop &amp; save</span>
          </div>
        )}
      </div>

      {!clip && !recording && storeStatus !== "loading" && (
        <div className={styles.actions}>
          {supportsInAppRecording && !recording && (
            <button type="button" className={styles.primaryButton} onClick={() => void startCameraRecording()} disabled={disabled || busy || storeStatus === "error"}>
              <Camera aria-hidden="true" size={18} /> Start recording
            </button>
          )}
          {!supportsInAppRecording && (
            <button type="button" className={styles.secondaryButton} onClick={openCameraPicker} disabled={disabled || busy || storeStatus === "error"}>
              <Camera aria-hidden="true" size={18} /> Record video
            </button>
          )}
          <button type="button" className={styles.secondaryButton} onClick={openUploadPicker} disabled={disabled || busy || storeStatus === "error"}>
            <Upload aria-hidden="true" size={18} /> Upload video
          </button>
        </div>
      )}

      {clip && !recording && (
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={openUploadPicker} disabled={disabled || busy}>
            <RotateCcw aria-hidden="true" size={18} /> Replace clip
          </button>
          <button type="button" className={styles.dangerButton} onClick={() => void removeClip()} disabled={disabled || busy}>
            <Trash2 aria-hidden="true" size={18} /> Remove clip
          </button>
        </div>
      )}

      <section className={styles.prompts} aria-labelledby={promptsId}>
        <div className={styles.promptHeading}>
          <div>
            <h3 id={promptsId}>Live Filming Prompts</h3>
            <p>Follow each step. Assess in person.</p>
          </div>
          <span className={styles.promptProgress}>{capturedPromptCount} of {roomPrompts.length} captured</span>
        </div>
        <p className="sr-only" role="status">{capturedPromptCount} of {roomPrompts.length} filming prompts captured.</p>
        <ol className={styles.promptList}>{renderPromptRows(visiblePromptIndexes)}</ol>
        {roomPrompts.length > collapsedPromptCount && <button
          type="button"
          className={styles.promptDisclosure}
          aria-expanded={showAllPrompts}
          onClick={() => setShowAllPrompts((expanded) => !expanded)}
        >
          {showAllPrompts ? "Show current prompts" : `View all ${roomPrompts.length} prompts`}
        </button>}
      </section>

      {busy && <p className={styles.status} role="status">Checking the video and saving source frames on this device…</p>}
      {cameraIssue && <p className={styles.warning} role="status">{cameraIssue}</p>}
      {localError && <p className={styles.error} role="alert">{localError}</p>}
      {notice && !localError && <p className={styles.success} role="status"><Check size={17} aria-hidden="true" /> {notice}</p>}
      {storeStatus === "error" && !localError && (
        <p className={styles.error} role="alert">Local video storage is unavailable in this browser. Enable site storage or use another browser.</p>
      )}

      {clip ? <details className={styles.savedClipDisclosure} data-testid="saved-clip-details" open={detailsExpanded} onToggle={(event) => onDetailsExpandedChange?.(event.currentTarget.open)}>
        <summary className={styles.savedClipSummary}>
          <strong>Saved clip &amp; analysis</strong>
          <span className={styles.savedClipFileName}>{clip.fileName}</span>
        </summary>
        <div className={styles.clipDetails} aria-label="Saved clip details">
          <div className={styles.clipMeta}>
            <span className={styles.clipName}>File: {clip.fileName}</span>
            <span>{formatTimestamp(clip.durationSeconds)} · {formatMiB(clip.sizeBytes)} MiB</span>
          </div>
          <details className={styles.stillDisclosure} data-testid="source-stills-details" open={stillsExpanded} onToggle={(event) => setStillsExpanded(event.currentTarget.open)}>
            <summary>Review {clip.stills.length} source stills <span>Swipe to browse</span></summary>
            {stillsExpanded && <>
              <p>Actual frames from this video; times are offsets from the start of the clip.</p>
              <div className={styles.stillScroller} role="region" aria-label="Source stills from saved video" tabIndex={0}>
                {clip.stills.map((still, index) => (
                  <StillPreview key={`${still.timestampSeconds}-${index}`} still={still} />
                ))}
              </div>
            </>}
          </details>
          <details className={styles.capturePrivacy}>
            <summary>On-device storage &amp; review</summary>
            <p>Clips and stills stay in this browser on this device. Recording guides video coverage; it does not assess Form 1083 or make an inspection decision.</p>
          </details>
          {children}
        </div>
      </details> : <details className={styles.savedClipDisclosure} data-testid="saved-clip-details" open={detailsExpanded} onToggle={(event) => onDetailsExpandedChange?.(event.currentTarget.open)}>
        <summary className={styles.savedClipSummary}><strong>Recording privacy &amp; analysis</strong></summary>
        <div className={styles.clipDetails} aria-label="Recording details">
          <details className={styles.capturePrivacy}>
            <summary>On-device storage &amp; review</summary>
            <p>Clips and stills stay in this browser on this device. Recording guides video coverage; it does not assess Form 1083 or make an inspection decision.</p>
          </details>
          {children}
        </div>
      </details>}
    </section>
  );

  function revokePreview(): void {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
  }

  function clearRecordingInterval(): void {
    if (recordingIntervalRef.current !== null) clearInterval(recordingIntervalRef.current);
    recordingIntervalRef.current = null;
    if (recordingStopTimeoutRef.current !== null) clearTimeout(recordingStopTimeoutRef.current);
    recordingStopTimeoutRef.current = null;
  }

  function getElapsedRecordingMs(): number {
    const activeSegmentMs = recordingStartedAtRef.current === null
      ? 0
      : Math.max(0, Date.now() - recordingStartedAtRef.current);
    return recordingElapsedBeforeSegmentMsRef.current + activeSegmentMs;
  }

  function startRecordingClock(): void {
    clearRecordingInterval();
    recordingIntervalRef.current = setInterval(() => {
      setElapsedSeconds(Math.min(Math.floor(getElapsedRecordingMs() / 1000), effectiveMaxDurationSeconds));
    }, 250);
    const remainingSeconds = Math.max(0, effectiveMaxDurationSeconds - getElapsedRecordingMs() / 1000);
    recordingStopTimeoutRef.current = setTimeout(stopCameraRecording, getRecordingStopDelayMs(remainingSeconds));
  }

  function resetRecordingClock(): void {
    clearRecordingInterval();
    recordingStartedAtRef.current = null;
    recordingElapsedBeforeSegmentMsRef.current = 0;
    setElapsedSeconds(0);
  }
}

function StillPreview({ still }: { still: StoredVideoStill }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const nextUrl = URL.createObjectURL(still.blob);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [still.blob]);
  if (!url) return <div className={styles.stillPlaceholder} aria-label="Loading source frame" />;
  return (
    <figure className={styles.still}>
      {/* The thumbnail is an actual decoded frame from the selected video. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={`Source video frame at ${formatTimestamp(still.timestampSeconds)}`} />
      <figcaption>{formatTimestamp(still.timestampSeconds)} from video</figcaption>
    </figure>
  );
}

function getRoomPrompts(roomId: string): readonly string[] {
  const normalized = roomId.toLowerCase();
  if (normalized.includes("kitchen")) return DEFAULT_ROOM_PROMPTS.kitchen;
  if (normalized.includes("bath")) return DEFAULT_ROOM_PROMPTS.bathroom;
  if (normalized.includes("bedroom-living")) return DEFAULT_ROOM_PROMPTS["bedroom-living"];
  if (normalized.includes("bed")) return DEFAULT_ROOM_PROMPTS.bedroom;
  if (normalized.includes("living")) return DEFAULT_ROOM_PROMPTS.living;
  if (normalized.includes("hall")) return DEFAULT_ROOM_PROMPTS.hallway;
  return DEFAULT_ROOM_PROMPTS.default;
}

function getNormalizedFileName(fileName: string, roomId: string, converted: boolean): string {
  const fallback = `walkthrough-${roomId}.mp4`;
  if (!fileName) return fallback;
  if (!converted) return fileName;
  const stem = fileName.replace(/\.[^./\\]*$/, "");
  return `${stem || `walkthrough-${roomId}`}.mp4`;
}

function hasMp4MediaRecorder(): boolean {
  if (typeof navigator === "undefined" || typeof MediaRecorder === "undefined") return false;
  return typeof navigator.mediaDevices?.getUserMedia === "function" && Boolean(chooseMp4RecorderMimeType());
}

function chooseMp4RecorderMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/quicktime",
  ];
  if (typeof MediaRecorder.isTypeSupported !== "function") return null;
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null;
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // Track release is best-effort during browser/device teardown.
    }
  });
}

function safeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

// Keep the input shape explicitly self-contained for integrations that need
// to forward extracted stills into a separately reviewed processing flow.
export function toVideoStillSummary(still: VideoStill): Pick<StoredVideoStill, "timestampSeconds" | "width" | "height"> {
  return {
    timestampSeconds: still.timestampSeconds,
    width: still.width,
    height: still.height,
  };
}
