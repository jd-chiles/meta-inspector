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
  MOVE_IN_READY_ELEMENTS,
  roomLabel,
  type MoveInReadyElementId,
  type MoveInReadyRoomId,
  type MoveInReadyUnitType,
} from "../../domain/move-in-ready";
import type { MoveInReadyInspection } from "./inspection-store";
import type { StoredVideoClip, VideoClipStore } from "./video-store";
import { LIVE_ELEMENT_SPECS, filmingRoomForLiveElement } from "./live-elements";
import { fixListTier, reinspectionChecklist } from "./fix-list";
import { SETUP_VOICE_QUESTIONS, VOICE_ROOM_CHECKS } from "./voice-checks";
import { filmingScriptForRoom } from "./assistant-script";
import { parseRoomId } from "../../domain/move-in-ready";
import { parseBathCount, parseUnitType, parseYesNo } from "./voice-parse";
import { speakPrompt } from "./voice-conversation";
import VoicePrompt, { type VoicePromptPhase } from "./voice-prompt";
import WalkthroughVideoCapture from "./video-capture";
import LiveCapture, { type LiveElementClipResult } from "./live-capture";
import {
  deriveTourNode,
  elementLabel,
  filmRoomShots,
  guidedReviewQueue,
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
  videoStore: VideoClipStore | null;
  voiceTranscript: string | null;
  onVoiceTranscript: (text: string | null) => void;
  batchActive: boolean;
  batchProgress: { done: number; total: number; roomLabel: string } | null;
  batchFailedRooms: readonly string[];
  analysisComplete: boolean;
  setEvaluatorName: (name: string) => void;
  setUnitType: (unit: MoveInReadyUnitType) => void;
  setBathCount: (count: number) => void;
  grantTourConsent: () => void;
  selectRoom: (roomId: string) => void;
  onClipChange: (clip: StoredVideoClip | null, roomId: string) => void;
  onRecordingStateChange: (recording: boolean) => void;
  answerVoiceCheck: (roomId: MoveInReadyRoomId, question: string, answer: "yes" | "no" | "skipped") => void;
  grantBatchConsent: () => void;
  startBatchAnalysis: () => void;
  cancelBatchAnalysis: () => void;
  saveLiveDraft: (elementId: MoveInReadyElementId) => boolean;
  onLiveClipSaved: (elementId: MoveInReadyElementId, result: LiveElementClipResult) => void;
  onLiveNeedsCheck: (elementId: MoveInReadyElementId, reason: string) => void;
  reviewProposalDraft: (elementId: MoveInReadyElementId) => void;
  confirmProposalDraft: (elementId: MoveInReadyElementId) => void;
  markNeedsCheck: (elementId: MoveInReadyElementId, note: string) => void;
  changeStep: (step: "home" | "capture" | "review" | "signoff" | "profile") => void;
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
  const speechControllerRef = useRef<AbortController | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

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
  }), [
    started, bathsConfirmed, analysisSettled, bindings.record, bindings.capturedRoomIds,
    bindings.analysisMode, bindings.online, bindings.batchActive, skipped,
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
  });

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
    topRef.current?.scrollIntoView({ block: "start" });
    if (!speakOn || script === "") return;
    const controller = new AbortController();
    speechControllerRef.current = controller;
    setTourSpeaking(true);
    void speakPrompt(script, controller.signal).then(
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
  }, [nodeKey, speechNonce, speakOn]);

  const sayNow = useCallback((text: string) => {
    if (!speakOn) return;
    stopSpeech();
    const controller = new AbortController();
    speechControllerRef.current = controller;
    setTourSpeaking(true);
    void speakPrompt(text, controller.signal).then(
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
  }, [speakOn, stopSpeech]);

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

  // Auto-start batch analysis once per analyze visit when it can run.
  useEffect(() => {
    if (node.kind !== "analyze") return;
    if (bindings.analysisMode !== "live" || !bindings.online) return;
    if (bindings.batchActive || batchSeen || analysisSettled) return;
    bindings.grantBatchConsent();
    bindings.startBatchAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, bindings.analysisMode, bindings.online, bindings.batchActive, batchSeen, analysisSettled]);

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
    const cues = filmingScriptForRoom(node.roomId);
    const timers = cues.map((cue, index) =>
      window.setTimeout(() => { setShotIndex(index); sayNow(cue); }, 1500 + index * 8000));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      setShotIndex(-1);
      stopSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, tourRecording, speakOn]);

  const skipElement = useCallback((elementId: MoveInReadyElementId) => {
    setSkipped((current) => new Set(current).add(elementId));
  }, []);

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
    if (text.trim()) sayNow("I didn't catch that. Tap your unit type below.");
  }, [bindings, sayNow]);

  const handleBathsTranscript = useCallback((text: string) => {
    bindings.onVoiceTranscript(text);
    const parsed = parseBathCount(text);
    if (parsed !== null) {
      bindings.setBathCount(parsed);
      setBathsConfirmed(true);
      return;
    }
    if (text.trim()) sayNow("I didn't catch that. Tap the bathroom count below.");
  }, [bindings, sayNow]);

  const handleCheckTranscript = useCallback((roomId: MoveInReadyRoomId, question: string) => (text: string) => {
    bindings.onVoiceTranscript(text);
    const parsed = parseYesNo(text);
    if (parsed) {
      bindings.answerVoiceCheck(roomId, question, parsed);
      return;
    }
    if (text.trim()) sayNow("I didn't catch that. Say yes or no, or tap an answer.");
  }, [bindings, sayNow]);

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
              question={SETUP_VOICE_QUESTIONS.evaluatorName}
              autoSpeak={speakOn}
              transcript={bindings.voiceTranscript}
              onTranscript={(text) => {
                bindings.onVoiceTranscript(text);
                if (text.trim()) setNameDraft(text.trim().slice(0, 80));
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
              question={SETUP_VOICE_QUESTIONS.unitTypeTour}
              autoSpeak={speakOn}
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
              question={SETUP_VOICE_QUESTIONS.baths}
              autoSpeak={speakOn}
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
                {filmRoomShots(node.roomId).map((shot, index) => (
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
              onRoomChange={(roomId) => bindings.selectRoom(roomId)}
              onRecordingStateChange={(recording) => {
                bindings.onRecordingStateChange(recording);
                setTourRecording(recording);
              }}
              onClipChange={(clip, roomId) => bindings.onClipChange(clip, roomId)}
            />
          </div>
        )}

        {node.kind === "room-check" && (() => {
          const parsed = parseRoomId(node.roomId);
          const question = parsed ? VOICE_ROOM_CHECKS[parsed.type][node.index] : undefined;
          if (!question) return null;
          return (
            <div className={flowStyles.card}>
              <p className={flowStyles.draftLabel}>{roomLabel(node.roomId)} · in-person check</p>
              <VoicePrompt
                key={`${node.roomId}:${node.index}`}
                question={question}
                autoSpeak={speakOn}
                transcript={bindings.voiceTranscript}
                onTranscript={handleCheckTranscript(node.roomId, question)}
                onPhaseChange={setVoicePhase}
              >
                <div className={flowStyles.voiceTapRow}>
                  <button className={flowStyles.button} type="button" data-testid="tour-check-yes" onClick={() => bindings.answerVoiceCheck(node.roomId, question, "yes")}>Yes</button>
                  <button className={flowStyles.button} type="button" data-testid="tour-check-no" onClick={() => bindings.answerVoiceCheck(node.roomId, question, "no")}>No</button>
                  <button className={flowStyles.textButton} type="button" onClick={() => bindings.answerVoiceCheck(node.roomId, question, "skipped")}>Skip</button>
                </div>
              </VoicePrompt>
            </div>
          );
        })()}

        {node.kind === "analyze" && (
          <div className={flowStyles.card} data-testid="tour-analyze">
            <h2>AI analysis</h2>
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
                <p className={flowStyles.cardLead} role="status">
                  {bindings.batchProgress
                    ? `Analyzing ${bindings.batchProgress.roomLabel} — ${bindings.batchProgress.done} of ${bindings.batchProgress.total} rooms done.`
                    : "Starting analysis."}
                </p>
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
            ) : (
              <p className={flowStyles.cardLead} role="status">Starting analysis.</p>
            )}
          </div>
        )}

        {node.kind === "live" && (() => {
          const spec = LIVE_ELEMENT_SPECS.find((item) => item.elementId === node.elementId);
          if (!spec || !bindings.videoStore) return null;
          const filmingRoomId = filmingRoomForLiveElement(spec, bindings.record.roomIds, bindings.record.selectedRoomId);
          return (
            <div className={styles.filmStage}>
              <LiveCapture
                key={`${bindings.sessionId}:${spec.elementId}`}
                sessionId={bindings.sessionId}
                elementId={spec.elementId}
                elementLabel={elementLabel(spec.elementId)}
                concept={spec.concept}
                conceptLabel={spec.conceptLabel}
                prompt={spec.prompt}
                recoveryHint={spec.recoveryHint}
                roomId={filmingRoomId}
                roomLabel={bindings.rooms.find((room) => room.id === filmingRoomId)?.label ?? filmingRoomId}
                schemaVersion={bindings.record.schemaVersion}
                catalogVersion={bindings.record.catalogVersion}
                clipStore={bindings.videoStore}
                transcriptLines={bindings.voiceTranscript ? [bindings.voiceTranscript] : []}
                existingIdentity={bindings.record.elementClipIdentities[spec.elementId]}
                onSaved={(result) => {
                  bindings.onLiveClipSaved(spec.elementId, result);
                  bindings.saveLiveDraft(spec.elementId);
                }}
                onNeedsHumanCheck={(reason) => bindings.onLiveNeedsCheck(spec.elementId, reason)}
              />
              <button className={flowStyles.secondaryButton} type="button" data-testid="tour-live-skip" onClick={() => skipElement(spec.elementId)}>
                Skip this proof
              </button>
            </div>
          );
        })()}

        {node.kind === "review-item" && (() => {
          const proposal = bindings.record.proposals[node.elementId];
          if (!proposal) return null;
          const tier = fixListTier(node.elementId);
          const approved = proposal.modelSuggestion === "A";
          return (
            <div className={flowStyles.card} data-testid="tour-review-card">
              <p className={flowStyles.draftLabel}>{tier.label}{reviewPosition ? ` · item ${reviewPosition.index} of ${reviewPosition.total}` : ""}</p>
              <h2>{elementLabel(node.elementId)}</h2>
              <p className={styles.suggestion} data-approved={approved}>
                AI suggests: {approved ? "Approved" : "Deficient"} · confidence {proposal.confidence}%
                {proposal.state === "needs-human-check" ? " · needs a human check" : ""}
              </p>
              <p className={styles.observation}>{proposal.observation}</p>
              {!approved && (
                <p className={flowStyles.helpText}>{reinspectionChecklist(node.elementId)}</p>
              )}
              <div className={styles.reviewActions}>
                <button
                  className={flowStyles.button}
                  type="button"
                  data-testid="tour-confirm-draft"
                  aria-label={`Confirm: I checked this in person and agree: ${approved ? "Approved" : "Deficient"}`}
                  onClick={() => bindings.confirmProposalDraft(node.elementId)}
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
            </div>
          );
        })()}

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
