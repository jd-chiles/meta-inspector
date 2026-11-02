/**
 * Static-first voice lookup. The fixed guide script is pre-generated into
 * public/voice/<clip-id>.mp3 (scripts/generate-voice.mjs); this module maps
 * exact spoken text to its clip via the same content id the script writes.
 * Anything missing — dynamic scripts, an undeployed manifest — resolves to
 * null so the caller falls back to live speech. Safe no-ops outside a
 * browser with SubtleCrypto.
 */
export interface VoiceClipManifest {
  version: 1;
  clips: Record<string, { chars: number }>;
}

const MANIFEST_URL = "/voice/manifest.json";

let manifestPromise: Promise<VoiceClipManifest | null> | null = null;

/** Test-only reset for the memoized manifest fetch. */
export function __resetVoiceManifestForTests(): void {
  manifestPromise = null;
}

function parseManifest(value: unknown): VoiceClipManifest | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as { version?: unknown; clips?: unknown };
  if (record.version !== 1 || typeof record.clips !== "object" || record.clips === null) return null;
  return { version: 1, clips: record.clips as Record<string, { chars: number }> };
}

function loadManifest(fetchImpl: typeof fetch): Promise<VoiceClipManifest | null> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      try {
        const response = await fetchImpl(MANIFEST_URL, { cache: "force-cache" });
        if (!response.ok) return null;
        return parseManifest(await response.json());
      } catch {
        return null;
      }
    })();
  }
  return manifestPromise;
}

/**
 * Content id for one clip: first 16 hex chars of sha256(trimmed text).
 * Must match voiceClipId in scripts/voice-inventory.mjs exactly.
 */
export async function voiceClipIdForText(text: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text.trim()));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  } catch {
    return null;
  }
}

/** Static clip URL for exact text, or null to speak it live instead. */
export async function staticVoiceUrl(text: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const [manifest, id] = await Promise.all([loadManifest(fetchImpl), voiceClipIdForText(text)]);
  if (!manifest || !id || !manifest.clips[id]) return null;
  return `/voice/${id}.mp3`;
}
