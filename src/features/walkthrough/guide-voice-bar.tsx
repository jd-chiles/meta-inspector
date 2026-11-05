"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Mic, MicOff, RotateCcw, Sparkles } from "lucide-react";

import type { AssistantNode } from "./assistant-script";
import styles from "./guide-voice-bar.module.css";

interface GuideVoiceBarProps {
  node: AssistantNode;
  voiceOn: boolean;
  recording: boolean;
  recordingCue?: string | null;
  /** Guided-tour language; the guide itself stays English and says so (REQ-R2). */
  tourLanguage?: "en" | "es";
  onVoiceToggle: () => void;
  onReplay: () => void;
}

/**
 * The single AI voice surface outside the guided tour: a slim docked bar
 * above the bottom nav that narrates every manual step (setup, filming
 * with live recording cues, analysis, review, sign-off). Voice only — it
 * triggers nothing. Flow actions live in the in-flow screens, and the
 * tour's own agent bar owns the tour step, so only one AI surface — and
 * one trigger set — is ever on screen. No close button: muting stops
 * speech while the text guidance stays.
 */
export default function GuideVoiceBar({
  node,
  voiceOn,
  recording,
  recordingCue = null,
  tourLanguage = "en",
  onVoiceToggle,
  onReplay,
}: GuideVoiceBarProps) {
  // Phones open collapsed: a one-line bar instead of a half-screen card.
  // The step title stays visible so guidance is never lost.
  const [expanded, setExpanded] = useState<boolean>(() =>
    typeof window === "undefined" ? true : !window.matchMedia("(max-width: 719px)").matches);
  return (
    <section className={styles.bar} data-testid="guide-voice-bar" role="complementary" aria-label="Voice inspection guide">
      <div className={styles.inner}>
        <div className={styles.header}>
          <span className={styles.avatar} aria-hidden="true"><Sparkles size={17} aria-hidden="true" /></span>
          <div className={styles.headerCopy}>
            <strong>{node.title}</strong>
            <small>{recordingCue ?? (recording ? "Camera rolling — follow my voice" : voiceOn ? "Voice guide · tap to expand" : "Voice muted · tap to expand")}</small>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.iconButton}
              data-testid="guide-voice-bar-toggle"
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={expanded}
              aria-label={expanded ? "Collapse the voice guide" : "Expand the voice guide"}
            >
              {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" /> }
            </button>
            {expanded && (
              <button type="button" className={styles.iconButton} onClick={onReplay} aria-label="Replay the spoken guidance">
                <RotateCcw size={16} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className={styles.iconButton}
              data-testid="guide-voice-bar-mute"
              onClick={onVoiceToggle}
              aria-label={voiceOn ? "Mute the voice guide" : "Unmute the voice guide"}
              aria-pressed={voiceOn}
            >
              {voiceOn ? <Mic size={16} aria-hidden="true" /> : <MicOff size={16} aria-hidden="true" /> }
            </button>
          </div>
        </div>
        {expanded && (
          <div className={styles.body}>
            <p className={styles.message} data-testid="guide-voice-bar-message">{node.message}</p>
            {tourLanguage === "es" && (
              <p className={styles.message} data-testid="guide-voice-bar-english-only">
                <small>This guide answers in English.</small>
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
