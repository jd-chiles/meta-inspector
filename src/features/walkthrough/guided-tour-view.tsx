"use client";

/**
 * Voice-agent-led inspection tour. The agent speaks each step (Fish Audio
 * server voice, device voice fallback, silent text when muted) and this
 * view renders the one visual that matches the spoken instruction. Tour
 * position derives from inspection data, so a reload resumes mid-tour and
 * the narration can never describe a screen that is not shown.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Home,
  LoaderCircle,
  Mic,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  EVALUATOR_ATTESTATION_TEXT,
  MOVE_IN_READY_ELEMENTS,
  PARTICIPANT_ATTESTATION_TEXT,
  roomLabel,
  type MoveInReadyElementId,
  type MoveInReadyRoomId,
  type MoveInReadyUnitType,
} from "../../domain/move-in-ready";
import type { MoveInReadyInspection } from "./inspection-store";
import type { StoredVideoClip } from "./video-store";
import { fixListTier, reinspectionChecklist } from "./fix-list";
import {
  SETUP_VOICE_QUESTIONS,
  SETUP_VOICE_QUESTIONS_ES,
  TOUR_REPROMPTS,
  TOUR_REPROMPTS_ES,
  checksForRoom,
} from "./voice-checks";
import { filmingScriptForRoom } from "./assistant-script";
import { ANALYSIS_WINDOW_NOTE } from "../../domain/video-format";
import { parseBathCount, parseUnitType, parseYesNo } from "./voice-parse";
import { speakPrompt, speakSequentially } from "./voice-conversation";
import VoicePrompt, { type VoicePromptPhase } from "./voice-prompt";
import WalkthroughVideoCapture from "./video-capture";
import DetectorTestCapture, { type CapturedDetectorStill } from "./detector-test-capture";
import { DETECTOR_TEST_STILL_PREFIX, isDetectorPresenceQuestion, isDetectorTestRoom } from "./detector-test";
import {
  confirmNeedsDetails,
  createDecisionDraft,
  prefillDraftFromProposal,
  type DecisionDraft,
  type ElementDetailsInput,
  type FireSafetyDraftOutcome,
} from "./decision-draft";
import {
  deriveTourNode,
  elementLabel,
  filmOutroCue,
  filmRoomShots,
  guidedReviewQueue,
  LANDLORD_VOICE_QUESTION,
  LANDLORD_VOICE_QUESTION_ES,
  nameReadbackScript,
  REVIEW_VOICE_QUESTION,
  REVIEW_VOICE_QUESTION_ES,
  reviewVoiceAction,
  tourNodeKey,
  tourProgress,
  tourScriptForNode,
  type GuidedTourNode,
  type TourAnalysisMode,
} from "./guided-tour";
import flowStyles from "./move-in-ready-flow.module.css";
import styles from "./guided-tour-view.module.css";

export interface GuidedTourBindings {
  sessionId: string;
  record: MoveInReadyInspection;
  rooms: readonly { id: MoveInReadyRoomId; label: string }[];
  capturedRoomIds: readonly MoveInReadyRoomId[];
  capturedRoomCount: number;
  analysisMode: TourAnalysisMode;
  online: boolean;
  voiceTranscript: string | null;
  onVoiceTranscript: (text: string | null) => void;
  batchActive: boolean;
  batchProgress: { done: number; total: number; roomLabel: string; startedAt: number } | null;
  /** Ticking m:ss batch elapsed, recomputed by the owner every second. */
  batchElapsedLabel: string;
  /** Current batch phase shown while rooms are in flight. */
  batchStageLabel: string;
  batchFailedRooms: readonly string[];
  /** Persisted offline analysis queue (REQ-L2): room ids awaiting analysis. */
  analysisQueue: readonly MoveInReadyRoomId[];
  analysisComplete: boolean;
  setEvaluatorName: (name: string) => void;
  setUnitType: (unit: MoveInReadyUnitType) => void;
  setBathCount: (count: number) => void;
  grantTourConsent: () => void;
  skipRoom: (roomId: MoveInReadyRoomId) => void;
  selectRoom: (roomId: string) => void;
  onClipChange: (clip: StoredVideoClip | null, roomId: string) => void;
  onRecordingStateChange: (recording: boolean) => void;
  answerVoiceCheck: (roomId: MoveInReadyRoomId, question: string, answer: "yes" | "no" | "skipped") => void;
  /** Persist a live detector-test still as room evidence (REQ-R3). Never blocks the tour. */
  attachDetectorStill: (roomId: MoveInReadyRoomId, still: CapturedDetectorStill) => Promise<{ ok: true } | { ok: false; message: string }>;
  grantBatchConsent: () => void;
  startBatchAnalysis: () => void;
  cancelBatchAnalysis: () => void;
  reviewProposalDraft: (elementId: MoveInReadyElementId) => void;
  confirmProposalDraft: (elementId: MoveInReadyElementId) => void;
  markNeedsCheck: (elementId: MoveInReadyElementId, note: string) => void;
  changeStep: (step: "home" | "capture" | "review" | "signoff" | "profile") => void;
  /** Current decision drafts for resuming in-tour detail edits. */
  drafts: Partial<Record<MoveInReadyElementId, DecisionDraft>>;
  /** Save a D correction plan through the detail-form validators. */
  saveElementDetails: (elementId: MoveInReadyElementId, details: ElementDetailsInput) => boolean;
  /** Save independent Fire Safety 11a/11b marks. */
  saveFireSafety: (unit: FireSafetyDraftOutcome, publicArea: FireSafetyDraftOutcome) => boolean;
  setAgencyName: (name: string) => void;
  setLandlordDiscussion: (value: "" | "yes" | "no") => void;
  setLandlordDate: (date: string) => void;
  setLeadershipName: (name: string) => void;
  setLeadershipSignature: (signature: string) => void;
  setLeadershipDate: (date: string) => void;
  participantName: string;
  participantSignature: string;
  participantAttested: boolean;
  setParticipantName: (name: string) => void;
  setParticipantSignature: (signature: string) => void;
  setParticipantAttested: (attested: boolean) => void;
  saveParticipantSignoff: () => boolean;
  signoffName: string;
  signoffAttested: boolean;
  setSignoffName: (name: string) => void;
  setSignoffAttested: (attested: boolean) => void;
  saveSignoff: () => boolean;
  /** Latest save failure message for the tour's save cards. */
  actionError: string;
}

const UNIT_OPTIONS: readonly { value: MoveInReadyUnitType; label: string }[] = [
  { value: "studio", label: "Studio" },
  { value: "1-bedroom", label: "1 bedroom" },
  { value: "2-bedroom", label: "2 bedroom" },
  { value: "3-bedroom", label: "3 bedroom" },
  { value: "4-bedroom", label: "4 bedroom" },
];

const BATH_OPTIONS = [1, 2, 3, 4];

type AgentStatus = "speaking" | "listening" | "working" | "ready";

function statusCopy(status: AgentStatus): string {
  switch (status) {
    case "speaking":
      return "Speaking — listen";
    case "listening":
      return "Listening — answer out loud";
    case "working":
      return "AI working";
    case "ready":
      return "Your turn";
  }
}

export default function GuidedTourView({ bindings }: { bindings: GuidedTourBindings }): React.JSX.Element {
  const [started, setStarted] = useState(false);
  const [bathsConfirmed, setBathsConfirmed] = useState(false);
  const [analysisSettled, setAnalysisSettled] = useState(false);
  const [batchSeen, setBatchSeen] = useState(false);
  const [skipped, setSkipped] = useState<ReadonlySet<MoveInReadyElementId>>(new Set());
  const [speakOn, setSpeakOn] = useState(true);
  const [tourRecording, setTourRecording] = useState(false);
  const [shotIndex, setShotIndex] = useState(-1);
  const [tourSpeaking, setTourSpeaking] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePromptPhase | null>(null);
  const [speechNonce, setSpeechNonce] = useState(0);
  const [nameDraft, setNameDraft] = useState("");
  const [detectorSkipped, setDetectorSkipped] = useState<ReadonlySet<MoveInReadyRoomId>>(new Set());
  const [detectorSaving, setDetectorSaving] = useState(false);
  const [detectorError, setDetectorError] = useState<string | null>(null);
  const [detailsElementId, setDetailsElementId] = useState<MoveInReadyElementId | null>(null);
  const [detailsFields, setDetailsFields] = useState<ElementDetailsInput>({ issueDescription: "", correction: "", completionDate: "", reinspectionDate: "" });
  const [fireUnit, setFireUnit] = useState<FireSafetyDraftOutcome>("");
  const [firePublic, setFirePublic] = useState<FireSafetyDraftOutcome>("");
  const [saveTried, setSaveTried] = useState(false);
  const speechControllerRef = useRef<AbortController | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const lang = bindings.record.tourLanguage === "es" ? "es" : "en";
  const setupQuestions = lang === "es" ? SETUP_VOICE_QUESTIONS_ES : SETUP_VOICE_QUESTIONS;
  const reprompts = lang === "es" ? TOUR_REPROMPTS_ES : TOUR_REPROMPTS;

  const node: GuidedTourNode = useMemo(() => deriveTourNode({
    started,
    bathsConfirmed,
    analysisSettled,
    record: bindings.record,
    capturedRoomIds: bindings.capturedRoomIds,
    analysisMode: bindings.analysisMode,
    online: bindings.online,
    batchActive: bindings.batchActive,
    skippedElementIds: skipped,
    detailsElementId,
  }), [
    started, bathsConfirmed, analysisSettled, bindings.record, bindings.capturedRoomIds,
    bindings.analysisMode, bindings.online, bindings.batchActive, skipped, detailsElementId,
  ]);
  const nodeKey = tourNodeKey(node);

  const reviewQueue = useMemo(
    () => guidedReviewQueue(bindings.record, skipped),
    [bindings.record, skipped],
  );
  const reviewPosition = node.kind === "review-item"
    ? { index: reviewQueue.indexOf(node.elementId) + 1, total: reviewQueue.length }
    : null;

  const script = tourScriptForNode(node, {
    record: bindings.record,
    capturedRoomCount: bindings.capturedRoomCount,
    batchActive: bindings.batchActive,
    reviewPosition,
  }, lang);

  const sections = useMemo(
    () => tourProgress(bindings.record, bindings.capturedRoomCount, analysisSettled),
    [bindings.record, bindings.capturedRoomCount, analysisSettled],
  );

  const stopSpeech = useCallback(() => {
    speechControllerRef.current?.abort();
    speechControllerRef.current = null;
    setTourSpeaking(false);
  }, []);

  useEffect(() => stopSpeech, [stopSpeech]);

  // Speak the node script on entry. Question nodes stay silent here: their
  // voice prompt speaks the question itself so speech never overlaps.
  useEffect(() => {
    stopSpeech();
    setVoicePhase(null);
    setDetectorError(null);
    topRef.current?.scrollIntoView({ block: "start" });
    if (!speakOn || script === "") return;
    const controller = new AbortController();
    speechControllerRef.current = controller;
    setTourSpeaking(true);
    void speakPrompt(script, controller.signal, { language: lang }).then(
      () => {
        if (speechControllerRef.current === controller) {
          speechControllerRef.current = null;
          setTourSpeaking(false);
        }
      },
      () => {
        if (speechControllerRef.current === controller) {
          speechControllerRef.current = null;
          setTourSpeaking(false);
        }
      },
    );
    return () => {
      controller.abort();
      if (speechControllerRef.current === controller) speechControllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, speechNonce, speakOn, lang]);

  const sayNow = useCallback((text: string) => {
    if (!speakOn) return;
    stopSpeech();
    const controller = new AbortController();
    speechControllerRef.current = controller;
    setTourSpeaking(true);
    void speakPrompt(text, controller.signal, { language: lang }).then(
      () => {
        if (speechControllerRef.current === controller) {
          speechControllerRef.current = null;
          setTourSpeaking(false);
        }
      },
      () => {
        if (speechControllerRef.current === controller) {
          speechControllerRef.current = null;
          setTourSpeaking(false);
        }
      },
    );
  }, [speakOn, stopSpeech, lang]);

  // The camera follows the tour: entering a film node selects that room.
  useEffect(() => {
    if (node.kind === "film-room" && bindings.record.selectedRoomId !== node.roomId) {
      bindings.selectRoom(node.roomId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey]);

  // Analyze node: settle immediately when every filmed room already has a
  // current proposal (tour re-entry must not re-trigger paid analysis).
  useEffect(() => {
    if (node.kind === "analyze" && bindings.analysisComplete) setAnalysisSettled(true);
  }, [node.kind, nodeKey, bindings.analysisComplete]);

  useEffect(() => {
    if (node.kind === "analyze" && bindings.batchActive) setBatchSeen(true);
  }, [node.kind, nodeKey, bindings.batchActive]);

  // Paid analysis never auto-starts: the evaluator taps Start analysis
  // on the analyze card, so a reload or revisit cannot re-send paid
  // calls without a fresh explicit tap.

  // Batch finished clean: move on without another tap.
  useEffect(() => {
    if (node.kind !== "analyze") return;
    if (batchSeen && !bindings.batchActive && bindings.batchFailedRooms.length === 0) {
      setAnalysisSettled(true);
    }
  }, [node.kind, nodeKey, batchSeen, bindings.batchActive, bindings.batchFailedRooms]);

  // Talk through the shot list while a take is recording: one cue at a
  // time so the evaluator covers every shot conversationally. Stops the
  // moment recording stops or the node advances (clip saved). The visible
  // checklist highlights the cue being spoken.
  useEffect(() => {
    if (node.kind !== "film-room" || !tourRecording || !speakOn) return;
    const cues = filmingScriptForRoom(node.roomId, lang);
    const controller = new AbortController();
    speechControllerRef.current = controller;
    setTourSpeaking(true);
    // Cues, then the spoken-only outro telling the evaluator to end the
    // video. The outro is not a shot card, so the highlight stays put.
    void speakSequentially([...cues, filmOutroCue(lang)], controller.signal, {
      language: lang,
      onCue: (index) => setShotIndex(Math.min(index, cues.length - 1)),
    }).finally(() => {
      if (speechControllerRef.current === controller) {
        speechControllerRef.current = null;
        setTourSpeaking(false);
      }
    });
    return () => {
      controller.abort();
      if (speechControllerRef.current === controller) speechControllerRef.current = null;
      setShotIndex(-1);
      setTourSpeaking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, tourRecording, speakOn, lang]);

  const skipElement = useCallback((elementId: MoveInReadyElementId) => {
    setSkipped((current) => new Set(current).add(elementId));
  }, []);

  // Save cards show the flow's save error only after an attempt on the
  // current node, so stale errors from other steps never greet the node.
  useEffect(() => {
    setSaveTried(false);
  }, [nodeKey]);

  // Prefill deficiency details from the current draft (resumed edits win)
  // or the AI suggestion when the card opens. Runs on entry only so
  // typing is never clobbered by record updates.
  useEffect(() => {
    if (node.kind !== "element-details") return;
    const draft = bindings.drafts[node.elementId];
    if (draft && (draft.issueDescription || draft.correction || draft.completionDate || draft.reinspectionDate)) {
      setDetailsFields({
        issueDescription: draft.issueDescription,
        correction: draft.correction,
        completionDate: draft.completionDate,
        reinspectionDate: draft.reinspectionDate,
      });
      return;
    }
    const proposal = bindings.record.proposals[node.elementId];
    if (!proposal) {
      setDetailsFields({ issueDescription: "", correction: "", completionDate: "", reinspectionDate: "" });
      return;
    }
    const prefilled = prefillDraftFromProposal(createDecisionDraft({ status: "unreviewed" }), proposal);
    setDetailsFields({
      issueDescription: prefilled.issueDescription,
      correction: prefilled.correction,
      completionDate: prefilled.completionDate,
      reinspectionDate: prefilled.reinspectionDate,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey]);

  // Prefill Fire Safety marks from the draft, else the saved assessment.
  useEffect(() => {
    if (node.kind !== "fire-safety") return;
    const draft = bindings.drafts["demo-smoke-co"];
    const decision = bindings.record.decisions["demo-smoke-co"];
    const saved = decision && "fireSafetyAssessment" in decision ? decision.fireSafetyAssessment : undefined;
    setFireUnit(draft?.fireSafetyUnitDetectors || saved?.unitDetectors || "");
    setFirePublic(draft?.fireSafetyPublicAreaDetectors || saved?.publicAreaDetectors || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey]);

  const agentStatus: AgentStatus =
    tourSpeaking || voicePhase === "speaking"
      ? "speaking"
      : voicePhase === "listening"
        ? "listening"
        : voicePhase === "transcribing" || bindings.batchActive
          ? "working"
          : "ready";

  const handleUnitTranscript = useCallback((text: string) => {
    bindings.onVoiceTranscript(text);
    const parsed = parseUnitType(text);
    if (parsed) {
      bindings.setUnitType(parsed);
      return;
    }
    if (text.trim()) sayNow(reprompts.unitType);
  }, [bindings, sayNow, reprompts]);

  const handleBathsTranscript = useCallback((text: string) => {
    bindings.onVoiceTranscript(text);
    const parsed = parseBathCount(text);
    if (parsed !== null) {
      bindings.setBathCount(parsed);
      setBathsConfirmed(true);
      return;
    }
    if (text.trim()) sayNow(reprompts.baths);
  }, [bindings, sayNow, reprompts]);

  const handleCheckTranscript = useCallback((roomId: MoveInReadyRoomId, question: string) => (text: string) => {
    bindings.onVoiceTranscript(text);
    const parsed = parseYesNo(text);
    if (parsed) {
      bindings.answerVoiceCheck(roomId, question, parsed);
      return;
    }
    if (text.trim()) sayNow(reprompts.yesNo);
  }, [bindings, sayNow, reprompts]);

  const attemptReviewConfirm = useCallback((elementId: MoveInReadyElementId) => {
    // A Deficient draft without a complete correction plan completes it
    // on the in-tour detail card (except Fire Safety, whose plan shares
    // the detail form with its 11a/11b marks); every other confirm path
    // is unchanged.
    if (elementId !== "demo-smoke-co" && confirmNeedsDetails(bindings.record.proposals[elementId])) {
      setDetailsElementId(elementId);
      return;
    }
    bindings.confirmProposalDraft(elementId);
  }, [bindings]);

  const handleReviewTranscript = useCallback((elementId: MoveInReadyElementId) => (text: string) => {
    bindings.onVoiceTranscript(text);
    const action = reviewVoiceAction(text);
    if (action === "confirm") {
      attemptReviewConfirm(elementId);
      return;
    }
    if (action === "edit") {
      bindings.reviewProposalDraft(elementId);
      return;
    }
    if (text.trim()) sayNow(reprompts.yesNo);
  }, [bindings, sayNow, reprompts, attemptReviewConfirm]);

  const handleLandlordTranscript = useCallback((text: string) => {
    bindings.onVoiceTranscript(text);
    const parsed = parseYesNo(text);
    if (parsed) {
      bindings.setLandlordDiscussion(parsed);
      return;
    }
    if (text.trim()) sayNow(reprompts.yesNo);
  }, [bindings, sayNow, reprompts]);

  return (
    <div className={styles.tour} data-testid="guided-tour" data-node={nodeKey}>
      <div ref={topRef} />
      <div className={styles.agentBar} data-testid="tour-agent-bar" role="status" aria-label={`Guide status: ${statusCopy(agentStatus)}`}>
        <span className={styles.agentIcon} data-status={agentStatus} aria-hidden="true">
          {agentStatus === "speaking" ? <Volume2 size={20} /> : agentStatus === "listening" ? <Mic size={20} /> : agentStatus === "working" ? <LoaderCircle size={20} className={styles.spin} /> : <CheckCircle2 size={20} />}
        </span>
        <span className={styles.agentStatus} data-testid="tour-status">{statusCopy(agentStatus)}</span>
        <span className={styles.agentSpacer} />
        {script !== "" && (
          <button type="button" className={styles.iconButton} data-testid="tour-repeat" aria-label="Repeat instruction" onClick={() => setSpeechNonce((nonce) => nonce + 1)}>
            <RotateCcw size={17} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className={styles.iconButton}
          data-testid="tour-voice-toggle"
          aria-label={speakOn ? "Mute guide voice" : "Unmute guide voice"}
          aria-pressed={speakOn}
          onClick={() => {
            if (speakOn) stopSpeech();
            setSpeakOn((on) => !on);
          }}
        >
          {speakOn ? <Volume2 size={17} aria-hidden="true" /> : <VolumeX size={17} aria-hidden="true" />}
        </button>
        <button type="button" className={styles.iconButton} data-testid="tour-exit" aria-label="Exit guided tour" onClick={() => bindings.changeStep("home")}>
          <Home size={17} aria-hidden="true" />
        </button>
      </div>

      <ol className={styles.stepper} aria-label="Tour progress" data-testid="tour-stepper">
        {sections.map((section) => (
          <li key={section.key} data-complete={section.done >= section.total} aria-label={`${section.label}: ${section.done} of ${section.total}`}>
            <span className={styles.stepDot} aria-hidden="true" />
            <span className={styles.stepLabel}>{section.label} {section.done}/{section.total}</span>
          </li>
        ))}
      </ol>

      {script !== "" && (
        <p className={styles.instruction} data-testid="tour-instruction">{script}</p>
      )}

      <div className={styles.stage}>
        {node.kind === "welcome" && (
          <div className={flowStyles.card}>
            <h2>Guided inspection</h2>
            <ul className={styles.overviewList}>
              <li>Film one take per room — I narrate each one.</li>
              <li>Answer short questions by voice or tap.</li>
              <li>Confirm each AI draft. Nothing is decided for you.</li>
            </ul>
            <button className={`${flowStyles.button} ${flowStyles.wideButton}`} type="button" data-testid="tour-start" onClick={() => setStarted(true)}>
              Start guided inspection <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        )}

        {node.kind === "ask-name" && (
          <div className={flowStyles.card}>
            <p className={flowStyles.draftLabel}>One thing before confirmations</p>
            <VoicePrompt
              question={setupQuestions.evaluatorName}
              autoSpeak={speakOn}
              language={lang}
              transcript={bindings.voiceTranscript}
              onTranscript={(text) => {
                bindings.onVoiceTranscript(text);
                const clean = text.trim().slice(0, 80);
                if (!clean) return;
                // First answer fills the draft and is read back; a yes on
                // the read-back saves without a tap, a no clears it, and a
                // different name replaces the draft.
                if (nameDraft.trim().length === 0) {
                  setNameDraft(clean);
                  sayNow(nameReadbackScript(clean, lang));
                  return;
                }
                const parsed = parseYesNo(clean);
                if (parsed === "yes") {
                  bindings.setEvaluatorName(nameDraft.trim().slice(0, 80));
                } else if (parsed === "no") {
                  setNameDraft("");
                  sayNow(setupQuestions.evaluatorName);
                } else {
                  setNameDraft(clean);
                  sayNow(nameReadbackScript(clean, lang));
                }
              }}
              onPhaseChange={setVoicePhase}
            >
              <label className={styles.stackLabel} htmlFor="tour-name">Evaluator name</label>
              <input
                id="tour-name"
                className={flowStyles.formInput}
                data-testid="tour-name-input"
                value={nameDraft}
                maxLength={80}
                placeholder="Type or answer by voice"
                onChange={(event) => setNameDraft(event.currentTarget.value)}
              />
              <button
                className={`${flowStyles.button} ${flowStyles.wideButton}`}
                type="button"
                data-testid="tour-name-save"
                disabled={nameDraft.trim().length === 0}
                onClick={() => bindings.setEvaluatorName(nameDraft.trim().slice(0, 80))}
              >
                Save name <ArrowRight size={17} aria-hidden="true" />
              </button>
            </VoicePrompt>
          </div>
        )}

        {node.kind === "ask-unit" && (
          <div className={flowStyles.card}>
            <VoicePrompt
              question={setupQuestions.unitTypeTour}
              autoSpeak={speakOn}
              language={lang}
              transcript={bindings.voiceTranscript}
              onTranscript={handleUnitTranscript}
              onPhaseChange={setVoicePhase}
            >
              <div className={styles.optionGrid} data-testid="tour-options" role="group" aria-label="Unit type">
                {UNIT_OPTIONS.map((option) => (
                  <button key={option.value} type="button" className={flowStyles.secondaryButton} onClick={() => bindings.setUnitType(option.value)}>
                    {option.label}
                  </button>
                ))}
              </div>
            </VoicePrompt>
          </div>
        )}

        {node.kind === "ask-baths" && (
          <div className={flowStyles.card}>
            <VoicePrompt
              question={setupQuestions.baths}
              autoSpeak={speakOn}
              language={lang}
              transcript={bindings.voiceTranscript}
              onTranscript={handleBathsTranscript}
              onPhaseChange={setVoicePhase}
            >
              <div className={styles.optionGrid} data-testid="tour-options" role="group" aria-label="Bathroom count">
                {BATH_OPTIONS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={flowStyles.secondaryButton}
                    onClick={() => {
                      bindings.setBathCount(count);
                      setBathsConfirmed(true);
                    }}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </VoicePrompt>
          </div>
        )}

        {node.kind === "consent" && (
          <div className={flowStyles.card}>
            <h2>Consent to film</h2>
            <p className={flowStyles.cardLead}>
              This demo inspects a staged mock unit only: no tenants, faces, addresses, personal
              documents, or real case notes. Each filmed clip is sent to Meta for AI analysis.
              Local deletion does not delete provider copies.
            </p>
            <p className={flowStyles.helpText} data-testid="tour-consent-path">
              LAHSA / Form 1083 path · Unit {bindings.record.pseudonym.trim() || "nickname auto-fills on confirm"}
            </p>
            <button
              className={`${flowStyles.button} ${flowStyles.wideButton}`}
              type="button"
              data-testid="tour-consent-confirm"
              onClick={() => bindings.grantTourConsent()}
            >
              I understand, let&apos;s film <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        )}

        {node.kind === "film-room" && (
          <div className={styles.filmStage}>
            <div className={flowStyles.card} data-testid="tour-shot-list">
              <p className={flowStyles.draftLabel}>{roomLabel(node.roomId)} · shot list</p>
              <ol className={styles.shotList}>
                {filmRoomShots(node.roomId, lang).map((shot, index) => (
                  <li
                    key={`${node.roomId}:${index}`}
                    className={index === shotIndex ? styles.shotActive : undefined}
                    aria-current={index === shotIndex ? "step" : undefined}
                  >
                    {shot}
                  </li>
                ))}
              </ol>
            </div>
            <WalkthroughVideoCapture
              key={`${bindings.sessionId}:${node.roomId}`}
              sessionId={bindings.sessionId}
              rooms={bindings.rooms}
              roomId={node.roomId}
              capturedRoomCount={bindings.capturedRoomCount}
              capturedRoomIds={bindings.capturedRoomIds}
              queuedRoomIds={bindings.analysisQueue}
              overlayCue={tourRecording ? filmingScriptForRoom(node.roomId, lang)[shotIndex] ?? null : null}
              onRoomChange={(roomId) => bindings.selectRoom(roomId)}
              onRecordingStateChange={(recording) => {
                bindings.onRecordingStateChange(recording);
                setTourRecording(recording);
              }}
              onClipChange={(clip, roomId) => bindings.onClipChange(clip, roomId)}
            />
            <button
              className={flowStyles.secondaryButton}
              type="button"
              data-testid="tour-open-capture"
              onClick={() => bindings.changeStep("capture")}
            >
              Open full capture screen
            </button>
            <button
              className={flowStyles.secondaryButton}
              type="button"
              data-testid="tour-skip-room"
              onClick={() => bindings.skipRoom(node.roomId)}
            >
              Skip — not in this unit
            </button>
          </div>
        )}

        {node.kind === "room-check" && (() => {
          const question = checksForRoom(bindings.record, node.roomId, lang)[node.index];
          if (!question) return null;
          const showDetectorTest = isDetectorTestRoom(node.roomId) &&
            isDetectorPresenceQuestion(question) &&
            !detectorSkipped.has(node.roomId);
          const detectorCaptured = (bindings.record.clipIdentities[node.roomId]?.evidence ?? [])
            .some((reference) => reference.stillId.startsWith(DETECTOR_TEST_STILL_PREFIX));
          return (
            <div className={flowStyles.card}>
              <p className={flowStyles.draftLabel}>{roomLabel(node.roomId)} · in-person check</p>
              <VoicePrompt
                key={`${node.roomId}:${node.index}:${lang}`}
                question={question}
                autoSpeak={speakOn}
                language={lang}
                transcript={bindings.voiceTranscript}
                onTranscript={handleCheckTranscript(node.roomId, question)}
                onPhaseChange={setVoicePhase}
              >
                <div className={flowStyles.voiceTapRow}>
                  <button className={flowStyles.button} type="button" data-testid="tour-check-yes" onClick={() => bindings.answerVoiceCheck(node.roomId, question, "yes")}>{lang === "es" ? "Sí" : "Yes"}</button>
                  <button className={flowStyles.button} type="button" data-testid="tour-check-no" onClick={() => bindings.answerVoiceCheck(node.roomId, question, "no")}>No</button>
                  <button className={flowStyles.textButton} type="button" onClick={() => bindings.answerVoiceCheck(node.roomId, question, "skipped")}>{lang === "es" ? "Omitir" : "Skip"}</button>
                </div>
              </VoicePrompt>
              {showDetectorTest && (
                <DetectorTestCapture
                  language={lang}
                  saving={detectorSaving}
                  saveError={detectorError}
                  alreadyCaptured={detectorCaptured}
                  onCapture={(still) => {
                    setDetectorSaving(true);
                    setDetectorError(null);
                    void bindings.attachDetectorStill(node.roomId, still).then((result) => {
                      setDetectorSaving(false);
                      if (!result.ok) setDetectorError(result.message);
                    });
                  }}
                  onSkip={() => setDetectorSkipped((current) => new Set(current).add(node.roomId))}
                />
              )}
            </div>
          );
        })()}

        {node.kind === "analyze" && (
          <div className={flowStyles.card} data-testid="tour-analyze">
            <h2>AI analysis</h2>
            <p className={flowStyles.helpText}>{ANALYSIS_WINDOW_NOTE}</p>
            <p className={flowStyles.cardLead} role="status" data-testid="tour-analysis-queue-counts">
              {bindings.analysisQueue.length === 0
                ? "No rooms waiting for analysis."
                : `${bindings.analysisQueue.length} room${bindings.analysisQueue.length === 1 ? "" : "s"} queued for analysis`}
              {bindings.batchActive && bindings.batchProgress
                ? ` · ${bindings.batchProgress.total - bindings.batchProgress.done} in progress`
                : ""}
            </p>
            {bindings.analysisMode !== "live" || !bindings.online ? (
              <>
                <p className={flowStyles.cardLead}>
                  {bindings.online
                    ? "Live analysis is off on this server, so no sample result will be substituted. Your clips stay saved on this device."
                    : "You are offline. Your clips stay saved on this device; analysis needs a connection."}
                </p>
                <button className={`${flowStyles.button} ${flowStyles.wideButton}`} type="button" data-testid="tour-analyze-continue" onClick={() => setAnalysisSettled(true)}>
                  Continue without analysis <ArrowRight size={17} aria-hidden="true" />
                </button>
              </>
            ) : bindings.batchActive ? (
              <>
                <p className={flowStyles.cardLead} role="status" data-testid="tour-analysis-status">
                  {bindings.batchProgress
                    ? `${bindings.batchProgress.roomLabel ? `Analyzing ${bindings.batchProgress.roomLabel}` : "Starting the first room"} — ${bindings.batchProgress.done} of ${bindings.batchProgress.total} rooms done · ${bindings.batchElapsedLabel} · ${bindings.batchStageLabel}…`
                    : "Starting analysis."}
                </p>
                {bindings.batchProgress && bindings.batchProgress.total > 0 && (
                  <>
                    <div
                      className={flowStyles.progressTrack}
                      role="progressbar"
                      aria-label="Batch analysis progress"
                      aria-valuemin={0}
                      aria-valuemax={bindings.batchProgress.total}
                      aria-valuenow={bindings.batchProgress.done}
                      data-testid="tour-analysis-progress"
                    >
                      <div
                        className={flowStyles.progressFill}
                        style={{ width: `${(bindings.batchProgress.done / bindings.batchProgress.total) * 100}%` }}
                      />
                    </div>
                    <p className={flowStyles.helpText}>
                      Each room takes a few minutes on cellular — the timer above proves it is still working. Keep this app open until every room is done.
                    </p>
                  </>
                )}
                <button className={flowStyles.secondaryButton} type="button" onClick={() => { bindings.cancelBatchAnalysis(); setAnalysisSettled(true); }}>
                  Cancel and continue
                </button>
              </>
            ) : batchSeen && bindings.batchFailedRooms.length > 0 ? (
              <>
                <p className={flowStyles.inlineError} role="alert">
                  Needs attention: {bindings.batchFailedRooms.join(", ")}.
                </p>
                <div className={flowStyles.buttonRow}>
                  <button
                    className={flowStyles.button}
                    type="button"
                    onClick={() => {
                      setBatchSeen(false);
                      bindings.grantBatchConsent();
                      bindings.startBatchAnalysis();
                    }}
                  >
                    Retry analysis
                  </button>
                  <button className={flowStyles.secondaryButton} type="button" data-testid="tour-analyze-continue" onClick={() => setAnalysisSettled(true)}>
                    Continue anyway
                  </button>
                </div>
              </>
            ) : bindings.analysisQueue.some((roomId) => bindings.capturedRoomIds.includes(roomId)) ? (
              <>
                <p className={flowStyles.cardLead} role="status">Analysis is ready to start.</p>
                <div className={flowStyles.buttonRow}>
                  <button
                    className={flowStyles.button}
                    type="button"
                    data-testid="tour-analyze-start"
                    onClick={() => {
                      bindings.grantBatchConsent();
                      bindings.startBatchAnalysis();
                    }}
                  >
                    Start analysis
                  </button>
                  <button className={flowStyles.secondaryButton} type="button" data-testid="tour-analyze-continue" onClick={() => setAnalysisSettled(true)}>
                    Continue without analysis
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className={flowStyles.cardLead} role="status">No filmed rooms are waiting for analysis.</p>
                <button className={flowStyles.secondaryButton} type="button" data-testid="tour-analyze-continue" onClick={() => setAnalysisSettled(true)}>
                  Continue
                </button>
              </>
            )}
          </div>
        )}

        {node.kind === "review-item" && (() => {
          const proposal = bindings.record.proposals[node.elementId];
          const tier = fixListTier(node.elementId);
          if (!proposal) {
            const draftlessDecision = bindings.record.decisions[node.elementId];
            const draftlessPrior = draftlessDecision?.status === "unreviewed" ? draftlessDecision.priorDeficiency : undefined;
            return (
              <div className={flowStyles.card} data-testid="tour-review-card" data-noproposal="true">
                <p className={flowStyles.draftLabel}>{tier.label}{reviewPosition ? ` · item ${reviewPosition.index} of ${reviewPosition.total}` : ""}</p>
                <h2>{elementLabel(node.elementId)}</h2>
                {draftlessPrior && (
                  <p className={flowStyles.helpText} data-testid="tour-reinspection-tag">
                    Re-inspection: a prior deficiency is on file — “{draftlessPrior.issueDescription}” Compare its Before stills in full review, then decide again.
                  </p>
                )}
                <p className={flowStyles.helpText}>No AI draft — the footage had no reviewable evidence for this item. Decide it yourself below.</p>
                <div className={styles.reviewActions}>
                  <button
                    className={flowStyles.button}
                    type="button"
                    data-testid="tour-review-draft"
                    onClick={() => bindings.reviewProposalDraft(node.elementId)}
                  >
                    Decide in detail form <ArrowRight size={17} aria-hidden="true" />
                  </button>
                  <button
                    className={flowStyles.secondaryButton}
                    type="button"
                    data-testid="tour-needs-check"
                    onClick={() => bindings.markNeedsCheck(node.elementId, `Inspector marked ${elementLabel(node.elementId)} for a human check during the guided tour.`)}
                  >
                    <CircleHelp size={16} aria-hidden="true" /> Needs human check
                  </button>
                  <button className={flowStyles.secondaryButton} type="button" data-testid="tour-skip" onClick={() => skipElement(node.elementId)}>
                    Skip
                  </button>
                </div>
              </div>
            );
          }
          const approved = proposal.modelSuggestion === "A";
          const tourDecision = bindings.record.decisions[node.elementId];
          const tourPrior = tourDecision?.status === "unreviewed" ? tourDecision.priorDeficiency : undefined;
          return (
            <div className={flowStyles.card} data-testid="tour-review-card">
              <p className={flowStyles.draftLabel}>{tier.label}{reviewPosition ? ` · item ${reviewPosition.index} of ${reviewPosition.total}` : ""}</p>
              <h2>{elementLabel(node.elementId)}</h2>
              {tourPrior && (
                <p className={flowStyles.helpText} data-testid="tour-reinspection-tag">
                  Re-inspection: a prior deficiency is on file — “{tourPrior.issueDescription}” Compare its Before stills in full review, then decide again.
                </p>
              )}
              <p className={styles.suggestion} data-approved={approved}>
                AI suggests: {approved ? "Approved" : "Deficient"} · confidence {proposal.confidence}%
                {proposal.state === "needs-human-check" ? " · needs a human check" : ""}
              </p>
              <p className={styles.observation}>{proposal.observation}</p>
              {!approved && (
                <p className={flowStyles.helpText}>{reinspectionChecklist(node.elementId)}</p>
              )}
              <VoicePrompt
                key={node.elementId}
                question={lang === "es" ? REVIEW_VOICE_QUESTION_ES : REVIEW_VOICE_QUESTION}
                autoSpeak={false}
                language={lang}
                transcript={bindings.voiceTranscript}
                onTranscript={handleReviewTranscript(node.elementId)}
                onPhaseChange={setVoicePhase}
              >
                <div className={styles.reviewActions}>
                  <button
                    className={flowStyles.button}
                    type="button"
                    data-testid="tour-confirm-draft"
                    aria-label={`Confirm: I checked this in person and agree: ${approved ? "Approved" : "Deficient"}`}
                    onClick={() => attemptReviewConfirm(node.elementId)}
                  >
                    Confirm: {approved ? "Approved" : "Deficient"} <ArrowRight size={17} aria-hidden="true" />
                  </button>
                  <button
                    className={flowStyles.secondaryButton}
                    type="button"
                    data-testid="tour-review-draft"
                    onClick={() => bindings.reviewProposalDraft(node.elementId)}
                  >
                    Review {proposal.modelSuggestion} draft
                  </button>
                  <button
                    className={flowStyles.secondaryButton}
                    type="button"
                    data-testid="tour-needs-check"
                    onClick={() => bindings.markNeedsCheck(node.elementId, `Inspector marked ${elementLabel(node.elementId)} for a human check during the guided tour.`)}
                  >
                    <CircleHelp size={16} aria-hidden="true" /> Needs human check
                  </button>
                  <button className={flowStyles.secondaryButton} type="button" data-testid="tour-skip" onClick={() => skipElement(node.elementId)}>
                    Skip
                  </button>
                </div>
              </VoicePrompt>
            </div>
          );
        })()}

        {node.kind === "element-details" && (
          <div className={flowStyles.card} key={node.elementId} data-testid="tour-details-card">
            <p className={flowStyles.draftLabel}>Deficiency plan</p>
            <h2>{elementLabel(node.elementId)}</h2>
            <p className={flowStyles.helpText}>The AI draft has no complete correction plan. Fill in every field — saving records your in-person decision.</p>
            <div role="group" aria-label="Deficiency details">
              <label className={styles.stackLabel} htmlFor="tour-details-issue">Issue description</label>
              <textarea
                id="tour-details-issue"
                className={flowStyles.formInput}
                data-testid="tour-details-issue"
                value={detailsFields.issueDescription}
                maxLength={1000}
                rows={2}
                onChange={(event) => setDetailsFields((current) => ({ ...current, issueDescription: event.currentTarget.value }))}
              />
              <label className={styles.stackLabel} htmlFor="tour-details-correction">Correction</label>
              <textarea
                id="tour-details-correction"
                className={flowStyles.formInput}
                data-testid="tour-details-correction"
                value={detailsFields.correction}
                maxLength={1000}
                rows={2}
                onChange={(event) => setDetailsFields((current) => ({ ...current, correction: event.currentTarget.value }))}
              />
              <label className={styles.stackLabel} htmlFor="tour-details-completion">Completion date</label>
              <input
                id="tour-details-completion"
                className={flowStyles.formInput}
                data-testid="tour-details-completion"
                type="date"
                value={detailsFields.completionDate}
                onChange={(event) => setDetailsFields((current) => ({ ...current, completionDate: event.currentTarget.value }))}
              />
              <label className={styles.stackLabel} htmlFor="tour-details-reinspection">Reinspection date</label>
              <input
                id="tour-details-reinspection"
                className={flowStyles.formInput}
                data-testid="tour-details-reinspection"
                type="date"
                value={detailsFields.reinspectionDate}
                onChange={(event) => setDetailsFields((current) => ({ ...current, reinspectionDate: event.currentTarget.value }))}
              />
            </div>
            {saveTried && bindings.actionError && <p className={flowStyles.inlineError} role="alert">{bindings.actionError}</p>}
            <div className={styles.reviewActions}>
              <button
                className={flowStyles.button}
                type="button"
                data-testid="tour-details-save"
                onClick={() => {
                  setSaveTried(true);
                  if (bindings.saveElementDetails(node.elementId, detailsFields)) setDetailsElementId(null);
                }}
              >
                Save Deficient decision <ArrowRight size={17} aria-hidden="true" />
              </button>
              <button
                className={flowStyles.secondaryButton}
                type="button"
                data-testid="tour-details-form"
                onClick={() => bindings.reviewProposalDraft(node.elementId)}
              >
                Open full detail form
              </button>
            </div>
          </div>
        )}

        {node.kind === "fire-safety" && (
          <div className={flowStyles.card} data-testid="tour-fire-card">
            <p className={flowStyles.draftLabel}>Fire Safety · 11a + 11b</p>
            <h2>Two separate marks</h2>
            <p className={flowStyles.helpText}>Unit detectors and public-area detectors are independent Form 1083 marks. Set each one.</p>
            <div className={styles.optionGrid} role="group" aria-label="Unit detectors (11a)">
              {(["A", "D", "needs-human-check"] as const).map((outcome) => (
                <button
                  key={`unit-${outcome}`}
                  type="button"
                  className={flowStyles.secondaryButton}
                  data-testid={`tour-fire-unit-${outcome}`}
                  aria-pressed={fireUnit === outcome}
                  onClick={() => setFireUnit(outcome)}
                >
                  Unit: {outcome === "A" ? "Meets" : outcome === "D" ? "Deficient" : "Needs check"}
                </button>
              ))}
            </div>
            <div className={styles.optionGrid} role="group" aria-label="Public-area detectors (11b)">
              {(["A", "D", "needs-human-check"] as const).map((outcome) => (
                <button
                  key={`public-${outcome}`}
                  type="button"
                  className={flowStyles.secondaryButton}
                  data-testid={`tour-fire-public-${outcome}`}
                  aria-pressed={firePublic === outcome}
                  onClick={() => setFirePublic(outcome)}
                >
                  Public: {outcome === "A" ? "Meets" : outcome === "D" ? "Deficient" : "Needs check"}
                </button>
              ))}
            </div>
            {saveTried && bindings.actionError && <p className={flowStyles.inlineError} role="alert">{bindings.actionError}</p>}
            <div className={styles.reviewActions}>
              <button
                className={flowStyles.button}
                type="button"
                data-testid="tour-fire-save"
                disabled={fireUnit === "" || firePublic === ""}
                onClick={() => {
                  setSaveTried(true);
                  bindings.saveFireSafety(fireUnit, firePublic);
                }}
              >
                Save Fire Safety marks <ArrowRight size={17} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {node.kind === "agency" && (
          <div className={flowStyles.card} data-testid="tour-agency-card">
            <p className={flowStyles.draftLabel}>Form 1083 · Evaluator</p>
            <h2>Agency name</h2>
            <label className={styles.stackLabel} htmlFor="tour-agency-input">Evaluator agency name</label>
            <input
              id="tour-agency-input"
              className={flowStyles.formInput}
              data-testid="tour-agency-input"
              value={bindings.record.evaluatorAgencyName}
              maxLength={120}
              placeholder="Agency name"
              onChange={(event) => bindings.setAgencyName(event.currentTarget.value)}
            />
            <p className={flowStyles.helpText}>Required by Form 1083. The tour continues once it is filled.</p>
          </div>
        )}

        {node.kind === "landlord-discussion" && (
          <div className={flowStyles.card} data-testid="tour-landlord-card">
            <p className={flowStyles.draftLabel}>Form 1083 · Landlord</p>
            <VoicePrompt
              question={lang === "es" ? LANDLORD_VOICE_QUESTION_ES : LANDLORD_VOICE_QUESTION}
              autoSpeak={speakOn}
              language={lang}
              transcript={bindings.voiceTranscript}
              onTranscript={handleLandlordTranscript}
              onPhaseChange={setVoicePhase}
            >
              <div className={styles.optionGrid} data-testid="tour-options" role="group" aria-label="Discussed with landlord">
                <button type="button" className={flowStyles.secondaryButton} onClick={() => bindings.setLandlordDiscussion("yes")}>
                  YES
                </button>
                <button type="button" className={flowStyles.secondaryButton} onClick={() => bindings.setLandlordDiscussion("no")}>
                  NO
                </button>
              </div>
            </VoicePrompt>
            {bindings.record.landlordDiscussion === "yes" && (
              <div>
                <label className={styles.stackLabel} htmlFor="tour-landlord-date">Discussion date</label>
                <input
                  id="tour-landlord-date"
                  className={flowStyles.formInput}
                  data-testid="tour-landlord-date"
                  type="date"
                  value={bindings.record.landlordDiscussionDate}
                  onChange={(event) => bindings.setLandlordDate(event.currentTarget.value)}
                />
              </div>
            )}
          </div>
        )}

        {node.kind === "leadership" && (
          <div className={flowStyles.card} data-testid="tour-leadership-card">
            <p className={flowStyles.draftLabel}>Form 1083 · Agency leadership</p>
            <h2>Leadership sign-off</h2>
            <p className={flowStyles.helpText}>Your agency requires a leadership sign-off before export.</p>
            <label className={styles.stackLabel} htmlFor="tour-leadership-name">Printed name and title</label>
            <input
              id="tour-leadership-name"
              className={flowStyles.formInput}
              data-testid="tour-leadership-name"
              value={bindings.record.leadershipNameAndTitle}
              maxLength={120}
              onChange={(event) => bindings.setLeadershipName(event.currentTarget.value)}
            />
            <label className={styles.stackLabel} htmlFor="tour-leadership-signature">Leadership signature</label>
            <input
              id="tour-leadership-signature"
              className={flowStyles.formInput}
              data-testid="tour-leadership-signature"
              value={bindings.record.leadershipSignoff}
              maxLength={120}
              onChange={(event) => bindings.setLeadershipSignature(event.currentTarget.value)}
            />
            <label className={styles.stackLabel} htmlFor="tour-leadership-date">Signature date</label>
            <input
              id="tour-leadership-date"
              className={flowStyles.formInput}
              data-testid="tour-leadership-date"
              type="date"
              value={bindings.record.leadershipSignedAt}
              onChange={(event) => bindings.setLeadershipDate(event.currentTarget.value)}
            />
          </div>
        )}

        {node.kind === "participant" && (
          <div className={flowStyles.card} data-testid="tour-participant-card">
            <p className={flowStyles.draftLabel}>Form 1083 · Participant</p>
            <h2>Participant sign-off</h2>
            <p className={flowStyles.helpText}>{PARTICIPANT_ATTESTATION_TEXT}</p>
            <label className={styles.stackLabel} htmlFor="tour-participant-name">Participant name</label>
            <input
              id="tour-participant-name"
              className={flowStyles.formInput}
              data-testid="tour-participant-name"
              value={bindings.participantName}
              maxLength={120}
              onChange={(event) => bindings.setParticipantName(event.currentTarget.value)}
            />
            <label className={styles.stackLabel} htmlFor="tour-participant-signature">Participant signature</label>
            <input
              id="tour-participant-signature"
              className={flowStyles.formInput}
              data-testid="tour-participant-signature"
              value={bindings.participantSignature}
              maxLength={120}
              onChange={(event) => bindings.setParticipantSignature(event.currentTarget.value)}
            />
            <label className={flowStyles.checkLabel}>
              <input
                type="checkbox"
                data-testid="tour-participant-attest"
                checked={bindings.participantAttested}
                onChange={(event) => bindings.setParticipantAttested(event.currentTarget.checked)}
              />
              <span>I walked through this unit with the evaluator.</span>
            </label>
            {saveTried && bindings.actionError && <p className={flowStyles.inlineError} role="alert">{bindings.actionError}</p>}
            <div className={styles.reviewActions}>
              <button
                className={flowStyles.button}
                type="button"
                data-testid="tour-participant-save"
                onClick={() => {
                  setSaveTried(true);
                  bindings.saveParticipantSignoff();
                }}
              >
                Save participant sign-off <ArrowRight size={17} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {node.kind === "signoff" && (
          <div className={flowStyles.card} data-testid="tour-signoff-card">
            <p className={flowStyles.draftLabel}>Form 1083 · Evaluator</p>
            <h2>Your sign-off</h2>
            <p className={flowStyles.helpText}>{EVALUATOR_ATTESTATION_TEXT}</p>
            <label className={styles.stackLabel} htmlFor="tour-signoff-signature">Typed signature</label>
            <input
              id="tour-signoff-signature"
              className={flowStyles.formInput}
              data-testid="tour-signoff-signature"
              value={bindings.signoffName}
              maxLength={120}
              placeholder={bindings.record.evaluatorName || "Evaluator name"}
              onChange={(event) => bindings.setSignoffName(event.currentTarget.value)}
            />
            <label className={flowStyles.checkLabel}>
              <input
                type="checkbox"
                data-testid="tour-signoff-attest"
                checked={bindings.signoffAttested}
                onChange={(event) => bindings.setSignoffAttested(event.currentTarget.checked)}
              />
              <span>I completed and reviewed this inspection based on my own assessment.</span>
            </label>
            {saveTried && bindings.actionError && <p className={flowStyles.inlineError} role="alert">{bindings.actionError}</p>}
            <div className={styles.reviewActions}>
              <button
                className={flowStyles.button}
                type="button"
                data-testid="tour-signoff-save"
                onClick={() => {
                  setSaveTried(true);
                  bindings.saveSignoff();
                }}
              >
                Save evaluator sign-off <ArrowRight size={17} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {node.kind === "finish" && (() => {
          const decided = MOVE_IN_READY_ELEMENTS.filter(
            (element) => (bindings.record.decisions[element.id]?.status ?? "unreviewed") !== "unreviewed",
          ).length;
          const total = MOVE_IN_READY_ELEMENTS.length;
          const open = MOVE_IN_READY_ELEMENTS.filter(
            (element) => (bindings.record.decisions[element.id]?.status ?? "unreviewed") === "unreviewed",
          );
          return (
            <div className={flowStyles.card} data-testid="tour-finish">
              <h2>Tour complete</h2>
              <p className={flowStyles.cardLead}>
                {decided} of {total} requirements decided.
                {open.length > 0 ? ` Still open: ${open.map((element) => element.label).join(", ")}.` : " Every requirement is decided."}
              </p>
              <div className={styles.reviewActions}>
                <button className={flowStyles.button} type="button" data-testid="tour-finish-signoff" onClick={() => bindings.changeStep("signoff")}>
                  Go to sign-off <ArrowRight size={17} aria-hidden="true" />
                </button>
                {open.length > 0 && (
                  <button className={flowStyles.secondaryButton} type="button" data-testid="tour-finish-review" onClick={() => bindings.changeStep("review")}>
                    Open full review
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
