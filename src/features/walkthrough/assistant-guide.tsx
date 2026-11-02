"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Mic, MicOff, RotateCcw, Sparkles, X } from "lucide-react";

import type { AssistantAction, AssistantNode } from "./assistant-script";
import styles from "./assistant-guide.module.css";

interface AssistantGuideProps {
  open: boolean;
  node: AssistantNode;
  voiceOn: boolean;
  recording: boolean;
  recordingCue?: string | null;
  onAction: (action: AssistantAction) => void;
  onVoiceToggle: () => void;
  onReplay: () => void;
  onClose: () => void;
}

export default function AssistantGuide({
  open,
  node,
  voiceOn,
  recording,
  recordingCue = null,
  onAction,
  onVoiceToggle,
  onReplay,
  onClose,
}: AssistantGuideProps) {
  // Phones open collapsed: a one-line banner instead of a half-screen
  // card. The step title stays visible so guidance is never lost.
  const [expanded, setExpanded] = useState<boolean>(() =>
    typeof window === "undefined" ? true : !window.matchMedia("(max-width: 719px)").matches);
  if (!open) return null;
  return (
    <section className={styles.panel} data-testid="assistant-guide" role="complementary" aria-label="AI inspection guide">
      <div className={styles.header}>
        <span className={styles.avatar} aria-hidden="true"><Sparkles size={17} aria-hidden="true" /></span>
        <div className={styles.headerCopy}>
          <strong>{node.title}</strong>
          <small>{recordingCue ?? (recording ? "Camera rolling — follow my voice" : "AI Guide · tap to expand")}</small>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconButton}
            data-testid="assistant-guide-toggle"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse the AI inspection guide" : "Expand the AI inspection guide"}
          >
            {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
          </button>
          {expanded && (
            <button type="button" className={styles.iconButton} onClick={onReplay} aria-label="Replay the spoken guidance">
              <RotateCcw size={16} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className={styles.iconButton}
            onClick={onVoiceToggle}
            aria-label={voiceOn ? "Mute the voice guide" : "Unmute the voice guide"}
            aria-pressed={voiceOn}
          >
            {voiceOn ? <Mic size={16} aria-hidden="true" /> : <MicOff size={16} aria-hidden="true" />}
          </button>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close the AI inspection guide">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      {expanded && (
        <div className={styles.body}>
          <p className={styles.message}>{node.message}</p>
          {node.actions.length > 0 && (
            <div className={styles.actions}>
              {node.actions.map((action) => (
                <button
                  key={`${action.id}-${action.label}`}
                  type="button"
                  className={action.primary ? styles.primaryButton : styles.secondaryButton}
                  onClick={() => onAction(action)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
