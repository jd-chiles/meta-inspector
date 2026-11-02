/**
 * Voice readout for the AI inspection guide and filming cues. One voice
 * everywhere: guide speech goes through the same static-first Fish pipeline
 * as the tour (pre-generated clips, live synthesis, device fallback, then
 * silent text). Speech output only: iOS Safari exposes no
 * speech-recognition API, so the user answers by tapping. All functions are
 * safe no-ops outside a browser or without voice support.
 */
import { speakPrompt, type SpeakResult } from "./voice-conversation";

const VOICE_ENABLED_KEY = "voice-guide-enabled-v1";

export function readVoiceEnabled(): boolean {
  try {
    return window.localStorage.getItem(VOICE_ENABLED_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeVoiceEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(VOICE_ENABLED_KEY, enabled ? "on" : "off");
  } catch {
    // Private mode: voice still works for this session.
  }
}

type GuideSpeaker = (text: string, signal?: AbortSignal) => Promise<SpeakResult>;

let speaker: GuideSpeaker = speakPrompt;
let controller: AbortController | null = null;

/** Test-only speaker injection (browser Audio is unavailable in unit tests). */
export function __setGuideSpeakerForTests(next: GuideSpeaker | null): void {
  speaker = next ?? speakPrompt;
}

export function cancelSpeech(): void {
  try {
    controller?.abort();
  } catch {
    // Aborting twice is fine.
  }
  controller = null;
  // Also silence a device-voice fallback utterance, if one is in flight.
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // Unsupported browsers stay silent.
  }
}

/** Speak one guide message, replacing anything currently playing. */
export function speakText(message: string): void {
  cancelSpeech();
  try {
    if (typeof window === "undefined") return;
    const next = new AbortController();
    controller = next;
    const signal = next.signal;
    void speaker(message, signal)
      .catch(() => undefined)
      .finally(() => {
        if (controller?.signal === signal) controller = null;
      });
  } catch {
    // Autoplay blocks stay silent; the text remains.
  }
}
