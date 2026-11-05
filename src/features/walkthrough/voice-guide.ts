/**
 * Voice readout for the voice guide bar and filming cues. One voice
 * everywhere: guide speech goes through the same static-first Fish pipeline
 * as the tour (pre-generated clips, live synthesis, device fallback, then
 * silent text). Speech output only: iOS Safari exposes no
 * speech-recognition API, so the user answers by tapping. All functions are
 * safe no-ops outside a browser or without voice support.
 */
import { playbackTimeoutMs, speakPrompt, type SpeakResult } from "./voice-conversation";

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

export interface CueSequence {
  done: Promise<void>;
  cancel: () => void;
}

/**
 * Speak the filming cues one at a time, in order. The next cue waits for
 * the current one to finish; a failed cue never blocks the rest. cancel()
 * stops the whole sequence. Used for guided-recording narration, where
 * fixed timers raced playback and dropped cues.
 */
export function speakCueSequence(
  texts: readonly string[],
  onCue?: (index: number) => void,
): CueSequence {
  cancelSpeech();
  const chain = new AbortController();
  controller = chain;
  const done = (async () => {
    for (let index = 0; index < texts.length; index++) {
      if (chain.signal.aborted) return;
      onCue?.(index);
      // Hard ceiling per cue so one stalled clip never freezes the take.
      // A failed cue retries once: a network blip must not silently drop
      // the guide's voice mid-take.
      const ceilingMs = playbackTimeoutMs(texts[index]!) + 8_000;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (chain.signal.aborted) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            speaker(texts[index]!, chain.signal),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error("cue timed out")), ceilingMs);
            }),
          ]);
          break;
        } catch {
          if (chain.signal.aborted) return;
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      }
      if (chain.signal.aborted) return;
      await new Promise((resolveGap) => setTimeout(resolveGap, 1000));
    }
  })().finally(() => {
    if (controller === chain) controller = null;
  });
  return { done, cancel: () => chain.abort() };
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
