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
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
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
  MOVE_IN_READY_SCHEMA_VERSION,
  MOVE_IN_READY_ELEMENTS,
  MOVE_IN_READY_ELEMENT_IDS,
  MOVE_IN_READY_ROOMS,
  MOVE_IN_READY_ROOM_PROMPT_IDS,
  createUnreviewedEvaluatorDecisions,
  deriveFinalInspectionResult,
  isMoveInReadyElementId,
  isMoveInReadyRoomId,
  validateModelDeficiencySuggestion,
  validateEvaluatorDecision,
  validateEvaluatorSignoff,
  type EvaluatorDecision,
  type EvaluatorDecisionSet,
  type EvaluatorSignoff,
  type EvidenceReference,
  type FireSafetyAssessment,
  type FireSafetyClauseOutcome,
  type FundingType,
  type ModelElementProposal,
  type ModelDeficiencySuggestion,
  type MoveInReadyElementId,
  type MoveInReadyPromptId,
  type MoveInReadyRoomId,
  type VideoAnalysisIdentity,
} from "../../domain/move-in-ready";
import { MOVE_IN_READY_ELEMENT_CRITERIA } from "../../domain/element-criteria";
import {
  buildHmisReadyJson,
  buildMoveInReadyPdf,
  exportFilename,
  type ExportStill,
  type MoveInReadyExportKind,
} from "../../export/move-in-ready-pdf";
import {
  createInitialInspectionRecord,
  createInspectionStore,
  INSPECTION_MEMORY_ONLY_WARNING,
  type InspectionStore,
  type MoveInReadyInspection,
  type PendingAnalysisIntent,
  type StoredRoomClipIdentity,
} from "./inspection-store";
import WalkthroughVideoCapture from "./video-capture";
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
  makeVideoClipId,
  type StoredVideoClip,
  type StoredVideoStill,
  type VideoClipStore,
} from "./video-store";
import { extractVideoStills, formatTimestamp, sha256Blob, type VideoStill } from "./video-utils";
import { createPendingCancelTracker } from "./pending-cancel";
import { deriveGuideModel, type GuideAction } from "./walkthrough-guide";
import AssistantGuide from "./assistant-guide";
import {
  ASSISTANT_FILMING_SCRIPTS,
  deriveAssistantNode,
  type AssistantAction as AssistantGuideAction,
} from "./assistant-script";
import { cancelSpeech, readVoiceEnabled, speakText, writeVoiceEnabled } from "./voice-guide";
import styles from "./move-in-ready-flow.module.css";

export type AnalysisMode = "live" | "fixture" | "unconfigured";
type Step = "home" | "capture" | "review" | "signoff" | "profile";
type ProfileSection = "unit" | "evaluator" | "agency";
type AnalysisStatus = "idle" | "segmenting" | "mapping" | "complete" | "error";
type DecisionChoice = "unreviewed" | "needs-human-check" | "A" | "D";
type FireSafetyDraftOutcome = "" | FireSafetyClauseOutcome;

export interface MoveInReadyFlowProps {
  analysisMode: AnalysisMode;
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

interface DecisionDraft {
  choice: DecisionChoice;
  rationale: string;
  manualCheckAcknowledged: boolean;
  issueDescription: string;
  correction: string;
  completionDate: string;
  reinspectionDate: string;
  fireSafetyUnitDetectors: FireSafetyDraftOutcome;
  fireSafetyPublicAreaDetectors: FireSafetyDraftOutcome;
  planSuggestionReviewed: boolean;
  evidenceStillIds: string[];
  note: string;
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

function isCaptureSetupComplete(
  record: Pick<MoveInReadyInspection, "pseudonym" | "fundingType"> | null,
): boolean {
  return record !== null && record.fundingType === "lahsa" && record.pseudonym.trim().length > 0;
}

function shouldExpandCaptureSetup(
  record: Pick<MoveInReadyInspection, "pseudonym" | "fundingType">,
): boolean {
  const isUntouched = !record.pseudonym.trim() && record.fundingType === "unknown";
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

export default function MoveInReadyFlow({ analysisMode }: MoveInReadyFlowProps) {
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
  const [activeElementId, setActiveElementId] = useState<MoveInReadyElementId | null>(MOVE_IN_READY_ELEMENT_IDS[0]);
  const [showAllReviewElements, setShowAllReviewElements] = useState(false);
  const [mobileReviewDetailOpen, setMobileReviewDetailOpen] = useState(false);
  const [isWideLayout, setIsWideLayout] = useState(false);
  const [reviewNoteOpen, setReviewNoteOpen] = useState(false);
  const [reviewNoteDraft, setReviewNoteDraft] = useState("");
  const [recordingInProgress, setRecordingInProgress] = useState(false);
  const [clips, setClips] = useState<Partial<Record<MoveInReadyRoomId, StoredVideoClip>>>({});
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
  const pendingCancelRef = useRef(createPendingCancelTracker());
  const [analysisError, setAnalysisError] = useState("");
  const [analysisNotice, setAnalysisNotice] = useState("");
  const [batchAttested, setBatchAttested] = useState(false);
  const [batchSendConsent, setBatchSendConsent] = useState(false);
  const [batchActive, setBatchActive] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; roomLabel: string } | null>(null);
  const [batchFailedRooms, setBatchFailedRooms] = useState<string[]>([]);
  const batchQueueRef = useRef<MoveInReadyRoomId[]>([]);
  const batchTotalRef = useRef(0);
  const batchRunningRef = useRef(false);
  const [walkthroughAttested, setWalkthroughAttested] = useState(false);
  const [walkthroughSendConsent, setWalkthroughSendConsent] = useState(false);
  const batchAutoStartedRef = useRef(false);
  const [assistantOpen, setAssistantOpen] = useState(() =>
    typeof navigator !== "undefined" && (navigator as { webdriver?: boolean }).webdriver === true ? false : true);
  const [voiceOn, setVoiceOn] = useState(() => readVoiceEnabled());
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
  const spokenAssistantKeyRef = useRef<string | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<MoveInReadyElementId, DecisionDraft>>>({});
  const [reviewError, setReviewError] = useState("");
  const [evidenceViews, setEvidenceViews] = useState<EvidenceView[]>([]);
  const [signoffName, setSignoffName] = useState("");
  const [signoffAttested, setSignoffAttested] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportNotice, setExportNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const analysisGenerationRef = useRef(0);
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

  const invalidateActiveAnalysis = useCallback((message?: string) => {
    analysisGenerationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (analysisStatus === "segmenting" || analysisStatus === "mapping") {
      setAnalysisStatus("idle");
      setAnalysisNotice(message ?? "Analysis stopped because the selected clip or room changed.");
    }
  }, [analysisStatus]);

  function analysisIsCurrent(generation: number, controller: AbortController, expectedSessionId: string, roomId: MoveInReadyRoomId, videoId: string, videoRevision: number, videoHash: string, schemaVersion: number, catalogVersion: string): boolean {
    const current = recordRef.current;
    const identity = current?.clipIdentities[roomId];
    return !controller.signal.aborted && generation === analysisGenerationRef.current && Boolean(
      current && identity && current.sessionId === expectedSessionId && current.selectedRoomId === roomId &&
      current.schemaVersion === schemaVersion && current.catalogVersion === catalogVersion &&
      identity.schemaVersion === schemaVersion && identity.catalogVersion === catalogVersion &&
      identity.videoId === videoId && identity.videoRevision === videoRevision && identity.videoHash === videoHash,
    );
  }

  // Release a server-held mapping lease when the tab closes mid-analysis.
  // The keepalive cancel is idempotent; lease expiry remains the fallback.
  useEffect(() => {
    const tracker = pendingCancelRef.current;
    const onPageHide = () => {
      const pending = tracker.consume();
      if (pending) void cancelPendingVideoMapping(pending.identity, pending.token);
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
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      active = false;
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      abortRef.current?.abort();
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
    setClipsReadySessionId(null);
    setUnreadableClipRooms([]);
    void Promise.all(MOVE_IN_READY_ROOMS.map(async (room) => {
      try {
        const clip = await store.get(expectedSession, room.id);
        const videoHash = clip ? await sha256Blob(clip.video) : null;
        return { roomId: room.id, clip, videoHash, failed: false } as const;
      } catch {
        return { roomId: room.id, clip: null, videoHash: null, failed: true } as const;
      }
    })).then((rows) => {
      if (!active || recordRef.current?.sessionId !== expectedSession) return;
      const next: Partial<Record<MoveInReadyRoomId, StoredVideoClip>> = {};
      const failedRooms: MoveInReadyRoomId[] = [];
      let reconciled = recordRef.current;
      let changed = false;
      for (const { roomId, clip, videoHash, failed } of rows) {
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
        const clip = clips[reference.roomId];
        if (!clip || clip.id !== makeVideoClipId(expectedSessionId, reference.roomId)) {
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
  }, [record, clips, clipsReadySessionId, unreadableClipRooms, persist]);

  const roomClips = useMemo(() => MOVE_IN_READY_ROOMS.map((room) => ({
    ...room,
    captured: Boolean(clips[room.id]),
  })), [clips]);
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
  const completedResult = currentRecord?.fundingType === "lahsa" && finalization?.status === "complete" && !form1083Blocker ? finalization.result : null;
  const canCapture = isCaptureSetupComplete(currentRecord);
  const guideModel = useMemo(() => deriveGuideModel({
    fundingType: currentRecord?.fundingType === "hud" ? "hud" : currentRecord?.fundingType === "lahsa" ? "lahsa" : "unknown",
    canCapture: isCaptureSetupComplete(currentRecord),
    pseudonym: currentRecord?.pseudonym ?? "",
    rooms: roomClips.map((room) => ({ id: room.id, label: room.label, captured: room.captured })),
    resolvedDecisions: reviewCounts.resolved,
    totalElements: MOVE_IN_READY_ELEMENTS.length,
    signed: Boolean(completedResult && currentRecord?.signoff),
  }), [currentRecord, canCapture, roomClips, reviewCounts.resolved, completedResult]);
  const assistantNode = useMemo(() => {
    const analyzedRoomIds = new Set<MoveInReadyRoomId>();
    for (const proposal of Object.values(currentRecord?.proposals ?? {})) {
      if (proposal) analyzedRoomIds.add(proposal.analysisIdentity.roomId);
    }
    let prefilled = 0;
    let acknowledged = 0;
    for (const element of MOVE_IN_READY_ELEMENTS) {
      const draft = drafts[element.id];
      if (!draft) continue;
      if (draft.choice === "A" || draft.choice === "D") prefilled += 1;
      if (draft.manualCheckAcknowledged) acknowledged += 1;
    }
    return deriveAssistantNode({
      fundingType: currentRecord?.fundingType === "hud" ? "hud" : currentRecord?.fundingType === "lahsa" ? "lahsa" : "unknown",
      canCapture: isCaptureSetupComplete(currentRecord),
      pseudonym: currentRecord?.pseudonym ?? "",
      evaluatorName: currentRecord?.evaluatorName ?? "",
      filmedRoomIds: capturedRoomIds,
      analyzedRoomIds: [...analyzedRoomIds],
      analyzedTotal: analyzedRoomIds.size,
      resolvedDecisions: reviewCounts.resolved,
      prefilledDecisions: prefilled,
      acknowledgedDecisions: acknowledged,
      nextUndecidedLabel: nextUndecidedElement?.label ?? null,
      nextUndecidedId: nextUndecidedElement?.id ?? null,
      signed: Boolean(completedResult && currentRecord?.signoff),
      batchActive,
    });
  }, [currentRecord, capturedRoomIds, reviewCounts.resolved, drafts, nextUndecidedElement, completedResult, batchActive]);

  const profileSectionReady = {
    unit: Boolean(currentRecord?.pseudonym.trim() && currentRecord.fundingType !== "unknown"),
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
  // per-room analyzeRoom() for every filmed room, sequentially. Each room
  // still passes the full consent/identity guards; success is proven by a
  // persisted proposal bound to the room's current clip, not by status text.
  useEffect(() => {
    if (!batchActive || step !== "capture") return;
    if (batchRunningRef.current) return;
    if (analysisStatus === "segmenting" || analysisStatus === "mapping") return;
    if (!online) {
      batchQueueRef.current = [];
      setBatchActive(false);
      setBatchProgress(null);
      setAnalysisNotice("Batch AI analysis stopped: the connection dropped. Reconnect and run it again; finished rooms are kept.");
      return;
    }
    const queue = batchQueueRef.current;
    if (queue.length === 0) {
      const failed = batchFailedRooms;
      setBatchActive(false);
      setBatchProgress(null);
      if (failed.length === 0) {
        setAnalysisNotice("AI finished every filmed room. Confirm each requirement below.");
        changeStep("review");
      } else {
        setAnalysisNotice(`AI finished with ${failed.length} room${failed.length === 1 ? "" : "s"} needing attention: ${failed.join(", ")}. Run batch analysis again to retry only those rooms.`);
      }
      return;
    }
    const roomId = queue[0];
    if (roomId === undefined || !isMoveInReadyRoomId(roomId)) {
      batchQueueRef.current = queue.slice(1);
      return;
    }
    if (selectedRoomId !== roomId) {
      selectRoom(roomId);
      return;
    }
    const key = clipConsentKey(recordRef.current, roomId);
    if (!key) {
      batchQueueRef.current = queue.slice(1);
      setBatchFailedRooms((previous) => [...previous, roomLabel(roomId)]);
      return;
    }
    if (mockUnitAttestationKey !== key || sendVideoConsentKey !== key) {
      if (!batchAttested || !batchSendConsent) {
        batchQueueRef.current = [];
        setBatchActive(false);
        setBatchProgress(null);
        setAnalysisNotice("Batch AI analysis stopped because its consent was withdrawn. No further room was sent.");
        return;
      }
      setMockUnitAttestationKey(key);
      setSendVideoConsentKey(key);
      return;
    }
    const total = batchTotalRef.current;
    const identity = recordRef.current?.clipIdentities[roomId] ?? null;
    const expectedVideoId = identity?.videoId ?? "";
    batchRunningRef.current = true;
    setBatchProgress({ done: total - queue.length, total, roomLabel: roomLabel(roomId) });
    void analyzeRoom().then(() => {
      batchRunningRef.current = false;
      const latest = recordRef.current;
      const proved = Boolean(latest && expectedVideoId &&
        Object.values(latest.proposals).some((proposal) =>
          Boolean(proposal) && proposal!.analysisIdentity.roomId === roomId && proposal!.analysisIdentity.videoId === expectedVideoId));
      batchQueueRef.current = batchQueueRef.current.slice(1);
      if (!proved) setBatchFailedRooms((previous) => [...previous, roomLabel(roomId)]);
      setBatchProgress({ done: total - batchQueueRef.current.length, total, roomLabel: roomLabel(roomId) });
    });
  });

  // Auto-run the AI batch once every room is filmed and the walkthrough
  // consent was confirmed upfront. One user decision covers the run; each
  // room still passes the full per-room consent/identity guards inside the
  // batch driver, and MOV-only or already-analyzed rooms are skipped.
  useEffect(() => {
    if (!walkthroughAttested || !walkthroughSendConsent) return;
    if (batchActive || batchAutoStartedRef.current) return;
    if (analysisMode !== "live" || !online) return;
    if (capturedRoomCount < MOVE_IN_READY_ROOMS.length) return;
    const current = recordRef.current;
    if (!current || current.fundingType !== "lahsa" || !current.pseudonym.trim()) return;
    const needsWork = MOVE_IN_READY_ROOMS.some((room) =>
      clips[room.id] && clips[room.id]?.mime !== "video/quicktime" && !roomHasCurrentProposal(room.id));
    if (!needsWork) return;
    batchAutoStartedRef.current = true;
    setBatchAttested(true);
    setBatchSendConsent(true);
    startBatchAnalysis();
  });

  // Speak each new guidance node aloud while the assistant is open.
  useEffect(() => {
    if (!assistantOpen || !voiceOn) return;
    if (spokenAssistantKeyRef.current === assistantNode.key) return;
    spokenAssistantKeyRef.current = assistantNode.key;
    speakText(assistantNode.speak);
    return () => cancelSpeech();
  }, [assistantNode, assistantOpen, voiceOn]);

  // Narrate the filming script on timed cues while a take is recording.
  useEffect(() => {
    if (!recordingInProgress || !assistantOpen || !voiceOn) return;
    const cues = ASSISTANT_FILMING_SCRIPTS[selectedRoomId];
    const timers = cues.map((cue, index) =>
      window.setTimeout(() => speakText(cue), 800 + index * 7000));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      cancelSpeech();
    };
  }, [recordingInProgress, selectedRoomId, assistantOpen, voiceOn]);

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
      if (oldIdentity) invalidateActiveAnalysis("The room clip was removed. Any decisions based on it were cleared.");
      const invalidated = oldIdentity ? invalidateRoomEvidence(activeRecord, roomId, null) : activeRecord;
      const next = {
        ...invalidated,
        completedPromptIdsByRoom: { ...invalidated.completedPromptIdsByRoom, [roomId]: [] },
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
      invalidateActiveAnalysis("A room clip changed. Prior proposals and decisions tied to that clip were cleared.");
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
    } catch (error) {
      setAnalysisError(safeClientError(error, "This browser could not securely identify the video bytes. The clip is saved locally, but live analysis is unavailable."));
    }
  }, [invalidateActiveAnalysis, persist, refreshStorageWarning]);

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
      setShowAllReviewElements(false);
      setMobileReviewDetailOpen(false);
      setReviewNoteOpen(false);
    }
    setReviewError("");
    scrollMainToTop();
  }

  function selectRoom(roomId: string): void {
    if (!isMoveInReadyRoomId(roomId)) return;
    invalidateActiveAnalysis("Analysis was cancelled because the selected room changed.");
    setSelectedRoomId(roomId);
    setClipDetailsExpanded(false);
    setAnalysisExpanded(false);
    setMockUnitAttestationKey(null);
    setSendVideoConsentKey(null);
    updateRecord((current) => ({ ...current, selectedRoomId: roomId }));
    setAnalysisError("");
  }

  function roomHasCurrentProposal(roomId: MoveInReadyRoomId): boolean {
    const current = recordRef.current;
    const identity = current?.clipIdentities[roomId];
    if (!current || !identity) return false;
    return Object.values(current.proposals).some((proposal) =>
      Boolean(proposal) &&
      proposal!.analysisIdentity.roomId === roomId &&
      proposal!.analysisIdentity.videoId === identity.videoId &&
      proposal!.analysisIdentity.videoRevision === identity.videoRevision);
  }

  function startBatchAnalysis(): void {
    if (batchActive || analysisStatus === "segmenting" || analysisStatus === "mapping") return;
    const current = recordRef.current;
    if (!current) return;
    const rooms = MOVE_IN_READY_ROOMS
      .map((room) => room.id)
      .filter((roomId) => clips[roomId] && clips[roomId]?.mime !== "video/quicktime" && !roomHasCurrentProposal(roomId));
    if (rooms.length === 0) return;
    batchQueueRef.current = [...rooms];
    batchTotalRef.current = rooms.length;
    setBatchFailedRooms([]);
    setBatchProgress({ done: 0, total: rooms.length, roomLabel: "" });
    setAnalysisError("");
    setAnalysisNotice("");
    setBatchActive(true);
  }

  function cancelBatchAnalysis(): void {
    if (!batchActive) return;
    batchQueueRef.current = [];
    setBatchActive(false);
    setBatchProgress(null);
    invalidateActiveAnalysis("Batch AI analysis was cancelled. Finished rooms keep their drafts.");
  }

  function handleGuideAction(action: GuideAction): void {
    if (action.type === "setup") {
      changeStep("capture");
      setSetupExpanded(true);
      window.setTimeout(() => {
        document.getElementById("capture-pseudonym")?.focus({ preventScroll: false });
      }, 60);
    } else if (action.type === "room") {
      changeStep("capture");
      selectRoom(action.roomId);
    } else if (action.type === "step") {
      changeStep(action.step);
    }
  }

  function handleAssistantAction(action: AssistantGuideAction): void {
    if (action.id === "setup") {
      handleGuideAction({ type: "setup" });
    } else if (action.id === "film-room" && action.roomId) {
      changeStep("capture");
      selectRoom(action.roomId);
      window.setTimeout(() => captureControlRef.current?.startCapture(), 400);
    } else if (action.id === "analyze-all") {
      changeStep("capture");
      setBatchAttested(true);
      setBatchSendConsent(true);
      window.setTimeout(() => startBatchAnalysis(), 60);
    } else if (action.id === "open-requirement" && action.elementId) {
      changeStep("review");
      openReviewElement(action.elementId);
    } else if (action.id === "prefill-all") {
      prefillAllFromProposals();
      changeStep("review");
    } else if (action.id === "save-all") {
      changeStep("review");
      window.setTimeout(() => saveAllConfirmed(), 60);
    } else if (action.id === "signoff") {
      changeStep("signoff");
    } else if (action.id === "dismiss") {
      setAssistantOpen(false);
    }
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
    if (!showAllReviewElements) setActiveElementId(null);
    scrollMainToTop("smooth");
  }

  function returnToReviewSummary(): void {
    setShowAllReviewElements(false);
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

  async function analyzeRoom(): Promise<void> {
    if (analysisStatus === "segmenting" || analysisStatus === "mapping") return;
    const generation = ++analysisGenerationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    const current = recordRef.current;
    if (!current) return;
    const roomId = selectedRoomId;
    if (clips[roomId]?.mime === "video/quicktime") {
      setAnalysisError("Meta's current video upload API accepts MP4 only. This MOV stays on this device for manual review; choose or record an MP4 for live analysis.");
      setAnalysisStatus("error");
      return;
    }
    const expectedSessionId = current.sessionId;
    let intentIdentity = current.clipIdentities[roomId] ?? null;
    const consentIsCurrent = () => {
      const key = clipConsentKey(recordRef.current, roomId);
      return Boolean(key && mockUnitAttestationKey === key && sendVideoConsentKey === key);
    };
    const intentIsCurrent = () => {
      const latest = recordRef.current;
      return !controller.signal.aborted &&
        generation === analysisGenerationRef.current &&
        latest?.sessionId === expectedSessionId &&
        latest.schemaVersion === MOVE_IN_READY_SCHEMA_VERSION &&
        latest.catalogVersion === CATALOG_VERSION &&
        latest.selectedRoomId === roomId &&
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
    const currentConsentKey = clipConsentKey(current, roomId);
    if (!currentConsentKey || mockUnitAttestationKey !== currentConsentKey || sendVideoConsentKey !== currentConsentKey) {
      setAnalysisError("Confirm this staged mock-unit clip and its temporary server/Meta processing notice before sending it.");
      setAnalysisStatus("error");
      return;
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
    abortRef.current = controller;
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
      if (generation === analysisGenerationRef.current) abortRef.current = null;
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
    if (!intentIsCurrent() || !analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion)) return;
    const latestRecord = recordRef.current;
    if (!latestRecord) return;
    persist(clearRoomAnalysisState(latestRecord, roomId));
    try {
      const segmentForm = new FormData();
      segmentForm.set("stage", "segment");
      segmentForm.set("room", roomId);
      segmentForm.set("video", new File([clip.video], clip.fileName, { type: clip.mime }));
      appendIdentity(segmentForm, requestIdentity);
      if (!intentIsCurrent() || !analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion)) return;
      segmentationRequested = true;
      pendingCancelRef.current.set(requestIdentity, null);
      const segmentResponse = await fetch("/api/video/segment?stage=segment", {
        method: "POST",
        body: segmentForm,
        signal: controller.signal,
        cache: "no-store",
      });
      const segmentJson: unknown = await segmentResponse.json().catch(() => null);
      if (!segmentResponse.ok) throw new Error(readSafeApiError(segmentJson, segmentResponse.status));
      const segmented = parseSegmentResponse(segmentJson, requestIdentity, roomId);
      candidateTokenToRelease = segmented.candidateToken;
      pendingCancelRef.current.set(requestIdentity, segmented.candidateToken ?? null);
      if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion)) return;

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
        if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion)) return;
      }
      if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion)) return;
      const stillByTime = new Map<number, { blob: Blob; hash: string; width: number; height: number }>();
      for (const still of extracted) {
        const timestampMs = Math.round(still.timestampSeconds * 1000);
        const hash = await sha256Blob(still.blob);
        if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion)) return;
        stillByTime.set(timestampMs, {
          blob: still.blob,
          hash,
          width: still.width,
          height: still.height,
        });
      }
      if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion)) return;
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
      if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion)) return;
      const updatedClip = await store.get(expectedSessionId, roomId);
      if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion)) return;
      if (!updatedClip || updatedClip.sourceSha256 !== identity.videoHash) throw new Error("The source clip changed before its review stills could be reopened.");
      setClips((previous) => ({ ...previous, [roomId]: updatedClip }));
      let extractedIdentity = { ...identity, evidence: [...sourceReferences.values()] };
      const latestRecord = recordRef.current;
      if (!latestRecord || !analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion)) return;
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
      const mapResponse = await fetch("/api/video/segment?stage=map", {
        method: "POST",
        body: mapForm,
        signal: controller.signal,
        cache: "no-store",
      });
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
      if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion)) return;
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
        if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion)) return;
        const updatedClip = await store.get(expectedSessionId, roomId);
        if (!analysisIsCurrent(generation, controller, expectedSessionId, roomId, identity.videoId, identity.videoRevision, identity.videoHash, requestIdentity.schemaVersion, requestIdentity.catalogVersion)) return;
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
      if (controller.signal.aborted || generation !== analysisGenerationRef.current) return;
      setAnalysisStatus("error");
      setAnalysisError(safeClientError(error, "Live room analysis did not complete. No sample result was substituted."));
    } finally {
      if (generation === analysisGenerationRef.current) {
        abortRef.current = null;
      }
      pendingCancelRef.current.clear();
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
        fundingType: key === "fundingType" ? value as FundingType : current?.fundingType ?? "unknown",
      }));
    }
    const previousValue = recordRef.current?.[key];
    const evaluatorChanged = key === "evaluatorName" && previousValue !== value;
    const signoffChanged = previousValue !== value;
    if (evaluatorChanged) setDrafts({});
    if (signoffChanged) {
      setSignoffName("");
      setSignoffAttested(false);
    }
    updateRecord((current) => {
      const identityChanged = key === "evaluatorName" && current.evaluatorName !== value;
      const landlordMarkedNotInformed = key === "landlordDiscussion" && value !== "yes";
      return {
        ...current,
        [key]: value,
        ...(landlordMarkedNotInformed ? { landlordDiscussionDate: "" } : {}),
        ...(signoffChanged ? { signoff: null } : {}),
        ...(identityChanged ? { decisions: createUnreviewedEvaluatorDecisions(), signoff: null } : {}),
      };
    });
  }

  function saveDecision(elementId: MoveInReadyElementId): boolean {
    const current = recordRef.current;
    if (!current) return false;
    if (current.fundingType !== "lahsa") {
      setReviewError(current.fundingType === "hud"
        ? "HQS is required for HUD-funded units. Form 1083 decisions are disabled for this unit."
        : "Choose LAHSA / Form 1083 funding in Profile before recording a decision.");
      return false;
    }
    const draft = drafts[elementId] ?? createDecisionDraft(current.decisions[elementId]);
    const isFireSafety = elementId === "demo-smoke-co";
    const fireAssessment = isFireSafety ? fireSafetyAssessmentFromDraft(draft) : undefined;
    const completeFireAssessment = isFireSafety ? completeFireSafetyAssessmentFromDraft(draft) : undefined;
    const choice = isFireSafety ? fireSafetyChoiceFromDraft(draft) : draft.choice;
    if (!current.evaluatorName.trim()) {
      setReviewError("Add the evaluator’s name in Profile before recording a decision.");
      return false;
    }
    if ((choice === "A" || choice === "D") && !draft.manualCheckAcknowledged) {
      setReviewError("Complete the in-person check and acknowledge it before saving this decision.");
      return false;
    }
    if (choice === "D" && current.proposals[elementId]?.modelSuggestion === "D" &&
        current.proposals[elementId]?.deficiencySuggestion && !draft.planSuggestionReviewed) {
      setReviewError("Review the AI plan suggestion, then confirm it or replace its fields before saving your D decision.");
      return false;
    }
    let candidate: EvaluatorDecision;
    if (choice === "unreviewed") {
      candidate = { status: "unreviewed" };
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
    }));
    setReviewError("");
    const savedOk = true;
    if (window.matchMedia("(max-width: 719px)").matches) {
      setMobileReviewDetailOpen(false);
      scrollMainToTop("smooth");
    }
    return savedOk;
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

  function prefillAllFromProposals(): void {
    const current = recordRef.current;
    if (!current) return;
    setDrafts((previous) => {
      const next = { ...previous };
      for (const element of MOVE_IN_READY_ELEMENTS) {
        if (element.id === "demo-smoke-co") continue;
        const proposal = current.proposals[element.id];
        if (!proposal) continue;
        if ((current.decisions[element.id]?.status ?? "unreviewed") !== "unreviewed") continue;
        const base = next[element.id] ?? createDecisionDraft({ status: "unreviewed" });
        next[element.id] = prefillDraftFromProposal(base, proposal);
      }
      return next;
    });
    setReviewError("");
  }

  function saveAllConfirmed(): void {
    const current = recordRef.current;
    if (!current) return;
    let saved = 0;
    const skipped: string[] = [];
    for (const element of MOVE_IN_READY_ELEMENTS) {
      if ((recordRef.current?.decisions[element.id]?.status ?? "unreviewed") !== "unreviewed") continue;
      const draft = drafts[element.id] ?? createDecisionDraft({ status: "unreviewed" });
      const effective = element.id === "demo-smoke-co" ? fireSafetyChoiceFromDraft(draft) : draft.choice;
      if ((effective === "A" || effective === "D") && draft.manualCheckAcknowledged) {
        if (saveDecision(element.id)) saved += 1;
        else skipped.push(element.label);
      } else {
        skipped.push(element.label);
      }
    }
    if (skipped.length === 0) setReviewError("");
    else if (saved === 0) setReviewError(`Nothing saved. Confirm each requirement in person first: ${skipped.join(", ")}.`);
    else setReviewError(`Saved ${saved}. Still need your in-person confirmation: ${skipped.join(", ")}.`);
  }

  function saveSignoff(): void {
    const current = recordRef.current;
    if (!current) return;
    if (current.fundingType !== "lahsa") {
      setExportError(current.fundingType === "hud"
        ? "HQS is required for HUD-funded units. Form 1083 sign-off is disabled."
        : "Choose LAHSA / Form 1083 funding in Profile before signing.");
      return;
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
      return;
    }
    const formBlocker = form1083AdministrativeBlocker(current);
    if (formBlocker) {
      setExportError(formBlocker);
      return;
    }
    const result = deriveFinalInspectionResult({
      fundingType: current.fundingType,
      capturedRoomIds: MOVE_IN_READY_ROOMS.filter((room) => Boolean(clips[room.id])).map((room) => room.id),
      evaluatorDecisions: current.decisions,
      signoff: parsed.value,
    });
    if (result.status !== "complete") {
      setExportError(result.blockers[0] ?? "Complete all evaluator decisions before sign-off.");
      return;
    }
    updateRecord((latest) => ({ ...latest, signoff: parsed.value }));
    setExportError("");
    setExportNotice("Evaluator sign-off saved to this device. No result has been sent to LAHSA or HMIS.");
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
      const clip = await store.get(current.sessionId, reference.roomId);
      const identity = current.clipIdentities[reference.roomId];
      const referenceIsCurrent = Boolean(identity && identity.videoId === reference.videoId && identity.videoRevision === reference.videoRevision &&
        identity.schemaVersion === reference.schemaVersion && identity.catalogVersion === reference.catalogVersion &&
        identity.evidence.some((saved) => saved.stillId === reference.stillId && saved.videoId === reference.videoId &&
          saved.schemaVersion === reference.schemaVersion && saved.catalogVersion === reference.catalogVersion &&
          saved.videoRevision === reference.videoRevision && saved.timestampMs === reference.timestampMs && saved.stillHash === reference.stillHash));
      if (!clip || clip.id !== makeVideoClipId(current.sessionId, reference.roomId) || !identity || !referenceIsCurrent ||
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
    if (recordRef.current !== current) {
      throw new Error("The walkthrough changed while this export was being prepared. Review the current details and export again.");
    }
  }

  async function downloadExport(kind: MoveInReadyExportKind | "hmis-json"): Promise<void> {
    const current = recordRef.current;
    if (current && current.fundingType !== "lahsa") {
      setExportError(current.fundingType === "hud"
        ? "HQS is required for HUD-funded units. Form 1083 exports are disabled."
        : "Choose LAHSA / Form 1083 funding in Profile before exporting.");
      return;
    }
    const capturedRoomIds = MOVE_IN_READY_ROOMS.filter((room) => Boolean(clips[room.id])).map((room) => room.id);
    const currentFinalization = current ? deriveFinalInspectionResult({
      fundingType: current.fundingType,
      capturedRoomIds,
      evaluatorDecisions: current.decisions,
      signoff: current.signoff,
    }) : null;
    if (!current?.signoff || currentFinalization?.status !== "complete" || form1083AdministrativeBlocker(current)) {
      setExportError(current ? form1083AdministrativeBlocker(current) ?? "Capture all four room videos, complete every evaluator decision, and save your attestation before creating exports." : "Capture all four room videos, complete every evaluator decision, and save your attestation before creating exports.");
      return;
    }
    setExporting(true);
    setExportError("");
    setExportNotice("");
    try {
      const stills = await collectExportStills(current);
      await assertExportSnapshotCurrent(current, capturedRoomIds);
      const exportInput = {
        sessionId: current.sessionId,
        pseudonym: current.pseudonym,
        fundingType: current.fundingType,
        capturedRoomIds,
        decisions: current.decisions,
        signoff: current.signoff,
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
      const body = kind === "hmis-json"
        ? new TextEncoder().encode(JSON.stringify(await buildHmisReadyJson(exportInput), null, 2))
        : await buildMoveInReadyPdf(exportInput, kind);
      await assertExportSnapshotCurrent(current, capturedRoomIds);
      const filename = kind === "hmis-json"
        ? exportFilename("hmis-ready", current.sessionId, dateName).replace(/\.pdf$/, ".json")
        : exportFilename(kind, current.sessionId, dateName);
      const mime = kind === "hmis-json" ? "application/json" : "application/pdf";
      const url = URL.createObjectURL(new Blob([body], { type: mime }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setExportNotice(`${filename} downloaded. Handle it through your existing manual process.`);
    } catch (error) {
      setExportError(safeClientError(error, "The local export could not be created."));
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
    batchQueueRef.current = [];
    batchTotalRef.current = 0;
    batchRunningRef.current = false;
    batchAutoStartedRef.current = false;
    setAnalysisExpanded(false);
    setClipDetailsExpanded(false);
    setDrafts({});
    setReviewError("");
    setEvidenceViews([]);
    setActiveElementId(null);
    setMobileReviewDetailOpen(false);
    setShowAllReviewElements(false);
    setReviewNoteOpen(false);
    setReviewNoteDraft("");
    setSignoffName("");
    setSignoffAttested(false);
    setExportError("");
    setExportNotice("");
    setProfileSection("unit");
    spokenAssistantKeyRef.current = null;
    cancelSpeech();
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
      element.roomIds.some((roomId) => roomId === reference.roomId) &&
      isEvidenceCurrent(reference, record.clipIdentities[reference.roomId], record),
    );
  };

  if (booting || !sessionId || !record) {
    return <main className={styles.app}><div className={styles.main}><p role="status">Opening this walkthrough on this device…</p></div></main>;
  }

  return (
    <div className={styles.app} data-step={step} data-review-detail={mobileReviewDetailOpen ? "true" : "false"} data-review-list={showAllReviewElements ? "true" : "false"} data-testid="move-in-ready-app">
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
                <p className={styles.draftLabel}>Next step</p>
                <h2>{guideModel?.nextLabel ?? "Walkthrough complete"}</h2>
                <p className={styles.cardLead}>
                  {record.fundingType === "hud"
                    ? "This unit needs the HQS workflow. Form 1083 cannot be completed here."
                    : "The AI drafts from your room videos. You only confirm each requirement in person — nothing is decided for you."}
                </p>
                {record.fundingType !== "hud" && (
                  <div className={styles.homeContinueRow}>
                    <button
                      className={`${styles.button} ${styles.wideButton}`}
                      type="button"
                      onClick={() => {
                        if (guideModel && guideModel.nextAction.type !== "none") handleGuideAction(guideModel.nextAction);
                        else if (!canCapture) { changeStep("capture"); setSetupExpanded(true); }
                        else changeStep("review");
                      }}
                    >
                      {hasInspectionProgress ? "Continue inspection" : "Continue"} <ArrowRight size={17} aria-hidden="true" />
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
                      const clipCount = MOVE_IN_READY_ROOMS.filter((room) => item.clipIdentities[room.id]).length;
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
                    <p className={styles.cardLead}>{capturedRoomCount} of {MOVE_IN_READY_ROOMS.length} clips saved. One continuous take per room.</p>
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
                      <select id="capture-funding" className={styles.formSelect} value={record.fundingType} onChange={(event) => setProfileField("fundingType", event.currentTarget.value as FundingType)}>
                        <option value="unknown">Choose funding type</option>
                        <option value="lahsa">LAHSA / Form 1083</option>
                        <option value="hud">HUD-funded / HQS</option>
                      </select>
                    </div>
                  </div>
                  {record.fundingType === "hud" && <div className={`${styles.callout} ${styles.calloutDanger}`} role="alert"><strong>HQS workflow required.</strong> This app only supports the LAHSA Form 1083 path. HUD-funded units cannot receive a result or export here.</div>}
                  {record.fundingType === "unknown" && <div className={`${styles.callout} ${styles.calloutWarning}`} role="status">Select the unit’s funding type to continue.</div>}
                </div>}
              </div>}

              {!canCapture && record.fundingType !== "hud" && (
                <div className={`${styles.callout} ${styles.captureSetupGate}`} role="status" data-testid="capture-setup-gate">
                  <strong>Finish unit setup to enable recording.</strong> Enter a unit pseudonym and select LAHSA / Form 1083 above. No video is sent unless you later choose live analysis.
                </div>
              )}

              {record.fundingType !== "hud" && (
                <>
                  {canCapture && (
                    <div className={`${styles.card} ${styles.captureNextBar}`} data-testid="capture-next-bar">
                      <div>
                        <strong>{capturedRoomCount} of {MOVE_IN_READY_ROOMS.length} rooms filmed</strong>
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
                          <p className={styles.cardLead}>Confirm once. Film all 4 rooms and the AI analyzes every clip by itself, then brings you the report.</p>
                          <label className={styles.checkLabel}>
                            <input type="checkbox" checked={walkthroughAttested} onChange={(event) => setWalkthroughAttested(event.currentTarget.checked)} />
                            <span>Every clip I film is staged/mock-unit footage with no tenants, faces, addresses, personal documents, or real case notes.</span>
                          </label>
                          <label className={styles.checkLabel}>
                            <input type="checkbox" checked={walkthroughSendConsent} onChange={(event) => setWalkthroughSendConsent(event.currentTarget.checked)} />
                            <span>I understand each filmed clip will be sent for live processing by Meta once all 4 rooms are filmed.</span>
                          </label>
                        </div>
                      )}
                      {capturedRoomCount > 0 && (
                        <details className={styles.batchDisclosure} data-testid="batch-analysis-disclosure">
                          <summary>
                            <span><strong>AI analyzes every filmed room</strong><small>{batchActive && batchProgress ? `Working: ${batchProgress.roomLabel} · ${batchProgress.done} of ${batchProgress.total}` : `${capturedRoomCount} clip${capturedRoomCount === 1 ? "" : "s"} ready · one tap`}</small></span>
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
                              <span>I understand the filmed clips will be sent one room at a time for live processing by Meta.</span>
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
                    rooms={MOVE_IN_READY_ROOMS}
                    roomId={selectedRoomId}
                    capturedRoomCount={capturedRoomCount}
                    capturedRoomIds={capturedRoomIds}
                    onRecordingStateChange={setRecordingInProgress}
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
                            MOVE_IN_READY_ROOM_PROMPT_IDS[selectedRoomId].length,
                          ) as MoveInReadyPromptId[],
                        },
                      }));
                    }}
                    onRoomChange={(roomId) => selectRoom(roomId)}
                    disabled={!canCapture || analysisStatus === "segmenting" || analysisStatus === "mapping"}
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
                        {analysisMode === "live" && <div className={`${styles.callout} ${styles.calloutWarning}`} role="status">Live mode is enabled, but the provider connection has not been tested. A request is sent only after you confirm the staged-unit and processing notices.</div>}
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
                          <button className={`${styles.button} ${styles.wideButton}`} type="button" onClick={() => void analyzeRoom()} disabled={analysisMode !== "live" || !clips[selectedRoomId] || clips[selectedRoomId]?.mime === "video/quicktime" || !mockUnitAttested || !sendVideoConsent || analysisStatus === "segmenting" || analysisStatus === "mapping" || (!online && Boolean(pendingForSelectedRoom))}>
                            {analysisStatus === "segmenting" || analysisStatus === "mapping" ? <><LoaderCircle className={styles.spinner} size={17} aria-hidden="true" /> {analysisStatus === "segmenting" ? "Segmenting room video…" : "Mapping source stills…"} <span aria-hidden="true">{formatTimestamp(analysisElapsedSeconds)}</span></> : pendingForSelectedRoom ? online ? <><RefreshCw size={17} aria-hidden="true" /> Retry analysis</> : <><CloudOff size={17} aria-hidden="true" /> Analysis queued</> : analysisStatus === "complete" ? <><RefreshCw size={17} aria-hidden="true" /> Analyze this room again</> : online ? <><Video size={17} aria-hidden="true" /> Analyze this room</> : <><CloudOff size={17} aria-hidden="true" /> Queue analysis for when connected</>}
                          </button>
                          {(analysisStatus === "segmenting" || analysisStatus === "mapping") && <button className={styles.secondaryButton} type="button" onClick={() => invalidateActiveAnalysis("Analysis was cancelled. No result was saved.")}>Cancel</button>}
                        </div>
                        <p className={styles.privacyText}>Each explicit run makes one segmentation stage and one mapping stage. No automatic paid retries. Local clips are not uploaded until you choose Analyze.</p>
                        {analysisStatus === "error" && analysisError && <p className={styles.statusText} role="status">No sample result was substituted.</p>}
                      </div>
                    </details>
                  </WalkthroughVideoCapture>

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
              title={record.fundingType === "hud" ? "HQS required" : record.fundingType === "unknown" ? "Choose funding type" : reviewNoteOpen ? "Add Note" : mobileReviewDetailOpen && !isWideLayout && activeElementId ? MOVE_IN_READY_ELEMENTS.find((element) => element.id === activeElementId)?.label ?? "Requirement review" : showAllReviewElements ? "All 11 requirements" : "Requirement checklist"}
              lead={record.fundingType === "hud" ? "Use the HQS inspection workflow for HUD-funded units." : record.fundingType === "unknown" ? "Choose the applicable route in Profile before reviewing." : reviewNoteOpen ? "Add a short note to this local walkthrough." : mobileReviewDetailOpen && !isWideLayout ? `Requirement ${activeReviewIndex + 1} of ${MOVE_IN_READY_ELEMENTS.length} · confirm in person` : showAllReviewElements ? "Work through each requirement in order. AI drafts first, your decision second." : `${record.pseudonym} · ${reviewCounts.resolved} of ${MOVE_IN_READY_ELEMENTS.length} requirements decided`}
              backLabel={reviewNoteOpen ? "checklist" : mobileReviewDetailOpen && !isWideLayout && showAllReviewElements ? "all 11 requirements" : mobileReviewDetailOpen && !isWideLayout ? "checklist" : showAllReviewElements ? "checklist" : "home"}
              onBack={() => {
                if (reviewNoteOpen) {
                  setReviewNoteOpen(false);
                } else if (mobileReviewDetailOpen && !isWideLayout) {
                  returnToReviewOverview();
                } else if (showAllReviewElements) {
                  returnToReviewSummary();
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
                      updateRecord((current) => ({ ...current, inspectionNote: nextNote, signoff: null }));
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
              {!mobileReviewDetailOpen && nextUndecidedElement && (
                <button className={`${styles.button} ${styles.wideButton}`} type="button" onClick={() => openReviewElement(nextUndecidedElement.id)}>
                  Continue: {nextUndecidedElement.label} <ArrowRight size={16} aria-hidden="true" />
                </button>
              )}
              {!mobileReviewDetailOpen && hasAnyProposals && (() => {
                const issues = selectIssueElements(record.proposals, record.decisions);
                if (issues.length === 0) return null;
                return (
                  <section className={`${styles.card} ${styles.aiReport}`} aria-labelledby="ai-report-heading" data-testid="ai-report">
                    <div className={styles.cardTitleRow}>
                      <div>
                        <h2 id="ai-report-heading">AI found {issues.length} issue{issues.length === 1 ? "" : "s"}</h2>
                        <p className={styles.cardLead}>Unreviewed drafts with video evidence. Tap one to verify it in person.</p>
                      </div>
                      <AlertCircle size={21} aria-hidden="true" />
                    </div>
                    <ul className={styles.aiReportList}>
                      {issues.map((elementId) => {
                        const element = MOVE_IN_READY_ELEMENTS.find((item) => item.id === elementId);
                        const proposal = record.proposals[elementId];
                        const firstEvidence = proposal?.evidence[0];
                        if (!element || !proposal) return null;
                        return (
                          <li key={elementId}>
                            <button type="button" className={styles.aiReportRow} onClick={() => openReviewElement(elementId)}>
                              <span className={`${styles.elementOverviewStatus} ${proposal.modelSuggestion === "D" ? styles.elementOverviewDeficient : styles.elementOverviewCheck}`}>
                                {proposal.modelSuggestion === "D" ? "Deficient" : "Check"}
                              </span>
                              <span className={styles.homeRequirementCopy}>
                                <strong>{element.label}</strong>
                                <small>{proposal.observation}{firstEvidence ? ` · ${roomLabel(firstEvidence.roomId)} ${formatTimestamp(firstEvidence.timestampMs / 1000)}` : ""}</small>
                              </span>
                              <ArrowRight size={16} aria-hidden="true" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })()}
              <section className={`${styles.card} ${styles.reviewOverview} ${showAllReviewElements ? styles.reviewOverviewAll : ""} ${mobileReviewDetailOpen ? styles.reviewOverviewHiddenOnMobile : ""}`} aria-label="All 11 inspection elements">
                <div className={styles.cardTitleRow}><div><h2>{showAllReviewElements ? "All 11 Form 1083 requirements" : "11 Form 1083 requirements"}</h2><p className={styles.cardLead}>
                  {hasAnyProposals ? "AI drafts are ready. Confirm each requirement in person, in order." : "No AI draft yet. Work through each requirement in person, in order."}
                  {!record.evaluatorName.trim() && <> Evaluator name is required before decisions. <button className={styles.linkButton} type="button" onClick={openProfileForRequiredDetails}>Set up profile</button></>}
                </p></div></div>
                <ul className={`${styles.elementOverview} ${showAllReviewElements ? styles.elementOverviewAll : ""}`} id="element-overview-list">
                  {MOVE_IN_READY_ELEMENTS.slice(0, showAllReviewElements ? MOVE_IN_READY_ELEMENTS.length : 4).map((element, index) => {
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
                    const decisionSummary = decision.status === "needs-human-check"
                      ? "Needs human check"
                      : decision.status === "unreviewed"
                        ? proposal ? "AI draft · unreviewed" : "Manual review needed"
                        : "";
                    const secondarySummary = [decisionSummary, evidenceSummary].filter(Boolean).join(" · ");
                    const state = decision.status === "A" ? styles.elementOverviewApproved
                      : decision.status === "D" ? styles.elementOverviewDeficient
                        : decision.status === "needs-human-check" ? styles.elementOverviewCheck : "";
                    return <li key={element.id} className={styles.elementOverviewItem}>
                      <button type="button" className={`${styles.elementOverviewButton} ${overviewEvidenceView ? styles.elementOverviewWithEvidence : ""}`} aria-pressed={element.id === activeElementId && (isWideLayout || mobileReviewDetailOpen)} onClick={() => openReviewElement(element.id)}>
                        <span className={styles.elementOverviewNumber}>{index + 1}</span>
                        <span className={styles.elementOverviewCopy}>
                          <strong>{element.label}</strong>
                          {secondarySummary && <small>{secondarySummary}</small>}
                        </span>
                        <span className={`${styles.elementOverviewStatus} ${state}`}>{decision.status === "A" ? "Approved" : decision.status === "D" ? "Deficient" : decision.status === "needs-human-check" ? "Check" : "Open"}</span>
                        {overviewEvidenceView && <Image className={styles.elementOverviewThumb} src={overviewEvidenceView.src} alt={`Source still for ${element.label}, ${roomLabel(overviewEvidenceView.reference.roomId)} at ${formatTimestamp(overviewEvidenceView.reference.timestampMs / 1000)}`} width={64} height={48} unoptimized />}
                      </button>
                    </li>;
                  })}
                </ul>
                {!showAllReviewElements && <div className={styles.overviewActions}>
                    <button className={styles.overviewDisclosure} type="button" onClick={() => { setShowAllReviewElements(true); scrollMainToTop("smooth"); }}>
                      View all {MOVE_IN_READY_ELEMENTS.length} requirements <ArrowRight size={16} aria-hidden="true" />
                    </button>
                    <div className={styles.overviewPrimaryActions}>
                      <button className={styles.secondaryButton} type="button" onClick={() => { setReviewNoteDraft(record.inspectionNote); setReviewNoteOpen(true); }}><StickyNote size={16} aria-hidden="true" /> {record.inspectionNote.trim() ? "Edit note" : "Add note"}</button>
                      {hasAnyProposals && nextUndecidedElement && (
                        <button className={styles.secondaryButton} type="button" onClick={prefillAllFromProposals}>
                          Pre-fill all from AI drafts
                        </button>
                      )}
                      {hasAnyProposals && nextUndecidedElement && (
                        <button className={styles.secondaryButton} type="button" onClick={saveAllConfirmed}>
                          Save all confirmed
                        </button>
                      )}
                      <button className={`${styles.button} ${styles.wideButton}`} type="button" onClick={() => changeStep("signoff")}>
                        Continue to sign-off <ArrowRight size={17} aria-hidden="true" />
                      </button>
                    </div>
                    {record.inspectionNote.trim() && <p className={styles.reviewNotePreview}>Note saved on this device: {record.inspectionNote}</p>}
                </div>}
              </section>
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
                                  <ChoiceButton label="A · Meets" choice="A" selected={draft.fireSafetyUnitDetectors} onClick={() => updateDecisionDraft(element.id, { fireSafetyUnitDetectors: "A", manualCheckAcknowledged: false })} />
                                  <ChoiceButton label="D · Deficient" choice="D" selected={draft.fireSafetyUnitDetectors} onClick={() => updateDecisionDraft(element.id, { fireSafetyUnitDetectors: "D", manualCheckAcknowledged: false })} />
                                  <ChoiceButton label="Needs check" choice="needs-human-check" selected={draft.fireSafetyUnitDetectors} onClick={() => updateDecisionDraft(element.id, { fireSafetyUnitDetectors: "needs-human-check", manualCheckAcknowledged: false })} />
                                </div>
                              </fieldset>
                              <fieldset className={styles.criteriaPanel}>
                                <legend>Form 1083 section 11b · Public/common areas</legend>
                                <p className={styles.supportingText}>Check each public or common area, including shared hallways and stairwells.</p>
                                <div className={styles.choiceRow} role="group" aria-label="Evaluator check for Form 1083 section 11b public and common area detectors">
                                  <ChoiceButton label="A · Meets" choice="A" selected={draft.fireSafetyPublicAreaDetectors} onClick={() => updateDecisionDraft(element.id, { fireSafetyPublicAreaDetectors: "A", manualCheckAcknowledged: false })} />
                                  <ChoiceButton label="D · Deficient" choice="D" selected={draft.fireSafetyPublicAreaDetectors} onClick={() => updateDecisionDraft(element.id, { fireSafetyPublicAreaDetectors: "D", manualCheckAcknowledged: false })} />
                                  <ChoiceButton label="Needs check" choice="needs-human-check" selected={draft.fireSafetyPublicAreaDetectors} onClick={() => updateDecisionDraft(element.id, { fireSafetyPublicAreaDetectors: "needs-human-check", manualCheckAcknowledged: false })} />
                                </div>
                              </fieldset>
                            </div>
                            <p className={styles.statusText}>Combined Fire Safety outcome: {effectiveChoice === "A" ? "A · Acceptable" : effectiveChoice === "D" ? "D · Deficient" : "Needs human check"}. Section 11a and 11b are recorded separately on Form 1083.</p>
                          </> : <div className={styles.choiceRow} role="group" aria-label={`Evaluator decision for ${element.label}`}>
                            <ChoiceButton label="A · Acceptable" choice="A" selected={draft.choice} onClick={() => updateDecisionDraft(element.id, (current) => ({ ...current, choice: "A", manualCheckAcknowledged: current.choice === "A" ? current.manualCheckAcknowledged : false }))} />
                            <ChoiceButton label="D · Deficient" choice="D" selected={draft.choice} onClick={() => updateDecisionDraft(element.id, (current) => ({ ...current, choice: "D", manualCheckAcknowledged: current.choice === "D" ? current.manualCheckAcknowledged : false }))} />
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
                            <label className={styles.checkLabel}>
                              <input type="checkbox" aria-label="I completed every required in-person check for this element" checked={draft.manualCheckAcknowledged} onChange={(event) => updateDecisionDraft(element.id, { manualCheckAcknowledged: event.currentTarget.checked })} />
                              <span>{isFireSafety ? "I personally completed both Form 1083 section 11 checks. AI suggestions and video stills do not replace these checks." : "I completed every required in-person check for this element. AI suggestions and video stills do not replace these checks."}</span>
                            </label>
                            {evidence.length > 0 && <fieldset className={styles.evidencePicker}>
                              <legend>Attach source stills to your decision</legend>
                              {evidence.slice(0, MAX_ROOM_EVIDENCE_STILLS * element.roomIds.length).map(({ reference, src }) => {
                                const modelEvidence = proposal?.evidence.find((item) => item.stillId === reference.stillId);
                                const accessibleEvidenceLabel = `${roomLabel(reference.roomId)} source still at ${formatTimestamp(reference.timestampMs / 1000)} (${reference.timestampMs} ms)${modelEvidence ? `, SAM frame index ${modelEvidence.frameIndex}` : ""}`;
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
                            <button type="button" className={`${styles.button} ${styles.reviewInlineSaveButton}`} onClick={() => saveDecision(element.id)}>Save evaluator decision</button>
                            {decision.status !== "unreviewed" && <button type="button" className={styles.textButton} onClick={() => { updateRecord((current) => ({ ...current, decisions: { ...current.decisions, [element.id]: { status: "unreviewed" } }, signoff: null })); setDrafts((current) => ({ ...current, [element.id]: createDecisionDraft({ status: "unreviewed" }) })); }}>Clear decision</button>}
                          </div>
                        </div>
                        <details className={styles.reviewSupplement}>
                          <summary>Form 1083 reference criteria</summary>
                          <section className={styles.criteriaPanel} aria-label={`${element.label} Form 1083 reference criteria`}>
                            <ul className={styles.criteriaList}>
                              {MOVE_IN_READY_ELEMENT_CRITERIA[element.id].checklistItems.map((item) => <li key={item}>{item}</li>)}
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
                              <Image src={src} width={320} height={240} unoptimized alt={`${MOVE_IN_READY_ROOMS.find((room) => room.id === reference.roomId)?.label ?? reference.roomId} source frame`} />
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
                <p className={styles.supportingText}>{completedResult ? "Based on the evaluator’s 11 saved decisions." : `${capturedRoomCount} of ${MOVE_IN_READY_ROOMS.length} room clips · ${reviewCounts.resolved} of ${MOVE_IN_READY_ELEMENTS.length} decisions · no result recorded`}</p>
                {finalization?.blockers.length ? <details className={styles.blockerDetails}><summary>{finalization.blockers.length} requirements need attention</summary><ul className={styles.blockerList}>{finalization.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></details> : null}
              </div>

              <div className={`${styles.card} ${styles.signoffCard}`}>
                <div className={styles.cardTitleRow}><div><h2>Evaluator sign-off</h2><p className={styles.cardLead}>Your assessment and attestation.</p></div><ShieldCheck size={21} aria-hidden="true" /></div>
                <p className={styles.supportingText}>Evaluator: <strong>{record.evaluatorName || "Not entered"}</strong></p>
                {record.signoff ? <div className={`${styles.callout} ${styles.calloutSuccess}`} role="status"><p>Signed by {record.signoff.typedSignature} on {new Date(record.signoff.signedAt).toLocaleString()}.</p><button className={styles.textButton} type="button" onClick={() => { updateRecord((current) => ({ ...current, signoff: null })); setSignoffAttested(false); setSignoffName(""); }}>Revoke sign-off</button></div> : <>
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
                      : "Capture all four room videos and finish the 11 evaluator decisions before signing."}</p>
                    <button className={styles.textButton} type="button" onClick={() => !record.evaluatorName.trim() || form1083Blocker ? openProfileForRequiredDetails() : changeStep("review")}>
                      {!record.evaluatorName.trim() || form1083Blocker ? "Fix Profile details" : "Continue review"}
                    </button>
                  </div>}
                  <div className={styles.buttonRow}><button className={styles.button} type="button" onClick={saveSignoff} disabled={!canSignOff}>Sign inspection</button></div>
                </>}
                {exportError && <p className={styles.inlineError} role="alert">{exportError}</p>}
                {exportNotice && <p className={styles.statusText} role="status">{exportNotice}</p>}
              </div>

              <div className={`${styles.card} ${styles.exportCard}`}>
                <div className={styles.cardTitleRow}><div><h2>Export options</h2><p className={styles.cardLead}>Local files for the existing manual workflow.</p></div><FolderOpen size={21} aria-hidden="true" /></div>
                <div className={styles.exportGrid}>
                  <ExportButton title="Client-file export" detail="PDF · decisions, signature, and source stills" icon={<FileText size={19} aria-hidden="true" />} disabled={!completedResult || !record.signoff || exporting} busy={exporting} compact onClick={() => void downloadExport("client-file")} />
                  <ExportButton title="Landlord fix-list" detail="PDF · evaluator-confirmed deficiencies and dates" icon={<FolderOpen size={19} aria-hidden="true" />} disabled={!completedResult || !record.signoff || exporting} busy={exporting} compact onClick={() => void downloadExport("landlord-fix-list")} />
                  <div className={`${styles.exportItem} ${styles.exportItemCompact}`}>
                    <FileText className={styles.exportIcon} size={19} aria-hidden="true" />
                    <div className={styles.exportCopy}><strong>HMIS-ready Form 1083</strong><span>Local PDF or structured JSON draft</span></div>
                    <div className={styles.exportActionsInline}>
                      <button className={styles.exportFormatButton} type="button" disabled={!completedResult || !record.signoff || exporting} onClick={() => void downloadExport("hmis-ready")}>PDF</button>
                      <button className={styles.exportFormatButton} type="button" disabled={!completedResult || !record.signoff || exporting} onClick={() => void downloadExport("hmis-json")}>JSON</button>
                    </div>
                  </div>
                </div>
                {exporting && <p className={styles.statusText} role="status"><LoaderCircle className={styles.spinner} size={16} aria-hidden="true" /> Preparing local export…</p>}
                {(!completedResult || !record.signoff) && <p className={styles.helpText}>Exports unlock after all four room clips, 11 evaluator decisions, required Form 1083 details, sign-off, and attestation.</p>}
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
                    <div className={styles.field}><label htmlFor="profile-funding">Funding type</label><select id="profile-funding" className={styles.formSelect} value={record.fundingType} onChange={(event) => setProfileField("fundingType", event.currentTarget.value as FundingType)}><option value="unknown">Choose funding type</option><option value="lahsa">LAHSA / Form 1083</option><option value="hud">HUD-funded / HQS</option></select></div>
                  </div>
                  {record.fundingType === "hud" && <div className={`${styles.callout} ${styles.calloutWarning} ${styles.profileNotice}`} role="status"><strong>HQS inspection required.</strong> This HUD-funded unit cannot continue through the LAHSA Form 1083 walkthrough.</div>}
                  <div className={styles.profilePanelActions}>
                    <span>{profileSectionReady.unit ? "Unit and funding details are ready." : "Enter a unit pseudonym and select a funding type."}</span>
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
                </div>
              </details>
            </div>
          </>
        )}
      </main>

      <div className={styles.appFooter}>
        <nav className={styles.bottomNav} aria-label="Main navigation">
          <NavButton icon={<Home size={19} aria-hidden="true" />} label="Home" active={step === "home"} onClick={() => changeStep("home")} disabled={recordingInProgress} />
          <NavButton icon={<Sparkles size={19} aria-hidden="true" />} label="Guide" active={assistantOpen} onClick={() => setAssistantOpen(true)} disabled={recordingInProgress} />
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
          <button className={`${styles.button} ${styles.wideButton}`} type="button" disabled={!activeElementId} onClick={() => { if (activeElementId) void saveDecision(activeElementId); }}>
            Save evaluator decision <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>}
      </div>

      <AssistantGuide
        open={assistantOpen}
        node={assistantNode}
        voiceOn={voiceOn}
        recording={recordingInProgress}
        onAction={handleAssistantAction}
        onVoiceToggle={() => {
          const next = !voiceOn;
          setVoiceOn(next);
          writeVoiceEnabled(next);
          if (!next) cancelSpeech();
          else speakText(assistantNode.speak);
        }}
        onReplay={() => speakText(recordingInProgress ? ASSISTANT_FILMING_SCRIPTS[selectedRoomId][0] ?? assistantNode.speak : assistantNode.speak)}
        onClose={() => { cancelSpeech(); setAssistantOpen(false); }}
      />
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
    signoff: null,
  };
}

function clearRoomAnalysisState(current: MoveInReadyInspection, roomId: MoveInReadyRoomId): MoveInReadyInspection {
  const decisions = { ...current.decisions };
  for (const elementId of MOVE_IN_READY_ELEMENT_IDS) {
    const decision = decisions[elementId];
    if ((decision.status === "A" || decision.status === "D") && decision.evidence.some((reference) => reference.roomId === roomId)) {
      decisions[elementId] = { status: "unreviewed" };
    }
  }
  return {
    ...current,
    updatedAt: new Date().toISOString(),
    proposals: Object.fromEntries(Object.entries(current.proposals).filter(([, proposal]) => !proposal || proposal.evidence.every((reference) => reference.roomId !== roomId))),
    decisions,
    pendingAnalysisIntent: current.pendingAnalysisIntent?.roomId === roomId ? null : current.pendingAnalysisIntent,
    signoff: null,
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
  };
}

function allCurrentEvidence(current: MoveInReadyInspection): EvidenceReference[] {
  return Object.values(current.clipIdentities).flatMap((identity) => identity?.evidence ?? []);
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
  const allowedRooms = MOVE_IN_READY_ELEMENTS.find((element) => element.id === elementId)?.roomIds ?? [];
  const currentRefs = allCurrentEvidence(current).filter((reference) => allowedRooms.some((roomId) => roomId === reference.roomId) && isEvidenceCurrent(reference, current.clipIdentities[reference.roomId], current));
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

function fireSafetyAssessmentFromDraft(draft: DecisionDraft): FireSafetyAssessment {
  return {
    unitDetectors: draft.fireSafetyUnitDetectors || "needs-human-check",
    publicAreaDetectors: draft.fireSafetyPublicAreaDetectors || "needs-human-check",
  };
}

function fireSafetyChoiceFromDraft(draft: DecisionDraft): DecisionChoice {
  const assessment = fireSafetyAssessmentFromDraft(draft);
  if (assessment.unitDetectors !== "A" && assessment.unitDetectors !== "D") return "needs-human-check";
  if (assessment.publicAreaDetectors !== "A" && assessment.publicAreaDetectors !== "D") return "needs-human-check";
  return assessment.unitDetectors === "D" || assessment.publicAreaDetectors === "D" ? "D" : "A";
}

function completeFireSafetyAssessmentFromDraft(
  draft: DecisionDraft,
): { unitDetectors: "A" | "D"; publicAreaDetectors: "A" | "D" } | null {
  const unitDetectors = draft.fireSafetyUnitDetectors;
  const publicAreaDetectors = draft.fireSafetyPublicAreaDetectors;
  if ((unitDetectors !== "A" && unitDetectors !== "D") ||
      (publicAreaDetectors !== "A" && publicAreaDetectors !== "D")) return null;
  return { unitDetectors, publicAreaDetectors };
}

function createDecisionDraft(decision: EvaluatorDecision): DecisionDraft {
  const fireSafetyAssessment = "fireSafetyAssessment" in decision ? decision.fireSafetyAssessment : undefined;
  if (decision.status === "A" || decision.status === "D") return {
    choice: decision.status,
    rationale: decision.rationale,
    manualCheckAcknowledged: Boolean(decision.inPersonCheckAcknowledgment),
    issueDescription: decision.status === "D" ? decision.deficiency.issueDescription : "",
    correction: decision.status === "D" ? decision.deficiency.correction : "",
    completionDate: decision.status === "D" ? decision.deficiency.completionDate : "",
    reinspectionDate: decision.status === "D" ? decision.deficiency.reinspectionDate : "",
    fireSafetyUnitDetectors: fireSafetyAssessment?.unitDetectors ?? "",
    fireSafetyPublicAreaDetectors: fireSafetyAssessment?.publicAreaDetectors ?? "",
    planSuggestionReviewed: decision.status === "D",
    evidenceStillIds: decision.evidence.map((reference) => reference.stillId),
    note: "",
  };
  if (decision.status === "needs-human-check") return { choice: decision.status, rationale: "", manualCheckAcknowledged: false, issueDescription: "", correction: "", completionDate: "", reinspectionDate: "", fireSafetyUnitDetectors: fireSafetyAssessment?.unitDetectors ?? "", fireSafetyPublicAreaDetectors: fireSafetyAssessment?.publicAreaDetectors ?? "", planSuggestionReviewed: false, evidenceStillIds: [], note: decision.note };
  return { choice: "unreviewed", rationale: "", manualCheckAcknowledged: false, issueDescription: "", correction: "", completionDate: "", reinspectionDate: "", fireSafetyUnitDetectors: "", fireSafetyPublicAreaDetectors: "", planSuggestionReviewed: false, evidenceStillIds: [], note: "" };
}

/**
 * Copy an unreviewed AI draft into editable draft fields. Never touches the
 * in-person acknowledgment or the plan-review confirmation: the evaluator
 * still performs both explicitly before any save.
 */
function prefillDraftFromProposal(draft: DecisionDraft, proposal: ModelElementProposal): DecisionDraft {
  return {
    ...draft,
    choice: proposal.modelSuggestion,
    rationale: draft.rationale.trim() ? draft.rationale : proposal.observation,
    evidenceStillIds: proposal.evidence.length > 0 ? proposal.evidence.map((reference) => reference.stillId) : draft.evidenceStillIds,
    ...(proposal.modelSuggestion === "D" && proposal.deficiencySuggestion ? {
      issueDescription: draft.issueDescription.trim() ? draft.issueDescription : proposal.deficiencySuggestion.deficientArea,
      correction: draft.correction.trim() ? draft.correction : proposal.deficiencySuggestion.correction,
      completionDate: draft.completionDate || proposal.deficiencySuggestion.completionDate,
      reinspectionDate: draft.reinspectionDate || proposal.deficiencySuggestion.reinspectionDate,
    } : {}),
  };
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

function roomLabel(roomId: MoveInReadyRoomId): string {
  return MOVE_IN_READY_ROOMS.find((room) => room.id === roomId)?.label ?? roomId;
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
