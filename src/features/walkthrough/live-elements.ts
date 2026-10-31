import type {
  EvidenceReference,
  ModelElementProposal,
  MoveInReadyElementId,
  VideoAnalysisIdentity,
} from "../../domain/move-in-ready";
import type { LiveProofMetadata, StoredRoomClipIdentity } from "./inspection-store";

/**
 * The four v2 live-proof elements. Concepts are fixed server-side SAM prompts
 * (see TRACKABLE_CONCEPTS); the client never sends free text to SAM.
 */
export interface LiveElementSpec {
  elementId: MoveInReadyElementId;
  concept: string;
  conceptLabel: string;
  prompt: string;
  recoveryHint: string;
  /** Preferred filming-room id prefixes, in order. */
  roomPreference: readonly string[];
}

export const LIVE_ELEMENT_SPECS: readonly LiveElementSpec[] = [
  {
    elementId: "demo-water-supply",
    concept: "water faucet",
    conceptLabel: "faucet",
    prompt: "Show the sink and turn the faucet on for 3 seconds, then off.",
    recoveryHint: "Move closer to the sink and hold the faucet steady in frame",
    roomPreference: ["kitchen", "bathroom"],
  },
  {
    elementId: "demo-interior-air",
    concept: "ventilation fan",
    conceptLabel: "ventilation fan",
    prompt: "Show the ventilation fan and turn it on so it spins.",
    recoveryHint: "Aim up at the fan and hold still",
    roomPreference: ["bathroom", "kitchen"],
  },
  {
    elementId: "demo-item-07",
    concept: "door lock",
    conceptLabel: "door lock",
    prompt: "Show the door lock, then lock and unlock the door on camera.",
    recoveryHint: "Move closer and hold the lock steady in frame",
    roomPreference: ["hallway", "bedroom", "living"],
  },
  {
    elementId: "demo-smoke-co",
    concept: "smoke detector",
    conceptLabel: "detector",
    prompt: "Show the detector and press its test button until it beeps.",
    recoveryHint: "Pan up toward the ceiling until the detector is in frame",
    roomPreference: ["bedroom", "living", "hallway", "kitchen"],
  },
];

export function liveElementSpec(elementId: MoveInReadyElementId): LiveElementSpec | undefined {
  return LIVE_ELEMENT_SPECS.find((spec) => spec.elementId === elementId);
}

export function isLiveElementId(elementId: string): elementId is MoveInReadyElementId {
  return LIVE_ELEMENT_SPECS.some((spec) => spec.elementId === elementId);
}

/**
 * What the inspector must demonstrate on camera for the proof to mean
 * anything. Shown in drafts so the reviewer knows what to verify.
 */
const PROOF_DEMONSTRATIONS: Record<string, string> = {
  "demo-water-supply": "faucet off-to-on change with water running clear",
  "demo-interior-air": "fan off-to-spinning change",
  "demo-item-07": "door lock locking and unlocking on camera",
  "demo-smoke-co": "detector test press with an audible beep",
};

export interface LiveProofDraftInput {
  spec: LiveElementSpec;
  sessionId: string;
  /** Room label where the clip was filmed, for the observation text. */
  roomLabel: string;
  identity: StoredRoomClipIdentity;
  proof: LiveProofMetadata;
  analysisId: string;
}

/**
 * Assemble an unreviewed draft proposal from a saved live proof clip.
 * Tracking proves the object stayed in frame over time; it does not prove
 * the demonstration happened, so weak tracking falls back to
 * needs-human-check and every draft names itself as unreviewed.
 */
export function buildLiveProofDraft(input: LiveProofDraftInput): ModelElementProposal | null {
  const { spec, sessionId, roomLabel, identity, proof, analysisId } = input;
  const source = identity.evidence[0];
  if (!source) return null;
  const ratio = proof.totalFrames > 0 ? proof.trackedFrames / proof.totalFrames : 0;
  const strong = proof.totalFrames >= 3 && ratio >= 0.5;
  const state = strong ? "draft-proposal" : "needs-human-check";
  const confidence = ratio >= 0.8 && proof.totalFrames >= 5 ? 80
    : ratio >= 0.65 ? 70
    : ratio >= 0.5 ? 60
    : 40;
  const demonstration = PROOF_DEMONSTRATIONS[spec.elementId] ?? "on-camera demonstration";
  const heard = proof.transcriptExcerpt ? ` Inspector narration: "${proof.transcriptExcerpt}".` : "";
  const observation = (
    `Live tracking draft (unreviewed): ${spec.conceptLabel} tracked in ${proof.trackedFrames} of ` +
    `${proof.totalFrames} sampled frames across a ${identity.durationSeconds}s clip filmed in ${roomLabel}.` +
    heard +
    ` Confirm the ${demonstration} happened on camera before deciding.`
  ).slice(0, 600);
  // Proposal stills cite the 1fps sampling frame the live loop reasoned over.
  const frameIndex = Math.max(1, Math.min(30, Math.floor(source.timestampMs / 1000) + 1));
  const evidence: EvidenceReference = { ...source, frameIndex };
  const analysisIdentity: VideoAnalysisIdentity = {
    sessionId,
    roomId: identity.roomId,
    schemaVersion: identity.schemaVersion,
    videoId: identity.videoId,
    videoRevision: identity.videoRevision,
    expectedSourceHash: identity.videoHash,
    analysisId,
    attempt: 1,
    catalogVersion: identity.catalogVersion,
  };
  return {
    elementId: spec.elementId,
    state,
    modelSuggestion: "A",
    observation,
    confidence,
    evidence: [evidence],
    analysisIdentity,
  };
}

/** Pick the best filming room available in this unit for a live element. */
export function filmingRoomForLiveElement(
  spec: LiveElementSpec,
  roomIds: readonly string[],
  fallbackRoomId: string,
): string {
  for (const prefix of spec.roomPreference) {
    const match = roomIds.find((roomId) => roomId === prefix || roomId.startsWith(`${prefix}-`) || roomId.startsWith(prefix));
    if (match) return match;
  }
  return fallbackRoomId;
}
