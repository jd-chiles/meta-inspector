/**
 * Turn-based voice conversation: speak a prompt (Fish Audio server voice,
 * falling back to the device voice when unconfigured), record one mic
 * answer, transcribe it server-side. Every voice turn has a tap fallback
 * in the UI; this module never blocks on voice availability.
 */
import { WALKTHROUGH_CLIENT_HEADER, WALKTHROUGH_CLIENT_ID } from "../../domain/walkthrough-client";
import { staticVoiceUrl } from "./voice-manifest";

export type VoiceEngine = "fish" | "device" | "none";

export interface SpeakResult {
  engine: VoiceEngine;
}

function stopDeviceSpeech(): void {
  try {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  } catch {
    // Device voice is best-effort only.
  }
}

function speakWithDeviceVoice(text: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
        resolve();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = DEVICE_SPEECH_RATE;
      const done = () => {
        window.clearInterval(keepalive);
        resolve();
      };
      utterance.onend = done;
      utterance.onerror = done;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      // iOS/macOS randomly suspend long utterances; a resume pulse keeps
      // narration alive until it ends. Cleared the moment speech settles.
      const keepalive = window.setInterval(() => {
        try {
          if (window.speechSynthesis.speaking && window.speechSynthesis.paused) window.speechSynthesis.resume();
        } catch {
          // Best-effort only.
        }
      }, 3000);
      // Never hang the conversation on a stuck voice engine.
      window.setTimeout(done, Math.min(45_000, 3000 + text.length * 175));
    } catch {
      resolve();
    }
  });
}

/**
 * Shared playback element. iOS only lets an element play later (from
 * timers) if it was played inside a user gesture first, so recording
 * start primes it; every guided clip then plays through it.
 */
let sharedAudio: HTMLAudioElement | null = null;

function silentWavUrl(): string {
  const sampleRate = 8000;
  const samples = 400;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

function ensureSharedAudio(): HTMLAudioElement | null {
  try {
    if (typeof Audio === "undefined") return null;
    if (!sharedAudio) sharedAudio = new Audio();
    return sharedAudio;
  } catch {
    return null;
  }
}

/** Play near-silence inside a user gesture so later guided clips play. */
export function primeAudio(): void {
  try {
    const audio = ensureSharedAudio();
    if (!audio) return;
    audio.src = silentWavUrl();
    void audio.play().catch(() => undefined);
  } catch {
    // Autoplay policy stays silent; speech retries on the next tap.
  }
}

export const PLAYBACK_TIMEOUT_MESSAGE = "voice playback timed out";

/** Hard cap for one clip: speech runs ~15 chars/s, floor 12s, cap 45s. */
/**
 * Narration pace for every voice surface: static clips, live synthesis, and
 * the device fallback all speak ~30% slower than conversational so filming
 * keeps up. Timeout budgets assume this rate (roughly 10 chars/second).
 */
export const SPEECH_PLAYBACK_RATE = 0.7;
export const DEVICE_SPEECH_RATE = 0.75;

export function playbackTimeoutMs(text: string): number {
  return Math.max(17_000, Math.min(60_000, text.length * 160));
}

function playAudioUrl(url: string, signal?: AbortSignal, timeoutMs: number = 12_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const audio = ensureSharedAudio() ?? new Audio(url);
    try {
      audio.playbackRate = SPEECH_PLAYBACK_RATE;
    } catch {
      // Older engines ignore playback rate; the clip still plays.
    }
    audio.src = url;
    const timer = setTimeout(() => {
      cleanup();
      audio.pause();
      reject(new Error(PLAYBACK_TIMEOUT_MESSAGE));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      audio.pause();
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("voice playback failed"));
    };
    void audio.play().catch((error: unknown) => {
      cleanup();
      reject(error instanceof Error ? error : new Error("voice playback failed"));
    });
  });
}

function isPlaybackTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === PLAYBACK_TIMEOUT_MESSAGE;
}

/**
 * Autoplay policy, not a broken clip. Falling through to live synthesis here
 * would bill a provider call that is equally unable to play, and the device
 * voice would then read the line in a different voice. Stay silent instead:
 * the next user gesture unlocks playback and the same static clip plays.
 */
function isAutoplayBlocked(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === "NotAllowedError";
}

export interface SpeakPromptOptions {
  /** Tour narration language; "es" uses the Spanish owner voice (REQ-R2). */
  language?: "en" | "es";
}

/** Speak one prompt; resolves with the engine that spoke. Aborted on signal. */
export async function speakPrompt(text: string, signal?: AbortSignal, options: SpeakPromptOptions = {}): Promise<SpeakResult> {
  const language = options.language ?? "en";
  if (signal?.aborted) return { engine: "none" };
  // Static-first: pre-generated clips for the fixed script play instantly
  // with zero provider latency. They are the same Fish voice, so a static
  // hit reports "fish"; anything missing falls through to live speech.
  try {
    const clip = await staticVoiceUrl(text, fetch, language);
    if (clip && !signal?.aborted) {
      await playAudioUrl(clip, signal, playbackTimeoutMs(text));
      return { engine: "fish" };
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    // Autoplay-blocked: the clip is fine, the browser is waiting for a gesture.
    if (isAutoplayBlocked(error)) return { engine: "none" };
    // A stuck clip counts as spoken: never freeze the walkthrough on it.
    if (isPlaybackTimeout(error)) return { engine: "fish" };
    // A missing or unplayable clip falls through to live speech below.
  }
  if (signal?.aborted) return { engine: "none" };
  try {
    const response = await fetch("/api/voice/speak", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [WALKTHROUGH_CLIENT_HEADER]: WALKTHROUGH_CLIENT_ID,
      },
      body: JSON.stringify(language === "es" ? { text: text.slice(0, 500), language: "es" } : { text: text.slice(0, 500) }),
      signal,
    });
    if (!response.ok) throw new Error(`voice speak ${response.status}`);
    const blob = await response.blob();
    if (blob.size === 0) throw new Error("voice speak empty");
    const url = URL.createObjectURL(blob);
    try {
      await playAudioUrl(url, signal, playbackTimeoutMs(text));
      return { engine: "fish" };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (signal?.aborted) return { engine: "none" };
    if (isPlaybackTimeout(error)) return { engine: "fish" };
    if (isAutoplayBlocked(error)) return { engine: "none" };
    stopDeviceSpeech();
    await speakWithDeviceVoice(text);
    if (signal?.aborted) return { engine: "none" };
    return { engine: "device" };
  }
}

export interface ListenResult {
  blob: Blob;
}

type CueSpeaker = (text: string, signal: AbortSignal) => Promise<unknown>;

/**
 * Speak cues strictly in turn: the next cue waits for the current one to
 * finish instead of racing fixed timers. A failed cue never blocks the
 * rest; aborting the signal stops the chain silently.
 */
export async function speakCueChain(
  texts: readonly string[],
  speak: CueSpeaker,
  signal: AbortSignal,
  onCue?: (index: number) => void,
): Promise<void> {
  for (let index = 0; index < texts.length; index++) {
    if (signal.aborted) return;
    onCue?.(index);
    // One cue gets a hard ceiling (speech time + fetch slack): a stalled
    // clip, fetch, or device voice can never freeze the walkthrough.
    // A failed cue retries once before moving on: a network blip must
    // not silently drop the walkthrough's voice mid-take.
    const ceilingMs = playbackTimeoutMs(texts[index]!) + 8_000;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          speak(texts[index]!, signal),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("cue timed out")), ceilingMs);
          }),
        ]);
        break;
      } catch {
        if (signal.aborted) return;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    if (signal.aborted) return;
    await new Promise((resolveGap) => setTimeout(resolveGap, 600));
  }
}

/** Guided narration: speak the shot list step by step through the Fish pipeline. */
export function speakSequentially(
  texts: readonly string[],
  signal: AbortSignal,
  options: SpeakPromptOptions & { onCue?: (index: number) => void } = {},
): Promise<void> {
  return speakCueChain(
    texts,
    (text, chainSignal) => speakPrompt(text, chainSignal, { language: options.language }),
    signal,
    options.onCue,
  );
}

function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  if (typeof MediaRecorder === "undefined") return "";
  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return "";
}

export function canListen(): boolean {
  return typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined";
}

/**
 * Record until stop() is called or maxMs elapses. The caller owns the mic
 * indicator; result.blob is a single clip for /api/voice/transcribe.
 */
export function listenOnce(options: { maxMs?: number } = {}): {
  done: Promise<ListenResult>;
  stop: () => void;
} {
  const maxMs = Math.min(Math.max(options.maxMs ?? 20_000, 3000), 60_000);
  let stoppedEarly = false;
  let stopRecording: () => void = () => {
    stoppedEarly = true;
  };
  const done = (async (): Promise<ListenResult> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      // A Stop tap during mic acquisition must cancel, not strand the
      // recorder for the full window.
      if (stoppedEarly) throw new Error("mic recording stopped before it started");
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      const stopped = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event: BlobEvent) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onerror = () => reject(new Error("mic recording failed"));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
      });
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (recorder.state !== "inactive") recorder.stop();
      };
      stopRecording = finish;
      const timer = window.setTimeout(finish, maxMs);
      recorder.start(250);
      const blob = await stopped;
      if (blob.size === 0) throw new Error("mic recording was empty");
      return { blob };
    } finally {
      for (const track of stream.getTracks()) track.stop();
    }
  })();
  return { done, stop: () => stopRecording() };
}

/** Which ASR engine answered: Muse (primary), Fish (flagged backup), or unknown (older stub). */
export type TranscribeProvider = "muse" | "fish" | "unknown";

export interface TranscribeResult {
  text: string;
  providerUsed: TranscribeProvider;
}

/** Transcribe one mic clip; returns raw text (possibly empty) plus which engine answered. */
export async function transcribeClip(blob: Blob, signal?: AbortSignal): Promise<TranscribeResult> {
  const form = new FormData();
  form.append("audio", blob, "mic.webm");
  const response = await fetch("/api/voice/transcribe", {
    method: "POST",
    headers: { [WALKTHROUGH_CLIENT_HEADER]: WALKTHROUGH_CLIENT_ID },
    body: form,
    signal,
  });
  if (!response.ok) throw new Error(`voice transcribe ${response.status}`);
  const body: unknown = await response.json().catch(() => null);
  const text = typeof body === "object" && body !== null ? (body as { text?: unknown }).text : undefined;
  const providerUsed = typeof body === "object" && body !== null ? (body as { providerUsed?: unknown }).providerUsed : undefined;
  return {
    text: typeof text === "string" ? text : "",
    providerUsed: providerUsed === "muse" || providerUsed === "fish" ? providerUsed : "unknown",
  };
}
