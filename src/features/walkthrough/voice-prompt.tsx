"use client";

/**
 * One voice turn: speaks the question, records one mic answer, transcribes
 * it, and hands the transcript to the parent for parsing. Tap controls
 * always stay available; voice never gates progress.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, Square, Volume2 } from "lucide-react";
import { canListen, listenOnce, speakPrompt, transcribeClip, type VoiceEngine } from "./voice-conversation";
import styles from "./move-in-ready-flow.module.css";

interface VoicePromptProps {
  question: string;
  autoSpeak?: boolean;
  transcript: string | null;
  onTranscript: (text: string) => void;
  onPhaseChange?: (phase: VoicePromptPhase) => void;
  children?: ReactNode;
}

export type VoicePromptPhase = "idle" | "speaking" | "ready" | "listening" | "transcribing" | "error";
type Phase = VoicePromptPhase;

export default function VoicePrompt({ question, autoSpeak, transcript, onTranscript, onPhaseChange, children }: VoicePromptProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [engine, setEngine] = useState<VoiceEngine>("none");
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
      const result = await speakPrompt(question, controller.signal);
      setEngine(result.engine);
      setPhase("ready");
    } catch {
      setPhase("ready");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
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
    setPhase("listening");
    try {
      const handle = listenOnce({ maxMs: 20_000 });
      listenRef.current = handle;
      const { blob } = await handle.done;
      listenRef.current = null;
      setPhase("transcribing");
      const text = await transcribeClip(blob);
      setPhase("ready");
      onTranscript(text.trim());
    } catch {
      listenRef.current = null;
      setPhase("error");
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
      {transcript !== null && transcript !== "" && <p className={styles.voiceTranscript}>Heard: “{transcript}”</p>}
      {engine !== "none" && <p className={styles.helpText}>{engine === "fish" ? "Spoken voice" : "Device voice (server voice unavailable)"}</p>}
      {children}
    </div>
  );
}
