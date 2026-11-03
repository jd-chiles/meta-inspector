#!/usr/bin/env node
/**
 * Pre-generate the fixed voice script into public/voice/*.mp3 + manifest.json.
 * One Fish TTS call per static clip; clips are content-addressed by text hash,
 * so reruns only synthesize changed or missing clips. Dynamic prompts (room
 * position, live proofs, review excerpts) stay live with a server-side cache.
 *
 * Usage: FISH_API_KEY=... FISH_VOICE_ID=... node scripts/generate-voice.mjs [--force] [--lang en|es]
 * Spanish clips (--lang es) use FISH_VOICE_ID_ES and land in public/voice/es/.
 * Requires owner approval: every synthesized clip is a billed provider call.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { VOICE_CLIP_TEXTS, VOICE_CLIP_TEXTS_ES, normalizeVoiceText, voiceClipFile, voiceClipId } from "./voice-inventory.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function langDir(lang) {
  return lang === "es" ? join(ROOT, "public", "voice", "es") : join(ROOT, "public", "voice");
}
const FISH_TTS_URL = "https://api.fish.audio/v1/tts";
const MAX_CLIP_BYTES = 5 * 1024 * 1024;

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sniffMp3(bytes) {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true; // ID3
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0; // frame sync
}

async function synthesize(text, { apiKey, voiceId, model }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(FISH_TTS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        model,
      },
      body: JSON.stringify({
        text,
        reference_id: voiceId,
        format: "mp3",
        mp3_bitrate: 128,
        normalize: true,
        latency: "normal",
      }),
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error("Fish rejected the API key (401/403). Check FISH_API_KEY / FISH_VOICE_ID.");
    }
    if (response.status === 402) throw new Error("Fish quota exceeded (402).");
    if (!response.ok) throw new Error(`Fish TTS failed with status ${response.status}.`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_CLIP_BYTES) {
      throw new Error(`Fish returned ${buffer.byteLength} bytes; expected 1–${MAX_CLIP_BYTES}.`);
    }
    if (!sniffMp3(buffer)) throw new Error("Fish did not return MP3 bytes.");
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const langFlag = process.argv.indexOf("--lang");
  const lang = langFlag >= 0 ? (process.argv[langFlag + 1] ?? "") : "en";
  if (lang !== "en" && lang !== "es") {
    console.error('Unknown --lang. Use "--lang en" or "--lang es".');
    process.exit(1);
  }
  const texts = lang === "es" ? VOICE_CLIP_TEXTS_ES : VOICE_CLIP_TEXTS;
  const voiceEnv = lang === "es" ? "FISH_VOICE_ID_ES" : "FISH_VOICE_ID";
  const apiKey = (process.env.FISH_API_KEY ?? "").trim();
  const voiceId = (process.env[voiceEnv] ?? "").trim();
  const model = (process.env.FISH_MODEL ?? "").trim() || "s2.1-pro-free";
  if (!apiKey || !voiceId) {
    console.error(`Set FISH_API_KEY and ${voiceEnv} to generate voice clips.`);
    process.exit(1);
  }
  const VOICE_DIR = langDir(lang);
  const MANIFEST_PATH = join(VOICE_DIR, "manifest.json");
  await mkdir(VOICE_DIR, { recursive: true });
  // The manifest pins a voice hash, never the raw id: it ships in public/.
  const voiceHash = sha256Hex(Buffer.from(voiceId, "utf8"));
  let manifest = { version: 1, voiceHash, model, clips: {} };
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && parsed.clips && typeof parsed.clips === "object") manifest = parsed;
  } catch {
    // Missing or unreadable manifest: regenerate everything.
  }
  if (manifest.voiceHash !== voiceHash || manifest.model !== model) {
    if (!force) {
      console.error("Manifest pins a different voice or model; rerun with --force to regenerate.");
      process.exit(1);
    }
    manifest = { version: 1, voiceHash, model, clips: {} };
  }
  const clips = {};
  let synthesized = 0;
  let reused = 0;
  for (const rawText of texts) {
    const text = normalizeVoiceText(rawText);
    const id = voiceClipId(text);
    const file = voiceClipFile(text);
    const existing = !force ? manifest.clips[id] : undefined;
    if (existing && typeof existing.sha256 === "string") {
      try {
        const current = await readFile(join(VOICE_DIR, file));
        if (sha256Hex(current) === existing.sha256 && sniffMp3(current)) {
          clips[id] = { ...existing, chars: text.length };
          reused += 1;
          continue;
        }
      } catch {
        // Missing or changed bytes: synthesize below.
      }
    }
    const audio = await synthesize(text, { apiKey, voiceId, model });
    await writeFile(join(VOICE_DIR, file), audio);
    clips[id] = { sha256: sha256Hex(audio), bytes: audio.byteLength, chars: text.length };
    synthesized += 1;
    console.log(`synthesized ${file} (${audio.byteLength} bytes): ${text.slice(0, 60)}…`);
  }
  await writeFile(MANIFEST_PATH, `${JSON.stringify({ version: 1, voiceHash, model, clips }, null, 2)}\n`);
  console.log(`voice clips (${lang}): ${synthesized} synthesized, ${reused} reused, ${texts.length} total`);
}

await main();
