"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  CloudOff,
  Download,
  FileText,
  FolderOpen,
  Home,
  LoaderCircle,
  Mic,
  RefreshCw,
  ShieldCheck,
  Share2,
  Smartphone,
  StickyNote,
  Trash2,
  Video,
} from "lucide-react";
import Image from "next/image";
import catalogJson from "../../data/catalog.demo.json";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
  type ReactNode,
} from "react";

import {
  EVALUATOR_ATTESTATION_TEXT,
  PARTICIPANT_ATTESTATION_TEXT,
  MOVE_IN_READY_SCHEMA_VERSION,
  LEGACY_DEFAULT_ROOM_IDS,
  MOVE_IN_READY_ELEMENTS,
  MOVE_IN_READY_ELEMENT_IDS,
  buildInspectionLocation,
  createUnreviewedEvaluatorDecisions,
  dequeueAnalysisQueue,
  deriveFinalInspectionResult,
  enqueueAnalysisQueue,
  hasDeficientDecisions,
  isMoveInReadyElementId,
  isMoveInReadyRoomId,
  normalizeFundingType,
  parseRoomId,
  pruneAnalysisQueue,
  roomContributesToElement,
  roomLabel,
  roomsForUnit,
  startReinspectionDecisions,
  unreviewedDecisionPreservingSnapshot,
  validateModelDeficiencySuggestion,
  validateEvaluatorDecision,
  validateEvaluatorSignoff,
  validateParticipantSignoff,
  type EvaluatorDecision,
  type EvaluatorDecisionSet,
  type EvaluatorSignoff,
  type ParticipantSignoff,
  type EvidenceReference,
  type ModelElementProposal,
  type ModelDeficiencySuggestion,
  type MoveInReadyElementId,
  type MoveInReadyPromptId,
  type MoveInReadyRoomId,
  type MoveInReadyUnitType,
  type VideoAnalysisIdentity,
} from "../../domain/move-in-ready";
import { checklistItemsForElement } from "../../domain/element-criteria";
import { WALKTHROUGH_CLIENT_HEADER, WALKTHROUGH_CLIENT_ID } from "../../domain/walkthrough-client";
import {
  buildHmisReadyJson,
  buildMoveInReadyPdf,
  exportFilename,
  type ExportStill,
  type FixListLanguage,
  type MoveInReadyExportKind,
} from "../../export/move-in-ready-pdf";
import { buildLahsa1083Json } from "../../export/lahsa-1083";
import {
  buildCaseNoteText,
  CASE_NOTE_DRAFT_LABEL,
} from "../../export/case-note";
import {
  createInitialInspectionRecord,
  createInspectionStore,
  identityForEvidenceReference,
  INSPECTION_MEMORY_ONLY_WARNING,
  type InspectionStore,
  type MoveInReadyInspection,
  type PendingAnalysisIntent,
  type StoredRoomClipIdentity,
  type TourLanguage,
} from "./inspection-store";
import WalkthroughVideoCapture from "./video-capture";
import BuildingPrescreen from "./building-prescreen";
import {
  buildDetectorTestReference,
  DETECTOR_TEST_STILL_PREFIX,
  firstFreeEvidenceTimestampMs,
} from "./detector-test";
import type { CapturedDetectorStill } from "./detector-test-capture";
import { rankDeficiencies, reinspectionChecklist } from "./fix-list";
import {
  findVerifiedEvidenceStill,
  isExpectedMp4Media,
  resolveMappedProposalState,
  verifyMappedServerEvidence,
  type VerifiedMappedEvidence,
} from "./evidence-verification";
import {
  DeferredInstallPrompt,
  detectInstallPlatform,
  getInstallAffordance,
  isStandaloneDisplay,
  manualInstallSteps,
  requestInstall,
  type InstallAffordance,
  type InstallPlatform,
} from "./offline";
import {
  createVideoClipStore,
  makeElementClipId,
  makeVideoClipId,
  type StoredVideoClip,
  type StoredVideoStill,
  type VideoClipStore,
} from "./video-store";
import { extractVideoStills, formatTimestamp, sha256Blob, type VideoStill } from "./video-utils";
import { createPendingCancelTracker } from "./pending-cancel";
import { canShareExportFiles } from "./export-share";
import { FetchTimeoutError, MAP_TIMEOUT_MS, SEGMENT_TIMEOUT_MS, fetchWithTimeout } from "./fetch-timeout";
import { isAnalysisCurrent } from "./analysis-identity";
import { MAX_CONCURRENT_BATCH_ROOMS, createRoomBatchQueue, runRoomBatch, shouldAutoEnqueueOnSave } from "./batch-scheduler";
import {
  buildConfirmDraft,
  completeFireSafetyAssessmentFromDraft,
  createDecisionDraft,
  fireSafetyAssessmentFromDraft,
  fireSafetyChoiceFromDraft,
  prefillDraftFromProposal,
  type DecisionChoice,
  type DecisionDraft,
  type ElementDetailsInput,
  type FireSafetyDraftOutcome,
} from "./decision-draft";
import { deriveGuideModel } from "./walkthrough-guide";
import { filmingScriptForRoom } from "./assistant-script";
import VoicePrompt from "./voice-prompt";
import GuidedTourView from "./guided-tour-view";
import { SETUP_VOICE_QUESTIONS, checksForRoom } from "./voice-checks";
import { parseBathCount, parseUnitType, parseYesNo } from "./voice-parse";
import styles from "./move-in-ready-flow.module.css";

export type AnalysisMode = "live" | "fixture" | "unconfigured";
type Step = "home" | "capture" | "review" | "signoff" | "profile" | "guided";
type ProfileSection = "unit" | "evaluator" | "agency";
type AnalysisStatus = "idle" | "segmenting" | "mapping" | "complete" | "error";
type FlowExportKind = MoveInReadyExportKind | "hmis-json" | "lahsa-1083-json" | "case-note";

/**
 * Ask the polish route to refine case-note wording. Any failure —
 * disabled flag, offline, timeout, bad response — returns the template
 * unchanged, so the download never depends on the network or AI.
 */
async function requestCaseNotePolish(template: string): Promise<{ text: string; polished: boolean }> {
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 35_000);
    try {
      const response = await fetch("/api/exports/polish-case-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: template }),
        signal: controller.signal,
      });
      if (!response.ok) return { text: template, polished: false };
      const payload = (await response.json()) as { text?: unknown; polished?: unknown };
      if (typeof payload.text !== "string" || !payload.text.trim()) {
        return { text: template, polished: false };
      }
      return { text: payload.text, polished: payload.polished === true };
    } finally {
      window.clearTimeout(timeout);
    }
  } catch {
    return { text: template, polished: false };
  }
}

export interface MoveInReadyFlowProps {
  analysisMode: AnalysisMode;
  /** Server-computed: true when FISH_VOICE_ID_ES is configured (REQ-R2). */
  esVoiceConfigured: boolean;
}

function form1083AdministrativeBlocker(record: MoveInReadyInspection): string | null {
  if (!record.evaluatorAgencyName.trim()) return "Enter the evaluator’s agency name in Profile before signing.";
  if (!record.landlordDiscussion) return "Choose YES or NO for landlord discussion in Profile before signing.";
  if (record.landlordDiscussion === "yes" && !record.landlordDiscussionDate) {
    return "Add the landlord-discussion date in Profile before signing.";
  }
  if (record.leadershipSignoffRequired && !record.leadershipNameAndTitle.trim()) {
    return "Add the required leadership name and title in Profile before signing.";
  }
  if (record.leadershipSignoffRequired && !record.leadershipSignoff.trim()) {
    return "Add the required agency leadership signature in Profile before signing.";
  }
  if (record.leadershipSignoffRequired && !record.leadershipSignedAt) {
    return "Add the required leadership-signature date in Profile before signing.";
  }
  return null;
}

/**
 * A record is signed for re-inspection (REQ-L1) when both the evaluator and
 * the participant (REQ-F1) sign-offs exist.
 */
function isSignedForReinspection(record: MoveInReadyInspection): boolean {
  return record.signoff != null && record.participantSignoff != null;
}

/** Home eligibility for "Re-inspect deficiencies" (REQ-L1): a signed record with any D decision. */
function canReinspect(record: MoveInReadyInspection): boolean {
  return isSignedForReinspection(record) && hasDeficientDecisions(record.decisions);
}

export interface VideoIdentityFields {
  sessionId: string;
  schemaVersion: number;
  videoId: string;
  videoRevision: number;
  analysisId: string;
  attempt: number;
  catalogVersion: string;
  expectedVideoSha256: string;
}

interface SegmentCandidate {
  candidateId: string;
  elementId: MoveInReadyElementId;
  concept: string;
  evidence: {
    frameIndex: number;
    timestampMs: number;
    objectOrdinal: number;
    box: { left: number; top: number; right: number; bottom: number };
    samConfidence?: number;
  };
}

interface SegmentResponse {
  candidateToken: string | null;
  identity: VideoIdentityFields;
  room: MoveInReadyRoomId;
  media: { container: "mp4"; sourceVideoSha256: string };
  candidates: SegmentCandidate[];
  sampleTimestampsMs: number[];
}

interface MapProposal {
  elementId: MoveInReadyElementId;
  state: "draft-proposal" | "needs-human-check";
  modelSuggestion: "A" | "D";
  observation: string;
  confidence: number;
  evidenceCandidateIds: string[];
  evidence: Array<{ candidateId: string; verified: VerifiedMappedEvidence | null }>;
  evidenceIntegrityValid: boolean;
  deficiencySuggestion?: ModelDeficiencySuggestion;
}

interface MapResponse {
  identity: VideoIdentityFields;
  room: MoveInReadyRoomId;
  media: { container: "mp4"; sourceVideoSha256: string };
  mappingModel: "muse-spark-1.3" | "muse-spark-open-baseten";
  proposals: MapProposal[];
}

interface EvidenceView {
  reference: EvidenceReference;
  clip: StoredVideoClip;
  still: StoredVideoClip["stills"][number];
  src: string;
}

interface ParsedSegmentResponse extends SegmentResponse {
  stage: "segmented";
}

interface ParsedMapResponse extends MapResponse {
  stage: "mapped";
}

const CATALOG_VERSION = catalogJson.version;
const ACTIVE_SESSION_KEY = "move-in-ready-active-session-v1";
const MAX_CANDIDATE_STILLS = 12;
const MAX_ROOM_EVIDENCE_STILLS = 30;
const MAX_STILLS_PER_DECODE = 12;

/** m:ss elapsed for the batch working line. _tick resubscribes the render to the 1 s batch timer. */
function formatBatchElapsed(elapsedMs: number, _tick: number): string {
  void _tick;
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function isCaptureSetupComplete(
  record: Pick<MoveInReadyInspection, "pseudonym" | "fundingType" | "unitType"> | null,
): boolean {
  return record !== null && record.fundingType === "lahsa" && record.pseudonym.trim().length > 0 && record.unitType !== "";
}

function shouldExpandCaptureSetup(
  record: Pick<MoveInReadyInspection, "pseudonym" | "fundingType" | "unitType">,
): boolean {
  const isUntouched = !record.pseudonym.trim() && record.fundingType === "unknown" && record.unitType === "";
  return !isCaptureSetupComplete(record) && !isUntouched;
}

function clipConsentKey(record: MoveInReadyInspection | null, roomId: MoveInReadyRoomId): string | null {
  const identity = record?.clipIdentities[roomId];
  if (!record || !identity) return null;
  return JSON.stringify([
    record.sessionId,
    record.schemaVersion,
    record.catalogVersion,
    roomId,
    identity.videoId,
    identity.videoRevision,
    identity.videoHash,
  ]);
}

export default function MoveInReadyFlow({ analysisMode, esVoiceConfigured }: MoveInReadyFlowProps) {
  const [sessionId, setSessionId] = useState("");
  const [record, setRecord] = useState<MoveInReadyInspection | null>(null);
  const recordRef = useRef<MoveInReadyInspection | null>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const inspectionStoreRef = useRef<InspectionStore | null>(null);
  const videoStoreRef = useRef<VideoClipStore | null>(null);
  const [step, setStep] = useState<Step>("home");
  const [profileSection, setProfileSection] = useState<ProfileSection>("unit");
  const [setupExpanded, setSetupExpanded] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<MoveInReadyRoomId>("kitchen");
  const [voiceTurn, setVoiceTurn] = useState<{ roomId: MoveInReadyRoomId; index: number } | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [setupVoiceStep, setSetupVoiceStep] = useState<"unit" | "baths" | null>(null);
  const [setupVoiceTranscript, setSetupVoiceTranscript] = useState<string | null>(null);
  const [activeElementId, setActiveElementId] = useState<MoveInReadyElementId | null>(MOVE_IN_READY_ELEMENT_IDS[0]);
  const [mobileReviewDetailOpen, setMobileReviewDetailOpen] = useState(false);
  const [isWideLayout, setIsWideLayout] = useState(false);
  const [reviewNoteOpen, setReviewNoteOpen] = useState(false);
  const [reviewNoteDraft, setReviewNoteDraft] = useState("");
  const [recordingInProgress, setRecordingInProgress] = useState(false);
  const [recordingCueIndex, setRecordingCueIndex] = useState(-1);
  const prevClipRef = useRef<StoredVideoClip | null>(null);
  const [clips, setClips] = useState<Partial<Record<MoveInReadyRoomId, StoredVideoClip>>>({});
  const [elementClips, setElementClips] = useState<Partial<Record<MoveInReadyElementId, StoredVideoClip>>>({});
  const [clipsReadySessionId, setClipsReadySessionId] = useState<string | null>(null);
  const [unreadableClipRooms, setUnreadableClipRooms] = useState<MoveInReadyRoomId[]>([]);
  const [booting, setBooting] = useState(true);
  const [storageWarning, setStorageWarning] = useState("");
  const [online, setOnline] = useState(true);
  const [mockUnitAttestationKey, setMockUnitAttestationKey] = useState<string | null>(null);
  const [sendVideoConsentKey, setSendVideoConsentKey] = useState<string | null>(null);
  const [installPlatform, setInstallPlatform] = useState<InstallPlatform>("unknown");
  const [isInstalled, setIsInstalled] = useState(false);
  const [hasInstallPrompt, setHasInstallPrompt] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [installNotice, setInstallNotice] = useState("");
  const [analysisExpanded, setAnalysisExpanded] = useState(false);
  const [clipDetailsExpanded, setClipDetailsExpanded] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const [analysisElapsedSeconds, setAnalysisElapsedSeconds] = useState(0);
  const analysisStartedAtRef = useRef<number | null>(null);
  const pendingCancelRef = useRef(new Map<MoveInReadyRoomId, ReturnType<typeof createPendingCancelTracker>>());
  function pendingCancelFor(roomId: MoveInReadyRoomId): ReturnType<typeof createPendingCancelTracker> {
    let tracker = pendingCancelRef.current.get(roomId);
    if (!tracker) {
      tracker = createPendingCancelTracker();
      pendingCancelRef.current.set(roomId, tracker);
    }
    return tracker;
  }
  // Render mirrors for long-lived batch-pool closures (the pool outlives its launching render).
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const stepRef = useRef(step);
  stepRef.current = step;
  const [analysisError, setAnalysisError] = useState("");
  const [analysisNotice, setAnalysisNotice] = useState("");
  const [batchAttested, setBatchAttested] = useState(false);
  const [batchSendConsent, setBatchSendConsent] = useState(false);
  const batchAttestedRef = useRef(batchAttested);
  batchAttestedRef.current = batchAttested;
  const batchSendConsentRef = useRef(batchSendConsent);
  batchSendConsentRef.current = batchSendConsent;
  const [batchActive, setBatchActive] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; roomLabel: string; startedAt: number } | null>(null);
  const [batchTick, setBatchTick] = useState(0);
  const [batchFailedRooms, setBatchFailedRooms] = useState<string[]>([]);
  const batchQueueRef = useRef(createRoomBatchQueue<MoveInReadyRoomId>());
  const batchTotalRef = useRef(0);
  const batchSettledRef = useRef(0);
  const batchStartedAtRef = useRef(0);
  const batchCancelRef = useRef(false);
  const batchStopReasonRef = useRef<"offline" | "consent" | null>(null);
  const batchSessionRef = useRef(0);
  const batchRunRef = useRef<Promise<{ proved: MoveInReadyRoomId[]; failed: MoveInReadyRoomId[] }> | null>(null);
  const batchRoomsInFlightRef = useRef<Set<MoveInReadyRoomId>>(new Set());
  /** Failed-room labels for the current run; batchFailedRooms state mirrors it for render. */
  const batchFailedRef = useRef<string[]>([]);
  const [walkthroughAttested, setWalkthroughAttested] = useState(false);
  const [walkthroughSendConsent, setWalkthroughSendConsent] = useState(false);
  const batchAutoStartedRef = useRef(false);
  const [inspections, setInspections] = useState<MoveInReadyInspection[]>([]);

  const refreshInspectionList = useCallback(async (): Promise<void> => {
    try {
      const rows = await inspectionStoreRef.current?.list() ?? [];
      setInspections(rows);
    } catch {
      // The list is a convenience; the active record already loaded.
    }
  }, []);
  const captureControlRef = useRef<{ startCapture: () => void } | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<MoveInReadyElementId, DecisionDraft>>>({});
  const [reviewError, setReviewError] = useState("");
  const [evidenceViews, setEvidenceViews] = useState<EvidenceView[]>([]);
  const [signoffName, setSignoffName] = useState("");
  const [signoffAttested, setSignoffAttested] = useState(false);
  const [participantName, setParticipantName] = useState("");
  const [participantSignature, setParticipantSignature] = useState("");
  const [participantAttested, setParticipantAttested] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [queueWakeTick, setQueueWakeTick] = useState(0);
  const queueRunnerKeyRef = useRef("");
  const [exportError, setExportError] = useState("");
  const [exportNotice, setExportNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [canExportShare] = useState(canShareExportFiles);
  const analysisControllersRef = useRef<Partial<Record<MoveInReadyRoomId, AbortController>>>({});
  const analysisGenerationRef = useRef<Partial<Record<MoveInReadyRoomId, number>>>({});
  /** Rooms with a live pipeline (one pipeline per room; callers release on settle). */
  const analysisInFlightRef = useRef<Set<MoveInReadyRoomId>>(new Set());
  const analysisAttemptsRef = useRef<Partial<Record<MoveInReadyRoomId, number>>>({});
  const clipChangeGenerationRef = useRef<Partial<Record<MoveInReadyRoomId, number>>>({});
  const objectUrlsRef = useRef<string[]>([]);
  const installPromptRef = useRef(new DeferredInstallPrompt());
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef<Step>(step);

  const refreshStorageWarning = useCallback(() => {
    const memoryOnly = Boolean(inspectionStoreRef.current?.isMemoryOnly() || videoStoreRef.current?.isMemoryOnly());
    setStorageWarning(memoryOnly ? INSPECTION_MEMORY_ONLY_WARNING : "");
  }, []);

  const persist = useCallback((next: MoveInReadyInspection) => {
    recordRef.current = next;
    setRecord(next);
    const store = inspectionStoreRef.current;
    if (!store) return;
    void store.put(next).then(() => {
      refreshStorageWarning();
    }).catch((error: unknown) => {
      setStorageWarning(safeClientError(error, "Local storage is unavailable. Changes will remain in memory only until this page closes."));
    });
  }, [refreshStorageWarning]);

  const updateRecord = useCallback((mutate: (current: MoveInReadyInspection) => MoveInReadyInspection) => {
    const current = recordRef.current;
    if (!current) return;
    const next = mutate({ ...current, updatedAt: new Date().toISOString() });
    persist(next);
  }, [persist]);

  const grantBatchConsent = useCallback(() => {
    setBatchAttested(true);
    setBatchSendConsent(true);
  }, []);

  const grantTourConsent = useCallback(() => {
    setWalkthroughAttested(true);
    setWalkthroughSendConsent(true);
    setBatchAttested(true);
    setBatchSendConsent(true);
    updateRecord((current) => ({
      ...current,
      fundingType: "lahsa",
      pseudonym: current.pseudonym.trim() || `Demo Unit ${current.sessionId.replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase() || "A"}`,
    }));
  }, [updateRecord]);

  const skipRoom = (roomId: MoveInReadyRoomId): void => {
    if (recordRef.current?.roomIds.includes(roomId)) toggleInspectionRoom(roomId);
  };

  const markNeedsCheck = useCallback((elementId: MoveInReadyElementId, note: string) => {
    updateRecord((current) => ({
      ...current,
      decisions: { ...current.decisions, [elementId]: { status: "needs-human-check", note: note.slice(0, 300) } },
      signoff: null,
      participantSignoff: null,
    }));
  }, [updateRecord]);

  const invalidateActiveAnalysis = useCallback((message?: string) => {
    for (const roomId of Object.keys(analysisGenerationRef.current) as MoveInReadyRoomId[]) {
      analysisGenerationRef.current[roomId] = (analysisGenerationRef.current[roomId] ?? 0) + 1;
    }
    for (const controller of Object.values(analysisControllersRef.current)) {
      controller?.abort();
    }
    analysisControllersRef.current = {};
    analysisInFlightRef.current.clear();
    if (analysisStatus === "segmenting" || analysisStatus === "mapping") {
      setAnalysisStatus("idle");
      setAnalysisNotice(message ?? "Analysis stopped because the selected clip or room changed.");
    }
  }, [analysisStatus]);

  /**
   * Room-scoped invalidation (Sprint 0 REQ-S2/REQ-S5): replacing or
   * removing one room's clip, or leaving one room selected, aborts only
   * that room's pipeline so a sibling room's batch pipeline keeps its
   * guards and result. The shared status line resets only when no other
   * room still has a live pipeline.
   */
  const invalidateRoomAnalysis = useCallback((roomId: MoveInReadyRoomId, message?: string) => {
    analysisGenerationRef.current[roomId] = (analysisGenerationRef.current[roomId] ?? 0) + 1;
    analysisControllersRef.current[roomId]?.abort();
    delete analysisControllersRef.current[roomId];
    analysisInFlightRef.current.delete(roomId);
    if (analysisInFlightRef.current.size === 0 &&
        (analysisStatus === "segmenting" || analysisStatus === "mapping")) {
      setAnalysisStatus("idle");
      setAnalysisNotice(message ?? "Analysis stopped because the selected clip or room changed.");
    }
  }, [analysisStatus]);

  function analysisIsCurrent(generation: number, controller: AbortController, expectedSessionId: string, roomId: MoveInReadyRoomId, videoId: string, videoRevision: number, videoHash: string, schemaVersion: number, catalogVersion: string, requireSelectedRoom = true): boolean {
    const current = recordRef.current;
    return isAnalysisCurrent({
      aborted: controller.signal.aborted,
      generation,
      currentGeneration: analysisGenerationRef.current[roomId] ?? 0,
      requireSelectedRoom,
      record: current ? {
        sessionId: current.sessionId,
        selectedRoomId: current.selectedRoomId,
        schemaVersion: current.schemaVersion,
        catalogVersion: current.catalogVersion,
      } : null,
      identity: current?.clipIdentities[roomId] ?? null,
      expected: {
        sessionId: expectedSessionId,
        roomId,
        videoId,
        videoRevision,
        videoHash,
        schemaVersion,
        catalogVersion,
      },
    });
  }

  // Release server-held mapping leases when the tab closes mid-analysis.
  // Each room tracks its own lease; the keepalive cancel is idempotent and
  // lease expiry remains the fallback.
  useEffect(() => {
    const trackers = pendingCancelRef.current;
    const onPageHide = () => {
      for (const tracker of trackers.values()) {
        const pending = tracker.consume();
        if (pending) void cancelPendingVideoMapping(pending.identity, pending.token);
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  // Elapsed ticker while a live analysis is in flight. Live rooms take on
  // the order of a minute; the counter is decorative (aria-hidden) so screen
  // readers hear the stable status text instead of every second.
  useEffect(() => {
    if (analysisStatus !== "segmenting" && analysisStatus !== "mapping") {
      analysisStartedAtRef.current = null;
      setAnalysisElapsedSeconds(0);
      return;
    }
    if (analysisStartedAtRef.current === null) analysisStartedAtRef.current = Date.now();
    const startedAt = analysisStartedAtRef.current;
    const timer = window.setInterval(() => {
      setAnalysisElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [analysisStatus]);

  useEffect(() => {
    let active = true;
    const inspectionStore = createInspectionStore();
    const videoStore = createVideoClipStore();
    inspectionStoreRef.current = inspectionStore;
    videoStoreRef.current = videoStore;
    if (inspectionStore.isMemoryOnly() || videoStore.isMemoryOnly()) setStorageWarning(INSPECTION_MEMORY_ONLY_WARNING);
    try {
      const saved = window.localStorage.getItem(ACTIVE_SESSION_KEY);
      const id = isSafeSessionId(saved) ? saved : makeId("walkthrough");
      if (!saved || !isSafeSessionId(saved)) window.localStorage.setItem(ACTIVE_SESSION_KEY, id);
      setSessionId(id);
      void inspectionStore.get(id).then((savedRecord) => {
        if (!active) return;
        const loaded = savedRecord ?? createInitialInspectionRecord(id);
        recordRef.current = loaded;
        setRecord(loaded);
        refreshStorageWarning();
        setSetupExpanded(shouldExpandCaptureSetup(loaded));
        setSelectedRoomId(loaded.selectedRoomId);
        setAnalysisExpanded(false);
        if (!savedRecord) void inspectionStore.put(loaded).catch((error: unknown) => {
          setStorageWarning(safeClientError(error, "Local storage is unavailable. This walkthrough is in memory only."));
        });
        setBooting(false);
      }).catch((error: unknown) => {
        if (!active) return;
        const inMemory = createInitialInspectionRecord(id);
        recordRef.current = inMemory;
        setRecord(inMemory);
        setSetupExpanded(shouldExpandCaptureSetup(inMemory));
        setStorageWarning(safeClientError(error, "Saved inspection could not be opened. This walkthrough is in memory only."));
        setBooting(false);
      });
    } catch {
      const id = makeId("walkthrough");
      setSessionId(id);
      const inMemory = createInitialInspectionRecord(id);
      recordRef.current = inMemory;
      setRecord(inMemory);
      setSetupExpanded(shouldExpandCaptureSetup(inMemory));
      setStorageWarning("This browser blocks local storage. This walkthrough will only remain in memory until the page closes.");
      setBooting(false);
    }
    const updateOnline = () => setOnline(navigator.onLine);
    // REQ-L2: a returning tab re-evaluates the persisted analysis queue even
    // when no online/offline transition fired while it was hidden.
    const wakeQueueRunner = () => {
      if (document.visibilityState === "visible") setQueueWakeTick((tick) => tick + 1);
    };
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    document.addEventListener("visibilitychange", wakeQueueRunner);
    return () => {
      active = false;
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      document.removeEventListener("visibilitychange", wakeQueueRunner);
      for (const controller of Object.values(analysisControllersRef.current)) {
        controller?.abort();
      }
      inspectionStore.close();
      videoStore.close();
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [refreshStorageWarning]);

  useEffect(() => {
    const activeSessionId = record?.sessionId;
    if (!activeSessionId) return;
    const store = videoStoreRef.current;
    if (!store) return;
    let active = true;
    const expectedSession = activeSessionId;
    setClips({});
    setElementClips({});
    setClipsReadySessionId(null);
    setUnreadableClipRooms([]);
    const loadRoomIds = recordRef.current?.roomIds ?? [...LEGACY_DEFAULT_ROOM_IDS];
    // Live-proof capture is removed; previously saved element clips still
    // load so old records reconcile and display their evidence.
    const loadElementIds = Object.keys(recordRef.current?.elementClipIdentities ?? {})
      .filter((id): id is MoveInReadyElementId => isMoveInReadyElementId(id));
    void Promise.all([
      ...loadRoomIds.map(async (roomId) => {
        try {
          const clip = await store.get(expectedSession, roomId);
          const videoHash = clip ? await sha256Blob(clip.video) : null;
          return { kind: "room", roomId, clip, videoHash, failed: false } as const;
        } catch {
          return { kind: "room", roomId, clip: null, videoHash: null, failed: true } as const;
        }
      }),
      ...loadElementIds.map(async (elementId) => {
        try {
          const clip = await store.getElement(expectedSession, elementId);
          const videoHash = clip ? await sha256Blob(clip.video) : null;
          return { kind: "element", elementId, clip, videoHash, failed: false } as const;
        } catch {
          return { kind: "element", elementId, clip: null, videoHash: null, failed: true } as const;
        }
      }),
    ]).then((rows) => {
      if (!active || recordRef.current?.sessionId !== expectedSession) return;
      const next: Partial<Record<MoveInReadyRoomId, StoredVideoClip>> = {};
      const nextElements: Partial<Record<MoveInReadyElementId, StoredVideoClip>> = {};
      const failedRooms: MoveInReadyRoomId[] = [];
      let reconciled = recordRef.current;
      let changed = false;
      for (const row of rows) {
        if (row.kind === "element") {
          const { elementId, clip, videoHash, failed } = row;
          const existing = reconciled.elementClipIdentities[elementId];
          if (failed) {
            setStorageWarning("A saved element clip could not be checked. Its evidence stays hidden until local storage can be read.");
            continue;
          }
          if (!clip || !videoHash || clip.sourceSha256 !== videoHash ||
              existing?.videoHash !== videoHash || existing.sizeBytes !== clip.sizeBytes ||
              existing.capturedAt !== clip.capturedAt) {
            if (existing) {
              reconciled = invalidateElementEvidence(reconciled, elementId);
              changed = true;
            }
            continue;
          }
          nextElements[elementId] = clip;
          continue;
        }
        const { roomId, clip, videoHash, failed } = row;
        const existing = reconciled.clipIdentities[roomId];
        if (failed) {
          failedRooms.push(roomId);
          setStorageWarning("One or more saved room clips could not be checked. Evidence from those rooms stays hidden until local storage can be read.");
          continue;
        }
        if (!clip || !videoHash) {
          if (existing) {
            reconciled = {
              ...invalidateRoomEvidence(reconciled, roomId, null),
              completedPromptIdsByRoom: { ...reconciled.completedPromptIdsByRoom, [roomId]: [] },
            };
            changed = true;
          }
          continue;
        }
        if (clip.sourceSha256 !== videoHash) {
          setStorageWarning("A saved room clip failed its local integrity check. Its evidence stays hidden until you choose the clip again.");
          continue;
        }
        const matchesIdentity = existing?.videoHash === videoHash &&
          existing.sizeBytes === clip.sizeBytes &&
          existing.capturedAt === clip.capturedAt;
        if (!matchesIdentity) {
          const identity: StoredRoomClipIdentity = {
            roomId,
            schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
            catalogVersion: CATALOG_VERSION,
            videoId: makeId("video"),
            videoRevision: (existing?.videoRevision ?? 0) + 1,
            videoHash,
            capturedAt: clip.capturedAt,
            durationSeconds: clip.durationSeconds,
            sizeBytes: clip.sizeBytes,
            evidence: [],
          };
          reconciled = invalidateRoomEvidence(reconciled, roomId, identity);
          if (existing) {
            reconciled = {
              ...reconciled,
              completedPromptIdsByRoom: { ...reconciled.completedPromptIdsByRoom, [roomId]: [] },
            };
          }
          changed = true;
        }
        next[roomId] = clip;
      }
      if (changed) {
        reconciled = { ...reconciled, updatedAt: new Date().toISOString() };
        persist(reconciled);
      }
      setClips(next);
      setElementClips(nextElements);
      setClipsReadySessionId(expectedSession);
      setUnreadableClipRooms(failedRooms);
      refreshStorageWarning();
    });
    return () => { active = false; };
  }, [record?.sessionId, persist, refreshStorageWarning]);

  useEffect(() => {
    let active = true;
    const previous = objectUrlsRef.current;
    objectUrlsRef.current = [];
    setEvidenceViews([]);
    previous.forEach((url) => URL.revokeObjectURL(url));
    if (!record || clipsReadySessionId !== record.sessionId) {
      return () => { active = false; };
    }

    const expectedSessionId = record.sessionId;
    const urls: string[] = [];
    const nextViews: EvidenceView[] = [];
    const staleByRoom = new Map<MoveInReadyRoomId, Set<string>>();
    const markStale = (reference: EvidenceReference) => {
      const ids = staleByRoom.get(reference.roomId) ?? new Set<string>();
      ids.add(reference.stillId);
      staleByRoom.set(reference.roomId, ids);
    };

    void (async () => {
      for (const reference of allCurrentEvidence(record)) {
        if (unreadableClipRooms.includes(reference.roomId)) continue;
        const fromRoomClip = record.clipIdentities[reference.roomId]?.videoId === reference.videoId;
        const elementId = fromRoomClip
          ? undefined
          : (Object.entries(record.elementClipIdentities ?? {}).find(([, candidate]) => candidate?.videoId === reference.videoId)?.[0] as MoveInReadyElementId | undefined);
        const clip = elementId ? elementClips[elementId] : clips[reference.roomId];
        const expectedClipId = elementId
          ? makeElementClipId(expectedSessionId, elementId)
          : makeVideoClipId(expectedSessionId, reference.roomId);
        if (!fromRoomClip && !elementId) {
          markStale(reference);
          continue;
        }
        if (!clip || clip.id !== expectedClipId) {
          markStale(reference);
          continue;
        }
        const still = await findVerifiedEvidenceStill(clip.stills, reference);
        if (!still) {
          markStale(reference);
          continue;
        }
        if (!active) return;
        const url = URL.createObjectURL(still.blob);
        urls.push(url);
        nextViews.push({ reference, clip, still, src: url });
      }

      if (!active) {
        urls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      objectUrlsRef.current = urls;
      setEvidenceViews(nextViews);

      if (staleByRoom.size > 0) {
        const latest = recordRef.current;
        if (!latest || latest.sessionId !== expectedSessionId) return;
        let invalidated = latest;
        for (const [roomId, staleStillIds] of staleByRoom) {
          const currentIdentity = invalidated.clipIdentities[roomId];
          if (!currentIdentity) continue;
          const hasCurrentStaleEvidence = currentIdentity.evidence.some((reference) =>
            staleStillIds.has(reference.stillId) && isEvidenceCurrent(reference, currentIdentity, invalidated),
          );
          if (!hasCurrentStaleEvidence) continue;
          invalidated = clearRoomAnalysisState(invalidated, roomId);
          const nextIdentity = invalidated.clipIdentities[roomId];
          if (nextIdentity) {
            invalidated = {
              ...invalidated,
              clipIdentities: {
                ...invalidated.clipIdentities,
                [roomId]: {
                  ...nextIdentity,
                  evidence: nextIdentity.evidence.filter((reference) => !staleStillIds.has(reference.stillId)),
                },
              },
            };
          }
          for (const [elementId, elementIdentity] of Object.entries(invalidated.elementClipIdentities ?? {})) {
            if (!elementIdentity || elementIdentity.roomId !== roomId) continue;
            const hasCurrentStaleElementEvidence = elementIdentity.evidence.some((reference) =>
              staleStillIds.has(reference.stillId) && isEvidenceCurrent(reference, elementIdentity, invalidated),
            );
            if (hasCurrentStaleElementEvidence) {
              invalidated = invalidateElementEvidence(invalidated, elementId as MoveInReadyElementId);
            }
          }
        }
        if (invalidated !== latest) {
          persist(invalidated);
          setAnalysisNotice("A saved evidence still failed its integrity check. Review decisions for that room were cleared; reanalyze or replace its clip.");
        }
      }
    })().catch(() => {
      if (!active) return;
      urls.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
      setEvidenceViews([]);
      setAnalysisNotice("Saved evidence could not be verified, so it is hidden until the room is reviewed again.");
    });

    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
      if (objectUrlsRef.current === urls) objectUrlsRef.current = [];
    };
  }, [record, clips, elementClips, clipsReadySessionId, unreadableClipRooms, persist]);

  const rooms = useMemo(() => (record?.roomIds ?? LEGACY_DEFAULT_ROOM_IDS).map((id) => ({
    id,
    label: roomLabel(id),
  })), [record?.roomIds]);
  const roomClips = useMemo(() => rooms.map((room) => ({
    ...room,
    captured: Boolean(clips[room.id]),
  })), [rooms, clips]);
  const capturedRoomCount = roomClips.filter((room) => room.captured).length;
  const capturedRoomIds = useMemo(
    () => roomClips.filter((room) => room.captured).map((room) => room.id),
    [roomClips],
  );
  const currentRecord = record;
  const finalization = useMemo(() => currentRecord
    ? deriveFinalInspectionResult({
        fundingType: currentRecord.fundingType,
        capturedRoomIds,
        expectedRoomIds: currentRecord.roomIds,
        evaluatorDecisions: currentRecord.decisions,
        signoff: currentRecord.signoff,
      })
    : null, [currentRecord, capturedRoomIds]);
  const reviewCounts = useMemo(() => getReviewCounts(currentRecord?.decisions), [currentRecord?.decisions]);
  const hasAnyProposals = MOVE_IN_READY_ELEMENTS.some((element) => Boolean(currentRecord?.proposals[element.id]));
  const nextUndecidedElement = MOVE_IN_READY_ELEMENTS.find(
    (element) => currentRecord?.decisions[element.id]?.status === "unreviewed",
  ) ?? null;
  const hasInspectionProgress = Boolean(
    currentRecord && (
      currentRecord.pseudonym.trim() ||
      currentRecord.fundingType !== "unknown" ||
      Object.keys(currentRecord.clipIdentities).length > 0 ||
      Object.keys(currentRecord.proposals).length > 0 ||
      reviewCounts.resolved > 0 ||
      currentRecord.signoff
    ));
  const nextRoomToFilm = roomClips.find((room) => !room.captured) ?? null;
  const activeReviewIndex = activeElementId ? MOVE_IN_READY_ELEMENT_IDS.indexOf(activeElementId) : -1;
  const form1083Blocker = currentRecord ? form1083AdministrativeBlocker(currentRecord) : null;
  const canSignOff = Boolean(
    currentRecord?.fundingType === "lahsa" &&
    currentRecord?.evaluatorName.trim() &&
    !form1083Blocker &&
    (finalization?.status === "signoff-required" || finalization?.status === "complete"),
  );
  // Dual attestation (REQ-F1): the participant signs once rooms, decisions,
  // and Form 1083 details are complete — in either order relative to the
  // evaluator. Exports require both signatures.
  const canParticipantSign = Boolean(
    currentRecord?.fundingType === "lahsa" &&
    !form1083Blocker &&
    (finalization?.status === "signoff-required" || finalization?.status === "complete"),
  );
  const completedResult = currentRecord?.fundingType === "lahsa" && finalization?.status === "complete" && !form1083Blocker ? finalization.result : null;
  const participantSigned = currentRecord?.participantSignoff?.attested === true;
  const canCapture = isCaptureSetupComplete(currentRecord);
  const tourAnalysisComplete = useMemo(() => {
    if (!currentRecord) return false;
    return currentRecord.roomIds.every((roomId) => {
      const identity = currentRecord.clipIdentities[roomId];
      if (!identity) return true;
      return Object.values(currentRecord.proposals).some((proposal) =>
        Boolean(proposal) &&
        proposal!.analysisIdentity.roomId === roomId &&
        proposal!.analysisIdentity.videoId === identity.videoId &&
        proposal!.analysisIdentity.videoRevision === identity.videoRevision);
    });
  }, [currentRecord]);
  const guideModel = useMemo(() => deriveGuideModel({
    fundingType: currentRecord?.fundingType === "hud" ? "hud" : currentRecord?.fundingType === "lahsa" ? "lahsa" : "unknown",
    canCapture: isCaptureSetupComplete(currentRecord),
    pseudonym: currentRecord?.pseudonym ?? "",
    rooms: roomClips.map((room) => ({ id: room.id, label: room.label, captured: room.captured })),
    resolvedDecisions: reviewCounts.resolved,
    totalElements: MOVE_IN_READY_ELEMENTS.length,
    signed: Boolean(completedResult && currentRecord?.signoff),
  }), [currentRecord, canCapture, roomClips, reviewCounts.resolved, completedResult]);
  const profileSectionReady = {
    unit: Boolean(currentRecord?.pseudonym.trim() && currentRecord.fundingType !== "unknown" && currentRecord.unitType !== ""),
    evaluator: Boolean(currentRecord?.evaluatorName.trim() && currentRecord.evaluatorAgencyName.trim()),
    agency: Boolean(
      currentRecord?.landlordDiscussion &&
      (currentRecord.landlordDiscussion !== "yes" || currentRecord.landlordDiscussionDate) &&
      (!currentRecord.leadershipSignoffRequired || (
        currentRecord.leadershipNameAndTitle.trim() &&
        currentRecord.leadershipSignoff.trim() &&
        currentRecord.leadershipSignedAt
      )),
    ),
  };
  const pendingAnalysisIntent = currentRecord?.pendingAnalysisIntent ?? null;
  const pendingForSelectedRoom = pendingAnalysisIntent?.roomId === selectedRoomId &&
    pendingAnalysisIntent.schemaVersion === currentRecord?.schemaVersion &&
    pendingAnalysisIntent.schemaVersion === MOVE_IN_READY_SCHEMA_VERSION &&
    pendingAnalysisIntent.catalogVersion === currentRecord?.catalogVersion &&
    pendingAnalysisIntent.catalogVersion === CATALOG_VERSION &&
    currentRecord?.schemaVersion === MOVE_IN_READY_SCHEMA_VERSION &&
    currentRecord?.catalogVersion === CATALOG_VERSION &&
    currentRecord?.clipIdentities[selectedRoomId]?.schemaVersion === pendingAnalysisIntent.schemaVersion &&
    currentRecord?.clipIdentities[selectedRoomId]?.catalogVersion === pendingAnalysisIntent.catalogVersion &&
    pendingAnalysisIntent.videoId === currentRecord?.clipIdentities[selectedRoomId]?.videoId &&
    pendingAnalysisIntent.videoRevision === currentRecord?.clipIdentities[selectedRoomId]?.videoRevision &&
    pendingAnalysisIntent.videoHash === currentRecord?.clipIdentities[selectedRoomId]?.videoHash
    ? pendingAnalysisIntent
    : null;
  const selectedConsentKey = clipConsentKey(currentRecord, selectedRoomId);
  const mockUnitAttested = Boolean(selectedConsentKey && mockUnitAttestationKey === selectedConsentKey);
  const sendVideoConsent = Boolean(selectedConsentKey && sendVideoConsentKey === selectedConsentKey);
  const installAffordance: InstallAffordance = getInstallAffordance({
    standalone: isInstalled,
    deferredPromptAvailable: hasInstallPrompt,
    platform: installPlatform,
  });

  useEffect(() => {
    const syncInstallState = () => {
      setInstallPlatform(detectInstallPlatform());
      setIsInstalled(isStandaloneDisplay());
    };
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      installPromptRef.current.capture(event as unknown as Parameters<DeferredInstallPrompt["capture"]>[0]);
      setHasInstallPrompt(true);
      setInstallNotice("");
    };
    const handleInstalled = () => {
      installPromptRef.current.take();
      setHasInstallPrompt(false);
      setIsInstalled(true);
      setInstallHelpOpen(false);
      setInstallNotice("Walkthrough is installed on this device.");
    };
    syncInstallState();
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 960px)");
    const syncWideLayout = () => setIsWideLayout(media.matches);
    syncWideLayout();
    media.addEventListener("change", syncWideLayout);
    return () => media.removeEventListener("change", syncWideLayout);
  }, []);

  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    window.requestAnimationFrame(() => stepHeadingRef.current?.focus({ preventScroll: true }));
  }, [step]);

  useEffect(() => {
    if (step === "home" && !booting) void refreshInspectionList();
  }, [step, booting, refreshInspectionList]);

  // Batch AI analysis driver: one explicit user action runs the same guarded
  // per-room analyzeRoomFor() for every queued room, up to
  // MAX_CONCURRENT_BATCH_ROOMS at once (Sprint 0 REQ-S2). Each room still
  // passes the full consent/identity guards; success is proven by a
  // persisted proposal bound to the room's current clip, not by status
  // text. The pool runs on the capture and guided steps; leaving them
  // pauses launching (finished rooms kept, queue preserved) until return.
  useEffect(() => {
    if (!batchActive) return;
    if (step !== "capture" && step !== "guided") return;
    if (!online && !batchStopReasonRef.current) {
      batchStopReasonRef.current = "offline";
      batchCancelRef.current = true;
      invalidateActiveAnalysis("Batch AI analysis stopped: the connection dropped. Reconnect and run it again; finished rooms are kept.");
      return;
    }
    if (batchRunRef.current) return;
    const session = batchSessionRef.current;
    const activeLabels = new Map<MoveInReadyRoomId, string>();
    let lastSettledLabel = "";
    const updateProgress = () => {
      setBatchProgress({
        done: batchSettledRef.current,
        total: Math.max(batchTotalRef.current, batchSettledRef.current),
        roomLabel: [...activeLabels.values()].join(" + ") || lastSettledLabel,
        startedAt: batchStartedAtRef.current,
      });
    };
    const runRoom = async (roomId: MoveInReadyRoomId): Promise<boolean> => {
      if (!batchAttestedRef.current || !batchSendConsentRef.current) {
        batchStopReasonRef.current = "consent";
        batchCancelRef.current = true;
        return false;
      }
      if (roomHasCurrentProposal(roomId)) return true;
      if (!clipConsentKey(recordRef.current, roomId)) return false;
      const identity = recordRef.current?.clipIdentities[roomId] ?? null;
      const expectedVideoId = identity?.videoId ?? "";
      batchRoomsInFlightRef.current.add(roomId);
      activeLabels.set(roomId, roomLabel(roomId));
      updateProgress();
      try {
        await analyzeRoomFor(roomId, { fromBatch: true });
      } finally {
        batchRoomsInFlightRef.current.delete(roomId);
        analysisInFlightRef.current.delete(roomId);
        activeLabels.delete(roomId);
        lastSettledLabel = roomLabel(roomId);
      }
      const latest = recordRef.current;
      return Boolean(latest && expectedVideoId &&
        Object.values(latest.proposals).some((proposal) =>
          Boolean(proposal) && proposal!.analysisIdentity.roomId === roomId && proposal!.analysisIdentity.videoId === expectedVideoId));
    };
    const pool = runRoomBatch({
      queue: batchQueueRef.current,
      maxConcurrent: MAX_CONCURRENT_BATCH_ROOMS,
      shouldStop: () => batchCancelRef.current || !onlineRef.current ||
        (stepRef.current !== "capture" && stepRef.current !== "guided"),
      runRoom,
      onRoomSettled: (roomId, proved) => {
        if (session !== batchSessionRef.current) return;
        batchSettledRef.current += 1;
        lastSettledLabel = roomLabel(roomId);
        updateProgress();
        if (!proved) {
          batchFailedRef.current.push(roomLabel(roomId));
          setBatchFailedRooms((previous) => [...previous, roomLabel(roomId)]);
        }
      },
    });
    batchRunRef.current = pool;
    void pool.then(() => {
      if (batchRunRef.current === pool) batchRunRef.current = null;
      if (session !== batchSessionRef.current) return;
      if (batchQueueRef.current.size > 0 && !batchCancelRef.current && !batchStopReasonRef.current) return;
      const failed = [...batchFailedRef.current];
      batchQueueRef.current.clear();
      batchTotalRef.current = 0;
      batchSettledRef.current = 0;
      setBatchActive(false);
      setBatchProgress(null);
      const reason = batchStopReasonRef.current;
      if (reason === "offline") return;
      if (reason === "consent") {
        setAnalysisNotice("Batch AI analysis stopped because its consent was withdrawn. No further room was sent.");
        return;
      }
      if (failed.length === 0) {
        setAnalysisNotice("AI finished every filmed room. Confirm each requirement below.");
        // Auto-started batches overlap filming (REQ-S5/REQ-L2): only take
        // the evaluator to the report once every room is filmed, so a
        // finished partial batch never yanks capture out from under them.
        const latest = recordRef.current;
        const filmingComplete = Boolean(latest) && latest!.roomIds.length > 0 &&
          latest!.roomIds.every((roomId) => Boolean(latest!.clipIdentities[roomId]));
        if (stepRef.current === "capture" && filmingComplete) changeStep("review");
      } else {
        setAnalysisNotice(`AI finished with ${failed.length} room${failed.length === 1 ? "" : "s"} needing attention: ${failed.join(", ")}. Run batch analysis again to retry only those rooms.`);
      }
    });
  });

  // Tick the batch elapsed timer and hold a screen wake lock while the
  // batch runs: on phones a sleeping screen can stall the long uploads,
  // and a frozen "Working" line reads as a hang.
  useEffect(() => {
    if (!batchActive) return;
    const timer = window.setInterval(() => setBatchTick((tick) => tick + 1), 1000);
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const holder = navigator as Navigator & { wakeLock?: { request: (kind: "screen") => Promise<{ release: () => Promise<void> }> } };
        const requested = await holder.wakeLock?.request("screen");
        if (cancelled) await requested?.release().catch(() => {});
        else lock = requested ?? null;
      } catch {
        lock = null;
      }
    })();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      lock?.release().catch(() => {});
    };
  }, [batchActive]);

  // Auto-run the AI batch once every room is filmed and the walkthrough
  // consent was confirmed upfront. One user decision covers the run; each
  // room still passes the full per-room consent/identity guards inside the
  // batch driver, and MOV-only or already-analyzed rooms are skipped.
  useEffect(() => {
    if (!walkthroughAttested || !walkthroughSendConsent) return;
    if (batchActive || batchAutoStartedRef.current) return;
    if (analysisMode !== "live" || !online) return;
    if (capturedRoomCount < rooms.length) return;
    const current = recordRef.current;
    if (!current || current.fundingType !== "lahsa" || !current.pseudonym.trim()) return;
    const needsWork = rooms.some((room) =>
      clips[room.id] && clips[room.id]?.mime !== "video/quicktime" && !roomHasCurrentProposal(room.id));
    if (!needsWork) return;
    setBatchAttested(true);
    setBatchSendConsent(true);
    // startBatchAnalysis consumes the auto-start itself, and only when a
    // run actually starts — an early return leaves it armed for later.
    startBatchAnalysis();
  });

  // Offline analysis queue runner (REQ-L2): clip saves persist room ids on
  // the record; when the browser is back online this starts the batch once
  // per queue state. It runs only under an existing consent basis — the
  // hands-free walkthrough consent or the manual batch disclosure — and the
  // batch driver still enforces its per-room consent/identity guards.
  // Mirrors REQ-S5's failure guard: a finished failed batch never
  // auto-restarts — retry stays an explicit manual action.
  // Concurrency stays with the batch driver — Sprint 0 raises it to 2 rooms;
  // this sprint only triggers it and never reimplements the scheduler.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void queueWakeTick;
    if (!online || analysisMode !== "live") return;
    if (batchActive) return;
    if (analysisStatus === "segmenting" || analysisStatus === "mapping") return;
    if (batchFailedRooms.length > 0) return;
    const walkthroughConsented = walkthroughAttested && walkthroughSendConsent;
    if (!walkthroughConsented && !(batchAttested && batchSendConsent)) return;
    const current = recordRef.current;
    if (!current || current.fundingType !== "lahsa" || !current.pseudonym.trim()) return;
    const queued = (current.analysisQueue ?? []).filter((roomId) =>
      clips[roomId] && clips[roomId]?.mime !== "video/quicktime" && !roomHasCurrentProposal(roomId));
    if (queued.length === 0) return;
    const key = `${current.sessionId}:${queued.join(",")}`;
    if (queueRunnerKeyRef.current === key) return;
    queueRunnerKeyRef.current = key;
    if (walkthroughConsented) {
      setBatchAttested(true);
      setBatchSendConsent(true);
    }
    startBatchAnalysis();
  });

  // Step through the filming script on timed cues while a take is
  // recording. The cue index always advances and the current cue captions
  // on the viewport; spoken narration lives in the guided tour.
  useEffect(() => {
    if (!recordingInProgress) return;
    const cues = filmingScriptForRoom(selectedRoomId);
    const timers = cues.map((_, index) =>
      window.setTimeout(() => {
        setRecordingCueIndex(index);
      }, 800 + index * 7000));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      setRecordingCueIndex(-1);
    };
  }, [recordingInProgress, selectedRoomId]);

  // Dashboard: when a clip lands, bring the yes/no checks into view under
  // the pinned viewport. Fires only on the null-to-clip transition.
  useEffect(() => {
    const clip = clips[selectedRoomId] ?? null;
    const had = prevClipRef.current !== null;
    prevClipRef.current = clip;
    if (!clip || had || step !== "capture") return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("room-checks")?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
    });
  }, [clips, selectedRoomId, step]);

  const roomHasCurrentProposal = useCallback((roomId: MoveInReadyRoomId): boolean => {
    const current = recordRef.current;
    const identity = current?.clipIdentities[roomId];
    if (!current || !identity) return false;
    return Object.values(current.proposals).some((proposal) =>
      Boolean(proposal) &&
      proposal!.analysisIdentity.roomId === roomId &&
      proposal!.analysisIdentity.videoId === identity.videoId &&
      proposal!.analysisIdentity.videoRevision === identity.videoRevision);
  }, []);

  /**
   * Initialize one batch run over the rooms already placed in
   * batchQueueRef (Sprint 0 REQ-S2/REQ-S5). The driver effect launches
   * the pool; bumping the session retires any stale pool callbacks.
   */
  const beginBatchRun = useCallback((total: number, clearMessages: boolean) => {
    batchTotalRef.current = total;
    batchSettledRef.current = 0;
    batchStartedAtRef.current = Date.now();
    batchFailedRef.current = [];
    batchCancelRef.current = false;
    batchStopReasonRef.current = null;
    batchRoomsInFlightRef.current.clear();
    batchRunRef.current = null;
    batchSessionRef.current += 1;
    setBatchFailedRooms([]);
    setBatchProgress({ done: 0, total, roomLabel: "", startedAt: batchStartedAtRef.current });
    if (clearMessages) {
      setAnalysisError("");
      setAnalysisNotice("");
    }
    setBatchActive(true);
  }, []);

  const handleClipChange = useCallback(async (clip: StoredVideoClip | null, roomIdValue: string) => {
    if (!isMoveInReadyRoomId(roomIdValue)) return;
    const roomId = roomIdValue;
    const operation = (clipChangeGenerationRef.current[roomId] ?? 0) + 1;
    clipChangeGenerationRef.current[roomId] = operation;
    const activeRecord = recordRef.current;
    if (!activeRecord) return;
    if (!clip) {
      const oldIdentity = activeRecord.clipIdentities[roomId];
      setClips((previous) => {
        const next = { ...previous };
        delete next[roomId];
        return next;
      });
      const hadPromptProgress = (activeRecord.completedPromptIdsByRoom[roomId] ?? []).length > 0;
      if (!oldIdentity && !hadPromptProgress) return;
      if (oldIdentity) invalidateRoomAnalysis(roomId, "The room clip was removed. Any decisions based on it were cleared.");
      const invalidated = oldIdentity ? invalidateRoomEvidence(activeRecord, roomId, null) : activeRecord;
      const next = {
        ...invalidated,
        completedPromptIdsByRoom: { ...invalidated.completedPromptIdsByRoom, [roomId]: [] },
        analysisQueue: dequeueAnalysisQueue(invalidated.analysisQueue ?? [], roomId),
      };
      persist(next);
      setMockUnitAttestationKey(null);
      setSendVideoConsentKey(null);
      setAnalysisExpanded(false);
      return;
    }
    try {
      const videoHash = await sha256Blob(clip.video);
      if (clip.sourceSha256 !== videoHash) throw new Error("The saved room clip failed its local integrity check.");
      if (clipChangeGenerationRef.current[roomId] !== operation || recordRef.current?.sessionId !== clip.sessionId) return;
      const latestStored = await videoStoreRef.current?.get(clip.sessionId, roomId);
      if (!latestStored || latestStored.sourceSha256 !== videoHash || latestStored.capturedAt !== clip.capturedAt || latestStored.sizeBytes !== clip.sizeBytes || await sha256Blob(latestStored.video) !== videoHash) return;
      if (clipChangeGenerationRef.current[roomId] !== operation || recordRef.current?.sessionId !== clip.sessionId) return;
      const current = recordRef.current;
      if (!current) return;
      const existing = current.clipIdentities[roomId];
      if (existing?.videoHash === videoHash && existing.sizeBytes === clip.sizeBytes && existing.capturedAt === clip.capturedAt) {
        setClips((previous) => ({ ...previous, [roomId]: latestStored }));
        return;
      }
      invalidateRoomAnalysis(roomId, "A room clip changed. Prior proposals and decisions tied to that clip were cleared.");
      const videoId = makeId("video");
      const videoRevision = (existing?.videoRevision ?? 0) + 1;
      const evidence: EvidenceReference[] = [];
      for (const still of latestStored.stills.slice(0, MAX_ROOM_EVIDENCE_STILLS)) {
        const timestampMs = Math.round(still.timestampSeconds * 1000);
        if (!Number.isSafeInteger(timestampMs) || timestampMs < 0 || timestampMs >= latestStored.durationSeconds * 1000) {
          throw new Error("A locally extracted source still falls outside the saved room clip.");
        }
        const stillHash = await sha256Blob(still.blob);
        if (clipChangeGenerationRef.current[roomId] !== operation || recordRef.current?.sessionId !== clip.sessionId) return;
        evidence.push({
          schemaVersion: activeRecord.schemaVersion,
          catalogVersion: activeRecord.catalogVersion,
          videoId,
          videoRevision,
          roomId,
          stillId: `s-${videoId}-${timestampMs}-${stillHash.slice(0, 8)}`,
          timestampMs,
          frameIndex: null,
          stillHash,
        });
      }
      if (clipChangeGenerationRef.current[roomId] !== operation || recordRef.current?.sessionId !== clip.sessionId) return;
      const stillsVerified = await videoStoreRef.current?.get(clip.sessionId, roomId);
      if (!stillsVerified || !sameStoredClipSource(latestStored, stillsVerified) ||
          stillsVerified.sourceSha256 !== videoHash || await sha256Blob(stillsVerified.video) !== videoHash) return;
      const identity: StoredRoomClipIdentity = {
        roomId,
        schemaVersion: current.schemaVersion,
        catalogVersion: current.catalogVersion,
        videoId,
        videoRevision,
        videoHash,
        capturedAt: clip.capturedAt,
        durationSeconds: clip.durationSeconds,
        sizeBytes: clip.sizeBytes,
        evidence,
      };
      const invalidated = invalidateRoomEvidence(current, roomId, identity);
      persist({
        ...invalidated,
        // REQ-L2: every clip save enqueues the room (saved clips always need
        // analysis; the queue runner gates the actual run on connectivity).
        analysisQueue: enqueueAnalysisQueue(invalidated.analysisQueue ?? [], roomId),
        ...(existing ? {
          completedPromptIdsByRoom: { ...invalidated.completedPromptIdsByRoom, [roomId]: [] },
        } : {}),
      });
      setClips((previous) => ({ ...previous, [roomId]: latestStored }));
      if (existing) {
        setMockUnitAttestationKey(null);
        setSendVideoConsentKey(null);
      }
      setAnalysisExpanded(false);
      refreshStorageWarning();
      setAnalysisStatus("idle");
      // Analyze on save (Sprint 0 REQ-S5): with tour consent, batch
      // consent, LAHSA funding, live mode, and a connection, enqueue
      // this room immediately so filming overlaps analysis. Skipped
      // while a manual analysis runs, while unresolved batch failures
      // await explicit review, and for MOV clips the server rejects.
      // Offline at save time: do nothing (Sprint 3 persists the queue).
      const saved = recordRef.current;
      if (shouldAutoEnqueueOnSave({
        walkthroughAttested,
        walkthroughSendConsent,
        batchAttested,
        batchSendConsent,
        analysisMode,
        online,
        manualPipelineInFlight: analysisStatus === "segmenting" || analysisStatus === "mapping",
        hasUnresolvedBatchFailures: batchFailedRooms.length > 0,
        mime: latestStored.mime,
        sessionMatches: saved != null && saved.sessionId === clip.sessionId,
        fundingType: saved?.fundingType ?? "",
        hasCurrentProposal: roomHasCurrentProposal(roomId),
        queuedInBatch: batchQueueRef.current.has(roomId),
        analysisInFlight: analysisInFlightRef.current.has(roomId),
      })) {
        if (!batchActive) {
          batchQueueRef.current = createRoomBatchQueue([roomId]);
          beginBatchRun(1, false);
        } else if (batchQueueRef.current.enqueue(roomId)) {
          batchTotalRef.current += 1;
        }
      }
    } catch (error) {
      setAnalysisError(safeClientError(error, "This browser could not securely identify the video bytes. The clip is saved locally, but live analysis is unavailable."));
    }
  }, [invalidateRoomAnalysis, persist, refreshStorageWarning, roomHasCurrentProposal, beginBatchRun, walkthroughAttested, walkthroughSendConsent, batchAttested, batchSendConsent, batchActive, batchFailedRooms, online, analysisMode, analysisStatus]);

  function scrollMainToTop(behavior: ScrollBehavior = "auto"): void {
    window.requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 719px)").matches) {
        mainScrollRef.current?.scrollTo({ top: 0, behavior });
      } else {
        window.scrollTo({ top: 0, behavior });
      }
    });
  }

  function changeStep(next: Step): void {
    if (analysisStatus === "segmenting" || analysisStatus === "mapping") {
      invalidateActiveAnalysis("Analysis was cancelled before you changed screens.");
    }
    setStep(next);
    if (next === "review") {
      setMobileReviewDetailOpen(false);
      setReviewNoteOpen(false);
    }
    setReviewError("");
    scrollMainToTop();
  }

  function selectRoom(roomId: string): void {
    if (!isMoveInReadyRoomId(roomId)) return;
    // Only a manual pipeline for the previously selected room is bound
    // to the selection; background batch pipelines keep analyzing.
    const manualInFlight = analysisInFlightRef.current.has(selectedRoomId) &&
      !batchRoomsInFlightRef.current.has(selectedRoomId);
    if (manualInFlight) {
      invalidateRoomAnalysis(selectedRoomId, "Analysis was cancelled because the selected room changed.");
    }
    setSelectedRoomId(roomId);
    setClipDetailsExpanded(false);
    setAnalysisExpanded(false);
    setMockUnitAttestationKey(null);
    setSendVideoConsentKey(null);
    updateRecord((current) => ({ ...current, selectedRoomId: roomId }));
    setAnalysisError("");
  }

  function startBatchAnalysis(): void {
    if (batchActive || analysisStatus === "segmenting" || analysisStatus === "mapping") return;
    const current = recordRef.current;
    if (!current) return;
    const queued = batchQueueRef.current.snapshot();
    // Manual Analyze covers only rooms not yet analyzed, queued, or in
    // flight (Sprint 0 REQ-S5): analyze-on-save may own some already.
    const rooms = current.roomIds
      .filter((roomId) => clips[roomId] && clips[roomId]?.mime !== "video/quicktime" &&
        !roomHasCurrentProposal(roomId) && !queued.includes(roomId) &&
        !analysisInFlightRef.current.has(roomId));
    if (rooms.length === 0) return;
    // Any batch start consumes the walkthrough auto-start: a finished batch
    // must never auto-restart itself, no matter which surface started it.
    batchAutoStartedRef.current = true;
    batchQueueRef.current = createRoomBatchQueue(rooms);
    beginBatchRun(rooms.length, true);
  }

  function cancelBatchAnalysis(): void {
    if (!batchActive) return;
    batchQueueRef.current.clear();
    batchCancelRef.current = true;
    batchSessionRef.current += 1;
    const inFlightLabels = [...batchRoomsInFlightRef.current].map((roomId) => roomLabel(roomId));
    if (inFlightLabels.length > 0) {
      batchFailedRef.current.push(...inFlightLabels);
      setBatchFailedRooms((previous) => [...previous, ...inFlightLabels]);
    }
    setBatchActive(false);
    setBatchProgress(null);
    invalidateActiveAnalysis();
    setAnalysisNotice("Batch AI analysis was cancelled. Finished rooms keep their drafts.");
  }

  function openProfileForRequiredDetails(): void {
    const section: ProfileSection = !profileSectionReady.unit
      ? "unit"
      : !profileSectionReady.evaluator
        ? "evaluator"
        : "agency";
    setProfileSection(section);
    changeStep("profile");
  }

  function openReviewElement(elementId: MoveInReadyElementId): void {
    setActiveElementId(elementId);
    setMobileReviewDetailOpen(true);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`review-element-${elementId}`);
      if (window.matchMedia("(max-width: 719px)").matches) {
        mainScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      target?.focus({ preventScroll: true });
    });
  }

  function returnToReviewOverview(): void {
    setMobileReviewDetailOpen(false);
    setActiveElementId(null);
    scrollMainToTop("smooth");
  }

  async function queueAnalysisForReconnect(): Promise<void> {
    const current = recordRef.current;
    const roomId = selectedRoomId;
    if (!current || online) return;
    if (analysisMode !== "live") {
      setAnalysisError(analysisMode === "fixture"
        ? "Live video analysis is disabled in fixture mode. No sample result will be substituted."
        : "Live Meta analysis is turned off on this server. No request was sent.");
      return;
    }
    if (current.fundingType !== "lahsa" || !current.pseudonym.trim()) {
      setAnalysisError("Choose the LAHSA path and enter a unit pseudonym before analysis.");
      return;
    }
    const currentConsentKey = clipConsentKey(current, roomId);
    if (!currentConsentKey || mockUnitAttestationKey !== currentConsentKey || sendVideoConsentKey !== currentConsentKey) {
      setAnalysisError("Confirm this staged mock-unit clip and its temporary server/Meta processing notice before queuing it.");
      return;
    }
    const localClip = clips[roomId];
    const clipIdentity = current.clipIdentities[roomId];
    const store = videoStoreRef.current;
    if (!localClip || !clipIdentity || !store) {
      setAnalysisError("Save and verify this room’s clip before queuing analysis.");
      return;
    }
    if (current.schemaVersion !== MOVE_IN_READY_SCHEMA_VERSION || current.catalogVersion !== CATALOG_VERSION ||
        clipIdentity.schemaVersion !== current.schemaVersion || clipIdentity.catalogVersion !== current.catalogVersion) {
      setAnalysisError("This saved clip belongs to an older walkthrough version. Reopen it while connected before queuing analysis.");
      return;
    }
    setAnalysisError("");
    try {
      const expectedSessionId = current.sessionId;
      const expectedVideoId = clipIdentity.videoId;
      const expectedRevision = clipIdentity.videoRevision;
      const expectedHash = clipIdentity.videoHash;
      const digest = await sha256Blob(localClip.video);
      if (digest !== expectedHash || localClip.sourceSha256 !== expectedHash) {
        throw new Error("The saved room clip changed. Select it again before queuing analysis.");
      }
      const savedClip = await store.get(expectedSessionId, roomId);
      if (!savedClip || !sameStoredClipSource(localClip, savedClip) ||
          savedClip.sourceSha256 !== expectedHash || await sha256Blob(savedClip.video) !== expectedHash) {
        throw new Error("The saved room clip changed. Select it again before queuing analysis.");
      }
      const latest = recordRef.current;
      const latestIdentity = latest?.clipIdentities[roomId];
      if (!latest || latest.sessionId !== expectedSessionId || latest.selectedRoomId !== roomId ||
          latestIdentity?.videoId !== expectedVideoId || latestIdentity.videoRevision !== expectedRevision ||
          latestIdentity.videoHash !== expectedHash) return;
      const verifiedConsentKey = clipConsentKey(latest, roomId);
      if (!verifiedConsentKey || mockUnitAttestationKey !== verifiedConsentKey || sendVideoConsentKey !== verifiedConsentKey) {
        throw new Error("Clip authorization changed before the offline request could be queued.");
      }
      const pending: PendingAnalysisIntent = {
        roomId,
        schemaVersion: current.schemaVersion,
        videoId: expectedVideoId,
        videoRevision: expectedRevision,
        videoHash: expectedHash,
        catalogVersion: current.catalogVersion,
        requestedAt: new Date().toISOString(),
      };
      const queued = { ...latest, updatedAt: pending.requestedAt, pendingAnalysisIntent: pending };
      const inspectionStore = inspectionStoreRef.current;
      if (!inspectionStore) throw new Error("Local inspection storage is unavailable.");
      recordRef.current = queued;
      setRecord(queued);
      await inspectionStore.put(queued);
      if (recordRef.current !== queued) return;
      refreshStorageWarning();
      setAnalysisNotice("Analysis is queued for this room. Your clip stays on this device; reconnect, then tap Retry analysis.");
      setAnalysisStatus("idle");
    } catch (error) {
      setAnalysisError(safeClientError(error, "This room could not be queued for connected analysis."));
    }
  }

  async function analyzeRoomFor(targetRoomId: MoveInReadyRoomId, options: { fromBatch?: boolean } = {}): Promise<void> {
    const { fromBatch = false } = options;
    // Batch pipelines bind the full media identity but not the UI
    // selection, so two rooms analyze at once (Sprint 0 REQ-S2).
    const requireSelectedRoom = !fromBatch;
    if (!fromBatch && (analysisStatus === "segmenting" || analysisStatus === "mapping")) return;
    if (!fromBatch && batchActive) {
      setAnalysisError("Batch AI analysis is running. Wait for it to finish or cancel the batch before a manual run.");
      setAnalysisStatus("error");
      return;
    }
    if (analysisInFlightRef.current.has(targetRoomId)) return;
    const roomId = targetRoomId;
    const generation = (analysisGenerationRef.current[roomId] ?? 0) + 1;
    analysisGenerationRef.current[roomId] = generation;
    analysisControllersRef.current[roomId]?.abort();
    analysisInFlightRef.current.add(roomId);
    const controller = new AbortController();
    const current = recordRef.current;
    if (!current) return;
    if (clips[roomId]?.mime === "video/quicktime") {
      setAnalysisError("Meta's current video upload API accepts MP4 only. This MOV stays on this device for manual review; choose or record an MP4 for live analysis.");
      setAnalysisStatus("error");
      return;
    }
    const expectedSessionId = current.sessionId;
    let intentIdentity = current.clipIdentities[roomId] ?? null;
    const consentIsCurrent = () => {
      // Two batch rooms cannot share the single-room consent keys, so
      // batch pipelines re-check the run-level batch consent instead.
      if (fromBatch) return batchAttestedRef.current && batchSendConsentRef.current;
      const key = clipConsentKey(recordRef.current, roomId);
      return Boolean(key && mockUnitAttestationKey === key && sendVideoConsentKey === key);
    };
    const intentIsCurrent = () => {
      const latest = recordRef.current;
      return !controller.signal.aborted &&
        generation === (analysisGenerationRef.current[roomId] ?? 0) &&
        latest?.sessionId === expectedSessionId &&
        latest.schemaVersion === MOVE_IN_READY_SCHEMA_VERSION &&
        latest.catalogVersion === CATALOG_VERSION &&
        (requireSelectedRoom ? latest.selectedRoomId === roomId : true) &&
        intentIdentity !== null &&
        intentIdentity.schemaVersion === latest.schemaVersion &&
        intentIdentity.catalogVersion === latest.catalogVersion &&
        sameRoomClipIdentity(intentIdentity, latest.clipIdentities[roomId] ?? null) &&
        consentIsCurrent();
    };
    if (analysisMode !== "live") {
      setAnalysisError(analysisMode === "fixture"
        ? "Live video analysis is disabled in fixture mode. No sample result will be substituted."
        : "Live Meta analysis is turned off on this server. No request was sent.");
      setAnalysisStatus("error");
      return;
    }
    if (current.fundingType !== "lahsa" || !current.pseudonym.trim()) {
      setAnalysisError("Choose the LAHSA path and enter a unit pseudonym before analysis.");
      setAnalysisStatus("error");
      return;
    }
    if (fromBatch) {
      if (!batchAttestedRef.current || !batchSendConsentRef.current) {
        setAnalysisError("Batch AI analysis stopped because its consent was withdrawn. No further room was sent.");
        setAnalysisStatus("error");
        return;
      }
    } else {
      const currentConsentKey = clipConsentKey(current, roomId);
      if (!currentConsentKey || mockUnitAttestationKey !== currentConsentKey || sendVideoConsentKey !== currentConsentKey) {
        setAnalysisError("Confirm this staged mock-unit clip and its temporary server/Meta processing notice before sending it.");
        setAnalysisStatus("error");
        return;
      }
    }
    if (!online) {
      await queueAnalysisForReconnect();
      return;
    }
    const store = videoStoreRef.current;
    if (!store) {
      setAnalysisError("Local video storage is unavailable.");
      setAnalysisStatus("error");
      return;
    }
    analysisControllersRef.current[roomId] = controller;
    setAnalysisError("");
    setAnalysisNotice("");
    setAnalysisStatus("segmenting");
    let identity: StoredRoomClipIdentity | null = intentIdentity;
    let clip: StoredVideoClip | null = null;
    try {
      clip = await store.get(expectedSessionId, roomId);
      if (!intentIsCurrent()) return;
      if (!clip) throw new Error("Record or choose a video for this room first.");

      const digest = await sha256Blob(clip.video);
      if (!intentIsCurrent()) return;
      if (clip.sourceSha256 !== digest) throw new Error("The saved room clip failed its local integrity check. No request was sent.");

      // The React clip state can lag IndexedDB during replacement/removal. Read
      // the row again after hashing, then rehash that exact stored blob before
      // any provider request can be constructed.
      const latestClip = await store.get(expectedSessionId, roomId);
      if (!intentIsCurrent()) return;
      if (!latestClip || !sameStoredClipSource(clip, latestClip) || latestClip.sourceSha256 !== digest) {
        throw new Error("The room clip changed while it was being prepared. Reload it and start a new analysis.");
      }
      const latestDigest = await sha256Blob(latestClip.video);
      if (!intentIsCurrent()) return;
      if (latestDigest !== digest) throw new Error("The room clip changed while it was being prepared. No request was sent.");
      clip = latestClip;

      const latestRecord = recordRef.current;
      if (!latestRecord || latestRecord.sessionId !== expectedSessionId) return;
      identity = latestRecord.clipIdentities[roomId] ?? null;
      if (!identity || identity.schemaVersion !== latestRecord.schemaVersion ||
          identity.catalogVersion !== latestRecord.catalogVersion || identity.videoHash !== digest ||
          identity.sizeBytes !== clip.sizeBytes || identity.capturedAt !== clip.capturedAt) {
        const nextIdentity: StoredRoomClipIdentity = {
          roomId,
          schemaVersion: latestRecord.schemaVersion,
          catalogVersion: latestRecord.catalogVersion,
          videoId: makeId("video"),
          videoRevision: (identity?.videoRevision ?? 0) + 1,
          videoHash: digest,
          capturedAt: clip.capturedAt,
          durationSeconds: clip.durationSeconds,
          sizeBytes: clip.sizeBytes,
          evidence: [],
        };
        intentIdentity = nextIdentity;
        persist(invalidateRoomEvidence(latestRecord, roomId, nextIdentity));
        identity = nextIdentity;
      }
      if (!intentIsCurrent()) return;
    } catch (error) {
      if (!intentIsCurrent()) return;
      setAnalysisError(safeClientError(error, "Could not open this room’s saved clip."));
      setAnalysisStatus("error");
      if (generation === (analysisGenerationRef.current[roomId] ?? 0) &&
          analysisControllersRef.current[roomId] === controller) {
        delete analysisControllersRef.current[roomId];
      }
      return;
    }
    if (!clip || !identity || !intentIsCurrent() || clip.sourceSha256 !== identity.videoHash ||
        clip.capturedAt !== identity.capturedAt || clip.sizeBytes !== identity.sizeBytes) return;
    const attempt = (analysisAttemptsRef.current[roomId] ?? 0) + 1;
    analysisAttemptsRef.current[roomId] = attempt;
    const requestIdentity: VideoIdentityFields = {
      sessionId: expectedSessionId,
      schemaVersion: current.schemaVersion,
      videoId: identity.videoId,
      videoRevision: identity.videoRevision,
      analysisId: makeId("analysis"),
      attempt,
      catalogVersion: current.catalogVersion,
      expectedVideoSha256: identity.videoHash,
    };
    let candidateTokenToRelease: string | null = null;
    let mappingCompleted = false;
    let segmentationRequested = false;
    if (!intentIsCurrent() || !analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion, requireSelectedRoom)) return;
    const latestRecord = recordRef.current;
    if (!latestRecord) return;
    persist(clearRoomAnalysisState(latestRecord, roomId));
    try {
      const segmentForm = new FormData();
      segmentForm.set("stage", "segment");
      segmentForm.set("room", roomId);
      segmentForm.set("video", new File([clip.video], clip.fileName, { type: clip.mime }));
      appendIdentity(segmentForm, requestIdentity);
      if (!intentIsCurrent() || !analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion, requireSelectedRoom)) return;
      segmentationRequested = true;
      pendingCancelFor(roomId).set(requestIdentity, null);
      const segmentResponse = await fetchWithTimeout("/api/video/segment?stage=segment", {
        method: "POST",
        headers: { [WALKTHROUGH_CLIENT_HEADER]: WALKTHROUGH_CLIENT_ID },
        body: segmentForm,
        signal: controller.signal,
        cache: "no-store",
      }, SEGMENT_TIMEOUT_MS);
      const segmentJson: unknown = await segmentResponse.json().catch(() => null);
      if (!segmentResponse.ok) throw new Error(readSafeApiError(segmentJson, segmentResponse.status));
      const segmented = parseSegmentResponse(segmentJson, requestIdentity, roomId);
      candidateTokenToRelease = segmented.candidateToken;
      pendingCancelFor(roomId).set(requestIdentity, segmented.candidateToken ?? null);
      if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion, requireSelectedRoom)) return;

      setAnalysisStatus("mapping");
      const uniqueTimes = [...new Set(segmented.candidates.map((candidate) => candidate.evidence.timestampMs))];
      if (uniqueTimes.length > MAX_CANDIDATE_STILLS) throw new Error("This analysis returned more still moments than the app can safely map at once.");
      const stillTimestamps = makeRoomEvidenceTimestamps(clip.durationSeconds, uniqueTimes);
      const extracted: VideoStill[] = [];
      for (let offset = 0; offset < stillTimestamps.length; offset += MAX_STILLS_PER_DECODE) {
        const batch = await extractVideoStills(
          clip.video,
          stillTimestamps
            .slice(offset, offset + MAX_STILLS_PER_DECODE)
            .map((timestampMs) => timestampMs / 1000),
          { maxDurationSeconds: 30 },
        );
        extracted.push(...batch);
        if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion, requireSelectedRoom)) return;
      }
      if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion, requireSelectedRoom)) return;
      const stillByTime = new Map<number, { blob: Blob; hash: string; width: number; height: number }>();
      for (const still of extracted) {
        const timestampMs = Math.round(still.timestampSeconds * 1000);
        const hash = await sha256Blob(still.blob);
        if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion, requireSelectedRoom)) return;
        stillByTime.set(timestampMs, {
          blob: still.blob,
          hash,
          width: still.width,
          height: still.height,
        });
      }
      if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion, requireSelectedRoom)) return;
      const sourceStills = new Map<number, StoredVideoClip["stills"][number]>();
      const sourceReferences = new Map<number, EvidenceReference>();
      for (const [timestampMs, item] of stillByTime) {
        const stillId = `s-${identity.videoId}-${timestampMs}-${item.hash.slice(0, 8)}`;
        sourceReferences.set(timestampMs, {
          schemaVersion: requestIdentity.schemaVersion,
          catalogVersion: requestIdentity.catalogVersion,
          videoId: identity.videoId,
          videoRevision: identity.videoRevision,
          roomId,
          stillId,
          timestampMs,
          frameIndex: null,
          stillHash: item.hash,
        });
        sourceStills.set(timestampMs, {
          timestampSeconds: timestampMs / 1000,
          blob: item.blob,
          width: item.width,
          height: item.height,
        });
      }
      for (const candidate of segmented.candidates) {
        const item = findNearestSourceStill(stillByTime, candidate.evidence.timestampMs);
        if (!item) throw new Error("A segmented moment could not be matched to a nearby decoded source frame.");
      }
      const stillsSaved = await store.addStillsIfSourceMatches(
        expectedSessionId,
        roomId,
        identity.videoHash,
        clip.capturedAt,
        [...sourceStills.values()],
      );
      if (!stillsSaved) throw new Error("The room clip changed before its source stills could be saved. Reload the clip and try again.");
      if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion, requireSelectedRoom)) return;
      const updatedClip = await store.get(expectedSessionId, roomId);
      if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion, requireSelectedRoom)) return;
      if (!updatedClip || updatedClip.sourceSha256 !== identity.videoHash) throw new Error("The source clip changed before its review stills could be reopened.");
      setClips((previous) => ({ ...previous, [roomId]: updatedClip }));
      let extractedIdentity = { ...identity, evidence: [...sourceReferences.values()] };
      const latestRecord = recordRef.current;
      if (!latestRecord || !analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion, requireSelectedRoom)) return;
      persist({
        ...latestRecord,
        updatedAt: new Date().toISOString(),
        clipIdentities: { ...latestRecord.clipIdentities, [roomId]: extractedIdentity },
      });
      if (segmented.candidates.length === 0) {
        const next = replaceRoomProposals(recordRef.current!, roomId, extractedIdentity, makeNoEvidenceProposals());
        persist(next);
        mappingCompleted = true;
        setAnalysisNotice(`SAM returned no reviewable moments. ${sourceReferences.size} locally extracted room stills are available for manual evidence selection; nothing was inferred from non-detection.`);
        setAnalysisStatus("complete");
        setAnalysisExpanded(false);
        return;
      }
      const mapForm = new FormData();
      mapForm.set("stage", "map");
      mapForm.set("room", roomId);
      if (!segmented.candidateToken) throw new Error("The segmentation response omitted its required mapping token.");
      mapForm.set("candidateToken", segmented.candidateToken);
      appendIdentity(mapForm, requestIdentity);
      // The server derives and retains bounded Muse input stills from the
      // original clip during segmentation. Only the signed identity returns
      // here, so the phone neither uploads the clip twice nor supplies pixels
      // that the server cannot tie back to that clip.
      const mapResponse = await fetchWithTimeout("/api/video/segment?stage=map", {
        method: "POST",
        headers: { [WALKTHROUGH_CLIENT_HEADER]: WALKTHROUGH_CLIENT_ID },
        body: mapForm,
        signal: controller.signal,
        cache: "no-store",
      }, MAP_TIMEOUT_MS);
      const mapJson: unknown = await mapResponse.json().catch(() => null);
      if (!mapResponse.ok) throw new Error(readSafeApiError(mapJson, mapResponse.status));
      const analysisIdentity: VideoAnalysisIdentity = {
        sessionId: requestIdentity.sessionId,
        roomId,
        schemaVersion: requestIdentity.schemaVersion,
        videoId: requestIdentity.videoId,
        videoRevision: requestIdentity.videoRevision,
        expectedSourceHash: requestIdentity.expectedVideoSha256,
        analysisId: requestIdentity.analysisId,
        attempt: requestIdentity.attempt,
        catalogVersion: requestIdentity.catalogVersion,
      };
      const mapped = await parseMapResponse(mapJson, requestIdentity, roomId, segmented.candidates, {
        schemaVersion: analysisIdentity.schemaVersion,
        catalogVersion: analysisIdentity.catalogVersion,
        videoId: analysisIdentity.videoId,
        videoRevision: analysisIdentity.videoRevision,
        roomId: analysisIdentity.roomId,
      });
      if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion, requireSelectedRoom)) return;
      const proposals = mapProposalsToEvidence(mapped, segmented.candidates, analysisIdentity);
      const verifiedByStillId = new Map<string, VerifiedMappedEvidence>();
      for (const proposal of mapped.proposals) {
        for (const evidence of proposal.evidence) {
          if (evidence.verified) verifiedByStillId.set(evidence.verified.reference.stillId, evidence.verified);
        }
      }
      const verifiedItems = [...verifiedByStillId.values()];
      if (verifiedItems.length > 0) {
        const stillsSaved = await store.addStillsIfSourceMatches(
          expectedSessionId,
          roomId,
          identity.videoHash,
          clip.capturedAt,
          verifiedItems.map((item): StoredVideoStill => item.still),
        );
        if (!stillsSaved) throw new Error("The room clip changed before verified server review stills could be saved.");
        if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion, requireSelectedRoom)) return;
        const updatedClip = await store.get(expectedSessionId, roomId);
        if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion, requireSelectedRoom)) return;
        if (!updatedClip || updatedClip.sourceSha256 !== identity.videoHash) throw new Error("The source clip changed before verified server stills could be reopened.");
        setClips((previous) => ({ ...previous, [roomId]: updatedClip }));
        const serverEvidenceById = new Map(verifiedItems.map((item) => [item.reference.stillId, { ...item.reference, frameIndex: null }]));
        const serverTimes = new Set(verifiedItems.map((item) => item.reference.timestampMs));
        const localEvidence = extractedIdentity.evidence.filter((reference) =>
          ![...serverTimes].some((timestampMs) => Math.abs(timestampMs - reference.timestampMs) <= 100),
        );
        const serverReferences = [...serverEvidenceById.values()];
        extractedIdentity = {
          ...extractedIdentity,
          evidence: [
            ...localEvidence.slice(0, Math.max(0, MAX_ROOM_EVIDENCE_STILLS - serverReferences.length)),
            ...serverReferences,
          ],
        };
      }
      const next = replaceRoomProposals(recordRef.current!, roomId, extractedIdentity, proposals);
      persist(next);
      mappingCompleted = true;
      setAnalysisStatus("complete");
      setAnalysisExpanded(false);
      const mapper = mapped.mappingModel === "muse-spark-open-baseten" ? "Baseten Muse Spark Open fallback" : "Meta Muse Spark";
      setAnalysisNotice(`SAM segmented ${segmented.candidates.length} moments. ${mapper} used one-frame-per-second context and returned unreviewed suggestions; check each actual still and complete the physical inspection yourself.`);
    } catch (error) {
      if (error instanceof FetchTimeoutError) {
        setAnalysisStatus("error");
        setAnalysisError(`The server did not answer within ${Math.round(error.timeoutMs / 60000)} minutes. Keep this app open on Wi-Fi and run it again — finished rooms are kept and this room is marked for retry.`);
        return;
      }
      if (controller.signal.aborted || generation !== (analysisGenerationRef.current[roomId] ?? 0)) return;
      setAnalysisStatus("error");
      setAnalysisError(safeClientError(error, "Live room analysis did not complete. No sample result was substituted."));
    } finally {
      if (generation === (analysisGenerationRef.current[roomId] ?? 0) &&
          analysisControllersRef.current[roomId] === controller) {
        delete analysisControllersRef.current[roomId];
      }
      pendingCancelFor(roomId).clear();
      if (segmentationRequested && !mappingCompleted) {
        void cancelPendingVideoMapping(requestIdentity, candidateTokenToRelease);
      }
    }
  }

  async function handleInstallAction(): Promise<void> {
    setInstallNotice("");
    if (installAffordance.mode === "prompt") {
      const result = await requestInstall(installPromptRef.current);
      setHasInstallPrompt(false);
      if (result.outcome === "accepted") {
        setInstallNotice("Install started. Open Walkthrough from your home screen when it finishes.");
        return;
      }
      setInstallHelpOpen(true);
      setInstallNotice(result.outcome === "dismissed"
        ? "The install prompt was dismissed. You can still add Walkthrough from your browser menu."
        : "The install prompt is unavailable. Follow the browser steps below.");
      return;
    }
    setInstallHelpOpen((open) => !open);
  }

  function setProfileField<K extends "pseudonym" | "fundingType" | "evaluatorName" | "evaluatorAgencyName" | "landlordDiscussion" | "landlordDiscussionDate" | "leadershipSignoffRequired" | "leadershipNameAndTitle" | "leadershipSignoff" | "leadershipSignedAt">(
    key: K,
    value: MoveInReadyInspection[K],
  ): void {
    invalidateActiveAnalysis("Analysis was cancelled because inspection settings changed.");
    if (key === "pseudonym" || key === "fundingType") {
      const current = recordRef.current;
      setSetupExpanded(!isCaptureSetupComplete({
        pseudonym: key === "pseudonym" ? String(value) : current?.pseudonym ?? "",
        // Normalize funding values from the UI or legacy persisted records
        // so unexpected labels like "other" map into the canonical union
        // and the compile-time FundingType union remains authoritative.
        fundingType: key === "fundingType" ? normalizeFundingType(value) : current?.fundingType ?? "unknown",
        unitType: current?.unitType ?? "",
      }));
    }
    const previousValue = recordRef.current?.[key];
    const evaluatorChanged = key === "evaluatorName" && previousValue !== value;
    const signoffChanged = previousValue !== value;
    if (evaluatorChanged) setDrafts({});
    if (signoffChanged) {
      setSignoffName("");
      setSignoffAttested(false);
      setParticipantName("");
      setParticipantSignature("");
      setParticipantAttested(false);
    }
    updateRecord((current) => {
      const identityChanged = key === "evaluatorName" && current.evaluatorName !== value;
      const landlordMarkedNotInformed = key === "landlordDiscussion" && value !== "yes";
      return {
        ...current,
        [key]: value,
        ...(landlordMarkedNotInformed ? { landlordDiscussionDate: "" } : {}),
        ...(signoffChanged ? { signoff: null, participantSignoff: null } : {}),
        ...(identityChanged ? { decisions: createUnreviewedEvaluatorDecisions(), signoff: null, participantSignoff: null } : {}),
      };
    });
  }

  /**
   * The evaluator describes the unit; rooms derive from that description.
   * Saved clips for removed rooms stay on the device but no longer count
   * toward capture; per-element decisions are untouched.
   */
  function setUnitDescription(unitType: MoveInReadyUnitType, bathCount: number, hallwayIncluded: boolean): void {
    invalidateActiveAnalysis("Analysis was cancelled because inspection settings changed.");
    const roomIds = roomsForUnit(unitType, bathCount, { hallway: hallwayIncluded });
    if (!roomIds.includes(selectedRoomId)) setSelectedRoomId(roomIds[0] ?? "kitchen");
    const current = recordRef.current;
    setSetupExpanded(!isCaptureSetupComplete({
      pseudonym: current?.pseudonym ?? "",
      fundingType: current?.fundingType ?? "unknown",
      unitType,
    }));
    setSignoffName("");
    setSignoffAttested(false);
    setParticipantName("");
    setParticipantSignature("");
    setParticipantAttested(false);
    updateRecord((latest) => ({
      ...latest,
      unitType,
      bathCount,
      roomIds,
      selectedRoomId: roomIds.includes(latest.selectedRoomId) ? latest.selectedRoomId : (roomIds[0] ?? "kitchen"),
      analysisQueue: pruneAnalysisQueue(latest.analysisQueue ?? [], roomIds),
      signoff: null,
      participantSignoff: null,
    }));
  }

  function recordVoiceCheck(roomId: MoveInReadyRoomId, question: string, answer: "yes" | "no" | "skipped"): void {
    updateRecord((current) => {
      const existing = current.voiceChecks[roomId] ?? [];
      const next = [...existing.filter((entry) => entry.question !== question),
        { question, answer, recordedAt: new Date().toISOString() }];
      return { ...current, voiceChecks: { ...current.voiceChecks, [roomId]: next } };
    });
  }

  function advanceVoiceTurn(roomId: MoveInReadyRoomId): void {
    const current = recordRef.current;
    const parsed = parseRoomId(roomId);
    if (!current || !parsed) {
      setVoiceTurn(null);
      return;
    }
    const questions = checksForRoom(current, roomId);
    const answers = current.voiceChecks[roomId] ?? [];
    const nextIndex = questions.findIndex((question) => !answers.some((entry) => entry.question === question));
    setVoiceTranscript(null);
    setVoiceTurn(nextIndex < 0 ? null : { roomId, index: nextIndex });
  }

  function answerVoiceCheck(roomId: MoveInReadyRoomId, question: string, answer: "yes" | "no" | "skipped"): void {
    recordVoiceCheck(roomId, question, answer);
    advanceVoiceTurn(roomId);
  }

  /**
   * Guided-tour narration language (REQ-R2). A presentation preference, not
   * inspection content: switching never clears decisions or sign-off (unlike
   * setProfileField, which resets sign-off for content changes).
   */
  function setTourLanguage(language: TourLanguage): void {
    if (!esVoiceConfigured && language === "es") return;
    updateRecord((current) => current.tourLanguage === language ? current : { ...current, tourLanguage: language });
  }

  /**
   * Persist a live detector-test still as evidence on the room's current
   * clip (REQ-R3). Mirrors the analysis still-save path: bytes land in the
   * clip store first (atomic on source match), then the evidence reference
   * joins the clip identity, then clips state refreshes from the store so
   * the review evidence picker resolves it. Decisions, proposals, and
   * sign-off are untouched; every failure returns a message, never throws.
   */
  const attachDetectorStill = useCallback(async (
    roomId: MoveInReadyRoomId,
    still: CapturedDetectorStill,
  ): Promise<{ ok: true } | { ok: false; message: string }> => {
    const current = recordRef.current;
    const identity = current?.clipIdentities[roomId];
    if (!current || !identity) {
      return { ok: false, message: "Film this room before capturing a detector still." };
    }
    if (identity.evidence.length >= MAX_ROOM_EVIDENCE_STILLS) {
      return { ok: false, message: "This room already has the maximum number of saved stills." };
    }
    const store = videoStoreRef.current;
    try {
      const clip = await store?.get(current.sessionId, roomId);
      if (!clip || clip.sourceSha256 !== identity.videoHash || clip.capturedAt !== identity.capturedAt ||
          clip.sizeBytes !== identity.sizeBytes || await sha256Blob(clip.video) !== identity.videoHash) {
        return { ok: false, message: "The room clip changed. Save the clip again, then capture the still." };
      }
      const stillHash = await sha256Blob(still.blob);
      const usedMs = [
        ...identity.evidence.map((reference) => reference.timestampMs),
        ...clip.stills.map((item) => Math.round(item.timestampSeconds * 1000)),
      ];
      const timestampMs = firstFreeEvidenceTimestampMs(usedMs, clip.durationSeconds);
      if (timestampMs === null) {
        return { ok: false, message: "No room-clip timestamp is available for this still." };
      }
      const saved = await store?.addStillsIfSourceMatches(current.sessionId, roomId, identity.videoHash, identity.capturedAt, [{
        timestampSeconds: timestampMs / 1000,
        blob: still.blob,
        width: still.width,
        height: still.height,
      }]);
      if (!saved) {
        return { ok: false, message: "The room clip changed before the still could be saved." };
      }
      const updatedClip = await store?.get(current.sessionId, roomId);
      if (!updatedClip || updatedClip.sourceSha256 !== identity.videoHash) {
        return { ok: false, message: "The room clip changed before the still could be reopened." };
      }
      const reference = buildDetectorTestReference({
        schemaVersion: identity.schemaVersion,
        catalogVersion: identity.catalogVersion,
        videoId: identity.videoId,
        videoRevision: identity.videoRevision,
        roomId,
      }, timestampMs, stillHash);
      const latest = recordRef.current;
      const latestIdentity = latest?.clipIdentities[roomId];
      if (!latest || latest.sessionId !== current.sessionId || !latestIdentity || latestIdentity.videoId !== identity.videoId) {
        return { ok: false, message: "The room clip changed. Review the room, then capture the still again." };
      }
      if (latestIdentity.evidence.some((item) => item.stillId === reference.stillId)) {
        setClips((previous) => ({ ...previous, [roomId]: updatedClip }));
        return { ok: true };
      }
      setClips((previous) => ({ ...previous, [roomId]: updatedClip }));
      updateRecord((record) => {
        const target = record.clipIdentities[roomId];
        if (!target || target.videoId !== identity.videoId) return record;
        return {
          ...record,
          clipIdentities: { ...record.clipIdentities, [roomId]: { ...target, evidence: [...target.evidence, reference] } },
        };
      });
      return { ok: true };
    } catch {
      return { ok: false, message: "The still could not be saved on this device." };
    }
  }, [updateRecord]);

  function voiceCheckNoteForElement(elementId: MoveInReadyElementId, current: MoveInReadyInspection): string | null {
    const element = MOVE_IN_READY_ELEMENTS.find((item) => item.id === elementId);
    if (!element) return null;
    const parts: string[] = [];
    for (const roomId of current.roomIds) {
      if (!roomContributesToElement(roomId, element)) continue;
      for (const entry of current.voiceChecks[roomId] ?? []) {
        if (entry.answer !== "skipped") parts.push(`${roomLabel(roomId)}: "${entry.question}" — ${entry.answer}`);
      }
    }
    return parts.length > 0 ? `Voice checks: ${parts.join("; ")}` : null;
  }

  function toggleInspectionRoom(roomId: MoveInReadyRoomId): void {
    const current = recordRef.current;
    if (!current) return;
    const included = current.roomIds.includes(roomId);
    const next = included
      ? current.roomIds.filter((id) => id !== roomId)
      : [...current.roomIds, roomId];
    if (next.length === 0) return;
    invalidateActiveAnalysis("Analysis was cancelled because inspection settings changed.");
    if (included && selectedRoomId === roomId) setSelectedRoomId(next[0] ?? "kitchen");
    setSignoffName("");
    setSignoffAttested(false);
    setParticipantName("");
    setParticipantSignature("");
    setParticipantAttested(false);
    updateRecord((latest) => {
      const checks = { ...latest.voiceChecks };
      for (const id of latest.roomIds) if (!next.includes(id)) delete checks[id];
      return {
        ...latest,
        roomIds: next,
        selectedRoomId: next.includes(latest.selectedRoomId) ? latest.selectedRoomId : (next[0] ?? "kitchen"),
        voiceChecks: checks,
        analysisQueue: pruneAnalysisQueue(latest.analysisQueue ?? [], next),
        signoff: null,
        participantSignoff: null,
      };
    });
  }

  function saveDecision(elementId: MoveInReadyElementId, draftOverride?: DecisionDraft): boolean {
    const current = recordRef.current;
    if (!current) return false;
    if (current.fundingType !== "lahsa") {
      setReviewError(current.fundingType === "hud"
        ? "HQS is required for HUD-funded units. Form 1083 decisions are disabled for this unit."
        : "Choose LAHSA / Form 1083 funding in Profile before recording a decision.");
      return false;
    }
    const draft = draftOverride ?? drafts[elementId] ?? createDecisionDraft(current.decisions[elementId]);
    const isFireSafety = elementId === "demo-smoke-co";
    const fireAssessment = isFireSafety ? fireSafetyAssessmentFromDraft(draft) : undefined;
    const completeFireAssessment = isFireSafety ? completeFireSafetyAssessmentFromDraft(draft) : undefined;
    const choice = isFireSafety ? fireSafetyChoiceFromDraft(draft) : draft.choice;
    if (!current.evaluatorName.trim()) {
      setReviewError("Add the evaluator’s name in Profile before recording a decision.");
      return false;
    }

    if (choice === "D" && current.proposals[elementId]?.modelSuggestion === "D" &&
        current.proposals[elementId]?.deficiencySuggestion && !draft.planSuggestionReviewed) {
      setReviewError("Review the AI plan suggestion, then confirm it or replace its fields before saving your D decision.");
      return false;
    }
    let candidate: EvaluatorDecision;
    if (choice === "unreviewed") {
      candidate = unreviewedDecisionPreservingSnapshot(current.decisions[elementId]);
    } else if (choice === "needs-human-check") {
      candidate = {
        status: "needs-human-check",
        note: draft.note.trim() || "Evaluator needs an in-person check before deciding.",
        ...(fireAssessment ? { fireSafetyAssessment: fireAssessment } : {}),
      };
    } else {
      const selected = selectedEvidence(elementId, draft.evidenceStillIds, current);
      const withProvenance = decisionEvidenceWithProvenance(current.proposals[elementId], selected);
      const decidedAt = new Date().toISOString();
      const base = {
        status: choice,
        evaluatorName: current.evaluatorName.trim(),
        decidedAt,
        inPersonCheckAcknowledgment: {
          evaluatorName: current.evaluatorName.trim(),
          completedAt: decidedAt,
        },
        rationale: draft.rationale.trim(),
        evidence: withProvenance.evidence,
        analysisIdentity: withProvenance.analysisIdentity,
        ...(completeFireAssessment ? { fireSafetyAssessment: completeFireAssessment } : {}),
      };
      candidate = choice === "D" ? {
        ...base,
        status: "D",
        deficiency: {
          issueDescription: draft.issueDescription.trim(),
          correction: draft.correction.trim(),
          completionDate: draft.completionDate,
          reinspectionDate: draft.reinspectionDate,
        },
      } : { ...base, status: "A" };
    }
    const parsed = validateEvaluatorDecision(candidate, elementId);
    if (!parsed.ok) {
      setReviewError(decisionMessage(parsed.errors));
      return false;
    }
    updateRecord((latest) => ({
      ...latest,
      decisions: { ...latest.decisions, [elementId]: parsed.value },
      signoff: null,
      participantSignoff: null,
    }));
    setReviewError("");
    const savedOk = true;
    if (window.matchMedia("(max-width: 719px)").matches) {
      setMobileReviewDetailOpen(false);
      scrollMainToTop("smooth");
    }
    return savedOk;
  }

  /**
   * Tour deficiency-detail save: completes a D correction plan in-tour
   * through the same saveDecision validators as the detail form. The
   * Save tap is the plan review, mirroring one-tap confirm semantics.
   */
  function saveElementDetails(elementId: MoveInReadyElementId, details: ElementDetailsInput): boolean {
    const current = recordRef.current;
    const proposal = current?.proposals[elementId];
    if (!current || !proposal) {
      setReviewError("No AI draft for this requirement. Assess it in the detail form.");
      return false;
    }
    if (elementId === "demo-smoke-co") {
      setReviewError("Fire Safety details share the detail form with the 11a/11b marks. Assess it there.");
      return false;
    }
    const draft: DecisionDraft = {
      ...prefillDraftFromProposal(drafts[elementId] ?? createDecisionDraft(current.decisions[elementId]), proposal),
      choice: "D",
      issueDescription: details.issueDescription,
      correction: details.correction,
      completionDate: details.completionDate,
      reinspectionDate: details.reinspectionDate,
      planSuggestionReviewed: true,
    };
    return saveDecision(elementId, draft);
  }

  /**
   * Tour Fire Safety save: records independent 11a unit and 11b
   * public-area marks. Both clauses must be set; the aggregate verdict
   * derives from them exactly like the detail form.
   */
  function saveFireSafety(unit: FireSafetyDraftOutcome, publicArea: FireSafetyDraftOutcome): boolean {
    const current = recordRef.current;
    if (!current) return false;
    if (unit === "" || publicArea === "") {
      setReviewError("Set both the unit and public-area detector marks before saving.");
      return false;
    }
    const draft: DecisionDraft = {
      ...(drafts["demo-smoke-co"] ?? createDecisionDraft(current.decisions["demo-smoke-co"])),
      fireSafetyUnitDetectors: unit,
      fireSafetyPublicAreaDetectors: publicArea,
    };
    if (fireSafetyChoiceFromDraft(draft) === "D") {
      const planReady = draft.issueDescription.trim() && draft.correction.trim() &&
        draft.completionDate && draft.reinspectionDate;
      if (!planReady) {
        setReviewError("A Deficient mark needs a correction plan. Complete it in the detail form.");
        return false;
      }
    }
    return saveDecision("demo-smoke-co", draft);
  }

  function updateDecisionDraft(
    elementId: MoveInReadyElementId,
    update: Partial<DecisionDraft> | ((current: DecisionDraft) => DecisionDraft),
  ): void {
    setDrafts((current) => {
      const savedDecision = recordRef.current?.decisions[elementId] ?? { status: "unreviewed" as const };
      const previous = current[elementId] ?? createDecisionDraft(savedDecision);
      let next = typeof update === "function" ? update(previous) : { ...previous, ...update };
      const planFieldsChanged = previous.issueDescription !== next.issueDescription ||
        previous.correction !== next.correction ||
        previous.completionDate !== next.completionDate ||
        previous.reinspectionDate !== next.reinspectionDate;
      if (planFieldsChanged && recordRef.current?.proposals[elementId]?.deficiencySuggestion) {
        next = { ...next, planSuggestionReviewed: false };
      }
      return { ...current, [elementId]: next };
    });
  }

  function proposalIsCurrent(proposal: ModelElementProposal, current: MoveInReadyInspection): boolean {
    const identity = current.clipIdentities[proposal.analysisIdentity.roomId];
    return Boolean(identity) &&
      proposal.analysisIdentity.videoId === identity!.videoId &&
      proposal.analysisIdentity.videoRevision === identity!.videoRevision &&
      proposal.analysisIdentity.expectedSourceHash === identity!.videoHash;
  }

  /**
   * One evaluator tap opening one AI proposal for review. Copies the draft
   * into editable fields and opens the detail form. Never saves a decision
   * and never touches the in-person acknowledgment: the evaluator still
   * completes the check, acknowledges it, and saves explicitly there.
   */
  function reviewProposalDraft(elementId: MoveInReadyElementId): void {
    const current = recordRef.current;
    if (!current) return;
    if (current.fundingType !== "lahsa") {
      setReviewError("Choose LAHSA / Form 1083 funding in Profile before recording a decision.");
      return;
    }
    if (!current.evaluatorName.trim()) {
      setReviewError("Add the evaluator’s name in Profile before recording a decision.");
      return;
    }
    if ((current.decisions[elementId]?.status ?? "unreviewed") !== "unreviewed") {
      changeStep("review");
      openReviewElement(elementId);
      return;
    }
    const proposal = current.proposals[elementId];
    const voiceNote = voiceCheckNoteForElement(elementId, current);
    if (!proposal) {
      if (voiceNote) {
        updateDecisionDraft(elementId, (draft) => (
          draft.rationale.trim() ? draft : { ...draft, rationale: voiceNote.slice(0, 1000) }
        ));
      }
      changeStep("review");
      openReviewElement(elementId);
      setReviewError("No AI draft for this requirement. Assess it in the detail form.");
      return;
    }
    if (!proposalIsCurrent(proposal, current)) {
      setReviewError("That room clip changed since analysis. Analyze it again, then review the new draft.");
      return;
    }
    updateDecisionDraft(elementId, (draft) => {
      const prefilled = prefillDraftFromProposal(draft, proposal);
      if (!voiceNote || prefilled.rationale.includes(voiceNote)) return prefilled;
      return { ...prefilled, rationale: `${prefilled.rationale}\n${voiceNote}`.slice(0, 1000) };
    });
    setReviewError("");
    changeStep("review");
    openReviewElement(elementId);
  }

  /**
   * One-tap confirm for an AI draft. Guards mirror reviewProposalDraft; the
   * tap itself is the in-person acknowledgment and plan review, so callers
   * must show the suggestion (and the D plan) next to the button. Blocked
   * drafts open the detail form with guidance instead of saving, and a
   * successful confirm advances to the next undecided requirement.
   */
  function confirmProposalDraft(elementId: MoveInReadyElementId): void {
    const current = recordRef.current;
    if (!current) return;
    if (current.fundingType !== "lahsa") {
      setReviewError("Choose LAHSA / Form 1083 funding in Profile before recording a decision.");
      return;
    }
    if (!current.evaluatorName.trim()) {
      changeStep("review");
      openReviewElement(elementId);
      setReviewError("Add the evaluator’s name in Profile before recording a decision.");
      return;
    }
    if ((current.decisions[elementId]?.status ?? "unreviewed") !== "unreviewed") {
      changeStep("review");
      openReviewElement(elementId);
      return;
    }
    const proposal = current.proposals[elementId];
    if (!proposal) {
      const voiceNote = voiceCheckNoteForElement(elementId, current);
      if (voiceNote) {
        updateDecisionDraft(elementId, (draft) => (
          draft.rationale.trim() ? draft : { ...draft, rationale: voiceNote.slice(0, 1000) }
        ));
      }
      changeStep("review");
      openReviewElement(elementId);
      setReviewError("No AI draft for this requirement. Assess it in the detail form.");
      return;
    }
    if (!proposalIsCurrent(proposal, current)) {
      changeStep("review");
      openReviewElement(elementId);
      setReviewError("That room clip changed since analysis. Analyze it again, then review the new draft.");
      return;
    }
    const built = buildConfirmDraft(elementId, proposal, voiceCheckNoteForElement(elementId, current));
    if (!built.ok) {
      updateDecisionDraft(elementId, (draft) => prefillDraftFromProposal(draft, proposal));
      changeStep("review");
      openReviewElement(elementId);
      setReviewError(built.reason);
      return;
    }
    setDrafts((previous) => ({ ...previous, [elementId]: built.draft }));
    if (!saveDecision(elementId, built.draft)) {
      changeStep("review");
      openReviewElement(elementId);
      return;
    }
    const next = MOVE_IN_READY_ELEMENT_IDS.find((id) =>
      id !== elementId && (current.decisions[id]?.status ?? "unreviewed") === "unreviewed");
    if (next) openReviewElement(next);
  }

  function saveSignoff(): boolean {
    const current = recordRef.current;
    if (!current) return false;
    if (current.fundingType !== "lahsa") {
      setExportError(current.fundingType === "hud"
        ? "HQS is required for HUD-funded units. Form 1083 sign-off is disabled."
        : "Choose LAHSA / Form 1083 funding in Profile before signing.");
      return false;
    }
    const signoff: EvaluatorSignoff = {
      evaluatorName: current.evaluatorName.trim(),
      typedSignature: signoffName.trim(),
      attested: signoffAttested,
      signedAt: new Date().toISOString(),
    };
    const parsed = validateEvaluatorSignoff(signoff);
    if (!parsed.ok) {
      setExportError(decisionMessage(parsed.errors));
      return false;
    }
    const formBlocker = form1083AdministrativeBlocker(current);
    if (formBlocker) {
      setExportError(formBlocker);
      return false;
    }
    const result = deriveFinalInspectionResult({
      fundingType: current.fundingType,
      capturedRoomIds: current.roomIds.filter((roomId) => Boolean(clips[roomId])),
      expectedRoomIds: current.roomIds,
      evaluatorDecisions: current.decisions,
      signoff: parsed.value,
    });
    if (result.status !== "complete") {
      setExportError(result.blockers[0] ?? "Complete all evaluator decisions before sign-off.");
      return false;
    }
    updateRecord((latest) => ({ ...latest, signoff: parsed.value }));
    setExportError("");
    setExportNotice("Evaluator sign-off saved to this device. No result has been sent to LAHSA or HMIS.");
    return true;
  }

  function saveParticipantSignoff(): boolean {
    const current = recordRef.current;
    if (!current) return false;
    if (current.fundingType !== "lahsa") {
      setExportError(current.fundingType === "hud"
        ? "HQS is required for HUD-funded units. Form 1083 sign-off is disabled."
        : "Choose LAHSA / Form 1083 funding in Profile before signing.");
      return false;
    }
    const participantSignoff: ParticipantSignoff = {
      participantName: participantName.trim(),
      typedSignature: participantSignature.trim(),
      attested: participantAttested,
      signedAt: new Date().toISOString(),
    };
    const parsed = validateParticipantSignoff(participantSignoff);
    if (!parsed.ok) {
      setExportError(decisionMessage(parsed.errors));
      return false;
    }
    const formBlocker = form1083AdministrativeBlocker(current);
    if (formBlocker) {
      setExportError(formBlocker);
      return false;
    }
    const result = deriveFinalInspectionResult({
      fundingType: current.fundingType,
      capturedRoomIds: current.roomIds.filter((roomId) => Boolean(clips[roomId])),
      expectedRoomIds: current.roomIds,
      evaluatorDecisions: current.decisions,
      signoff: current.signoff,
    });
    if (result.status !== "complete" && result.status !== "signoff-required") {
      setExportError(result.blockers[0] ?? "Complete all evaluator decisions before participant sign-off.");
      return false;
    }
    updateRecord((latest) => ({ ...latest, participantSignoff: parsed.value }));
    setExportError("");
    setExportNotice("Participant sign-off saved to this device. No result has been sent to LAHSA or HMIS.");
    return true;
  }

  /**
   * Optional GPS attestation (REQ-L3). Explicit tap only — never
   * auto-prompted — and never blocking: denial, timeout, or an unavailable
   * API records nothing and leaves signing and exports untouched.
   */
  function requestInspectionLocation(): void {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setLocationError("Location not recorded");
      return;
    }
    setLocating(true);
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        updateRecord((current) => ({
          ...current,
          inspectionLocation: buildInspectionLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracyM: position.coords.accuracy,
            capturedAt: new Date().toISOString(),
          }),
        }));
      },
      () => {
        setLocating(false);
        setLocationError("Location not recorded");
      },
      { timeout: 10_000 },
    );
  }

  async function collectExportStills(current: MoveInReadyInspection): Promise<ExportStill[]> {
    const store = videoStoreRef.current;
    if (!store) throw new Error("Local video storage is unavailable.");
    const needed = new Map<string, EvidenceReference>();
    for (const elementId of MOVE_IN_READY_ELEMENT_IDS) {
      const decision = current.decisions[elementId];
      if (decision.status === "A" || decision.status === "D") {
        for (const evidence of decision.evidence) needed.set(evidence.stillId, evidence);
      }
    }
    const result: ExportStill[] = [];
    for (const reference of needed.values()) {
      const fromRoomClip = current.clipIdentities[reference.roomId]?.videoId === reference.videoId;
      const elementId = fromRoomClip
        ? undefined
        : (Object.entries(current.elementClipIdentities ?? {}).find(([, candidate]) => candidate?.videoId === reference.videoId)?.[0] as MoveInReadyElementId | undefined);
      if (!fromRoomClip && !elementId) {
        throw new Error("An evidence clip changed while this export was being prepared. Recheck the room before export.");
      }
      const clip = elementId
        ? await store.getElement(current.sessionId, elementId)
        : await store.get(current.sessionId, reference.roomId);
      const identity = identityForEvidenceReference(current, reference);
      const expectedClipId = elementId
        ? makeElementClipId(current.sessionId, elementId)
        : makeVideoClipId(current.sessionId, reference.roomId);
      const referenceIsCurrent = Boolean(identity && identity.videoId === reference.videoId && identity.videoRevision === reference.videoRevision &&
        identity.schemaVersion === reference.schemaVersion && identity.catalogVersion === reference.catalogVersion &&
        identity.evidence.some((saved) => saved.stillId === reference.stillId && saved.videoId === reference.videoId &&
          saved.schemaVersion === reference.schemaVersion && saved.catalogVersion === reference.catalogVersion &&
          saved.videoRevision === reference.videoRevision && saved.timestampMs === reference.timestampMs && saved.stillHash === reference.stillHash));
      if (!clip || clip.id !== expectedClipId || !identity || !referenceIsCurrent ||
          clip.sourceSha256 !== identity.videoHash || clip.capturedAt !== identity.capturedAt || clip.sizeBytes !== identity.sizeBytes) {
        throw new Error("An evidence clip changed while this export was being prepared. Recheck the room before export.");
      }
      const still = await findVerifiedEvidenceStill(clip.stills, reference);
      if (!still) throw new Error("A source still is missing from this device. Recheck the room before export.");
      const bytes = new Uint8Array(await still.blob.arrayBuffer());
      result.push({ evidence: reference, jpegBytes: bytes });
    }
    return result;
  }

  async function assertExportSnapshotCurrent(current: MoveInReadyInspection, capturedRoomIds: readonly MoveInReadyRoomId[]): Promise<void> {
    const store = videoStoreRef.current;
    if (!store) throw new Error("Local video storage is unavailable.");
    for (const roomId of capturedRoomIds) {
      const identity = current.clipIdentities[roomId];
      const clip = await store.get(current.sessionId, roomId);
      if (!identity || !clip || clip.id !== makeVideoClipId(current.sessionId, roomId) ||
          clip.sourceSha256 !== identity.videoHash || clip.capturedAt !== identity.capturedAt || clip.sizeBytes !== identity.sizeBytes) {
        throw new Error("A room clip changed while this export was being prepared. Review the current walkthrough and export again.");
      }
    }
    for (const [elementId, identity] of Object.entries(current.elementClipIdentities ?? {})) {
      if (!identity) continue;
      const clip = await store.getElement(current.sessionId, elementId as MoveInReadyElementId);
      if (!clip || clip.id !== makeElementClipId(current.sessionId, elementId) ||
          clip.sourceSha256 !== identity.videoHash || clip.capturedAt !== identity.capturedAt || clip.sizeBytes !== identity.sizeBytes) {
        throw new Error("A live proof clip changed while this export was being prepared. Review the current walkthrough and export again.");
      }
    }
    if (recordRef.current !== current) {
      throw new Error("The walkthrough changed while this export was being prepared. Review the current details and export again.");
    }
  }

  async function buildExportFile(kind: FlowExportKind, fixListLanguage: FixListLanguage = "en"): Promise<{ body: Uint8Array; filename: string; mime: string; polished: boolean }> {
    const current = recordRef.current;
    if (current && current.fundingType !== "lahsa") {
      throw new Error(current.fundingType === "hud"
        ? "HQS is required for HUD-funded units. Form 1083 exports are disabled."
        : "Choose LAHSA / Form 1083 funding in Profile before exporting.");
    }
    const capturedRoomIds = (current?.roomIds ?? []).filter((roomId) => Boolean(clips[roomId]));
    const currentFinalization = current ? deriveFinalInspectionResult({
      fundingType: current.fundingType,
      capturedRoomIds,
      expectedRoomIds: current.roomIds,
      evaluatorDecisions: current.decisions,
      signoff: current.signoff,
    }) : null;
    if (!current?.signoff || currentFinalization?.status !== "complete" || form1083AdministrativeBlocker(current)) {
      throw new Error(current ? form1083AdministrativeBlocker(current) ?? "Capture every room video, complete every evaluator decision, and save your attestation before creating exports." : "Capture every room video, complete every evaluator decision, and save your attestation before creating exports.");
    }
    if (!current?.participantSignoff) {
      throw new Error("Participant sign-off is required before export. The participant signs in the Sign-Off step.");
    }
    {
      const stills = await collectExportStills(current);
      await assertExportSnapshotCurrent(current, capturedRoomIds);
      const exportInput = {
        sessionId: current.sessionId,
        pseudonym: current.pseudonym,
        fundingType: current.fundingType,
        capturedRoomIds,
        expectedRoomIds: current.roomIds,
        decisions: current.decisions,
        signoff: current.signoff,
        participantSignoff: current.participantSignoff,
        evaluatorAgencyName: current.evaluatorAgencyName,
        landlordDiscussion: current.landlordDiscussion === "" ? undefined : current.landlordDiscussion,
        landlordDiscussionDate: current.landlordDiscussionDate || undefined,
        leadershipSignoffRequired: current.leadershipSignoffRequired,
        leadershipNameAndTitle: current.leadershipNameAndTitle,
        leadershipSignoff: current.leadershipSignoff,
        leadershipSignedAt: current.leadershipSignedAt || undefined,
        stills,
      };
      const dateName = new Date().toISOString();
      const visualAlarmsRequired = current.participantVisualAlarmsRequired === true;
      if (kind === "lahsa-1083-json") {
        const json = buildLahsa1083Json({
          sessionId: current.sessionId,
          fundingType: current.fundingType,
          decisions: current.decisions,
          signoff: current.signoff,
          participantSignoff: current.participantSignoff,
          participantVisualAlarmsRequired: visualAlarmsRequired,
          inspectionLocation: current.inspectionLocation,
          generatedAt: dateName,
        });
        await assertExportSnapshotCurrent(current, capturedRoomIds);
        return {
          body: new TextEncoder().encode(JSON.stringify(json, null, 2)),
          filename: exportFilename("hmis-ready", current.sessionId, dateName).replace("hmis-ready", "lahsa-1083-json").replace(/\.pdf$/, ".json"),
          mime: "application/json",
          polished: false,
        };
      }
      if (kind === "case-note") {
        const template = buildCaseNoteText({
          fundingType: current.fundingType,
          pseudonym: current.pseudonym,
          decisions: current.decisions,
          signoff: current.signoff,
          participantSignoff: current.participantSignoff,
          participantVisualAlarmsRequired: visualAlarmsRequired,
          generatedAt: dateName,
        });
        const { text, polished } = await requestCaseNotePolish(template);
        await assertExportSnapshotCurrent(current, capturedRoomIds);
        return {
          body: new TextEncoder().encode(text),
          filename: exportFilename("hmis-ready", current.sessionId, dateName).replace("hmis-ready", "case-note").replace(/\.pdf$/, ".txt"),
          mime: "text/plain",
          polished,
        };
      }
      const body = kind === "hmis-json"
        ? new TextEncoder().encode(JSON.stringify(await buildHmisReadyJson(exportInput), null, 2))
        : await buildMoveInReadyPdf(exportInput, kind, kind === "landlord-fix-list" ? fixListLanguage : "en");
      await assertExportSnapshotCurrent(current, capturedRoomIds);
      const filename = kind === "hmis-json"
        ? exportFilename("hmis-ready", current.sessionId, dateName).replace(/\.pdf$/, ".json")
        : exportFilename(kind, current.sessionId, dateName, fixListLanguage);
      const mime = kind === "hmis-json" ? "application/json" : "application/pdf";
      return { body, filename, mime, polished: false };
    }
  }

  async function downloadExport(kind: FlowExportKind, fixListLanguage: FixListLanguage = "en"): Promise<void> {
    setExporting(true);
    setExportError("");
    setExportNotice("");
    try {
      const { body, filename, mime, polished } = await buildExportFile(kind, fixListLanguage);
      const url = URL.createObjectURL(new Blob([body], { type: mime }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      if (kind === "case-note") {
        setExportNotice(polished
          ? `${filename} downloaded (polished wording). ${CASE_NOTE_DRAFT_LABEL}`
          : `${filename} downloaded. ${CASE_NOTE_DRAFT_LABEL}`);
      } else {
        setExportNotice(`${filename} downloaded. Handle it through your existing manual process.`);
      }
    } catch (error) {
      setExportError(safeClientError(error, "The local export could not be created."));
    } finally {
      setExporting(false);
    }
  }

  async function shareExports(): Promise<void> {
    setExporting(true);
    setExportError("");
    setExportNotice("");
    try {
      const kinds: FlowExportKind[] = ["client-file", "landlord-fix-list", "hmis-ready", "hmis-json"];
      if (recordRef.current?.participantSignoff) kinds.push("case-note");
      const files: File[] = [];
      for (const kind of kinds) {
        const { body, filename, mime } = await buildExportFile(kind);
        files.push(new File([body as BlobPart], filename, { type: mime }));
      }
      await navigator.share({ files, title: "Form 1083 walkthrough exports" });
      setExportNotice("Export packet shared. Handle it through your existing manual process.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setExportError(safeClientError(error, "Sharing is not available on this device. Use the downloads."));
    } finally {
      setExporting(false);
    }
  }

  /** Reset every per-inspection UI state after the record ref and id change. Clips reload from the session id. */
  function resetSessionUi(next: MoveInReadyInspection): void {
    setSetupExpanded(shouldExpandCaptureSetup(next));
    setClips({});
    setClipsReadySessionId(null);
    setUnreadableClipRooms([]);
    setSelectedRoomId(next.selectedRoomId);
    setAnalysisStatus("idle");
    setAnalysisError("");
    setAnalysisNotice("");
    setMockUnitAttestationKey(null);
    setSendVideoConsentKey(null);
    setBatchAttested(false);
    setBatchSendConsent(false);
    setBatchActive(false);
    setBatchProgress(null);
    setBatchFailedRooms([]);
    setWalkthroughAttested(false);
    setWalkthroughSendConsent(false);
    batchQueueRef.current = createRoomBatchQueue<MoveInReadyRoomId>();
    batchTotalRef.current = 0;
    batchSettledRef.current = 0;
    batchFailedRef.current = [];
    batchCancelRef.current = false;
    batchStopReasonRef.current = null;
    batchRunRef.current = null;
    batchSessionRef.current += 1;
    batchRoomsInFlightRef.current.clear();
    batchAutoStartedRef.current = false;
    setAnalysisExpanded(false);
    setClipDetailsExpanded(false);
    setDrafts({});
    setReviewError("");
    setEvidenceViews([]);
    setActiveElementId(null);
    setMobileReviewDetailOpen(false);
    setReviewNoteOpen(false);
    setReviewNoteDraft("");
    setSignoffName("");
    setSignoffAttested(false);
    setParticipantName("");
    setParticipantSignature("");
    setParticipantAttested(false);
    setLocating(false);
    setLocationError("");
    queueRunnerKeyRef.current = "";
    setExportError("");
    setExportNotice("");
    setProfileSection("unit");
  }

  async function activateInspection(next: MoveInReadyInspection): Promise<void> {
    recordRef.current = next;
    setSessionId(next.sessionId);
    setRecord(next);
    try {
      window.localStorage.setItem(ACTIVE_SESSION_KEY, next.sessionId);
    } catch {
      // Active id stays in memory for this page.
    }
    resetSessionUi(next);
    setStep("home");
    await refreshInspectionList();
  }

  async function switchInspection(sessionIdValue: string): Promise<void> {
    if (!isSafeSessionId(sessionIdValue) || sessionIdValue === recordRef.current?.sessionId) return;
    invalidateActiveAnalysis("Switched to another saved inspection.");
    try {
      const current = recordRef.current;
      if (current) await inspectionStoreRef.current?.put({ ...current, updatedAt: new Date().toISOString() });
      const target = await inspectionStoreRef.current?.get(sessionIdValue);
      if (!target) {
        setStorageWarning("That saved inspection is no longer on this device.");
        await refreshInspectionList();
        return;
      }
      await activateInspection(target);
    } catch (error) {
      setStorageWarning(safeClientError(error, "That saved inspection could not be opened."));
    }
  }

  /**
   * Start a deficiency re-inspection (REQ-L1) for a signed record: every D
   * decision is snapshotted into `priorDeficiency` and reset to unreviewed,
   * both sign-offs reset, and the guided tour then queues only those
   * elements. deriveFinalInspectionResult is unchanged: any standing D still
   * blocks completion.
   */
  async function startReinspection(sessionIdValue: string): Promise<void> {
    if (!isSafeSessionId(sessionIdValue)) return;
    invalidateActiveAnalysis("Started a deficiency re-inspection.");
    try {
      const current = recordRef.current;
      if (current) await inspectionStoreRef.current?.put({ ...current, updatedAt: new Date().toISOString() });
      const target = await inspectionStoreRef.current?.get(sessionIdValue);
      if (!target) {
        setStorageWarning("That saved inspection is no longer on this device.");
        await refreshInspectionList();
        return;
      }
      if (!isSignedForReinspection(target)) {
        setStorageWarning("Re-inspection needs a signed inspection. Sign it first, then re-inspect its deficiencies.");
        await refreshInspectionList();
        return;
      }
      const { decisions, reinspectionCount } = startReinspectionDecisions(target.decisions);
      if (reinspectionCount === 0) {
        setStorageWarning("That inspection has no deficiencies to re-inspect.");
        await refreshInspectionList();
        return;
      }
      const next: MoveInReadyInspection = {
        ...target,
        updatedAt: new Date().toISOString(),
        decisions,
        signoff: null,
        participantSignoff: null,
      };
      await inspectionStoreRef.current?.put(next);
      await activateInspection(next);
      changeStep("guided");
      setAnalysisNotice(`Re-inspection started: ${reinspectionCount} deficient item${reinspectionCount === 1 ? "" : "s"} reset for review. Prior findings are kept as Before stills.`);
    } catch (error) {
      setStorageWarning(safeClientError(error, "That re-inspection could not be started."));
    }
  }

  async function startNewInspection(): Promise<void> {
    invalidateActiveAnalysis("Started a new inspection. The previous one stays saved.");
    try {
      const current = recordRef.current;
      if (current) await inspectionStoreRef.current?.put({ ...current, updatedAt: new Date().toISOString() });
      const fresh = createInitialInspectionRecord(makeId("walkthrough"));
      await inspectionStoreRef.current?.put(fresh);
      await activateInspection(fresh);
      changeStep("capture");
      setSetupExpanded(true);
    } catch (error) {
      setStorageWarning(safeClientError(error, "A new inspection could not be started."));
    }
  }

  async function deleteInspection(sessionIdValue: string): Promise<void> {
    if (!isSafeSessionId(sessionIdValue)) return;
    const target = inspections.find((row) => row.sessionId === sessionIdValue);
    const label = target?.pseudonym.trim() || "Untitled inspection";
    if (!window.confirm(`Delete "${label}" and its local video clips, frames, drafts, decisions, and signatures from this browser? Downloaded files and provider-side processing are not deleted.`)) return;
    invalidateActiveAnalysis("An inspection was deleted.");
    try {
      await videoStoreRef.current?.removeSession(sessionIdValue);
      await inspectionStoreRef.current?.delete(sessionIdValue);
      if (sessionIdValue === recordRef.current?.sessionId) {
        const fresh = createInitialInspectionRecord(makeId("walkthrough"));
        await inspectionStoreRef.current?.put(fresh);
        await activateInspection(fresh);
      } else {
        await refreshInspectionList();
      }
    } catch (error) {
      setStorageWarning(safeClientError(error, "Some local inspection data could not be removed."));
    }
  }

  async function clearSession(): Promise<void> {
    if (!recordRef.current || !window.confirm("Delete this walkthrough, its local video clips, frames, drafts, decisions, and signatures from this browser? Downloaded files and provider-side processing are not deleted.")) return;
    invalidateActiveAnalysis("The walkthrough was cleared.");
    const oldId = recordRef.current.sessionId;
    const newId = makeId("walkthrough");
    try {
      await videoStoreRef.current?.removeSession(oldId);
      await inspectionStoreRef.current?.delete(oldId);
      window.localStorage.setItem(ACTIVE_SESSION_KEY, newId);
      const fresh = createInitialInspectionRecord(newId);
      recordRef.current = fresh;
      setSessionId(newId);
      setRecord(fresh);
      resetSessionUi(fresh);
      setStep("profile");
      setAnalysisNotice("Local data for this walkthrough was removed. Downloads and provider processing are outside this device.");
      await inspectionStoreRef.current?.put(fresh);
      await refreshInspectionList();
    } catch (error) {
      setStorageWarning(safeClientError(error, "Some local walkthrough data could not be removed."));
    }
  }

  const selectedEvidenceForView = (elementId: MoveInReadyElementId): EvidenceView[] => {
    if (!record) return [];
    const element = MOVE_IN_READY_ELEMENTS.find((item) => item.id === elementId);
    if (!element) return [];
    return evidenceViews.filter(({ reference }) =>
      roomContributesToElement(reference.roomId, element) &&
      isEvidenceCurrent(reference, identityForEvidenceReference(record, reference), record),
    );
  };

  if (booting || !sessionId || !record) {
    return <main className={styles.app}><div className={styles.main}><p role="status">Opening this walkthrough on this device…</p></div></main>;
  }

  return (
    <div className={styles.app} data-step={step} data-review-detail={mobileReviewDetailOpen ? "true" : "false"} data-testid="move-in-ready-app">
      <p className={styles.demoBanner} data-testid="synthetic-data-banner" role="note">
        Demo build · staged mock-unit data only — no real client data. Stills come only from filmed clips.
      </p>
      <header className={`${styles.topBar} ${analysisMode === "live" ? styles.topBarConfigured : ""}`}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">MR</span>
          <div className={styles.brandCopy}>
            <p className={styles.brandKicker}>LAHSA Form 1083 · Local draft</p>
            <p className={styles.brandTitle}>Move-in Ready</p>
          </div>
        </div>
        <span className={`${styles.modeBadge} ${analysisMode === "live" ? styles.modeLive : analysisMode === "fixture" ? styles.modeFixture : styles.modeUnconfigured}`} data-testid="analysis-mode">
          {analysisMode === "live" ? "Meta live · untested" : analysisMode === "fixture" ? "Sample only" : "Meta off"}
        </span>
      </header>

      <div className={styles.notice}>
        {step === "capture" && <div className={`${styles.noticeBox} ${styles.noticeWarning}`} role="note">
          <ShieldCheck size={18} aria-hidden="true" />
          <p>Staged mock unit · local draft · not submitted.</p>
        </div>}
        {!online && <div className={`${styles.noticeBox} ${styles.noticeWarning}`} role="status"><CloudOff size={18} aria-hidden="true" /><p>Offline. Capture and review stay on this device; live analysis needs a connection.</p></div>}
        {pendingAnalysisIntent && <div className={`${styles.noticeBox} ${styles.noticeWarning}`} role="status"><CloudOff size={18} aria-hidden="true" /><p>Analysis for {roomLabel(pendingAnalysisIntent.roomId)} is waiting for a connection. It will not send automatically. {online && pendingForSelectedRoom ? "Tap Retry analysis below to send it." : `Select ${roomLabel(pendingAnalysisIntent.roomId)} to retry it.`}</p></div>}
        {storageWarning && <div className={`${styles.noticeBox} ${styles.noticeWarning}`} role="alert"><AlertCircle size={18} aria-hidden="true" /><p>{storageWarning}</p></div>}
        {analysisNotice && <div className={`${styles.noticeBox} ${styles.noticeSuccess}`} role="status"><CheckCircle2 size={18} aria-hidden="true" /><p>{analysisNotice}</p></div>}
      </div>

      <main id="main-content" ref={mainScrollRef} className={styles.main}>
        {step === "home" && (
          <>
            <StepHeader headingRef={stepHeadingRef} eyebrow="INSPECTION HOME" title="Inspection home" lead={canCapture ? record.pseudonym : "One guided pass: film the unit, let AI draft, confirm each requirement."} />
            <section className={`${styles.contentStack} ${styles.homeContent}`} aria-label="Inspection home" data-testid="inspection-home">
              <div className={`${styles.card} ${styles.homeNextCard}`}>
                <p className={styles.draftLabel}>{hasInspectionProgress ? "Next step" : "Your inspection guide"}</p>
                <h2>{guideModel?.nextLabel ?? "Walkthrough complete"}</h2>
                {!hasInspectionProgress && record.fundingType !== "hud" && (
                  <p className={styles.homeAgentRow} data-testid="home-voice-entry">
                    <span className={styles.homeAgentAvatar} aria-hidden="true"><Mic size={17} /></span>
                    <span>Voice-led · about 10 minutes. I explain each step out loud — just answer by voice and follow along.</span>
                  </p>
                )}
                <p className={styles.cardLead}>
                  {record.fundingType === "hud"
                    ? "This unit needs the HQS workflow. Form 1083 cannot be completed here."
                    : hasInspectionProgress
                      ? "The AI drafts from your room videos. You only confirm each requirement in person — nothing is decided for you."
                      : "Tap Start below and I will talk you through setup, filming, and every AI draft to a finished Form 1083."}
                </p>
                {record.fundingType !== "hud" && (
                  <div className={styles.homeContinueRow}>
                    <button
                      className={`${styles.button} ${styles.wideButton}`}
                      type="button"
                      data-testid="start-guided-tour"
                      onClick={() => changeStep("guided")}
                    >
                      {hasInspectionProgress ? "Continue inspection" : "Start inspection"} <ArrowRight size={17} aria-hidden="true" />
                    </button>
                    <button className={styles.secondaryButton} type="button" onClick={() => void startNewInspection()}>
                      {hasInspectionProgress ? "Start new inspection" : "New inspection"}
                    </button>
                  </div>
                )}
              </div>

              <section className={styles.card} aria-labelledby="home-inspections-heading" data-testid="saved-inspections">
                <div className={styles.cardTitleRow}>
                  <div>
                    <h2 id="home-inspections-heading">Saved inspections</h2>
                    <p className={styles.cardLead}>{inspections.length === 0 ? "This walkthrough saves here automatically." : `${inspections.length} saved on this device. Tap one to open it.`}</p>
                  </div>
                  <FolderOpen size={21} aria-hidden="true" />
                </div>
                {inspections.length > 0 && (
                  <ul className={styles.homeRequirementList}>
                    {inspections.map((item) => {
                      const clipCount = item.roomIds.filter((roomId) => item.clipIdentities[roomId]).length;
                      const decidedCount = MOVE_IN_READY_ELEMENTS.filter((element) => (item.decisions[element.id]?.status ?? "unreviewed") !== "unreviewed").length;
                      const isActive = item.sessionId === record.sessionId;
                      const updated = item.updatedAt.slice(0, 10);
                      return (
                        <li key={item.sessionId}>
                          <div className={styles.inspectionRow}>
                            <button
                              type="button"
                              className={styles.homeRequirementRow}
                              aria-label={`Open inspection ${item.pseudonym.trim() || "Untitled inspection"}`}
                              onClick={() => void switchInspection(item.sessionId)}
                            >
                              <span className={styles.homeRequirementCopy}>
                                <strong>{item.pseudonym.trim() || "Untitled inspection"}{isActive ? " · Current" : ""}</strong>
                                <small>{item.fundingType === "lahsa" ? "LAHSA" : item.fundingType === "hud" ? "HUD" : "No funding"} · {clipCount}/4 clips · {decidedCount}/11 decided{item.signoff ? " · Signed" : ""} · {updated}</small>
                              </span>
                            </button>
                            {canReinspect(item) && (
                              <button
                                type="button"
                                className={styles.secondaryButton}
                                aria-label={`Re-inspect deficiencies for ${item.pseudonym.trim() || "Untitled inspection"}`}
                                onClick={() => void startReinspection(item.sessionId)}
                              >
                                Re-inspect deficiencies
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.iconButton}
                              aria-label={`Delete inspection ${item.pseudonym.trim() || "Untitled inspection"}`}
                              onClick={() => void deleteInspection(item.sessionId)}
                            >
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {guideModel && (
                <ol className={styles.homeStages} aria-label="Inspection progress">
                  {guideModel.steps.map((stage, index) => (
                    <li key={stage.id} className={`${styles.homeStage} ${stage.state === "done" ? styles.homeStageDone : stage.state === "current" ? styles.homeStageCurrent : ""}`}>
                      <span className={styles.homeStageNumber}>{stage.state === "done" ? <CheckCircle2 size={16} aria-hidden="true" /> : index + 1}</span>
                      <span className={styles.homeStageCopy}><strong>{stage.title}</strong><small>{stage.detail}</small></span>
                      <span className={styles.homeStageState}>{stage.state === "done" ? "Done" : stage.state === "current" ? "Next" : "Locked"}</span>
                    </li>
                  ))}
                </ol>
              )}

              <section className={styles.card} aria-labelledby="home-requirements-heading">
                <div className={styles.cardTitleRow}>
                  <div>
                    <h2 id="home-requirements-heading">Form 1083 requirements</h2>
                    <p className={styles.cardLead}>{reviewCounts.resolved} of {MOVE_IN_READY_ELEMENTS.length} decided · AI drafts stay unreviewed until you confirm them.</p>
                  </div>
                  <ClipboardCheck size={21} aria-hidden="true" />
                </div>
                <div className={styles.homeProgressTrack} role="progressbar" aria-label="Requirements decided" aria-valuemin={0} aria-valuemax={MOVE_IN_READY_ELEMENTS.length} aria-valuenow={reviewCounts.resolved}>
                  <span style={{ width: `${(reviewCounts.resolved / MOVE_IN_READY_ELEMENTS.length) * 100}%` }} />
                </div>
                <ul className={styles.homeRequirementList}>
                  {MOVE_IN_READY_ELEMENTS.map((element, index) => {
                    const decision = record.decisions[element.id];
                    const proposal = record.proposals[element.id];
                    const status = decision.status === "A" ? "Approved" : decision.status === "D" ? "Deficient" : decision.status === "needs-human-check" ? "Check" : proposal ? "AI draft" : "Open";
                    return (
                      <li key={element.id}>
                        <button
                          type="button"
                          className={styles.homeRequirementRow}
                          disabled={record.fundingType !== "lahsa"}
                          onClick={() => { changeStep("review"); openReviewElement(element.id); }}
                        >
                          <span className={styles.elementOverviewNumber}>{index + 1}</span>
                          <span className={styles.homeRequirementCopy}><strong>{element.label}</strong><small>{element.roomIds.map((roomId) => roomLabel(roomId)).join(" · ")}</small></span>
                          <span className={styles.elementOverviewStatus}>{status}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className={styles.card} aria-labelledby="home-rooms-heading">
                <div className={styles.cardTitleRow}>
                  <div>
                    <h2 id="home-rooms-heading">Room evidence</h2>
                    <p className={styles.cardLead}>{capturedRoomCount} of {rooms.length} clips saved. One continuous take per room.</p>
                  </div>
                  <Video size={21} aria-hidden="true" />
                </div>
                <div className={styles.homeRoomGrid}>
                  {roomClips.map((room) => (
                    <button
                      key={room.id}
                      type="button"
                      className={styles.homeRoomButton}
                      disabled={!canCapture}
                      onClick={() => { changeStep("capture"); selectRoom(room.id); }}
                    >
                      <strong>{room.label}</strong>
                      <span>{room.captured ? "Filmed" : "Not filmed"}</span>
                    </button>
                  ))}
                </div>
                {!canCapture && <p className={styles.helpText}>Finish unit setup first — Continue above takes you there.</p>}
              </section>

              <section className={styles.card} aria-labelledby="home-prescreen-heading">
                <div className={styles.cardTitleRow}>
                  <div>
                    <h2 id="home-prescreen-heading">Building pre-screen</h2>
                    <p className={styles.cardLead}>Illustrative in this demo — live records are not connected.</p>
                  </div>
                  <ShieldCheck size={21} aria-hidden="true" />
                </div>
                <BuildingPrescreen />
              </section>
            </section>
          </>
        )}

        {step === "guided" && (
          <>
            <StepHeader headingRef={stepHeadingRef} compact eyebrow="GUIDED INSPECTION" title="Guided inspection" lead="The voice guide narrates every step. Answer by voice or tap." backLabel="home" onBack={() => changeStep("home")} />
            <section className={styles.contentStack} aria-label="Guided inspection">
              <GuidedTourView
                bindings={{
                  sessionId,
                  record,
                  rooms,
                  capturedRoomIds,
                  capturedRoomCount,
                  analysisMode,
                  online,
                  voiceTranscript,
                  onVoiceTranscript: setVoiceTranscript,
                  batchActive,
                  batchProgress,
                  batchFailedRooms,
                  analysisQueue: record.analysisQueue ?? [],
                  analysisComplete: tourAnalysisComplete,
                  setEvaluatorName: (name) => setProfileField("evaluatorName", name),
                  setUnitType: (unit) => setUnitDescription(
                    unit,
                    recordRef.current?.bathCount ?? 1,
                    recordRef.current?.roomIds.includes("hallway") ?? false,
                  ),
                  setBathCount: (count) => {
                    const unit = recordRef.current?.unitType;
                    if (unit) {
                      setUnitDescription(unit, count, recordRef.current?.roomIds.includes("hallway") ?? false);
                    }
                  },
                  grantTourConsent,
                  skipRoom,
                  selectRoom,
                  onClipChange: (clip, roomId) => handleClipChange(clip, roomId),
                  onRecordingStateChange: setRecordingInProgress,
                  answerVoiceCheck,
                  attachDetectorStill,
                  grantBatchConsent,
                  startBatchAnalysis,
                  cancelBatchAnalysis,
                  reviewProposalDraft,
                  confirmProposalDraft,
                  markNeedsCheck,
                  changeStep,
                  drafts,
                  saveElementDetails,
                  saveFireSafety,
                  setAgencyName: (name) => setProfileField("evaluatorAgencyName", name),
                  setLandlordDiscussion: (value) => setProfileField("landlordDiscussion", value),
                  setLandlordDate: (date) => setProfileField("landlordDiscussionDate", date),
                  setLeadershipName: (name) => setProfileField("leadershipNameAndTitle", name),
                  setLeadershipSignature: (signature) => setProfileField("leadershipSignoff", signature),
                  setLeadershipDate: (date) => setProfileField("leadershipSignedAt", date),
                  participantName,
                  participantSignature,
                  participantAttested,
                  setParticipantName,
                  setParticipantSignature,
                  setParticipantAttested,
                  saveParticipantSignoff,
                  signoffName,
                  signoffAttested,
                  setSignoffName,
                  setSignoffAttested,
                  saveSignoff,
                  actionError: reviewError || exportError,
                }}
              />
            </section>
          </>
        )}

        {step === "capture" && (
          <>
            <StepHeader headingRef={stepHeadingRef} compact eyebrow="STEP 1 OF 3 · FILM" title="Film the unit" lead={canCapture ? `${record.pseudonym} · one take per room, then AI drafts the checklist` : "Set up this unit to begin recording."} backLabel="home" onBack={() => changeStep("home")} />
            <section className={`${styles.contentStack} ${styles.captureContent}`} aria-label="Video capture">
              {!canCapture && <div className={styles.card}>
                <button className={styles.setupToggle} type="button" data-testid="capture-setup-toggle" aria-expanded={setupExpanded} aria-controls="capture-setup-fields" onClick={() => setSetupExpanded((expanded) => !expanded)}>
                  <span className={styles.setupToggleCopy}>
                    <span className={styles.setupToggleTitle} role="heading" aria-level={2}>Inspection setup</span>
                    <span className={styles.setupToggleDetail}>{canCapture ? `${record.pseudonym} · LAHSA / Form 1083` : "Use a unit pseudonym and choose the funding path before filming."}</span>
                  </span>
                  <span className={styles.setupToggleIcons}><ClipboardCheck size={19} aria-hidden="true" /><ChevronDown className={setupExpanded ? styles.setupChevronExpanded : styles.setupChevron} size={18} aria-hidden="true" /></span>
                </button>
                {setupExpanded && <div className={styles.setupContent} id="capture-setup-fields">
                  <div className={styles.fieldGrid}>
                    <div className={styles.field}>
                      <label htmlFor="capture-pseudonym">Unit pseudonym</label>
                      <input id="capture-pseudonym" className={styles.formInput} value={record.pseudonym} maxLength={80} placeholder="For example, Demo Unit 04" onChange={(event) => setProfileField("pseudonym", event.currentTarget.value)} />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="capture-funding">Funding type</label>
                      <select id="capture-funding" className={styles.formSelect} value={record.fundingType} onChange={(event) => {
                        const v = event.currentTarget.value;
                        // Accept only the known FundingType union so the compiler and
                        // runtime cannot be silently coerced by unexpected option
                        // values. Map HUD-funded CoC/ESG into the LAHSA/FORM 1083
                        // route here: the form requires Form 1083 for HUD-funded
                        // CoC/ESG units while Housing Authority vouchers go to HQS.
                        if (v === "lahsa" || v === "hud" || v === "unknown") {
                          setProfileField("fundingType", v);
                        } else if (v === "other") {
                          // Back-compatibility: treat the former "other" option
                          // as LAHSA so it reaches the Form 1083 export path.
                          setProfileField("fundingType", "lahsa");
                        }
                      }}>
                        <option value="unknown">Choose funding type</option>
                        <option value="lahsa">LAHSA / Form 1083</option>
                        <option value="hud">Housing Authority or voucher (HQS required)</option>
                        <option value="lahsa">HUD-funded (CoC/ESG) — Form 1083 applies</option>
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="capture-unit-type">Unit type</label>
                      <select id="capture-unit-type" className={styles.formSelect} value={record.unitType} onChange={(event) => { const next = event.currentTarget.value as MoveInReadyUnitType | ""; if (next !== "") setUnitDescription(next, record.bathCount, record.roomIds.includes("hallway")); }}>
                        <option value="">Choose unit type</option>
                        <option value="studio">Studio</option>
                        <option value="1-bedroom">1 bedroom</option>
                        <option value="2-bedroom">2 bedroom</option>
                        <option value="3-bedroom">3 bedroom</option>
                        <option value="4-bedroom">4 bedroom</option>
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="capture-baths">Bathrooms</label>
                      <select id="capture-baths" className={styles.formSelect} value={String(record.bathCount)} disabled={record.unitType === ""} onChange={(event) => { if (record.unitType !== "") setUnitDescription(record.unitType, Number(event.currentTarget.value), record.roomIds.includes("hallway")); }}>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                      </select>
                    </div>
                  </div>
                  {record.fundingType === "hud" && <div className={`${styles.callout} ${styles.calloutDanger}`} role="alert"><strong>HQS workflow required.</strong> This app only supports the LAHSA Form 1083 path. HUD-funded units cannot receive a result or export here.</div>}
                  {record.fundingType === "unknown" && <div className={`${styles.callout} ${styles.calloutWarning}`} role="status">Select the unit’s funding type to continue.</div>}
                </div>}
              </div>}

              {!canCapture && record.fundingType !== "hud" && (
                <div className={`${styles.callout} ${styles.captureSetupGate}`} role="status" data-testid="capture-setup-gate">
                  <strong>Finish unit setup to enable recording.</strong> Enter a pseudonym, select LAHSA / Form 1083, and describe the unit above. No video is sent unless you later choose live analysis.
                </div>
              )}

              {record.fundingType !== "hud" && (
                <>
                  {canCapture && (
                    <div className={`${styles.card} ${styles.captureNextBar}`} data-testid="capture-next-bar">
                      <div>
                        <strong>{capturedRoomCount} of {rooms.length} rooms filmed</strong>
                        <p className={styles.cardLead}>
                          {capturedRoomCount === 0
                            ? "Film one continuous take per room. The AI drafts every requirement from your clips."
                            : nextRoomToFilm
                              ? "Saved on this device. Film the next room, or let AI analyze the saved clips now."
                              : "Every room is filmed. Run AI analysis once, then confirm the checklist."}
                        </p>
                      </div>
                      {nextRoomToFilm ? (
                        <button className={styles.button} type="button" onClick={() => selectRoom(nextRoomToFilm.id)}>
                          Film next: {nextRoomToFilm.label} <ArrowRight size={16} aria-hidden="true" />
                        </button>
                      ) : (
                        <button className={styles.button} type="button" onClick={() => changeStep("review")}>
                          Open requirement checklist <ArrowRight size={16} aria-hidden="true" />
                        </button>
                      )}
                      {capturedRoomCount === 0 && analysisMode === "live" && online && (
                        <div className={styles.walkthroughConsent} data-testid="walkthrough-consent">
                          <strong>Hands-free AI walkthrough</strong>
                          <p className={styles.cardLead}>Confirm once. Film every room and the AI analyzes every clip by itself, then brings you the report.</p>
                          <label className={styles.checkLabel}>
                            <input type="checkbox" checked={walkthroughAttested} onChange={(event) => setWalkthroughAttested(event.currentTarget.checked)} />
                            <span>Every clip I film is staged/mock-unit footage with no tenants, faces, addresses, personal documents, or real case notes.</span>
                          </label>
                          <label className={styles.checkLabel}>
                            <input type="checkbox" checked={walkthroughSendConsent} onChange={(event) => setWalkthroughSendConsent(event.currentTarget.checked)} />
                            <span>I understand each filmed clip will be sent for live processing by Meta.</span>
                          </label>
                        </div>
                      )}
                      {capturedRoomCount > 0 && (
                        <details className={styles.batchDisclosure} data-testid="batch-analysis-disclosure">
                          <summary>
                            <span><strong>AI analyzes every filmed room</strong><small>{batchActive && batchProgress ? `Working: ${batchProgress.roomLabel} · ${batchProgress.done} of ${batchProgress.total} · ${formatBatchElapsed(Date.now() - batchProgress.startedAt, batchTick)} · ${analysisStatus === "mapping" ? "Mapping" : "Segmenting"}…` : `${capturedRoomCount} clip${capturedRoomCount === 1 ? "" : "s"} ready · one tap`}</small></span>
                          </summary>
                          <div className={styles.batchBody}>
                            {analysisMode !== "live" && <p className={styles.helpText} role="status">{analysisMode === "fixture" ? "Sample mode: batch analysis runs only against live Meta. No sample result will be substituted." : "Live Meta analysis is off on this server."}</p>}
                            {!online && <p className={styles.helpText} role="status">Offline. Batch analysis needs a connection.</p>}
                            <label className={styles.checkLabel}>
                              <input type="checkbox" checked={batchAttested} disabled={batchActive} onChange={(event) => setBatchAttested(event.currentTarget.checked)} />
                              <span>All {capturedRoomCount} filmed {capturedRoomCount === 1 ? "clip is" : "clips are"} staged/mock-unit footage with no tenants, faces, addresses, personal documents, or real case notes.</span>
                            </label>
                            <label className={styles.checkLabel}>
                              <input type="checkbox" checked={batchSendConsent} disabled={batchActive} onChange={(event) => setBatchSendConsent(event.currentTarget.checked)} />
                              <span>I understand the filmed clips will be sent up to two rooms at a time for live processing by Meta.</span>
                            </label>
                            {batchFailedRooms.length > 0 && !batchActive && <p className={styles.inlineError} role="alert">Needs attention: {batchFailedRooms.join(", ")}.</p>}
                            <div className={styles.buttonRow}>
                              {batchActive ? (
                                <>
                                  <button className={styles.secondaryButton} type="button" onClick={cancelBatchAnalysis}>Cancel batch</button>
                                  <span className={styles.statusText} role="status">{batchProgress && batchProgress.roomLabel ? `Analyzing ${batchProgress.roomLabel}… ${batchProgress.done} of ${batchProgress.total} done` : "Starting batch…"}</span>
                                </>
                              ) : (
                                <button className={`${styles.button} ${styles.wideButton}`} type="button" disabled={analysisMode !== "live" || !online || !batchAttested || !batchSendConsent} onClick={startBatchAnalysis}>
                                  <Video size={17} aria-hidden="true" /> Analyze {capturedRoomCount} filmed room{capturedRoomCount === 1 ? "" : "s"}
                                </button>
                              )}
                            </div>
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                  <WalkthroughVideoCapture
                    key={`${sessionId}:${selectedRoomId}`}
                    controlRef={captureControlRef}
                    sessionId={sessionId}
                    rooms={rooms}
                    roomId={selectedRoomId}
                    capturedRoomCount={capturedRoomCount}
                    capturedRoomIds={capturedRoomIds}
                    queuedRoomIds={record.analysisQueue ?? []}
                    onRecordingStateChange={setRecordingInProgress}
                    overlayCue={recordingInProgress ? filmingScriptForRoom(selectedRoomId)[recordingCueIndex] ?? null : null}
                    completedPromptIds={record.completedPromptIdsByRoom[selectedRoomId] ?? []}
                    onPromptCompletionChange={(promptId, completed) => {
                      updateRecord((current) => ({
                        ...current,
                        completedPromptIdsByRoom: {
                          ...current.completedPromptIdsByRoom,
                          [selectedRoomId]: updateChecked(
                            current.completedPromptIdsByRoom[selectedRoomId] ?? [],
                            promptId,
                            completed,
                            1,
                          ) as MoveInReadyPromptId[],
                        },
                      }));
                    }}
                    onRoomChange={(roomId) => selectRoom(roomId)}
                    disabled={!canCapture || (!batchActive && (analysisStatus === "segmenting" || analysisStatus === "mapping"))}
                    onClipChange={(clip, roomId) => handleClipChange(clip, roomId)}
                    detailsExpanded={clipDetailsExpanded}
                    onDetailsExpandedChange={setClipDetailsExpanded}
                  >
                    <details className={`${styles.card} ${styles.analysisDisclosure}`} open={analysisExpanded} onToggle={(event) => setAnalysisExpanded(event.currentTarget.open)} data-testid="analysis-disclosure">
                      <summary className={styles.analysisSummary}>
                        <span className={styles.analysisSummaryCopy}>
                          <strong>Live video analysis</strong>
                          <span>{analysisStatus === "complete" ? "Analysis returned unreviewed suggestions." : "SAM finds review moments; Muse drafts possible Form 1083 links."}</span>
                        </span>
                        <span className={styles.analysisSummaryAction}>
                          {analysisExpanded ? "Hide details" : "Consent & analysis"}
                          <ChevronDown className={analysisExpanded ? styles.setupChevronExpanded : styles.setupChevron} size={17} aria-hidden="true" />
                        </span>
                      </summary>
                      <div className={styles.analysisDetails}>
                        {analysisMode === "fixture" && <div className={`${styles.callout} ${styles.calloutWarning}`} role="status">Sample mode is active. This video flow will not invent a sample result or fall back when live analysis is unavailable.</div>}
                        {analysisMode === "unconfigured" && <div className={`${styles.callout} ${styles.calloutDanger}`} role="status">Live Meta analysis is off on this server. Configure APP_ANALYSIS_MODE=live and restart the server to enable it.</div>}
                        {analysisMode === "live" && <div className={`${styles.callout} ${styles.calloutWarning}`} role="status">Live mode is enabled, but the provider connection has not been tested. A request is sent only for consented analysis: confirm the per-room notices below, or walkthrough and batch consent to analyze each saved clip automatically.</div>}
                        {clips[selectedRoomId]?.mime === "video/quicktime" && <div className={`${styles.callout} ${styles.calloutWarning}`} role="status">Meta&apos;s current video upload API accepts MP4 only. This MOV stays on this device for manual review; choose or record an MP4 for live analysis.</div>}
                        <div className={`${styles.callout} ${styles.calloutWarning}`}><p>Sending a room transmits its clip to this server and Meta for temporary SAM processing. Candidate stills and one-per-second source samples go to Meta Muse; if Meta Muse is unavailable and a Baseten key is configured, Baseten Muse Spark Open may receive those stills as a fallback. Check every observation yourself. Provider terms determine retention; local deletion does not delete provider copies.</p></div>
                        <label className={styles.checkLabel}>
                          <input
                            type="checkbox"
                            checked={mockUnitAttested}
                            disabled={!selectedConsentKey}
                            onChange={(event) => {
                              setMockUnitAttestationKey(event.currentTarget.checked ? selectedConsentKey : null);
                              if (!event.currentTarget.checked) invalidateActiveAnalysis("Mock-unit attestation was withdrawn; video analysis stopped.");
                            }}
                          />
                          <span>I attest this is staged/mock-unit footage with no tenants, faces, addresses, personal documents, or real case notes.</span>
                        </label>
                        <label className={styles.checkLabel}>
                          <input
                            type="checkbox"
                            checked={sendVideoConsent}
                            disabled={!selectedConsentKey}
                            onChange={(event) => {
                              setSendVideoConsentKey(event.currentTarget.checked ? selectedConsentKey : null);
                              if (!event.currentTarget.checked) invalidateActiveAnalysis("Processing consent was withdrawn; video analysis stopped.");
                            }}
                          />
                          <span>I understand this selected mock-unit video and its sampled stills will be sent for live processing by Meta and, if configured for fallback, Baseten.</span>
                        </label>
                        {analysisError && <p className={styles.inlineError} role="alert">{analysisError}</p>}
                        <div className={styles.buttonRow}>
                          <button className={`${styles.button} ${styles.wideButton}`} type="button" onClick={() => { const roomId = selectedRoomId; void analyzeRoomFor(roomId).finally(() => { analysisInFlightRef.current.delete(roomId); }); }} disabled={batchActive || analysisMode !== "live" || !clips[selectedRoomId] || clips[selectedRoomId]?.mime === "video/quicktime" || !mockUnitAttested || !sendVideoConsent || analysisStatus === "segmenting" || analysisStatus === "mapping" || (!online && Boolean(pendingForSelectedRoom))}>
                            {(analysisStatus === "segmenting" || analysisStatus === "mapping") && !batchActive ? <><LoaderCircle className={styles.spinner} size={17} aria-hidden="true" /> {analysisStatus === "segmenting" ? "Segmenting room video…" : "Mapping source stills…"} <span aria-hidden="true">{formatTimestamp(analysisElapsedSeconds)}</span></> : pendingForSelectedRoom ? online ? <><RefreshCw size={17} aria-hidden="true" /> Retry analysis</> : <><CloudOff size={17} aria-hidden="true" /> Analysis queued</> : analysisStatus === "complete" ? <><RefreshCw size={17} aria-hidden="true" /> Analyze this room again</> : online ? <><Video size={17} aria-hidden="true" /> Analyze this room</> : <><CloudOff size={17} aria-hidden="true" /> Queue analysis for when connected</>}
                          </button>
                          {(analysisStatus === "segmenting" || analysisStatus === "mapping") && !batchActive && <button className={styles.secondaryButton} type="button" onClick={() => invalidateActiveAnalysis("Analysis was cancelled. No result was saved.")}>Cancel</button>}
                        </div>
                        <p className={styles.privacyText}>Each explicit run makes one segmentation stage and one mapping stage. No automatic paid retries. A clip is uploaded only for analysis you authorized: your Analyze tap, or automatically on save when walkthrough and batch consent are confirmed.</p>
                        {analysisStatus === "error" && analysisError && <p className={styles.statusText} role="status">No sample result was substituted.</p>}
                      </div>
                    </details>
                  </WalkthroughVideoCapture>
                  {clips[selectedRoomId] && canCapture && (() => {
                    const parsed = parseRoomId(selectedRoomId);
                    if (!parsed) return null;
                    const questions = checksForRoom(record, selectedRoomId);
                    const answers = record.voiceChecks[selectedRoomId] ?? [];
                    const turn = voiceTurn?.roomId === selectedRoomId ? voiceTurn : null;
                    const turnQuestion = turn ? questions[turn.index] : undefined;
                    return (
                      <section id="room-checks" className={styles.card} aria-label={`In-person checks for ${roomLabel(selectedRoomId)}`} data-testid="room-checks">
                        <div className={styles.cardTitleRow}><div>
                          <h2>In-person checks · {roomLabel(selectedRoomId)}</h2>
                          <p className={styles.cardLead}>The camera can&apos;t prove these. Answer by voice or tap — answers attach to your decisions.</p>
                        </div></div>
                        <ul className={styles.voiceCheckList}>
                          {questions.map((question, index) => {
                            const entry = answers.find((item) => item.question === question);
                            return (
                              <li key={question}>
                                <span>{question}</span>
                                {entry ? <strong>{entry.answer}</strong> : (
                                  <button className={styles.linkButton} type="button" onClick={() => { setVoiceTranscript(null); setVoiceTurn({ roomId: selectedRoomId, index }); }}>
                                    Answer
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        {turn && turnQuestion && (
                          <VoicePrompt
                            key={`${selectedRoomId}:${turn.index}`}
                            question={turnQuestion}
                            autoSpeak
                            transcript={voiceTranscript}
                            onTranscript={(text) => {
                              setVoiceTranscript(text);
                              const parsedAnswer = parseYesNo(text);
                              if (parsedAnswer) answerVoiceCheck(selectedRoomId, turnQuestion, parsedAnswer);
                            }}
                          >
                            <div className={styles.voiceTapRow}>
                              <button className={styles.secondaryButton} type="button" onClick={() => answerVoiceCheck(selectedRoomId, turnQuestion, "yes")}>Yes</button>
                              <button className={styles.secondaryButton} type="button" onClick={() => answerVoiceCheck(selectedRoomId, turnQuestion, "no")}>No</button>
                              <button className={styles.secondaryButton} type="button" onClick={() => answerVoiceCheck(selectedRoomId, turnQuestion, "skipped")}>Skip</button>
                            </div>
                          </VoicePrompt>
                        )}
                      </section>
                    );
                  })()}

                </>
              )}
            </section>
          </>
        )}

        {step === "review" && (
          <>
            <StepHeader
              headingRef={stepHeadingRef}
              eyebrow="STEP 2 OF 3 · CHECKLIST"
              title={record.fundingType === "hud" ? "HQS required" : record.fundingType === "unknown" ? "Choose funding type" : reviewNoteOpen ? "Add Note" : mobileReviewDetailOpen && !isWideLayout && activeElementId ? MOVE_IN_READY_ELEMENTS.find((element) => element.id === activeElementId)?.label ?? "Requirement review" : "Requirement checklist"}
              lead={record.fundingType === "hud" ? "Use the HQS inspection workflow for HUD-funded units." : record.fundingType === "unknown" ? "Choose the applicable route in Profile before reviewing." : reviewNoteOpen ? "Add a short note to this local walkthrough." : mobileReviewDetailOpen && !isWideLayout ? `Requirement ${activeReviewIndex + 1} of ${MOVE_IN_READY_ELEMENTS.length} · confirm in person` : `${record.pseudonym} · ${reviewCounts.resolved} of ${MOVE_IN_READY_ELEMENTS.length} requirements decided`}
              backLabel={reviewNoteOpen ? "checklist" : mobileReviewDetailOpen && !isWideLayout ? "checklist" : "home"}
              onBack={() => {
                if (reviewNoteOpen) {
                  setReviewNoteOpen(false);
                } else if (mobileReviewDetailOpen && !isWideLayout) {
                  returnToReviewOverview();
                } else {
                  changeStep("home");
                }
              }}
            />
            <div className={`${styles.contentStack} ${styles.reviewContent}`}>
              {record.fundingType !== "lahsa" ? <section className={`${styles.card} ${styles.reviewRoute}`} aria-labelledby="review-funding-route-heading">
                <h2 id="review-funding-route-heading">{record.fundingType === "hud" ? "HQS inspection required" : "Choose a funding type"}</h2>
                <div className={`${styles.callout} ${record.fundingType === "hud" ? styles.calloutDanger : styles.calloutWarning}`} role={record.fundingType === "hud" ? "alert" : "status"}>
                  <strong>{record.fundingType === "hud" ? "HQS is required for HUD-funded units." : "Funding type is required."}</strong>{" "}
                  {record.fundingType === "hud"
                    ? "This Form 1083 review cannot be completed. This app does not perform an HQS inspection."
                    : "Choose LAHSA / Form 1083 or HUD / HQS in Profile before continuing."}
                </div>
                <button className={styles.secondaryButton} type="button" onClick={() => { setProfileSection("unit"); changeStep("profile"); }}>
                  Review funding type <ArrowRight size={16} aria-hidden="true" />
                </button>
              </section> : reviewNoteOpen ? <section className={`${styles.card} ${styles.reviewNoteCard}`} aria-label="Inspection note">
                <label className={styles.fieldLabel} htmlFor="review-inspection-note">Inspection note</label>
                <textarea id="review-inspection-note" className={styles.formTextarea} value={reviewNoteDraft} maxLength={2000} onChange={(event) => setReviewNoteDraft(event.currentTarget.value)} placeholder="Record a short observation for this walkthrough." />
                <p className={styles.helpText}>Saved on this device only. Do not enter tenant names, addresses, or real case details. This note is not included in exports.</p>
                <div className={styles.reviewNoteActions}>
                  <button className={styles.secondaryButton} type="button" onClick={() => { setReviewNoteDraft(record.inspectionNote); setReviewNoteOpen(false); }}>Cancel</button>
                  <button className={styles.button} type="button" onClick={() => {
                    const nextNote = reviewNoteDraft.trim();
                    if (nextNote !== record.inspectionNote) {
                      updateRecord((current) => ({ ...current, inspectionNote: nextNote, signoff: null, participantSignoff: null }));
                      setSignoffAttested(false);
                      setSignoffName("");
                    }
                    setReviewNoteOpen(false);
                    scrollMainToTop("smooth");
                  }}>Save note</button>
                </div>
              </section> : <>
              <div className={styles.reviewSummary}>
                <div><span>Requirements decided</span><strong>{reviewCounts.resolved} of {MOVE_IN_READY_ELEMENTS.length} reviewed</strong></div>
                <div className={styles.decisionTotals}>A {reviewCounts.approved} · D {reviewCounts.deficient}</div>
              </div>
              <div className={styles.homeProgressTrack} role="progressbar" aria-label="Checklist progress" aria-valuemin={0} aria-valuemax={MOVE_IN_READY_ELEMENTS.length} aria-valuenow={reviewCounts.resolved}>
                <span style={{ width: `${(reviewCounts.resolved / MOVE_IN_READY_ELEMENTS.length) * 100}%` }} />
              </div>
              {!mobileReviewDetailOpen && reviewCounts.resolved < MOVE_IN_READY_ELEMENTS.length && nextUndecidedElement && (
                <button className={`${styles.button} ${styles.wideButton}`} type="button" onClick={() => openReviewElement(nextUndecidedElement.id)}>
                  Review next: {nextUndecidedElement.label} <ArrowRight size={16} aria-hidden="true" />
                </button>
              )}
              {!mobileReviewDetailOpen && reviewCounts.resolved === MOVE_IN_READY_ELEMENTS.length && (
                <button className={`${styles.button} ${styles.wideButton}`} type="button" onClick={() => changeStep("signoff")}>
                  Continue to sign-off <ArrowRight size={17} aria-hidden="true" />
                </button>
              )}
              <section className={`${styles.card} ${styles.reviewOverview} ${mobileReviewDetailOpen ? styles.reviewOverviewHiddenOnMobile : ""}`} aria-label="All 11 inspection elements">
                <div className={styles.cardTitleRow}><div><h2>Checklist — hardest first</h2><p className={styles.cardLead}>
                  {hasAnyProposals ? "AI drafts are proposed below. Open each requirement, complete your in-person check, and record your own decision." : "No AI draft yet. Open each requirement to assess it in person."}
                  {!record.evaluatorName.trim() && <> Evaluator name is required before recording a decision. <button className={styles.linkButton} type="button" onClick={openProfileForRequiredDetails}>Set up profile</button></>}
                </p></div></div>
                <ul className={styles.elementOverview} id="element-overview-list">
                  {sortedReviewElements(record.proposals, record.decisions).map(({ element, index }) => {
                    const decision = record.decisions[element.id];
                    const proposal = record.proposals[element.id];
                    const decisionEvidence = decision.status === "A" || decision.status === "D" ? decision.evidence : [];
                    const overviewEvidenceList = decisionEvidence.length > 0 ? decisionEvidence : proposal?.evidence ?? [];
                    const overviewEvidence = overviewEvidenceList[0];
                    const overviewEvidenceView = overviewEvidence ? evidenceViews.find(({ reference }) =>
                      reference.videoId === overviewEvidence.videoId &&
                      reference.videoRevision === overviewEvidence.videoRevision &&
                      reference.stillId === overviewEvidence.stillId,
                    ) : undefined;
                    const remainingEvidenceCount = Math.max(0, overviewEvidenceList.length - 1);
                    const evidenceSummary = overviewEvidence
                      ? `${roomLabel(overviewEvidence.roomId)} · ${formatTimestamp(overviewEvidence.timestampMs / 1000)}${remainingEvidenceCount > 0 ? ` +${remainingEvidenceCount}` : ""}`
                      : "";
                    const draftSummary = decision.status === "unreviewed" && proposal
                      ? `${proposal.modelSuggestion} draft · ${proposal.confidence}% · ${proposal.observation}`
                      : decision.status === "needs-human-check"
                        ? "Needs human check"
                        : decision.status === "unreviewed"
                          ? "Manual review needed"
                          : "";
                    const secondarySummary = [draftSummary, evidenceSummary].filter(Boolean).join(" · ");
                    const state = decision.status === "A" ? styles.elementOverviewApproved
                      : decision.status === "D" ? styles.elementOverviewDeficient
                        : decision.status === "needs-human-check" ? styles.elementOverviewCheck : "";
                    const reviewable = decision.status === "unreviewed" && Boolean(proposal);
                    return <li key={element.id} className={styles.elementOverviewItem}>
                      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                        <button type="button" style={{ flex: 1, minWidth: 0 }} className={`${styles.elementOverviewButton} ${overviewEvidenceView ? styles.elementOverviewWithEvidence : ""}`} aria-pressed={element.id === activeElementId && (isWideLayout || mobileReviewDetailOpen)} onClick={() => openReviewElement(element.id)}>
                          <span className={styles.elementOverviewNumber}>{index + 1}</span>
                          <span className={styles.elementOverviewCopy}>
                            <strong>{element.label}</strong>
                            {secondarySummary && <small>{secondarySummary}</small>}
                          </span>
                          <span className={`${styles.elementOverviewStatus} ${state}`}>{decision.status === "A" ? "Approved" : decision.status === "D" ? "Deficient" : decision.status === "needs-human-check" ? "Check" : proposal ? `AI ${proposal.modelSuggestion}` : "Open"}</span>
                          {overviewEvidenceView && <Image className={styles.elementOverviewThumb} src={overviewEvidenceView.src} alt={`Source still for ${element.label}, ${roomLabel(overviewEvidenceView.reference.roomId)} at ${formatTimestamp(overviewEvidenceView.reference.timestampMs / 1000)}`} width={64} height={48} unoptimized />}
                        </button>
                        {reviewable && proposal && (
                          <button type="button" className={styles.secondaryButton} aria-label={`Review ${proposal.modelSuggestion} draft for ${element.label}`} onClick={() => reviewProposalDraft(element.id)}>
                            Review {proposal.modelSuggestion} draft
                          </button>
                        )}
                      </div>
                    </li>;
                  })}
                </ul>
                <div className={styles.overviewActions}>
                  <button className={styles.secondaryButton} type="button" onClick={() => { setReviewNoteDraft(record.inspectionNote); setReviewNoteOpen(true); }}><StickyNote size={16} aria-hidden="true" /> {record.inspectionNote.trim() ? "Edit note" : "Add note"}</button>
                  {record.inspectionNote.trim() && <p className={styles.reviewNotePreview}>Note saved on this device: {record.inspectionNote}</p>}
                </div>
              </section>
              {(() => {
                const ranked = rankDeficiencies(record.decisions);
                if (ranked.length === 0) return null;
                return (
                  <section className={styles.card} aria-label="Landlord fix list preview" data-testid="fix-list-preview">
                    <strong>Fix list preview · risk-ranked</strong>
                    <p className={styles.cardLead}>
                      {ranked.length} deficient item{ranked.length === 1 ? "" : "s"}, life and safety first.
                      The property stays Not Approved until every item is fixed and re-filmed.
                    </p>
                    <ol className={styles.elementOverview}>
                      {ranked.map(({ elementId, decision, tierLabel }, position) => {
                        const element = MOVE_IN_READY_ELEMENTS.find((item) => item.id === elementId);
                        const firstEvidence = decision.evidence[0];
                        const evidenceView = firstEvidence ? evidenceViews.find(({ reference }) =>
                          reference.videoId === firstEvidence.videoId &&
                          reference.videoRevision === firstEvidence.videoRevision &&
                          reference.stillId === firstEvidence.stillId,
                        ) : undefined;
                        return (
                          <li key={elementId} className={styles.elementOverviewItem} data-testid={`fix-list-item-${elementId}`}>
                            <span className={styles.elementOverviewNumber}>{position + 1}</span>
                            <span className={styles.elementOverviewCopy}>
                              <strong>{element?.label ?? elementId}</strong>
                              <small>{tierLabel}</small>
                              <small>Deficient area: {decision.deficiency.issueDescription}</small>
                              <small>Correction: {decision.deficiency.correction}</small>
                              <small>Complete by {decision.deficiency.completionDate} · reinspect {decision.deficiency.reinspectionDate}</small>
                              {firstEvidence && (
                                <small>Still: {roomLabel(firstEvidence.roomId)} · {formatTimestamp(firstEvidence.timestampMs / 1000)}</small>
                              )}
                              <small>{reinspectionChecklist(elementId)}</small>
                            </span>
                            {evidenceView && <Image className={styles.elementOverviewThumb} src={evidenceView.src} alt={`Source still for ${element?.label ?? elementId}`} width={64} height={48} unoptimized />}
                            <button type="button" className={styles.secondaryButton} onClick={() => openReviewElement(elementId)}>
                              Edit decision
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                );
              })()}
              <div className={`${styles.reviewDetails} ${mobileReviewDetailOpen ? styles.reviewDetailsOpen : ""}`} id="review-details">
              {mobileReviewDetailOpen && <div className={styles.reviewDetailProgress} role="status">
                <strong>{reviewCounts.resolved} of {MOVE_IN_READY_ELEMENTS.length} reviewed</strong>
                <span>{reviewCounts.approved} approved · {reviewCounts.deficient} deficient</span>
              </div>}
              <div className={`${styles.callout} ${styles.calloutWarning}`}><p>Video guides the review. Check each item in person; mark “Needs human check” if you cannot assess it.</p></div>
              {!activeElementId && <p className={styles.supportingText}>Select an element from the list to review its evidence and evaluator checks.</p>}
              {reviewError && <p className={styles.inlineError} role="alert">{reviewError}</p>}
              <ul className={styles.elementList}>
                {MOVE_IN_READY_ELEMENTS.filter((element) => element.id === activeElementId).map((element) => {
                  const elementIndex = MOVE_IN_READY_ELEMENT_IDS.indexOf(element.id);
                  const catalogElement = catalogJson.items.find((item) => item.id === element.id);
                  const manualChecks = catalogElement?.manualChecks ?? [];
                  const decision = record.decisions[element.id];
                  const proposal = record.proposals[element.id];
                  const priorDeficiency = decision.status === "unreviewed" ? decision.priorDeficiency : undefined;
                  const evidence = selectedEvidenceForView(element.id);
                  const proposalEvidenceView = proposal?.evidence
                    .map((proposalReference) => evidence.find(({ reference }) => evidenceReferenceBaseKey(reference) === evidenceReferenceBaseKey(proposalReference)))
                    .find((view): view is (typeof evidence)[number] => Boolean(view));
                  const visibleEvidenceView = proposalEvidenceView ?? evidence[0];
                  const correctionStatus = decision.status === "D"
                    ? decision.deficiency.correction.trim() ? "Correction plan recorded" : "Correction plan needed"
                    : decision.status === "unreviewed" ? "No evaluator correction yet" : "No correction required";
                  const draft = drafts[element.id] ?? createDecisionDraft(decision);
                  const isFireSafety = element.id === "demo-smoke-co";
                  const effectiveChoice = isFireSafety ? fireSafetyChoiceFromDraft(draft) : draft.choice;
                  return (
                    <li id={`review-element-${element.id}`} className={styles.elementCard} key={element.id} data-testid={`review-element-${element.id}`} tabIndex={-1}>
                      <div className={styles.elementHeading}>
                        <span className={styles.elementNumber}>{elementIndex + 1}</span>
                        <div className={styles.elementHeadingCopy}><strong>{element.label}</strong><span>{decisionLabel(decision)}</span></div>
                        <span className={`${styles.statusBadge} ${statusClass(decision)}`}>{decision.status === "A" ? "Approved" : decision.status === "D" ? "Deficient" : decision.status === "needs-human-check" ? "Check" : proposal ? "AI draft" : "Not reviewed"}</span>
                      </div>
                      <section className={styles.proposalSummary} aria-label={`${element.label} draft and evidence summary`}>
                        <div className={styles.proposalSummaryCopy}>
                          <p className={styles.draftLabel}>{proposal ? "AI draft · unreviewed" : "Manual assessment"}</p>
                          {proposal ? <>
                            <div className={styles.proposalMarkRow}><strong>{proposal.modelSuggestion} suggestion</strong><span>Draft confidence {Math.round(proposal.confidence)}%</span></div>
                            <p>{proposal.observation}</p>
                            {proposal.state === "needs-human-check" && <p className={styles.proposalWarning}>Needs human check: this draft has no verified linked source still.</p>}
                          </> : <p>No AI draft for this element. Assess it with the source clip and the required in-person checks.</p>}
                          <p className={styles.proposalDecisionMeta}><span>Evaluator: {decisionLabel(decision)}</span><span>{correctionStatus}</span></p>
                          {proposal && !isFireSafety && (
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              onClick={() => updateDecisionDraft(element.id, (current) => prefillDraftFromProposal(current, proposal))}
                            >
                              Use AI draft to pre-fill
                            </button>
                          )}
                          {proposal && <p className={styles.helpText}>Pre-fill only. You still complete the in-person check and save your own decision below.</p>}
                        </div>
                        {visibleEvidenceView ? <figure className={styles.proposalEvidenceFigure}>
                          <Image src={visibleEvidenceView.src} width={160} height={120} unoptimized alt={`${roomLabel(visibleEvidenceView.reference.roomId)} source still at ${formatTimestamp(visibleEvidenceView.reference.timestampMs / 1000)}`} />
                          <figcaption>{roomLabel(visibleEvidenceView.reference.roomId)} · {formatTimestamp(visibleEvidenceView.reference.timestampMs / 1000)}<small>{proposalEvidenceView ? "AI-linked still" : "Available still · not linked to draft"}</small></figcaption>
                        </figure> : <p className={styles.proposalNoEvidence}>No verified source still linked to this draft.</p>}
                      </section>
                      {priorDeficiency && (
                        <section className={styles.proposalSummary} aria-label={`${element.label} prior deficiency from the earlier inspection`} data-testid={`before-deficiency-${element.id}`}>
                          <div className={styles.proposalSummaryCopy}>
                            <p className={styles.draftLabel}>Before · prior inspection, decided {new Date(priorDeficiency.decidedAt).toLocaleDateString()}</p>
                            <p><strong>Prior issue:</strong> {priorDeficiency.issueDescription}</p>
                            <p><strong>Prior correction:</strong> {priorDeficiency.correction}</p>
                            <p className={styles.helpText}>Complete by {priorDeficiency.completionDate} · reinspect {priorDeficiency.reinspectionDate}</p>
                            {(() => {
                              const beforeViews = priorDeficiency.evidenceStillIds
                                .map((stillId) => evidenceViews.find((view) => view.reference.stillId === stillId))
                                .filter((view): view is EvidenceView => Boolean(view));
                              if (beforeViews.length === 0) {
                                return <p className={styles.helpText}>Prior stills are no longer on this device.</p>;
                              }
                              return (
                                <div className={styles.evidenceGrid} aria-label={`${element.label} before stills`}>
                                  {beforeViews.slice(0, 5).map((view) => (
                                    <figure className={styles.evidenceFigure} key={view.reference.stillId}>
                                      <Image src={view.src} width={160} height={120} unoptimized alt={`Before still for ${element.label}, ${roomLabel(view.reference.roomId)} at ${formatTimestamp(view.reference.timestampMs / 1000)}`} />
                                      <figcaption>Before · {roomLabel(view.reference.roomId)} · {formatTimestamp(view.reference.timestampMs / 1000)}</figcaption>
                                    </figure>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        </section>
                      )}
                      <div className={styles.elementBody}>
                        <section className={styles.criteriaPanel} aria-label={`${element.label} required in-person checks`}>
                          <p className={styles.draftLabel}>Required in-person checks</p>
                          {manualChecks.length > 0 ? <ul className={styles.criteriaList}>
                            {manualChecks.map((check) => <li key={check.id}>{check.instruction}</li>)}
                          </ul> : <p>Complete the physical Form 1083 check for this element and record any area you could not assess.</p>}
                          <p className={styles.criteriaNote}>Video stills and AI suggestions cannot complete this check.</p>
                        </section>
                        <div className={styles.decisionBox}>
                          <p className={styles.decisionTitle}>Your assessment</p>
                          {isFireSafety ? <>
                            <div className={styles.fieldGridTwo}>
                              <fieldset className={styles.criteriaPanel}>
                                <legend>Form 1083 section 11a · Unit detectors</legend>
                                <p className={styles.supportingText}>Check occupied levels, smoke-detector placement, and the applicable alarm provision.</p>
                                <div className={styles.choiceRow} role="group" aria-label="Evaluator check for Form 1083 section 11a unit detectors">
                                  <ChoiceButton label="A · Meets" choice="A" selected={draft.fireSafetyUnitDetectors} onClick={() => updateDecisionDraft(element.id, { fireSafetyUnitDetectors: "A" })} />
                                  <ChoiceButton label="D · Deficient" choice="D" selected={draft.fireSafetyUnitDetectors} onClick={() => updateDecisionDraft(element.id, { fireSafetyUnitDetectors: "D" })} />
                                  <ChoiceButton label="Needs check" choice="needs-human-check" selected={draft.fireSafetyUnitDetectors} onClick={() => updateDecisionDraft(element.id, { fireSafetyUnitDetectors: "needs-human-check" })} />
                                </div>
                              </fieldset>
                              <fieldset className={styles.criteriaPanel}>
                                <legend>Form 1083 section 11b · Public/common areas</legend>
                                <p className={styles.supportingText}>Check each public or common area, including shared hallways and stairwells.</p>
                                <div className={styles.choiceRow} role="group" aria-label="Evaluator check for Form 1083 section 11b public and common area detectors">
                                  <ChoiceButton label="A · Meets" choice="A" selected={draft.fireSafetyPublicAreaDetectors} onClick={() => updateDecisionDraft(element.id, { fireSafetyPublicAreaDetectors: "A" })} />
                                  <ChoiceButton label="D · Deficient" choice="D" selected={draft.fireSafetyPublicAreaDetectors} onClick={() => updateDecisionDraft(element.id, { fireSafetyPublicAreaDetectors: "D" })} />
                                  <ChoiceButton label="Needs check" choice="needs-human-check" selected={draft.fireSafetyPublicAreaDetectors} onClick={() => updateDecisionDraft(element.id, { fireSafetyPublicAreaDetectors: "needs-human-check" })} />
                                </div>
                              </fieldset>
                            </div>
                            <p className={styles.statusText}>Combined Fire Safety outcome: {effectiveChoice === "A" ? "A · Acceptable" : effectiveChoice === "D" ? "D · Deficient" : "Needs human check"}. Section 11a and 11b are recorded separately on Form 1083.</p>
                          </> : <div className={styles.choiceRow} role="group" aria-label={`Evaluator decision for ${element.label}`}>
                            <ChoiceButton label="A · Acceptable" choice="A" selected={draft.choice} onClick={() => updateDecisionDraft(element.id, { choice: "A" })} />
                            <ChoiceButton label="D · Deficient" choice="D" selected={draft.choice} onClick={() => updateDecisionDraft(element.id, { choice: "D" })} />
                            <ChoiceButton label="Needs check" choice="needs-human-check" selected={draft.choice} onClick={() => updateDecisionDraft(element.id, { choice: "needs-human-check" })} />
                          </div>}
                          {effectiveChoice === "needs-human-check" && <div className={styles.field}>
                            <label htmlFor={`note-${element.id}`}>What must be checked?</label>
                            <textarea id={`note-${element.id}`} className={styles.formTextarea} value={draft.note} maxLength={1000} onChange={(event) => { const note = event.currentTarget.value; updateDecisionDraft(element.id, { note }); }} placeholder="Record the unresolved physical check." />
                          </div>}
                          {(effectiveChoice === "A" || effectiveChoice === "D") && <>
                            <div className={styles.field}>
                              <label htmlFor={`rationale-${element.id}`}>Evaluator observation</label>
                              <textarea id={`rationale-${element.id}`} className={styles.formTextarea} value={draft.rationale} maxLength={1000} onChange={(event) => { const rationale = event.currentTarget.value; updateDecisionDraft(element.id, { rationale }); }} placeholder="Describe what you assessed in person." />
                            </div>
                            {effectiveChoice === "D" && proposal?.modelSuggestion === "D" && proposal.deficiencySuggestion && <p className={styles.helpText}>Open the AI plan details below, then confirm or replace its suggested fields before saving.</p>}
                            <p className={styles.helpText}>{isFireSafety ? "Saving records that you personally completed both Form 1083 section 11 checks. AI suggestions and video stills do not replace these checks." : "Saving records your in-person check for this element. AI suggestions and video stills do not replace these checks."}</p>
                            {evidence.length > 0 && <fieldset className={styles.evidencePicker}>
                              <legend>Attach source stills to your decision</legend>
                              {evidence.slice(0, MAX_ROOM_EVIDENCE_STILLS * element.roomIds.length).map(({ reference, src }) => {
                                const modelEvidence = proposal?.evidence.find((item) => item.stillId === reference.stillId);
                                const liveCaptureNote = reference.stillId.startsWith(DETECTOR_TEST_STILL_PREFIX) ? ", live detector-test capture" : "";
                                const accessibleEvidenceLabel = `${roomLabel(reference.roomId)} source still at ${formatTimestamp(reference.timestampMs / 1000)} (${reference.timestampMs} ms)${modelEvidence ? `, SAM frame index ${modelEvidence.frameIndex}` : ""}${liveCaptureNote}`;
                                return <label className={styles.evidenceOption} key={reference.stillId}>
                                  <input type="checkbox" aria-label={accessibleEvidenceLabel} checked={draft.evidenceStillIds.includes(reference.stillId)} onChange={(event) => { const checked = event.currentTarget.checked; updateDecisionDraft(element.id, (current) => ({ ...current, evidenceStillIds: updateChecked(current.evidenceStillIds, reference.stillId, checked, 5) })); }} />
                                  <Image src={src} width={96} height={72} unoptimized alt="" />
                                  <span>{roomLabel(reference.roomId)} · {formatTimestamp(reference.timestampMs / 1000)}</span>
                                </label>;
                              })}
                              <p className={styles.helpText}>Choose up to 5 room stills. A deficiency requires at least one source still.</p>
                            </fieldset>}
                            {effectiveChoice === "D" && <div className={styles.fieldGridTwo}>
                              <div className={styles.field}><label htmlFor={`issue-${element.id}`}>Deficient area / observed issue</label><textarea id={`issue-${element.id}`} className={styles.formTextarea} value={draft.issueDescription} maxLength={1000} placeholder="Name the room or fixture and the issue." onChange={(event) => { const issueDescription = event.currentTarget.value; updateDecisionDraft(element.id, { issueDescription }); }} /></div>
                              <div className={styles.field}><label htmlFor={`correction-${element.id}`}>Required correction</label><textarea id={`correction-${element.id}`} className={styles.formTextarea} value={draft.correction} maxLength={1000} onChange={(event) => { const correction = event.currentTarget.value; updateDecisionDraft(element.id, { correction }); }} /></div>
                              <div className={styles.field}><label htmlFor={`completion-${element.id}`}>Completion date</label><input id={`completion-${element.id}`} className={styles.formInput} type="date" value={draft.completionDate} onChange={(event) => { const completionDate = event.currentTarget.value; updateDecisionDraft(element.id, { completionDate }); }} /></div>
                              <div className={styles.field}><label htmlFor={`reinspection-${element.id}`}>Reinspection date</label><input id={`reinspection-${element.id}`} className={styles.formInput} type="date" value={draft.reinspectionDate} onChange={(event) => { const reinspectionDate = event.currentTarget.value; updateDecisionDraft(element.id, { reinspectionDate }); }} /></div>
                            </div>}
                          </>}
                          <div className={styles.buttonRow}>
                            {decision.status === "unreviewed" && proposal && record && proposalIsCurrent(proposal, record) && (
                              <button
                                type="button"
                                className={`${styles.button} ${styles.reviewInlineSaveButton}`}
                                data-testid={`confirm-draft-${element.id}`}
                                aria-label={`Confirm: I checked this in person and agree with the AI draft: ${proposal.modelSuggestion === "A" ? "Approved" : "Deficient"}`}
                                onClick={() => confirmProposalDraft(element.id)}
                              >
                                Confirm AI draft: {proposal.modelSuggestion === "A" ? "Approved" : "Deficient"}
                              </button>
                            )}
                            <button type="button" className={`${styles.button} ${styles.reviewInlineSaveButton}`} onClick={() => saveDecision(element.id)}>Save evaluator decision</button>
                            {decision.status !== "unreviewed" && <button type="button" className={styles.textButton} onClick={() => { updateRecord((current) => ({ ...current, decisions: { ...current.decisions, [element.id]: { status: "unreviewed" } }, signoff: null, participantSignoff: null })); setDrafts((current) => ({ ...current, [element.id]: createDecisionDraft({ status: "unreviewed" }) })); }}>Clear decision</button>}
                          </div>
                        </div>
                        <details className={styles.reviewSupplement}>
                          <summary>Form 1083 reference criteria</summary>
                          <section className={styles.criteriaPanel} aria-label={`${element.label} Form 1083 reference criteria`}>
                            <ul className={styles.criteriaList}>
                              {checklistItemsForElement(record, element.id).map((item) => <li key={item}>{item}</li>)}
                            </ul>
                            <p className={styles.criteriaNote}>Reference checklist only. Complete the physical check; this guide records no finding.</p>
                          </section>
                        </details>
                        {proposal?.modelSuggestion === "D" && proposal.deficiencySuggestion && <details className={styles.reviewSupplement}>
                          <summary>Unreviewed AI correction plan</summary>
                          <div className={styles.draftPanel}>
                            <div className={styles.proposalPlan}>
                              <p className={styles.draftLabel}>Unreviewed AI plan suggestion · confirm or replace each field</p>
                              <dl className={styles.proposalPlanFields}>
                                <div><dt>Suggested deficient area</dt><dd>{proposal.deficiencySuggestion.deficientArea}</dd></div>
                                <div><dt>Suggested correction</dt><dd>{proposal.deficiencySuggestion.correction}</dd></div>
                                <div><dt>Suggested completion date</dt><dd>{proposal.deficiencySuggestion.completionDate}</dd></div>
                                <div><dt>Suggested reinspection date</dt><dd>{proposal.deficiencySuggestion.reinspectionDate}</dd></div>
                              </dl>
                              {effectiveChoice === "D" && <>
                                <button type="button" className={styles.textButton} onClick={() => updateDecisionDraft(element.id, {
                                  issueDescription: proposal.deficiencySuggestion!.deficientArea,
                                  correction: proposal.deficiencySuggestion!.correction,
                                  completionDate: proposal.deficiencySuggestion!.completionDate,
                                  reinspectionDate: proposal.deficiencySuggestion!.reinspectionDate,
                                })}>Copy suggestions into editable plan</button>
                                <label className={styles.checkLabel}>
                                  <input type="checkbox" checked={draft.planSuggestionReviewed} onChange={(event) => updateDecisionDraft(element.id, { planSuggestionReviewed: event.currentTarget.checked })} />
                                  <span>I reviewed the AI plan and confirmed or replaced the suggested area, correction, and dates above.</span>
                                </label>
                              </>}
                              <p className={styles.helpText}>The proposal has no evaluator authority. Dates are tentative and need confirmation.</p>
                            </div>
                          </div>
                        </details>}
                        {evidence.length > 0 ? <details className={styles.reviewSupplement}>
                          <summary>Source video frames · {evidence.length}</summary>
                          <div className={styles.evidenceGrid} aria-label={`${element.label} source stills`}>
                            {evidence.slice(0, 6).map(({ reference, src }) => <figure className={styles.evidenceFigure} key={reference.stillId}>
                              <Image src={src} width={320} height={240} unoptimized alt={`${roomLabel(reference.roomId)} source frame`} />
                              <figcaption>{roomLabel(reference.roomId)} · {formatTimestamp(reference.timestampMs / 1000)}</figcaption>
                            </figure>)}
                          </div>
                        </details> : <p className={styles.supportingText}>No current source-frame still is available for this element.</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {activeElementId && <div className={styles.reviewPager}>
                <button className={styles.secondaryButton} type="button" disabled={activeReviewIndex <= 0} onClick={() => { const previous = MOVE_IN_READY_ELEMENT_IDS[activeReviewIndex - 1]; if (previous) setActiveElementId(previous); }}>Previous element</button>
                <span>{activeReviewIndex + 1} / {MOVE_IN_READY_ELEMENTS.length}</span>
                <button className={styles.secondaryButton} type="button" disabled={activeReviewIndex === MOVE_IN_READY_ELEMENTS.length - 1} onClick={() => { const next = MOVE_IN_READY_ELEMENT_IDS[activeReviewIndex + 1]; if (next) setActiveElementId(next); }}>Next element</button>
              </div>}
              <button className={`${styles.button} ${styles.wideButton}`} type="button" onClick={() => changeStep("signoff")}>Continue to sign-off <ArrowRight size={17} aria-hidden="true" /></button>
              </div>
              </>}
            </div>
          </>
        )}

        {step === "signoff" && (
          <>
            <StepHeader headingRef={stepHeadingRef} eyebrow="STEP 3 OF 3 · SIGN-OFF" title={record.fundingType === "hud" ? "HQS required" : record.fundingType === "unknown" ? "Choose funding type" : "Sign-Off & Export"} lead={record.fundingType === "hud" ? "Use the HQS inspection workflow for HUD-funded units." : record.fundingType === "unknown" ? "Choose the applicable route in Profile before signing." : "Result auto-generated from your 11 decisions, then signature and local exports."} backLabel="checklist" onBack={() => changeStep("review")} />
            <div className={`${styles.contentStack} ${styles.signoffContent}`}>
              {record.fundingType !== "lahsa" ? <section className={`${styles.card} ${styles.signoffRoute}`} aria-labelledby="signoff-funding-route-heading">
                <div className={`${styles.callout} ${record.fundingType === "hud" ? styles.calloutDanger : styles.calloutWarning}`} role={record.fundingType === "hud" ? "alert" : "status"}>
                  <strong>{record.fundingType === "hud" ? "HQS required." : "Funding type required."}</strong>{" "}
                  {record.fundingType === "hud"
                    ? "This app cannot complete or export a Form 1083 result for a HUD-funded unit. Use the applicable HQS workflow."
                    : "Choose LAHSA / Form 1083 or HUD / HQS in Profile before signing or exporting."}
                </div>
                <h2 id="signoff-funding-route-heading">{record.fundingType === "hud" ? "Form 1083 sign-off is unavailable" : "Choose the correct workflow"}</h2>
                <p className={styles.supportingText}>No LAHSA inspection result, signature, or export can be created for this funding route.</p>
                <button className={styles.secondaryButton} type="button" onClick={() => { setProfileSection("unit"); changeStep("profile"); }}>
                  Review funding type <ArrowRight size={16} aria-hidden="true" />
                </button>
              </section> : <>
              <div className={`${styles.resultPanel} ${styles.resultPanelCompact}`}>
                <h2>Inspection result</h2>
                {completedResult ? <p className={`${styles.resultValue} ${completedResult === "approved" ? styles.resultApproved : styles.resultNotApproved}`} data-testid="inspection-result">{completedResult === "approved" ? "Approved" : "Not Approved"}</p> : <p className={`${styles.resultValue} ${styles.resultNeedsReview}`} data-testid="inspection-result">Needs review</p>}
                <p className={styles.supportingText}>{completedResult ? "Based on the evaluator’s 11 saved decisions." : `${capturedRoomCount} of ${rooms.length} room clips · ${reviewCounts.resolved} of ${MOVE_IN_READY_ELEMENTS.length} decisions · no result recorded`}</p>
                {finalization?.blockers.length ? <details className={styles.blockerDetails}><summary>{finalization.blockers.length} requirements need attention</summary><ul className={styles.blockerList}>{finalization.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></details> : null}
              </div>

              <div className={`${styles.card} ${styles.signoffCard}`}>
                <div className={styles.cardTitleRow}><div><h2>Evaluator sign-off</h2><p className={styles.cardLead}>Your assessment and attestation.</p></div><ShieldCheck size={21} aria-hidden="true" /></div>
                <p className={styles.supportingText}>Evaluator: <strong>{record.evaluatorName || "Not entered"}</strong></p>
                {record.signoff ? <div className={`${styles.callout} ${styles.calloutSuccess}`} role="status"><p>Signed by {record.signoff.typedSignature} on {new Date(record.signoff.signedAt).toLocaleString()}.</p><button className={styles.textButton} type="button" onClick={() => { updateRecord((current) => ({ ...current, signoff: null, participantSignoff: null })); setSignoffAttested(false); setSignoffName(""); setParticipantName(""); setParticipantSignature(""); setParticipantAttested(false); }}>Revoke sign-off</button></div> : <>
                  {canSignOff ? <>
                    <div className={styles.field}>
                      <label htmlFor="typed-signature">Type your name to sign</label>
                      <input id="typed-signature" className={styles.formInput} value={signoffName} maxLength={120} onChange={(event) => setSignoffName(event.currentTarget.value)} placeholder={record.evaluatorName || "Evaluator name"} />
                      <p className={styles.helpText}>Must match the name in Profile.</p>
                    </div>
                    <label className={styles.checkLabel}>
                      <input type="checkbox" checked={signoffAttested} onChange={(event) => setSignoffAttested(event.currentTarget.checked)} />
                      <span>{EVALUATOR_ATTESTATION_TEXT}</span>
                    </label>
                  </> : <div className={`${styles.callout} ${styles.calloutWarning} ${styles.signoffGate}`} role="status">
                    <p>{!record.evaluatorName.trim() || form1083Blocker
                      ? "Complete the required Profile details before signing."
                      : "Capture every room video and finish the 11 evaluator decisions before signing."}</p>
                    <button className={styles.textButton} type="button" onClick={() => !record.evaluatorName.trim() || form1083Blocker ? openProfileForRequiredDetails() : changeStep("review")}>
                      {!record.evaluatorName.trim() || form1083Blocker ? "Fix Profile details" : "Continue review"}
                    </button>
                  </div>}
                  <div className={styles.buttonRow}><button className={styles.button} type="button" onClick={saveSignoff} disabled={!canSignOff}>Sign inspection</button></div>
                </>}
                <div className={styles.buttonRow}>
                  <button className={styles.secondaryButton} type="button" data-testid="add-location" disabled={locating} onClick={requestInspectionLocation}>
                    {record.inspectionLocation ? "Update location" : "Add location"}
                  </button>
                  <span className={styles.statusText} role="status" data-testid="inspection-location-status">
                    {locating
                      ? "Locating…"
                      : record.inspectionLocation
                        ? `Location recorded: ${record.inspectionLocation.lat}, ${record.inspectionLocation.lng} (approx. 100 m)`
                        : locationError
                          ? locationError
                          : "Location optional — never blocks signing."}
                  </span>
                </div>
                {exportError && <p className={styles.inlineError} role="alert">{exportError}</p>}
                {exportNotice && <p className={styles.statusText} role="status">{exportNotice}</p>}
              </div>

              <div className={`${styles.card} ${styles.signoffCard}`}>
                <div className={styles.cardTitleRow}><div><h2>Participant sign-off</h2><p className={styles.cardLead}>The participant confirms the walkthrough findings.</p></div><ShieldCheck size={21} aria-hidden="true" /></div>
                {record.participantSignoff ? <div className={`${styles.callout} ${styles.calloutSuccess}`} role="status"><p>Signed by {record.participantSignoff.typedSignature} on {new Date(record.participantSignoff.signedAt).toLocaleString()}.</p><button className={styles.textButton} type="button" onClick={() => { updateRecord((current) => ({ ...current, participantSignoff: null })); setParticipantAttested(false); setParticipantName(""); setParticipantSignature(""); }}>Revoke participant sign-off</button></div> : <>
                  {canParticipantSign ? <>
                    <div className={styles.field}>
                      <label htmlFor="participant-name">Participant name</label>
                      <input id="participant-name" className={styles.formInput} value={participantName} maxLength={120} onChange={(event) => setParticipantName(event.currentTarget.value)} placeholder="Participant name" />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="participant-signature">Type participant name to sign</label>
                      <input id="participant-signature" className={styles.formInput} value={participantSignature} maxLength={120} onChange={(event) => setParticipantSignature(event.currentTarget.value)} placeholder="Participant name" />
                      <p className={styles.helpText}>Must match the participant name above. Only the name and typed signature are stored.</p>
                    </div>
                    <label className={styles.checkLabel}>
                      <input type="checkbox" checked={participantAttested} onChange={(event) => setParticipantAttested(event.currentTarget.checked)} />
                      <span>{PARTICIPANT_ATTESTATION_TEXT}</span>
                    </label>
                  </> : <div className={`${styles.callout} ${styles.calloutWarning} ${styles.signoffGate}`} role="status">
                    <p>{form1083Blocker
                      ? "Complete the required Profile details before participant sign-off."
                      : "Capture every room video and finish the 11 evaluator decisions before participant sign-off."}</p>
                    <button className={styles.textButton} type="button" onClick={() => form1083Blocker ? openProfileForRequiredDetails() : changeStep("review")}>
                      {form1083Blocker ? "Fix Profile details" : "Continue review"}
                    </button>
                  </div>}
                  <div className={styles.buttonRow}><button className={styles.button} type="button" onClick={saveParticipantSignoff} disabled={!canParticipantSign}>Sign as participant</button></div>
                </>}
              </div>

              <div className={`${styles.card} ${styles.exportCard}`}>
                <div className={styles.cardTitleRow}><div><h2>Export options</h2><p className={styles.cardLead}>Local files for the existing manual workflow.</p></div><FolderOpen size={21} aria-hidden="true" /></div>
                <div className={styles.exportGrid}>
                  <ExportButton title="Client-file export" detail="PDF · decisions, signatures, and source stills" icon={<FileText size={19} aria-hidden="true" />} disabled={!completedResult || !record.signoff || !record.participantSignoff || exporting} busy={exporting} compact onClick={() => void downloadExport("client-file")} />
                  <ExportButton title="Landlord fix-list" detail="Fix list (EN) · PDF · evaluator-confirmed deficiencies and dates" icon={<FolderOpen size={19} aria-hidden="true" />} disabled={!completedResult || !record.signoff || !record.participantSignoff || exporting} busy={exporting} compact onClick={() => void downloadExport("landlord-fix-list", "en")} />
                  {canExportShare && <ExportButton title="Share export packet" detail={participantSigned ? "All five files · message or email to yourself" : "All four files · message or email to yourself"} icon={<Share2 size={19} aria-hidden="true" />} disabled={!completedResult || !record.signoff || !record.participantSignoff || exporting} busy={exporting} compact onClick={() => void shareExports()} />}
                  <div className={`${styles.exportItem} ${styles.exportItemCompact}`}>
                    <FileText className={styles.exportIcon} size={19} aria-hidden="true" />
                    <div className={styles.exportCopy}><strong>HMIS-ready Form 1083</strong><span>Local PDF or structured JSON draft</span></div>
                    <div className={styles.exportActionsInline}>
                      <button className={styles.exportFormatButton} type="button" disabled={!completedResult || !record.signoff || !record.participantSignoff || exporting} onClick={() => void downloadExport("hmis-ready")}>PDF</button>
                      <button className={styles.exportFormatButton} type="button" disabled={!completedResult || !record.signoff || !record.participantSignoff || exporting} onClick={() => void downloadExport("hmis-json")}>JSON</button>
                      <button className={styles.exportFormatButton} type="button" disabled={!completedResult || !record.signoff || !participantSigned || exporting} onClick={() => void downloadExport("lahsa-1083-json")}>LAHSA JSON</button>
                    </div>
                  </div>
                  <ExportButton title="Fix list (ES)" detail="PDF · español · deficiencias confirmadas por el evaluador y fechas" icon={<FolderOpen size={19} aria-hidden="true" />} disabled={!completedResult || !record.signoff || !record.participantSignoff || exporting} busy={exporting} compact onClick={() => void downloadExport("landlord-fix-list", "es")} />
                  <ExportButton title="Case note" detail={CASE_NOTE_DRAFT_LABEL} icon={<StickyNote size={19} aria-hidden="true" />} disabled={!completedResult || !record.signoff || !participantSigned || exporting} busy={exporting} compact onClick={() => void downloadExport("case-note")} />
                </div>
                {exporting && <p className={styles.statusText} role="status"><LoaderCircle className={styles.spinner} size={16} aria-hidden="true" /> Preparing local export…</p>}
                {(!completedResult || !record.signoff || !record.participantSignoff) && <p className={styles.helpText}>Exports unlock after every room clip, 11 evaluator decisions, required Form 1083 details, both signatures, and attestation.</p>}
                <details className={styles.exportPrivacy}><summary>Handling notes</summary><p className={styles.privacyText}>Downloads stay on this device unless you share them. Local deletion does not remove downloaded exports or provider-side processing. This app does not submit to HMIS or confirm acceptance by LAHSA.</p></details>
              </div>
              </>}
            </div>
          </>
        )}

        {step === "profile" && (
          <>
            <StepHeader headingRef={stepHeadingRef} eyebrow="WORKSPACE SETUP" title="Profile" lead="Complete one short section at a time. Your progress saves on this device." backLabel="home" onBack={() => changeStep("home")} />
            <div className={styles.contentStack}>
              <section className={styles.profileFlow} aria-label="Profile setup">
                <div className={styles.profileProgress}>
                  <div className={styles.profileProgressHeading}>
                    <span>Setup progress</span>
                    <strong>{Object.values(profileSectionReady).filter(Boolean).length} of 3 sections complete</strong>
                  </div>
                  <div className={styles.profileProgressTrack} role="progressbar" aria-label="Profile setup progress" aria-valuemin={0} aria-valuemax={3} aria-valuenow={Object.values(profileSectionReady).filter(Boolean).length}>
                    <span style={{ width: `${(Object.values(profileSectionReady).filter(Boolean).length / 3) * 100}%` }} />
                  </div>
                </div>

                <nav className={styles.profileSteps} aria-label="Profile setup sections">
                  {([
                    ["unit", "Unit & Funding", "1", profileSectionReady.unit],
                    ["evaluator", "Evaluator", "2", profileSectionReady.evaluator],
                    ["agency", "Landlord & Agency", "3", profileSectionReady.agency],
                  ] as const).map(([section, label, number, ready]) => (
                    <button
                      key={section}
                      className={`${styles.profileStepButton} ${profileSection === section ? styles.profileStepButtonActive : ""} ${ready ? styles.profileStepButtonReady : ""}`}
                      type="button"
                      aria-label={label}
                      aria-current={profileSection === section ? "step" : undefined}
                      aria-expanded={profileSection === section}
                      aria-controls={`profile-panel-${section}`}
                      onClick={() => setProfileSection(section)}
                    >
                      <span className={styles.profileStepNumber}>{number}</span>
                      <span className={styles.profileStepName}>
                        <span className={styles.profileStepFull}>{label}</span>
                        <span className={styles.profileStepCompact}>{section === "unit" ? "Unit" : section === "agency" ? "Agency" : label}</span>
                      </span>
                      <span className={styles.profileStepState}>{ready ? "Ready" : "Needs info"}</span>
                    </button>
                  ))}
                </nav>

                <section id="profile-panel-unit" className={`${styles.card} ${styles.profilePanel}`} role="region" aria-labelledby="profile-panel-title-unit" hidden={profileSection !== "unit"}>
                  <div className={styles.profilePanelHeading}>
                    <span className={styles.eyebrow}>STEP 1 OF 3</span>
                    <h2 id="profile-panel-title-unit">Unit &amp; Funding</h2>
                    <p>Use a local pseudonym, then choose the funding path before recording.</p>
                  </div>
                  <div className={styles.profileFields}>
                    <div className={styles.field}><label htmlFor="profile-pseudonym">Unit pseudonym</label><input id="profile-pseudonym" className={styles.formInput} value={record.pseudonym} maxLength={80} placeholder="Demo Unit 04" onChange={(event) => setProfileField("pseudonym", event.currentTarget.value)} /></div>
                    <div className={styles.field}><label htmlFor="profile-funding">Funding type</label><select id="profile-funding" className={styles.formSelect} value={record.fundingType} onChange={(event) => setProfileField("fundingType", normalizeFundingType(event.currentTarget.value))}><option value="unknown">Choose funding type</option><option value="lahsa">LAHSA / Form 1083</option><option value="hud">Housing Authority or voucher (HQS required)</option><option value="other">HUD-funded (CoC/ESG) — Form 1083 applies</option></select></div>
                    <div className={styles.field}><label htmlFor="profile-unit-type">Unit type</label><select id="profile-unit-type" className={styles.formSelect} value={record.unitType} onChange={(event) => { const next = event.currentTarget.value as MoveInReadyUnitType | ""; if (next !== "") setUnitDescription(next, record.bathCount, record.roomIds.includes("hallway")); }}><option value="">Choose unit type</option><option value="studio">Studio</option><option value="1-bedroom">1 bedroom</option><option value="2-bedroom">2 bedroom</option><option value="3-bedroom">3 bedroom</option><option value="4-bedroom">4 bedroom</option></select></div>
                    <div className={styles.field}><label htmlFor="profile-baths">Bathrooms</label><select id="profile-baths" className={styles.formSelect} value={String(record.bathCount)} disabled={record.unitType === ""} onChange={(event) => { if (record.unitType !== "") setUnitDescription(record.unitType, Number(event.currentTarget.value), record.roomIds.includes("hallway")); }}><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></div>
                  </div>
                  <fieldset className={styles.field} style={{ border: "none", padding: 0, margin: "12px 0 0" }}>
                    <legend>Guided tour language</legend>
                    <div role="radiogroup" aria-label="Guided tour language">
                      <label className={styles.checkLabel} style={{ marginBottom: 4 }}>
                        <input
                          type="radio"
                          name="tour-language"
                          value="en"
                          data-testid="tour-language-en"
                          checked={record.tourLanguage !== "es"}
                          onChange={() => setTourLanguage("en")}
                        />
                        <span>English</span>
                      </label>
                      <label className={styles.checkLabel} style={{ marginBottom: 4 }}>
                        <input
                          type="radio"
                          name="tour-language"
                          value="es"
                          data-testid="tour-language-es"
                          checked={record.tourLanguage === "es"}
                          disabled={!esVoiceConfigured}
                          onChange={() => setTourLanguage("es")}
                        />
                        <span>Español — recorrido guiado</span>
                      </label>
                    </div>
                    {!esVoiceConfigured
                      ? <p className={styles.helpText}>Spanish voice not configured.</p>
                      : <p className={styles.helpText}>Tour narration and questions only. Review, sign-off, and exports stay in English.</p>}
                  </fieldset>
                  {setupVoiceStep === null ? (
                    <button className={styles.secondaryButton} type="button" onClick={() => { setSetupVoiceTranscript(null); setSetupVoiceStep("unit"); }}>
                      <Mic size={16} aria-hidden="true" /> Describe by voice
                    </button>
                  ) : (
                    <VoicePrompt
                      key={setupVoiceStep}
                      question={setupVoiceStep === "unit" ? SETUP_VOICE_QUESTIONS.unitTypeCapture : SETUP_VOICE_QUESTIONS.baths}
                      autoSpeak
                      transcript={setupVoiceTranscript}
                      onTranscript={(text) => {
                        setSetupVoiceTranscript(text);
                        if (setupVoiceStep === "unit") {
                          const unit = parseUnitType(text);
                          if (unit) {
                            setUnitDescription(unit, recordRef.current?.bathCount ?? 1, recordRef.current?.roomIds.includes("hallway") ?? true);
                            setSetupVoiceTranscript(null);
                            setSetupVoiceStep("baths");
                          }
                        } else {
                          const baths = parseBathCount(text);
                          const unit = recordRef.current?.unitType;
                          if (baths && unit) {
                            setUnitDescription(unit, baths, recordRef.current?.roomIds.includes("hallway") ?? true);
                            setSetupVoiceTranscript(null);
                            setSetupVoiceStep(null);
                          }
                        }
                      }}
                    >
                      <div className={styles.voiceTapRow}>
                        <button className={styles.secondaryButton} type="button" onClick={() => { setSetupVoiceTranscript(null); setSetupVoiceStep(null); }}>Use the menus instead</button>
                      </div>
                    </VoicePrompt>
                  )}
                  {record.unitType !== "" && (
                    <fieldset className={styles.field} style={{ border: "none", padding: 0, margin: "12px 0 0" }}>
                      <legend className={styles.helpText} style={{ marginBottom: 8 }}>Rooms to film — uncheck any this unit doesn&apos;t have.</legend>
                      {roomsForUnit(record.unitType, record.bathCount).map((roomId) => (
                        <label key={roomId} className={styles.checkLabel} style={{ marginBottom: 4 }}>
                          <input
                            type="checkbox"
                            checked={record.roomIds.includes(roomId)}
                            disabled={record.roomIds.includes(roomId) && record.roomIds.length === 1}
                            onChange={() => toggleInspectionRoom(roomId)}
                          />
                          <span>{roomLabel(roomId)}{clips[roomId] ? " · filmed" : ""}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <label className={`${styles.checkLabel} ${styles.profileLeadershipCheck}`}><input type="checkbox" checked={record.participantVisualAlarmsRequired} onChange={(event) => updateRecord((current) => ({ ...current, participantVisualAlarmsRequired: event.currentTarget.checked }))} /><span>Participant needs visual (strobe) alarms</span></label>
                  <p className={styles.helpText}>Adds a strobe-alarm check to the bedroom and hallway, and to the Fire Safety criteria.</p>
                  {record.fundingType === "hud" && <div className={`${styles.callout} ${styles.calloutWarning} ${styles.profileNotice}`} role="status"><strong>HQS inspection required.</strong> This HUD-funded unit cannot continue through the LAHSA Form 1083 walkthrough.</div>}
                  <div className={styles.profilePanelActions}>
                    <span>{profileSectionReady.unit ? "Unit and funding details are ready." : "Enter a pseudonym, funding type, and unit type."}</span>
                    <button className={styles.button} type="button" disabled={!profileSectionReady.unit || record.fundingType === "hud"} onClick={() => setProfileSection("evaluator")}>Continue to evaluator <ArrowRight size={16} aria-hidden="true" /></button>
                  </div>
                </section>

                <section id="profile-panel-evaluator" className={`${styles.card} ${styles.profilePanel}`} role="region" aria-labelledby="profile-panel-title-evaluator" hidden={profileSection !== "evaluator"}>
                  <div className={styles.profilePanelHeading}>
                    <span className={styles.eyebrow}>STEP 2 OF 3</span>
                    <h2 id="profile-panel-title-evaluator">Evaluator</h2>
                    <p>Record the person assessing the unit and the agency they represent.</p>
                  </div>
                  <div className={styles.profileFields}>
                    <div className={styles.field}><label htmlFor="profile-evaluator">Evaluator name</label><input id="profile-evaluator" className={styles.formInput} value={record.evaluatorName} maxLength={120} placeholder="Evaluator name" onChange={(event) => setProfileField("evaluatorName", event.currentTarget.value)} /><p className={styles.helpText}>Changing this name clears the prior evaluator&apos;s decisions and sign-off.</p></div>
                    <div className={styles.field}><label htmlFor="profile-evaluator-agency">Evaluator agency name</label><input id="profile-evaluator-agency" className={styles.formInput} value={record.evaluatorAgencyName} maxLength={120} placeholder="Agency name" onChange={(event) => setProfileField("evaluatorAgencyName", event.currentTarget.value)} /><p className={styles.helpText}>Required by Form 1083. Staged participant and address fields stay blank.</p></div>
                  </div>
                  <div className={styles.profilePanelActions}>
                    <button className={styles.secondaryButton} type="button" onClick={() => setProfileSection("unit")}><ArrowLeft size={16} aria-hidden="true" /> Back</button>
                    <button className={styles.button} type="button" disabled={!profileSectionReady.evaluator} onClick={() => setProfileSection("agency")}>Continue to landlord &amp; agency <ArrowRight size={16} aria-hidden="true" /></button>
                  </div>
                </section>

                <section id="profile-panel-agency" className={`${styles.card} ${styles.profilePanel}`} role="region" aria-labelledby="profile-panel-title-agency" hidden={profileSection !== "agency"}>
                  <div className={styles.profilePanelHeading}>
                    <span className={styles.eyebrow}>STEP 3 OF 3</span>
                    <h2 id="profile-panel-title-agency">Landlord &amp; Agency</h2>
                    <p>Complete the required Form 1083 conversation and any agency sign-off fields.</p>
                  </div>
                  <div className={styles.profileFields}>
                    <div className={styles.field}><label htmlFor="profile-landlord-discussion">Discussed with landlord?</label><select id="profile-landlord-discussion" className={styles.formSelect} value={record.landlordDiscussion} onChange={(event) => setProfileField("landlordDiscussion", event.currentTarget.value as MoveInReadyInspection["landlordDiscussion"])}><option value="">Choose YES or NO</option><option value="yes">YES</option><option value="no">NO</option></select></div>
                    {record.landlordDiscussion === "yes" && <div className={styles.field}><label htmlFor="profile-landlord-date">Landlord-discussion date</label><input id="profile-landlord-date" className={styles.formInput} type="date" value={record.landlordDiscussionDate} onChange={(event) => setProfileField("landlordDiscussionDate", event.currentTarget.value)} /><p className={styles.helpText}>Required when the landlord was informed.</p></div>}
                  </div>
                  <label className={`${styles.checkLabel} ${styles.profileLeadershipCheck}`}><input type="checkbox" checked={record.leadershipSignoffRequired} onChange={(event) => setProfileField("leadershipSignoffRequired", event.currentTarget.checked)} /><span>Agency policy requires a leadership sign-off before export.</span></label>
                  {record.leadershipSignoffRequired && <div className={styles.profileFields}>
                    <div className={styles.field}><label htmlFor="leadership-name-title">Agency leadership printed name and title</label><input id="leadership-name-title" className={styles.formInput} value={record.leadershipNameAndTitle} maxLength={120} onChange={(event) => setProfileField("leadershipNameAndTitle", event.currentTarget.value)} /></div>
                    <div className={styles.field}><label htmlFor="leadership-signature">Agency leadership typed signature</label><input id="leadership-signature" className={styles.formInput} value={record.leadershipSignoff} maxLength={120} onChange={(event) => setProfileField("leadershipSignoff", event.currentTarget.value)} /></div>
                    <div className={styles.field}><label htmlFor="leadership-signature-date">Leadership signature date</label><input id="leadership-signature-date" className={styles.formInput} type="date" value={record.leadershipSignedAt} onChange={(event) => setProfileField("leadershipSignedAt", event.currentTarget.value)} /></div>
                  </div>}
                  <div className={styles.profilePanelActions}>
                    <button className={styles.secondaryButton} type="button" onClick={() => setProfileSection("evaluator")}><ArrowLeft size={16} aria-hidden="true" /> Back</button>
                    <button className={styles.button} type="button" onClick={() => changeStep("signoff")}>Review sign-off <ArrowRight size={16} aria-hidden="true" /></button>
                  </div>
                </section>
              </section>

              <details className={`${styles.card} ${styles.settingsDisclosure}`} data-testid="profile-more-settings">
                <summary><span><strong>More settings &amp; privacy</strong><small>Install · connection &amp; privacy · local data</small></span><ChevronDown size={19} aria-hidden="true" /></summary>
                <div className={styles.settingsDisclosureContent}>
              <details className={`${styles.settingsDisclosure} ${styles.settingsSubDisclosure}`} data-testid="profile-install-disclosure">
                <summary><span><strong>Use on this device</strong><small>Add the walkthrough to your home screen.</small></span><Smartphone size={21} aria-hidden="true" /></summary>
                <div className={styles.settingsDisclosureContent}>
                  {installAffordance.mode === "installed" ? (
                    <p className={styles.statusText} role="status"><CheckCircle2 size={16} aria-hidden="true" /> Walkthrough is installed on this device.</p>
                  ) : (
                    <>
                      <button className={styles.secondaryButton} type="button" aria-expanded={installHelpOpen} onClick={() => void handleInstallAction()}>
                        <Download size={17} aria-hidden="true" /> {installAffordance.mode === "prompt" ? "Install walkthrough app" : installHelpOpen ? "Hide install steps" : "Show install steps"}
                      </button>
                      {installNotice && <p className={styles.statusText} role="status">{installNotice}</p>}
                      {installHelpOpen && (
                        <ol className={styles.installSteps} data-testid="install-steps">
                          {(installAffordance.mode === "guidance" ? installAffordance.steps : manualInstallSteps(installPlatform)).map((instruction) => <li key={instruction}>{instruction}</li>)}
                        </ol>
                      )}
                    </>
                  )}
                </div>
              </details>
              <details className={`${styles.settingsDisclosure} ${styles.settingsSubDisclosure}`} data-testid="profile-privacy-disclosure">
                <summary><span><strong>Connection, cost &amp; privacy</strong><small>{online ? "Online" : "Offline"} · {analysisMode === "live" ? "Meta live mode" : analysisMode === "fixture" ? "Sample mode" : "Meta off"}</small></span><ChevronDown size={19} aria-hidden="true" /></summary>
                <div className={styles.settingsDisclosureContent}>
                  <p className={styles.supportingText}>Meta analysis: <strong>{analysisMode === "live" ? "live mode enabled; connection untested" : analysisMode === "fixture" ? "sample only" : "live mode off"}</strong></p>
                  <p className={styles.supportingText}>Clips, stills, drafts, decisions, and signatures are stored locally. After you confirm live processing, the selected room video is sent to this server and Meta for SAM; selected source stills and timestamps are then sent for Muse mapping. The app does not cache media in the service worker.</p>
                  <p className={styles.supportingText}><strong>Potential provider charges:</strong> Live video analysis and mapping may be billable to the configured Meta account. Charges depend on current pricing and usage; check the account dashboard before use. This app does not estimate per-inspection cost.</p>
                  <p className={styles.supportingText}>Use a staged unit and pseudonym. Do not include tenants, faces, addresses, personal documents, or real case notes. Review current provider privacy and retention terms before live use. Local deletion cannot erase provider-side processing or downloaded files.</p>
                  <p className={styles.helpText}>The status shows whether live mode is enabled. It does not mean that a provider request has run or succeeded.</p>
                </div>
              </details>
              <details className={`${styles.settingsDisclosure} ${styles.settingsSubDisclosure}`}>
                <summary><span><strong>Local data</strong><small>{capturedRoomCount} room clips · {reviewCounts.resolved} decisions saved</small></span><ChevronDown size={19} aria-hidden="true" /></summary>
                <div className={styles.settingsDisclosureContent}>
                  <p className={styles.supportingText}>Clear this walkthrough from this device, including its clips, stills, drafts, decisions, and signature.</p>
                  <button className={styles.dangerButton} type="button" onClick={() => void clearSession()}><Trash2 size={17} aria-hidden="true" /> Clear this walkthrough from this device</button>
                </div>
              </details>
              <details className={`${styles.settingsDisclosure} ${styles.settingsSubDisclosure}`} data-testid="profile-about-disclosure">
                <summary><span><strong>About this checklist</strong><small>Demo scope · AI limits</small></span><ChevronDown size={19} aria-hidden="true" /></summary>
                <div className={styles.settingsDisclosureContent}>
                  <p className={styles.supportingText} data-testid="about-checklist-line">Demo checklist — not a verified Form 1083 mapping. Known AI misses are listed in the demo notes.</p>
                  <p className={styles.helpText}>The staged-video evaluation and its miss list are recorded in the demo notes. No accuracy percentage is shown until a recorded run produces one.</p>
                </div>
              </details>
                </div>
              </details>
            </div>
          </>
        )}
      </main>

      <div className={styles.appFooter}>
        <nav className={styles.bottomNav} aria-label="Main navigation">
          <NavButton icon={<Home size={19} aria-hidden="true" />} label="Home" active={step === "home"} onClick={() => changeStep("home")} disabled={recordingInProgress} />
          <NavButton icon={<ClipboardCheck size={19} aria-hidden="true" />} label="Review" active={step === "review"} onClick={() => changeStep("review")} disabled={recordingInProgress} />
          <NavButton icon={<CheckCircle2 size={19} aria-hidden="true" />} label="Sign-Off" active={step === "signoff"} onClick={() => changeStep("signoff")} disabled={recordingInProgress} />
          <NavButton icon={<CircleHelp size={19} aria-hidden="true" />} label="Profile" active={step === "profile"} onClick={() => changeStep("profile")} disabled={recordingInProgress} />
        </nav>
        {step === "review" && mobileReviewDetailOpen && <div className={styles.reviewActionBar} aria-label="Review actions">
          <div className={styles.reviewStickyPager} aria-label="Move between inspection elements">
            <button className={styles.secondaryButton} type="button" disabled={activeReviewIndex <= 0} onClick={() => { const previous = MOVE_IN_READY_ELEMENT_IDS[activeReviewIndex - 1]; if (previous) openReviewElement(previous); }}>Previous</button>
            <span className={styles.reviewPagerStatus}><span>Element {activeReviewIndex + 1} of {MOVE_IN_READY_ELEMENTS.length}</span><small>{reviewCounts.resolved} of {MOVE_IN_READY_ELEMENTS.length} reviewed</small></span>
            <button className={styles.secondaryButton} type="button" disabled={activeReviewIndex < 0 || activeReviewIndex === MOVE_IN_READY_ELEMENTS.length - 1} onClick={() => { const next = MOVE_IN_READY_ELEMENT_IDS[activeReviewIndex + 1]; if (next) openReviewElement(next); }}>Next</button>
          </div>
          {reviewError && <p className={`${styles.inlineError} ${styles.reviewStickyError}`} role="alert">{reviewError}</p>}
          {activeElementId && record && (() => {
            const elementId = activeElementId;
            const proposal = record.proposals[elementId];
            const decided = (record.decisions[elementId]?.status ?? "unreviewed") !== "unreviewed";
            if (!proposal || decided || !proposalIsCurrent(proposal, record)) return null;
            return (
              <button
                className={`${styles.button} ${styles.wideButton}`}
                type="button"
                data-testid={`confirm-draft-bar-${elementId}`}
                aria-label={`Confirm: I checked this in person and agree with the AI draft: ${proposal.modelSuggestion === "A" ? "Approved" : "Deficient"}`}
                onClick={() => confirmProposalDraft(elementId)}
              >
                Confirm AI draft: {proposal.modelSuggestion === "A" ? "Approved" : "Deficient"}
              </button>
            );
          })()}
          <button className={`${styles.button} ${styles.wideButton}`} type="button" disabled={!activeElementId} onClick={() => { if (activeElementId) void saveDecision(activeElementId); }}>
            Save evaluator decision <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>}
      </div>

    </div>
  );

}

function StepHeader({ eyebrow, title, lead, headingRef, compact = false, backLabel, onBack }: { eyebrow: string; title: string; lead: string; headingRef: Ref<HTMLHeadingElement>; compact?: boolean; backLabel?: string; onBack?: () => void }) {
  return <div className={`${styles.stepHeader} ${compact ? styles.stepHeaderCompact : ""} ${onBack ? styles.stepHeaderHasBack : ""}`}>
    {onBack && <button className={styles.stepBack} type="button" aria-label={`Back to ${backLabel ?? "previous screen"}`} onClick={onBack}><ArrowLeft size={20} aria-hidden="true" /></button>}
    <div className={styles.stepHeadingCopy}><p className={styles.eyebrow}>{eyebrow}</p><h1 ref={headingRef} tabIndex={-1}>{title}</h1><p>{lead}</p></div>
  </div>;
}

function ChoiceButton({ label, choice, selected, onClick }: { label: string; choice: DecisionChoice; selected: DecisionChoice | FireSafetyDraftOutcome; onClick: () => void }) {
  return <button type="button" className={`${styles.choiceButton} ${selected === choice ? styles.choiceButtonSelected : ""}`} aria-pressed={selected === choice} onClick={onClick}>{label}</button>;
}

function NavButton({ icon, label, active, disabled = false, onClick }: { icon: ReactNode; label: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={`${styles.navButton} ${active ? styles.navButtonActive : ""}`} aria-current={active ? "page" : undefined} disabled={disabled} onClick={onClick}><span className={styles.navIcon}>{icon}</span><span>{label}</span></button>;
}

function ExportButton({ title, detail, icon, disabled, busy, compact = false, onClick }: { title: string; detail: string; icon: ReactNode; disabled: boolean; busy: boolean; compact?: boolean; onClick: () => void }) {
  return <button type="button" className={`${styles.exportItem} ${compact ? styles.exportItemCompact : ""}`} onClick={onClick} disabled={disabled}>
    <span className={styles.exportIcon}>{busy ? <LoaderCircle className={styles.spinner} size={18} aria-hidden="true" /> : icon}</span>
    <span className={styles.exportCopy}><strong>{title}</strong><span>{detail}</span></span><ArrowRight size={17} aria-hidden="true" />
  </button>;
}

function appendIdentity(form: FormData, identity: VideoIdentityFields): void {
  form.set("sessionId", identity.sessionId);
  form.set("schemaVersion", String(identity.schemaVersion));
  form.set("videoId", identity.videoId);
  form.set("videoRevision", String(identity.videoRevision));
  form.set("analysisId", identity.analysisId);
  form.set("attempt", String(identity.attempt));
  form.set("catalogVersion", identity.catalogVersion);
  form.set("expectedVideoSha256", identity.expectedVideoSha256);
}

async function cancelPendingVideoMapping(identity: VideoIdentityFields, candidateToken: string | null): Promise<void> {
  const form = new FormData();
  form.set("stage", "cancel");
  appendIdentity(form, identity);
  if (candidateToken) form.set("candidateToken", candidateToken);
  try {
    await fetch("/api/video/segment?stage=cancel", {
      method: "POST",
      headers: { [WALKTHROUGH_CLIENT_HEADER]: WALKTHROUGH_CLIENT_ID },
      body: form,
      keepalive: true,
      cache: "no-store",
    });
  } catch {
    // Lease expiry remains the fallback when the browser cannot reach the app.
  }
}

function parseSegmentResponse(value: unknown, expected: VideoIdentityFields, room: MoveInReadyRoomId): ParsedSegmentResponse {
  const root = recordObject(value, "The segmentation response was invalid.");
  if (root.ok !== true || root.stage !== "segmented" || root.humanReviewRequired !== true || root.conditionAssessment !== "not_assessed") throw new Error("The segmentation response did not match the expected review-only contract.");
  const models = recordObject(root.models, "The model identity was invalid.");
  if (models.segmentation !== "sam-3.1" || typeof root.mappingRequired !== "boolean") throw new Error("The response was produced by an unsupported segmentation configuration.");
  const identity = parseIdentity(root.identity, expected);
  if (root.room !== room) throw new Error("The segmentation response was for a different room.");
  const media = recordObject(root.media, "The segmentation media reference was invalid.");
  if (!isExpectedMp4Media(media, expected.expectedVideoSha256)) throw new Error("The segmentation response did not match the selected MP4 bytes.");
  const hasMappingToken = typeof root.candidateToken === "string" && root.candidateToken.length >= 16 && root.candidateToken.length <= 48 * 1024;
  if (!Array.isArray(root.sampleTimestampsMs) || root.sampleTimestampsMs.length < 1 || root.sampleTimestampsMs.length > 30 ||
      root.sampleTimestampsMs.some((timestamp, index) => typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp >= 30_000 || (index > 0 && timestamp <= (root.sampleTimestampsMs as number[])[index - 1]!))) {
    throw new Error("The segmentation response did not include a valid one-frame-per-second Muse sample schedule.");
  }
      if (!Array.isArray(root.candidates) || root.candidates.length > 40) throw new Error("The segmentation response contains too many candidate moments.");
  const seen = new Set<string>();
  const candidates = root.candidates.map((raw): SegmentCandidate => {
    const candidate = recordObject(raw, "A segmentation candidate was invalid.");
    if (Object.keys(candidate).some((key) => !["candidateId", "elementId", "concept", "evidence"].includes(key))) throw new Error("A segmentation candidate included unsupported fields.");
    if (typeof candidate.candidateId !== "string" || !/^cand-\d{4}$/.test(candidate.candidateId) || seen.has(candidate.candidateId)) throw new Error("A segmentation candidate identifier was invalid.");
    seen.add(candidate.candidateId);
    if (!isMoveInReadyElementId(candidate.elementId) || typeof candidate.concept !== "string" || candidate.concept.length > 80) throw new Error("A segmentation candidate referenced an unsupported inspection element.");
    const evidence = recordObject(candidate.evidence, "A candidate source moment was invalid.");
    if (Object.keys(evidence).some((key) => !["frameIndex", "timestampMs", "objectOrdinal", "box", "samConfidence"].includes(key))) throw new Error("A candidate source moment included unsupported fields.");
    if (!Number.isSafeInteger(evidence.frameIndex) || (evidence.frameIndex as number) < 0 || !Number.isSafeInteger(evidence.timestampMs) || (evidence.timestampMs as number) < 0 || (evidence.timestampMs as number) >= 30_000 || !Number.isSafeInteger(evidence.objectOrdinal) || (evidence.objectOrdinal as number) < 0) throw new Error("A candidate source frame was outside the allowed video bounds.");
    const box = recordObject(evidence.box, "A candidate geometry was invalid.");
    if (Object.keys(box).some((key) => !["left", "top", "right", "bottom"].includes(key)) || ![box.left, box.top, box.right, box.bottom].every((part) => typeof part === "number" && Number.isFinite(part) && part >= 0 && part <= 100_000) || (box.left as number) >= (box.right as number) || (box.top as number) >= (box.bottom as number)) throw new Error("A candidate geometry was outside the supported image bounds.");
    if (evidence.samConfidence !== undefined && (typeof evidence.samConfidence !== "number" || evidence.samConfidence < 0 || evidence.samConfidence > 1)) throw new Error("A candidate confidence was invalid.");
    return {
      candidateId: candidate.candidateId,
      elementId: candidate.elementId,
      concept: candidate.concept,
      evidence: {
        frameIndex: evidence.frameIndex as number,
        timestampMs: evidence.timestampMs as number,
        objectOrdinal: evidence.objectOrdinal as number,
        box: { left: box.left as number, top: box.top as number, right: box.right as number, bottom: box.bottom as number },
        ...(typeof evidence.samConfidence === "number" ? { samConfidence: evidence.samConfidence } : {}),
      },
    };
  });
  const times = new Set(candidates.map((candidate) => candidate.evidence.timestampMs));
  if (times.size > MAX_CANDIDATE_STILLS) throw new Error("The segmentation response exceeded the still-extraction limit.");
  if (root.mappingRequired !== (candidates.length > 0) || (candidates.length > 0 && (!hasMappingToken || typeof root.mappingExpiresAt !== "number" || !Number.isFinite(root.mappingExpiresAt))) || (candidates.length === 0 && (root.candidateToken !== undefined || root.mappingExpiresAt !== undefined))) {
    throw new Error("The response mapping lease did not match its candidate evidence.");
  }
  return {
    stage: "segmented",
    identity,
    room,
    media: { container: media.container, sourceVideoSha256: media.sourceVideoSha256 as string },
    candidateToken: hasMappingToken ? root.candidateToken as string : null,
    candidates,
    sampleTimestampsMs: root.sampleTimestampsMs as number[],
  };
}

async function parseMapResponse(
  value: unknown,
  expected: VideoIdentityFields,
  room: MoveInReadyRoomId,
  candidates: readonly SegmentCandidate[],
  evidenceIdentity: Pick<EvidenceReference, "schemaVersion" | "catalogVersion" | "videoId" | "videoRevision" | "roomId">,
): Promise<ParsedMapResponse> {
  const root = recordObject(value, "The Muse mapping response was invalid.");
  if (root.ok !== true || root.stage !== "mapped" || root.humanReviewRequired !== true || root.conditionAssessment !== "not_assessed") throw new Error("Muse output did not match the expected review-only contract.");
  const models = recordObject(root.models, "The model identity was invalid.");
  if (models.segmentation !== "sam-3.1" || (models.mapping !== "muse-spark-1.3" && models.mapping !== "muse-spark-open-baseten")) throw new Error("The response was produced by an unsupported model configuration.");
  const identity = parseIdentity(root.identity, expected);
  if (root.room !== room) throw new Error("Muse mapping returned a different room.");
  const media = recordObject(root.media, "The mapped media reference was invalid.");
  if (!isExpectedMp4Media(media, expected.expectedVideoSha256)) throw new Error("Muse mapping did not match the selected MP4 bytes.");
  if (!Array.isArray(root.proposals) || root.proposals.length > MOVE_IN_READY_ELEMENTS.length) throw new Error("Muse mapping contained an invalid proposal count.");
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const seen = new Set<string>();
  const proposals: MapProposal[] = [];
  for (const raw of root.proposals) {
    const proposal = recordObject(raw, "A Muse proposal was invalid.");
    if (Object.keys(proposal).some((key) => !["elementId", "state", "modelSuggestion", "observation", "confidence", "evidenceCandidateIds", "evidence", "deficiencySuggestion"].includes(key))) throw new Error("Muse returned an unsupported or verdict-like proposal field.");
    if (!isMoveInReadyElementId(proposal.elementId) || seen.has(proposal.elementId)) throw new Error("Muse returned a duplicate or unsupported element ID.");
    seen.add(proposal.elementId);
    if (proposal.state !== "draft-proposal" && proposal.state !== "needs-human-check") throw new Error("Muse proposal status was invalid.");
    if (proposal.modelSuggestion !== "A" && proposal.modelSuggestion !== "D") throw new Error("Muse suggestion must be an unreviewed A or D proposal.");
    let deficiencySuggestion: ModelDeficiencySuggestion | undefined;
    if (proposal.modelSuggestion === "D") {
      const parsedSuggestion = validateModelDeficiencySuggestion(proposal.deficiencySuggestion);
      if (!parsedSuggestion.ok) throw new Error("Muse returned an incomplete or invalid deficiency plan suggestion.");
      deficiencySuggestion = parsedSuggestion.value;
    } else if (proposal.deficiencySuggestion !== undefined && proposal.deficiencySuggestion !== null) {
      throw new Error("Muse returned a deficiency plan for a non-D suggestion.");
    }
    if (typeof proposal.observation !== "string" || proposal.observation.length < 1 || proposal.observation.length > 600) throw new Error("Muse observation text was outside its allowed length.");
    if (typeof proposal.confidence !== "number" || !Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 100) throw new Error("Muse proposal confidence was invalid.");
    const evidenceCandidateIds = proposal.evidenceCandidateIds;
    if (!Array.isArray(evidenceCandidateIds) || evidenceCandidateIds.length === 0 || evidenceCandidateIds.length > 5 || evidenceCandidateIds.some((id) => typeof id !== "string")) throw new Error("Muse evidence references were invalid.");
    const rawEvidence = Array.isArray(proposal.evidence) ? proposal.evidence : [];
    let evidenceIntegrityValid = rawEvidence.length === evidenceCandidateIds.length && new Set(evidenceCandidateIds).size === evidenceCandidateIds.length;
    const evidence = await Promise.all(evidenceCandidateIds.map(async (rawCandidateId, index) => {
      const candidateId = rawCandidateId as string;
      const candidate = candidateById.get(candidateId);
      const verified = candidate && candidate.elementId === proposal.elementId
        ? await verifyMappedServerEvidence(rawEvidence[index], candidate, evidenceIdentity)
        : null;
      if (!verified) evidenceIntegrityValid = false;
      return { candidateId, verified };
    }));
    proposals.push({
      elementId: proposal.elementId,
      state: proposal.state,
      modelSuggestion: proposal.modelSuggestion,
      observation: proposal.observation,
      confidence: proposal.confidence,
      evidenceCandidateIds: evidenceCandidateIds as string[],
      evidence,
      evidenceIntegrityValid,
      ...(deficiencySuggestion ? { deficiencySuggestion } : {}),
    });
  }
  return {
    stage: "mapped",
    identity,
    room,
    media: { container: media.container, sourceVideoSha256: media.sourceVideoSha256 as string },
    mappingModel: models.mapping,
    proposals,
  };
}

function parseIdentity(value: unknown, expected: VideoIdentityFields): VideoIdentityFields {
  const identity = recordObject(value, "The provider response identity was invalid.");
  for (const [key, value] of Object.entries(expected)) {
    if (identity[key] !== value) throw new Error("The response belongs to a different clip or analysis attempt. No result was saved.");
  }
  return expected;
}

function mapProposalsToEvidence(
  mapped: ParsedMapResponse,
  candidates: readonly SegmentCandidate[],
  analysisIdentity: VideoAnalysisIdentity,
): Partial<Record<MoveInReadyElementId, ModelElementProposal>> {
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const result: Partial<Record<MoveInReadyElementId, ModelElementProposal>> = {};
  for (const proposal of mapped.proposals) {
    const evidence: EvidenceReference[] = [];
    const ids = new Set<string>();
    let evidenceIntegrityValid = proposal.evidenceIntegrityValid;
    for (const mappedEvidence of proposal.evidence) {
      const candidateId = mappedEvidence.candidateId;
      if (ids.has(candidateId)) {
        evidenceIntegrityValid = false;
        continue;
      }
      ids.add(candidateId);
      const candidate = candidateById.get(candidateId);
      const verified = mappedEvidence.verified;
      if (!candidate || !verified || candidate.elementId !== proposal.elementId ||
          verified.reference.frameIndex !== candidate.evidence.frameIndex ||
          verified.reference.timestampMs !== candidate.evidence.timestampMs) {
        evidenceIntegrityValid = false;
        continue;
      }
      if (!evidence.some((item) => item.stillId === verified.reference.stillId)) evidence.push(verified.reference);
    }
    const state = resolveMappedProposalState(proposal.state, evidence.length, evidenceIntegrityValid);
    const base = {
      elementId: proposal.elementId,
      state,
      observation: proposal.observation,
      confidence: proposal.confidence,
      evidence,
      analysisIdentity,
    };
    result[proposal.elementId] = proposal.modelSuggestion === "D"
      ? {
          ...base,
          modelSuggestion: "D",
          ...(proposal.deficiencySuggestion ? { deficiencySuggestion: proposal.deficiencySuggestion } : {}),
        }
      : { ...base, modelSuggestion: "A" };
  }
  return result;
}

function makeNoEvidenceProposals(): Partial<Record<MoveInReadyElementId, ModelElementProposal>> {
  return {};
}

function replaceRoomProposals(
  current: MoveInReadyInspection,
  roomId: MoveInReadyRoomId,
  identity: StoredRoomClipIdentity,
  proposals: Partial<Record<MoveInReadyElementId, ModelElementProposal>>,
): MoveInReadyInspection {
  const decisions = { ...current.decisions };
  for (const elementId of MOVE_IN_READY_ELEMENT_IDS) {
    const decision = decisions[elementId];
    if ((decision.status === "A" || decision.status === "D") && decision.evidence.some((reference) => reference.roomId === roomId)) {
      decisions[elementId] = { status: "unreviewed" };
    }
  }
  for (const elementId of MOVE_IN_READY_ELEMENT_IDS) {
    const proposal = proposals[elementId];
    if (!proposal) continue;
    const decision = decisions[elementId];
    if ((decision.status === "A" || decision.status === "D") && decision.analysisIdentity !== null &&
        !sameAnalysisProvenance(decision.analysisIdentity, proposal.analysisIdentity)) {
      decisions[elementId] = { status: "unreviewed" };
    }
  }
  return {
    ...current,
    updatedAt: new Date().toISOString(),
    clipIdentities: { ...current.clipIdentities, [roomId]: identity },
    proposals: {
      ...Object.fromEntries(Object.entries(current.proposals).filter(([, proposal]) => !proposal || proposal.evidence.every((reference) => reference.roomId !== roomId))),
      ...proposals,
    },
    decisions,
    pendingAnalysisIntent: current.pendingAnalysisIntent?.roomId === roomId ? null : current.pendingAnalysisIntent,
    analysisQueue: dequeueAnalysisQueue(current.analysisQueue ?? [], roomId),
    signoff: null,
    participantSignoff: null,
  };
}

function clearRoomAnalysisState(current: MoveInReadyInspection, roomId: MoveInReadyRoomId): MoveInReadyInspection {
  // Element proof clips are filmed in a room but bound to their own videoId;
  // clearing a room clip must not strip element-bound evidence.
  const roomVideoId = current.clipIdentities[roomId]?.videoId;
  const belongsToRoomClip = (reference: EvidenceReference): boolean =>
    reference.roomId === roomId && (roomVideoId === undefined || reference.videoId === roomVideoId);
  const decisions = { ...current.decisions };
  for (const elementId of MOVE_IN_READY_ELEMENT_IDS) {
    const decision = decisions[elementId];
    if ((decision.status === "A" || decision.status === "D") && decision.evidence.some(belongsToRoomClip)) {
      decisions[elementId] = { status: "unreviewed" };
    }
  }
  return {
    ...current,
    updatedAt: new Date().toISOString(),
    proposals: Object.fromEntries(Object.entries(current.proposals).filter(([, proposal]) => !proposal || proposal.evidence.every((reference) => !belongsToRoomClip(reference)))),
    decisions,
    pendingAnalysisIntent: current.pendingAnalysisIntent?.roomId === roomId ? null : current.pendingAnalysisIntent,
    signoff: null,
    participantSignoff: null,
  };
}

function invalidateElementEvidence(
  current: MoveInReadyInspection,
  elementId: MoveInReadyElementId,
): MoveInReadyInspection {
  const oldVideoId = current.elementClipIdentities[elementId]?.videoId;
  const decisions = { ...current.decisions };
  for (const id of MOVE_IN_READY_ELEMENT_IDS) {
    const decision = decisions[id];
    if ((decision.status === "A" || decision.status === "D") &&
        decision.evidence.some((reference) => reference.videoId === oldVideoId)) {
      decisions[id] = { status: "unreviewed" };
    }
  }
  const elementClipIdentities = { ...current.elementClipIdentities };
  delete elementClipIdentities[elementId];
  const liveProofs = { ...current.liveProofs };
  delete liveProofs[elementId];
  const proposals = Object.fromEntries(Object.entries(current.proposals).filter(([, proposal]) =>
    !proposal || proposal.evidence.every((reference) => reference.videoId !== oldVideoId)));
  return {
    ...current,
    updatedAt: new Date().toISOString(),
    elementClipIdentities,
    liveProofs,
    proposals,
    decisions,
    signoff: null,
    participantSignoff: null,
  };
}

function invalidateRoomEvidence(
  current: MoveInReadyInspection,
  roomId: MoveInReadyRoomId,
  nextIdentity: StoredRoomClipIdentity | null,
): MoveInReadyInspection {
  const oldVideoId = current.clipIdentities[roomId]?.videoId;
  const decisions = { ...current.decisions };
  for (const elementId of MOVE_IN_READY_ELEMENT_IDS) {
    const decision = decisions[elementId];
    if ((decision.status === "A" || decision.status === "D") && decision.evidence.some((reference) => reference.roomId === roomId && reference.videoId === oldVideoId)) {
      decisions[elementId] = { status: "unreviewed" };
    }
  }
  const clipIdentities = { ...current.clipIdentities };
  if (nextIdentity) clipIdentities[roomId] = nextIdentity;
  else delete clipIdentities[roomId];
  const proposals = Object.fromEntries(Object.entries(current.proposals).filter(([, proposal]) => !proposal || proposal.evidence.every((reference) => reference.roomId !== roomId || reference.videoId !== oldVideoId)));
  return {
    ...current,
    updatedAt: new Date().toISOString(),
    clipIdentities,
    proposals,
    decisions,
    pendingAnalysisIntent: current.pendingAnalysisIntent?.roomId === roomId ? null : current.pendingAnalysisIntent,
    signoff: null,
    participantSignoff: null,
  };
}

function allCurrentEvidence(current: MoveInReadyInspection): EvidenceReference[] {
  return [
    ...Object.values(current.clipIdentities).flatMap((identity) => identity?.evidence ?? []),
    ...Object.values(current.elementClipIdentities ?? {}).flatMap((identity) => identity?.evidence ?? []),
  ];
}

function isEvidenceCurrent(
  reference: EvidenceReference,
  identity: StoredRoomClipIdentity | undefined,
  record: Pick<MoveInReadyInspection, "schemaVersion" | "catalogVersion">,
): boolean {
  return Boolean(identity &&
    reference.schemaVersion === record.schemaVersion && identity.schemaVersion === record.schemaVersion &&
    reference.catalogVersion === record.catalogVersion && identity.catalogVersion === record.catalogVersion &&
    reference.roomId === identity.roomId && reference.videoId === identity.videoId &&
    reference.videoRevision === identity.videoRevision && identity.evidence.some((item) =>
      item.schemaVersion === reference.schemaVersion && item.catalogVersion === reference.catalogVersion &&
      item.stillId === reference.stillId && item.stillHash === reference.stillHash,
    ));
}

function evidenceReferenceBaseKey(reference: EvidenceReference): string {
  return `${reference.videoId}\u0000${reference.videoRevision}\u0000${reference.roomId}\u0000${reference.stillId}\u0000${reference.timestampMs}\u0000${reference.stillHash}`;
}

function selectedEvidence(elementId: MoveInReadyElementId, stillIds: string[], current: MoveInReadyInspection): EvidenceReference[] {
  const element = MOVE_IN_READY_ELEMENTS.find((item) => item.id === elementId);
  const currentRefs = allCurrentEvidence(current).filter((reference) => (element ? roomContributesToElement(reference.roomId, element) : false) && isEvidenceCurrent(reference, identityForEvidenceReference(current, reference), current));
  const wanted = new Set(stillIds.slice(0, 5));
  return currentRefs.filter((reference) => wanted.has(reference.stillId));
}

function decisionEvidenceWithProvenance(
  proposal: ModelElementProposal | undefined,
  selected: readonly EvidenceReference[],
): { evidence: EvidenceReference[]; analysisIdentity: VideoAnalysisIdentity | null } {
  let includesModelEvidence = false;
  const evidence = selected.map((reference) => {
    const modelReference = proposal?.evidence.find((candidate) => evidenceReferenceBaseKey(candidate) === evidenceReferenceBaseKey(reference));
    if (!modelReference) return reference;
    includesModelEvidence = true;
    return modelReference;
  });
  return {
    evidence,
    analysisIdentity: includesModelEvidence ? proposal?.analysisIdentity ?? null : null,
  };
}

function sameAnalysisProvenance(left: VideoAnalysisIdentity, right: VideoAnalysisIdentity): boolean {
  return left.sessionId === right.sessionId &&
    left.roomId === right.roomId &&
    left.schemaVersion === right.schemaVersion &&
    left.videoId === right.videoId &&
    left.videoRevision === right.videoRevision &&
    left.expectedSourceHash === right.expectedSourceHash &&
    left.analysisId === right.analysisId &&
    left.attempt === right.attempt &&
    left.catalogVersion === right.catalogVersion;
}

/**
 * Unresolved elements whose AI draft needs evaluator attention first: a
 * suggested deficiency or a draft without verified evidence. Decided
 * elements never appear, and pure "A" drafts stay in the checklist.
 */
export function selectIssueElements(
  proposals: Partial<Record<MoveInReadyElementId, ModelElementProposal>>,
  decisions: EvaluatorDecisionSet,
): MoveInReadyElementId[] {
  return MOVE_IN_READY_ELEMENTS
    .filter((element) => {
      const proposal = proposals[element.id];
      if (!proposal) return false;
      if ((decisions[element.id]?.status ?? "unreviewed") !== "unreviewed") return false;
      return proposal.modelSuggestion === "D" || proposal.state === "needs-human-check";
    })
    .map((element) => element.id);
}

/**
 * Checklist order, hardest first: manual-only items, then D/check drafts,
 * then A drafts, then decided. Original numbering is preserved per row.
 */
export function sortedReviewElements(
  proposals: Partial<Record<MoveInReadyElementId, ModelElementProposal>>,
  decisions: EvaluatorDecisionSet,
): Array<{ element: (typeof MOVE_IN_READY_ELEMENTS)[number]; index: number }> {
  const rankOf = (elementId: MoveInReadyElementId): number => {
    const status = decisions[elementId]?.status ?? "unreviewed";
    if (status !== "unreviewed") return 3;
    const proposal = proposals[elementId];
    if (!proposal) return 0;
    if (proposal.modelSuggestion === "D" || proposal.state === "needs-human-check") return 1;
    return 2;
  };
  return MOVE_IN_READY_ELEMENTS
    .map((element, index) => ({ element, index }))
    .sort((a, b) => rankOf(a.element.id) - rankOf(b.element.id) || a.index - b.index);
}

function updateChecked(values: string[], value: string, checked: boolean, limit: number): string[] {
  if (checked) return values.includes(value) || values.length >= limit ? values : [...values, value];
  return values.filter((item) => item !== value);
}

function getReviewCounts(decisions?: EvaluatorDecisionSet): { resolved: number; approved: number; deficient: number; humanCheck: number } {
  if (!decisions) return { resolved: 0, approved: 0, deficient: 0, humanCheck: 0 };
  const list = MOVE_IN_READY_ELEMENT_IDS.map((id) => decisions[id]);
  return {
    resolved: list.filter((decision) => decision.status === "A" || decision.status === "D").length,
    approved: list.filter((decision) => decision.status === "A").length,
    deficient: list.filter((decision) => decision.status === "D").length,
    humanCheck: list.filter((decision) => decision.status === "needs-human-check").length,
  };
}

function decisionLabel(decision: EvaluatorDecision): string {
  if (decision.status === "A") return "Evaluator: acceptable";
  if (decision.status === "D") return "Evaluator: deficient";
  if (decision.status === "needs-human-check") return "Evaluator: needs a human check";
  return "Evaluator decision required";
}

function statusClass(decision: EvaluatorDecision): string {
  if (decision.status === "A") return styles.statusApproved;
  if (decision.status === "D") return styles.statusDeficient;
  if (decision.status === "needs-human-check") return styles.statusCheck;
  return "";
}

function recordObject(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function readSafeApiError(value: unknown, status: number): string {
  if (typeof value === "object" && value !== null && "error" in value) {
    const error = (value as { error?: unknown }).error;
    const code = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    if (typeof code === "string") {
      const safeMessages: Record<string, string> = {
        SETUP_REQUIRED: "Live video processing is not configured on this server.",
        INVALID_REQUEST: "The video request was invalid. Reload the room clip and try again.",
        VIDEO_TOO_LARGE: "The video exceeds the server’s 60 MiB upload limit.",
        VIDEO_TOO_LONG: "Keep each room video to 30 seconds or less.",
        UNSUPPORTED_VIDEO: "Choose an MP4 or MOV video supported by the server.",
        INVALID_VIDEO: "The selected video could not be validated. Choose a different MP4 or MOV clip.",
        UNSUPPORTED_STILL: "A source still could not be validated. Retry with a different clip.",
        STALE_REQUEST: "This room clip or walkthrough changed during processing. Reload it and start a new analysis.",
        OPERATION_BUSY: "Another video analysis is still active for this walkthrough. Wait, or reload after it completes.",
        PROCESSING_BUSY: "Video processing is busy. Wait briefly and retry.",
        PROVIDER_TIMEOUT: "Live video processing timed out. No sample result was substituted.",
        PROVIDER_FAILURE: "The live video provider could not complete this request. No sample result was substituted.",
        INVALID_MODEL_OUTPUT: "The provider response could not be safely reviewed. No decision was saved.",
      };
      if (safeMessages[code]) return safeMessages[code];
    }
  }
  return `Live analysis did not complete (server response ${status}). No sample result was substituted.`;
}

function findNearestSourceStill(
  stills: Map<number, { blob: Blob; hash: string; width: number; height: number }>,
  requestedTimestampMs: number,
): { timestampMs: number; blob: Blob; hash: string; width: number; height: number } | null {
  let closest: { timestampMs: number; blob: Blob; hash: string; width: number; height: number } | null = null;
  for (const [timestampMs, still] of stills) {
    if (!closest || Math.abs(timestampMs - requestedTimestampMs) < Math.abs(closest.timestampMs - requestedTimestampMs)) {
      closest = { timestampMs, ...still };
    }
  }
  if (!closest || Math.abs(closest.timestampMs - requestedTimestampMs) > 100) return null;
  return closest;
}

function sameRoomClipIdentity(
  left: StoredRoomClipIdentity | null,
  right: StoredRoomClipIdentity | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.roomId === right.roomId &&
    left.schemaVersion === right.schemaVersion &&
    left.catalogVersion === right.catalogVersion &&
    left.videoId === right.videoId &&
    left.videoRevision === right.videoRevision &&
    left.videoHash === right.videoHash &&
    left.capturedAt === right.capturedAt &&
    left.sizeBytes === right.sizeBytes;
}

function sameStoredClipSource(left: StoredVideoClip, right: StoredVideoClip): boolean {
  return left.id === right.id &&
    left.sessionId === right.sessionId &&
    left.roomId === right.roomId &&
    left.sourceSha256 === right.sourceSha256 &&
    left.capturedAt === right.capturedAt &&
    left.sizeBytes === right.sizeBytes &&
    left.durationSeconds === right.durationSeconds;
}

function makeRoomEvidenceTimestamps(
  durationSeconds: number,
  requiredTimestampMs: readonly number[],
): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 30) {
    throw new Error("The room clip duration is outside the supported still-extraction range.");
  }
  const durationMs = Math.floor(durationSeconds * 1000);
  const timestamps = new Set<number>();
  for (const timestampMs of requiredTimestampMs) {
    if (!Number.isSafeInteger(timestampMs) || timestampMs < 0 || timestampMs >= durationMs) {
      throw new Error("A segmented moment falls outside the current room clip.");
    }
    timestamps.add(timestampMs);
  }
  if (timestamps.size > MAX_ROOM_EVIDENCE_STILLS) {
    throw new Error("This room has more candidate moments than the local evidence limit allows.");
  }

  const targetCount = Math.max(
    timestamps.size,
    Math.min(MAX_ROOM_EVIDENCE_STILLS, Math.ceil(durationSeconds)),
  );
  for (let pass = 0; pass < 4 && timestamps.size < targetCount; pass += 1) {
    for (let index = 0; index < targetCount && timestamps.size < targetCount; index += 1) {
      const fractionalSlot = index + (pass + 0.5) / 4;
      const timestampMs = Math.min(
        durationMs - 1,
        Math.round((fractionalSlot / targetCount) * durationMs),
      );
      timestamps.add(timestampMs);
    }
  }
  return [...timestamps].sort((left, right) => left - right);
}

function safeClientError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0 && error.message.length <= 500) return error.message;
  return fallback;
}

function decisionMessage(errors: readonly string[]): string {
  if (errors.some((item) => item.includes("evidence"))) return "Attach at least one current source still to a D decision, then save it.";
  if (errors.some((item) => item.includes("completionDate") || item.includes("reinspectionDate"))) return "Enter valid completion and reinspection dates. Reinspection cannot be earlier than completion.";
  if (errors.some((item) => item.includes("correction") || item.includes("issueDescription"))) return "Enter the observed issue and required correction before saving a D decision.";
  if (errors.some((item) => item.includes("rationale"))) return "Add your own evaluator observation before saving this decision.";
  if (errors.some((item) => item.includes("typedSignature"))) return "Type the same name entered for the evaluator.";
  return "Complete the required fields and try again.";
}

function makeId(prefix: string): string {
  const token = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${token}`;
}

function isSafeSessionId(value: string | null): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
