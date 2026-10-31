/**
 * Voice readout for the AI inspection guide. Speech output only: iOS Safari
 * exposes no speech-recognition API, so the user answers by tapping.
 * All functions are safe no-ops outside a browser or without TTS support.
 */

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

export function cancelSpeech(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // Unsupported browsers stay silent.
  }
}

/** Speak one guide message, replacing anything currently playing. */
export function speakText(message: string): void {
  try {
    const synthesis = window.speechSynthesis;
    if (!synthesis || typeof SpeechSynthesisUtterance === "undefined") return;
    synthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 1.05;
    const voices = synthesis.getVoices();
    const english = voices.find((voice) => voice.lang.toLowerCase().startsWith("en") && voice.localService)
      ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("en"));
    if (english) utterance.voice = english;
    synthesis.speak(utterance);
  } catch {
    // Autoplay blocks and missing voices stay silent; the text remains.
  }
}
