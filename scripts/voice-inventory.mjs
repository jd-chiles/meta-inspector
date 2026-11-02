/**
 * Single source of truth for pre-generated voice clips: every static string
 * the app speaks through Fish Audio (tour scripts, setup questions, room
 * checks, filming cues). Dynamic scripts (film-room position, live proofs,
 * review-item excerpts, finish counts) stay live with a server-side cache.
 *
 * Playback matches by exact text: stay in sync with the sources named per
 * entry. tests/unit/walkthrough/voice-inventory.test.ts guards every entry
 * against its source; a drifted string safely falls back to live speech.
 */
import { createHash } from "node:crypto";

const TOUR_STATIC = [
  // tourScriptForNode welcome/consent/analyze + finish with zero missing.
  "I will guide this inspection step by step. You film each room, answer a few questions by voice, and review the A I drafts. About ten minutes. Tap Start when you are ready.",
  "Quick consent before we film. This demo inspects a staged mock unit only, with no tenants, faces, or real case data. Each clip you film is sent to Meta for A I analysis. Tap I understand, let's film, to continue.",
  "Every room is filmed. Sending your clips for A I analysis now. This takes a few minutes. Stay on this screen.",
  "Inspection complete. Every requirement is decided. Head to sign-off to review the result and export.",
];

const SETUP_QUESTIONS = [
  // GuidedTourView ask-name / ask-unit / ask-baths + capture setup voice.
  "Your name goes on each decision. What is your name?",
  "What type of unit is it?",
  "What type of unit is this? Say studio, or how many bedrooms.",
  "How many bathrooms?",
];

const ROOM_CHECKS = [
  // VOICE_ROOM_CHECKS, every room type.
  "Turn on the faucet. Is hot water running clear?",
  "Is the cooking and food storage area usable?",
  "Flush the toilet. Is everything working?",
  "Do the windows and door locks work?",
  "Is there a working smoke detector in or near this room?",
  "Turn on the heat or cooling. Is it working?",
  "Is the exit path clear and usable?",
  "Is there a working smoke detector along this path?",
];

const FILMING_CUES = [
  // ASSISTANT_FILMING_SCRIPTS, raw spoken form per room type.
  "Recording. First, run the kitchen faucet and show the water flow and drainage.",
  "Now pan across the sink, counters, and outlets.",
  "Open the entry door and test its lock.",
  "Finally, show the smoke or carbon monoxide detector and its indicator light.",
  "Recording. First, run the bathroom faucet and show the flow and drainage.",
  "Now show the toilet, sink, and surfaces.",
  "Show the ventilation fan running.",
  "Finally, show the smoke or carbon monoxide detector.",
  "Recording. First, walk the bedroom showing walls and floors.",
  "Now show the windows, locks, and heating or cooling equipment.",
  "Show the light fixtures and outlets.",
  "Recording. First, walk the living room showing walls and floors.",
  "Recording. First, walk the full hallway showing the exit path.",
  "Now show the exit door and any secondary exit or fire escape window.",
  "Show the lighting along the path.",
];

/** Every static spoken string, deduplicated, in stable generation order. */
export const VOICE_CLIP_TEXTS = [...new Set([...TOUR_STATIC, ...SETUP_QUESTIONS, ...ROOM_CHECKS, ...FILMING_CUES])];

/** Normalize exactly like the client lookup: trim only, never reword. */
export function normalizeVoiceText(text) {
  return text.trim();
}

/**
 * Content id for one clip: first 16 hex chars of sha256(trimmed text).
 * The client recomputes this with SubtleCrypto; keep the algorithm in sync.
 */
export function voiceClipId(text) {
  return createHash("sha256").update(normalizeVoiceText(text), "utf8").digest("hex").slice(0, 16);
}

/** Static asset path served from public/voice. */
export function voiceClipFile(text) {
  return `${voiceClipId(text)}.mp3`;
}
