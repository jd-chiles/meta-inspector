"use client";

/**
 * One voice turn: speaks the question, records one mic answer, transcribes
 * it, and hands the transcript to the parent for parsing. Tap controls
 * always stay available; voice never gates progress.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, Square, Volume2 } from "lucide-react";
import { canListen, listenOnce, speakPrompt, transcribeClip, type TranscribeProvider, type VoiceEngine } from "./voice-conversation";
import styles from "./move-in-ready-flow.module.css";

interface VoicePromptProps {
  question: string;
  autoSpeak?: boolean;
  /** Tour narration language; spoken through the matching owner voice. */
  language?: "en" | "es";
  transcript: string | null;
  onTranscript: (text: string) => void;
  onPhaseChange?: (phase: VoicePromptPhase) => void;
  children?: ReactNode;
}

export type VoicePromptPhase = "idle" | "speaking" | "ready" | "listening" | "transcribing" | "error";
type Phase = VoicePromptPhase;

export default function VoicePrompt({ question, autoSpeak, language = "en", transcript, onTranscript, onPhaseChange, children }: VoicePromptProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [engine, setEngine] = useState<VoiceEngine>("none");
  const [transcribeProvider, setTranscribeProvider] = useState<TranscribeProvider | null>(null);
  const [listeningAvailable] = useState(() => canListen());
  const abortRef = useRef<AbortController | null>(null);
  const listenRef = useRef<{ stop: () => void } | null>(null);

  const stopAll = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    listenRef.current?.stop();
    listenRef.current = null;
  }, []);

  useEffect(() => stopAll, [stopAll]);

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

  const speak = useCallback(async () => {
    stopAll();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("speaking");
    try {
      const result = await speakPrompt(question, controller.signal, { language });
      setEngine(result.engine);
      setPhase("ready");
    } catch {
      setPhase("ready");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [question, language, stopAll]);

  // A new question cancels the previous turn first: without this, a
  // late transcript can land on the next question after navigation and
  // record an answer against the wrong prompt. Declared before the
  // auto-speak effect so mount order is stop (no-op) then speak.
  useEffect(() => {
    stopAll();
  }, [question, stopAll]);

  useEffect(() => {
    if (autoSpeak) void speak();
  }, [autoSpeak, speak]);

  const toggleListen = useCallback(async () => {
    if (phase === "listening") {
      listenRef.current?.stop();
      return;
    }
    stopAll();
    const controller = new AbortController();
    abortRef.current = controller;
    setTranscribeProvider(null);
    setPhase("listening");
    try {
      const handle = listenOnce({ maxMs: 20_000 });
      listenRef.current = handle;
      const { blob } = await handle.done;
      listenRef.current = null;
      if (controller.signal.aborted) return;
      setPhase("transcribing");
      const result = await transcribeClip(blob, controller.signal);
      // Drop transcripts from a superseded turn: only the current
      // controller may deliver. Aborts land silently, never as errors.
      if (controller.signal.aborted || abortRef.current !== controller) return;
      setTranscribeProvider(result.providerUsed);
      setPhase("ready");
      onTranscript(result.text.trim());
    } catch {
      listenRef.current = null;
      if (controller.signal.aborted || abortRef.current !== controller) {
        setPhase("ready");
        return;
      }
      setPhase("error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [phase, stopAll, onTranscript]);

  return (
    <div className={styles.voicePrompt} data-testid="voice-prompt" data-phase={phase}>
      <p className={styles.voiceQuestion}>{question}</p>
      <div className={styles.voiceControls}>
        <button type="button" className={styles.secondaryButton} onClick={() => void speak()} disabled={phase === "speaking" || phase === "listening" || phase === "transcribing"}>
          <Volume2 size={16} aria-hidden="true" /> {phase === "speaking" ? "Speaking…" : "Hear it"}
        </button>
        {listeningAvailable ? (
          <button type="button" className={styles.secondaryButton} onClick={() => void toggleListen()} disabled={phase === "speaking" || phase === "transcribing"}>
            {phase === "listening" ? <><Square size={16} aria-hidden="true" /> Stop</> : <><Mic size={16} aria-hidden="true" /> Answer by voice</>}
          </button>
        ) : (
          <span className={styles.helpText}>Mic unavailable — use the buttons.</span>
        )}
      </div>
      {phase === "listening" && <p className={styles.statusText} role="status">Listening… tap Stop when done.</p>}
      {phase === "transcribing" && <p className={styles.statusText} role="status">Transcribing…</p>}
      {phase === "error" && <p className={styles.inlineError} role="alert">Voice didn’t catch that. Use the buttons below.</p>}
      {transcribeProvider === "fish" && <p className={styles.statusText} role="status">Transcribed by backup provider</p>}
      {transcript !== null && transcript !== "" && <p className={styles.voiceTranscript}>Heard: “{transcript}”</p>}
      {engine !== "none" && <p className={styles.helpText}>{engine === "fish" ? "Spoken voice" : "Device voice (server voice unavailable)"}</p>}
      {children}
    </div>
  );
}
