"use client";

import { Mic, MicOff, RotateCcw, Sparkles, X } from "lucide-react";

import type { AssistantAction, AssistantNode } from "./assistant-script";
import styles from "./assistant-guide.module.css";

interface AssistantGuideProps {
  open: boolean;
  node: AssistantNode;
  voiceOn: boolean;
  recording: boolean;
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
  onAction,
  onVoiceToggle,
  onReplay,
  onClose,
}: AssistantGuideProps) {
  if (!open) return null;
  return (
    <section className={styles.panel} data-testid="assistant-guide" role="complementary" aria-label="AI inspection guide">
      <div className={styles.header}>
        <span className={styles.avatar} aria-hidden="true"><Sparkles size={17} aria-hidden="true" /></span>
        <div className={styles.headerCopy}>
          <strong>AI Guide</strong>
          <small>{recording ? "Camera rolling — follow my voice" : "Walking you through the inspection"}</small>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.iconButton} onClick={onReplay} aria-label="Replay the spoken guidance">
            <RotateCcw size={16} aria-hidden="true" />
          </button>
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
      <div className={styles.body}>
        <p className={styles.title}>{node.title}</p>
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
    </section>
  );
}
