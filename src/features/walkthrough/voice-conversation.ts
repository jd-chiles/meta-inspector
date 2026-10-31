/**
 * Turn-based voice conversation: speak a prompt (Fish Audio server voice,
 * falling back to the device voice when unconfigured), record one mic
 * answer, transcribe it server-side. Every voice turn has a tap fallback
 * in the UI; this module never blocks on voice availability.
 */
import { WALKTHROUGH_CLIENT_HEADER, WALKTHROUGH_CLIENT_ID } from "../../domain/walkthrough-client";

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
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      // Never hang the conversation on a stuck voice engine.
      window.setTimeout(resolve, Math.min(30_000, 3000 + text.length * 120));
    } catch {
      resolve();
    }
  });
}

/** Speak one prompt; resolves with the engine that spoke. Aborted on signal. */
export async function speakPrompt(text: string, signal?: AbortSignal): Promise<SpeakResult> {
  if (signal?.aborted) return { engine: "none" };
  try {
    const response = await fetch("/api/voice/speak", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [WALKTHROUGH_CLIENT_HEADER]: WALKTHROUGH_CLIENT_ID,
      },
      body: JSON.stringify({ text: text.slice(0, 500) }),
      signal,
    });
    if (!response.ok) throw new Error(`voice speak ${response.status}`);
    const blob = await response.blob();
    if (blob.size === 0) throw new Error("voice speak empty");
    const url = URL.createObjectURL(blob);
    try {
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(url);
        const onAbort = () => {
          audio.pause();
          reject(new DOMException("aborted", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        audio.onended = () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        audio.onerror = () => {
          signal?.removeEventListener("abort", onAbort);
          reject(new Error("voice playback failed"));
        };
        void audio.play().catch(reject);
      });
      return { engine: "fish" };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (signal?.aborted) return { engine: "none" };
    stopDeviceSpeech();
    await speakWithDeviceVoice(text);
    if (signal?.aborted) return { engine: "none" };
    return { engine: "device" };
  }
}

export interface ListenResult {
  blob: Blob;
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
  let stopRecording: () => void = () => undefined;
  const done = (async (): Promise<ListenResult> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
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

/** Transcribe one mic clip; returns raw text (possibly empty). */
export async function transcribeClip(blob: Blob, signal?: AbortSignal): Promise<string> {
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
  return typeof text === "string" ? text : "";
}
