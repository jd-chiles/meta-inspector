#!/usr/bin/env node
/**
 * Live Meta smoke runner (REQ-003, REQ-010, REQ-011).
 *
 * Default (live) path — coordinator-side only, exactly one authorized call:
 *   1. Reads META_API_KEY from process env only (never from .env files,
 *      never logged, never echoed).
 *   2. Starts a production-build Next.js server in live mode
 *      (APP_ANALYSIS_MODE=live) on 127.0.0.1.
 *   3. POSTs one rights-cleared JPEG as multipart to /api/analyze for the
 *      demo-smoke-co item (same-origin: no Origin header is sent).
 *   4. Asserts HTTP 200 plus a strictly valid draft envelope whose mode is
 *      "live" and which carries no verdict fields.
 *   5. Prints SANITIZED evidence only (model, mode, requestId, latencyMs,
 *      sha256 of the canonical bytes, image dimensions) and exits 0.
 *
 * Fail-closed behavior: without META_API_KEY the runner exits 1 with an
 * explicit message. There is no fixture fallback and no fixture success
 * claim. A missing/unreadable smoke image is also a hard failure.
 *
 * Self-test path (no network, no key required):
 *   node tests/live/smoke.mjs --self-test
 * Verifies the fail-closed key gate and the strict response-shape validator
 * with pure in-memory cases only. Never spawns a server, never fetches.
 *
 * Coordinator live execution:
 *   server command : this runner starts `npx next start` on 127.0.0.1
 *                    (production build required; run `npm run build` first)
 *   env inputs     : META_API_KEY (names only; value stays in process env),
 *                    APP_ANALYSIS_MODE is forced to "live" by the runner,
 *                    SMOKE_IMAGE (optional JPEG path),
 *                    SMOKE_PORT (optional server port)
 *   sanitized output fields: model, mode, requestId, latencyMs, sha256,
 *                    width, height
 *
 * Logging discipline: never logs key material, key presence, provider
 * request/response bodies, or image bytes. Error output carries status
 * codes and field-name reasons only.
 */

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------------------------------------------------------------------------
// Constants (names only; no secret values anywhere in this file).
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ITEM_ID = "demo-smoke-co";
const DEFAULT_IMAGE_PATH = "/tmp/live-smoke-detector.jpg";
const DEFAULT_PORT = 3200;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SERVER_READY_TIMEOUT_MS = 30_000;
const SERVER_POLL_INTERVAL_MS = 500;
const ANALYZE_TIMEOUT_MS = 60_000;

const DRAFT_KEYS = new Set([
  "observation",
  "visibleEvidence",
  "unknowns",
  "suggestedManualChecks",
]);

const ENVELOPE_KEYS = new Set([
  "analysisId",
  "sessionId",
  "itemId",
  "catalogVersion",
  "mediaId",
  "mediaHash",
  "model",
  "mode",
  "requestId",
  "latencyMs",
  "draft",
]);

const RESPONSE_KEYS = new Set([
  "envelope",
  "normalizedMedia",
  "mode",
  "model",
  "requestId",
  "latencyMs",
]);

const NORMALIZED_MEDIA_KEYS = new Set([
  "mediaId",
  "mime",
  "width",
  "height",
  "digest",
  "base64",
  "targetWidth",
  "targetHeight",
  "resampleRequired",
  "pixelTransposeRequired",
]);

/** Verdict-like fields rejected everywhere (REQ-004). */
const FORBIDDEN_KEYS = new Set([
  "verdict",
  "confidence",
  "approved",
  "deficient",
  "deficiency",
  "pass",
  "fail",
  "habitability",
  "habitable",
  "compliant",
  "nonCompliant",
  "score",
  "rating",
  "decision",
  "certification",
  "formVerdict",
]);

const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MEDIA_HASH_PATTERN = /^[0-9a-f]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

// ---------------------------------------------------------------------------
// Pure helpers (also exercised by --self-test; no I/O, no network).
// ---------------------------------------------------------------------------

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Read the live bearer from process env only. Returns the trimmed key or
 * null when absent/blank. Never logs anything; callers must not log the
 * return value or whether it was present outside the fail-closed message.
 */
export function readLiveKey(env) {
  const raw = env?.META_API_KEY;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Fail-closed gate: null when the live call may proceed, else the reason. */
export function liveBlockedReason(env) {
  return readLiveKey(env) === null ? "missing-key" : null;
}

function checkStringList(errors, where, value) {
  if (!Array.isArray(value)) {
    errors.push(`${where}: must be an array of 0-5 strings`);
    return null;
  }
  if (value.length > 5) {
    errors.push(`${where}: must hold at most 5 entries`);
    return null;
  }
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== "string" || entry.length > 200) {
      errors.push(`${where}[${index}]: must be a string of at most 200 characters`);
      return null;
    }
  }
  return value;
}

function validateDraftShape(errors, draft) {
  if (!isRecord(draft)) {
    errors.push("envelope.draft: must be an object");
    return null;
  }
  for (const key of Object.keys(draft)) {
    if (FORBIDDEN_KEYS.has(key)) {
      errors.push(`envelope.draft: forbidden field "${key}" (no verdict fields)`);
    } else if (!DRAFT_KEYS.has(key)) {
      errors.push(`envelope.draft: unexpected field "${key}"`);
    }
  }
  let observation = null;
  let visible = null;
  let unknowns = null;
  let suggested = null;
  if (
    typeof draft.observation !== "string" ||
    draft.observation.trim().length === 0 ||
    draft.observation.length > 600
  ) {
    errors.push('envelope.draft: "observation" must be 1-600 characters');
  } else {
    observation = draft.observation;
  }
  visible = checkStringList(errors, 'envelope.draft: "visibleEvidence"', draft.visibleEvidence);
  unknowns = checkStringList(errors, 'envelope.draft: "unknowns"', draft.unknowns);
  suggested = checkStringList(
    errors,
    'envelope.draft: "suggestedManualChecks"',
    draft.suggestedManualChecks,
  );
  if (
    errors.length === 0 &&
    visible !== null &&
    unknowns !== null &&
    suggested !== null &&
    visible.length === 0 &&
    unknowns.length === 0 &&
    suggested.length === 0
  ) {
    errors.push("envelope.draft: unusable empty output");
  }
  if (errors.length > 0 || observation === null || visible === null || unknowns === null || suggested === null) {
    return null;
  }
  return { observation, visibleEvidence: visible, unknowns, suggestedManualChecks: suggested };
}

/**
 * Strictly validate a live /api/analyze success body. Live-only: top-level
 * and envelope mode must both be "live", and fixtureNotice must be absent
 * (fixture output must never stand in for live inference). Returns
 * { ok, errors, evidence } where evidence holds sanitized fields only.
 * Error strings reference field names, never provider content.
 */
export function validateLiveResponse(body) {
  const errors = [];
  if (!isRecord(body)) {
    return { ok: false, errors: ["response: must be an object"] };
  }
  for (const key of Object.keys(body)) {
    if (!RESPONSE_KEYS.has(key)) {
      errors.push(`response: unexpected field "${key}"`);
    }
  }
  if ("fixtureNotice" in body) {
    errors.push("response: fixtureNotice present (fixture output is not live inference)");
  }
  if (body.mode !== "live") {
    errors.push('response: "mode" must be "live"');
  }
  if (!isNonEmptyString(body.model)) {
    errors.push('response: "model" must be a non-empty string');
  }
  if (!isNonEmptyString(body.requestId)) {
    errors.push('response: "requestId" must be a non-empty string');
  }
  if (typeof body.latencyMs !== "number" || !Number.isFinite(body.latencyMs) || body.latencyMs < 0) {
    errors.push('response: "latencyMs" must be a finite number >= 0');
  }

  const envelope = body.envelope;
  if (!isRecord(envelope)) {
    errors.push("response: envelope must be an object");
    return { ok: false, errors };
  }
  for (const key of Object.keys(envelope)) {
    if (FORBIDDEN_KEYS.has(key)) {
      errors.push(`envelope: forbidden field "${key}" (no verdict fields)`);
    } else if (!ENVELOPE_KEYS.has(key)) {
      errors.push(`envelope: unexpected field "${key}"`);
    }
  }
  for (const key of ["analysisId", "sessionId", "itemId", "mediaId", "model", "requestId"]) {
    if (!isNonEmptyString(envelope[key])) {
      errors.push(`envelope: "${key}" must be a non-empty string`);
    }
  }
  if (typeof envelope.catalogVersion !== "string" || !VERSION_PATTERN.test(envelope.catalogVersion)) {
    errors.push('envelope: "catalogVersion" must look like "1.2.3"');
  }
  if (typeof envelope.mediaHash !== "string" || !MEDIA_HASH_PATTERN.test(envelope.mediaHash)) {
    errors.push('envelope: "mediaHash" must be a SHA-256 hex digest (64 hex characters)');
  }
  if (envelope.mode !== "live") {
    errors.push('envelope: "mode" must be "live"');
  }
  if (
    typeof envelope.latencyMs !== "number" ||
    !Number.isFinite(envelope.latencyMs) ||
    envelope.latencyMs < 0
  ) {
    errors.push('envelope: "latencyMs" must be a finite number >= 0');
  }
  if (envelope.itemId !== ITEM_ID) {
    errors.push(`envelope: "itemId" must be "${ITEM_ID}"`);
  }
  const draft = validateDraftShape(errors, envelope.draft);
  if (errors.length > 0 || draft === null) {
    return { ok: false, errors };
  }

  const media = body.normalizedMedia;
  if (!isRecord(media)) {
    return { ok: false, errors: ["response: normalizedMedia must be an object"] };
  }
  for (const key of Object.keys(media)) {
    if (!NORMALIZED_MEDIA_KEYS.has(key)) {
      errors.push(`normalizedMedia: unexpected field "${key}"`);
    }
  }
  if (!isNonEmptyString(media.mediaId)) {
    errors.push('normalizedMedia: "mediaId" must be a non-empty string');
  }
  if (typeof media.mime !== "string" || !ALLOWED_MIMES.has(media.mime)) {
    errors.push('normalizedMedia: "mime" must be an allowed image MIME');
  }
  for (const key of ["width", "height"]) {
    if (typeof media[key] !== "number" || !Number.isInteger(media[key]) || media[key] <= 0) {
      errors.push(`normalizedMedia: "${key}" must be a positive integer`);
    }
  }
  if (typeof media.digest !== "string" || !MEDIA_HASH_PATTERN.test(media.digest)) {
    errors.push('normalizedMedia: "digest" must be a SHA-256 hex digest (64 hex characters)');
  }
  if (typeof media.base64 !== "string" || media.base64.length === 0) {
    errors.push('normalizedMedia: "base64" must be a non-empty string');
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Cross-field consistency (IDs and provenance must agree).
  if (media.mediaId !== envelope.mediaId) {
    errors.push("response: normalizedMedia.mediaId must match envelope.mediaId");
  }
  if (media.digest.toLowerCase() !== envelope.mediaHash.toLowerCase()) {
    errors.push("response: normalizedMedia.digest must match envelope.mediaHash");
  }
  if (body.requestId !== envelope.requestId) {
    errors.push("response: top-level requestId must match envelope.requestId");
  }
  if (body.model !== envelope.model) {
    errors.push("response: top-level model must match envelope.model");
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Canonical-bytes digest: decode once, hash, compare. The bytes themselves
  // are never logged; only the hex digest leaves this function.
  let canonical;
  try {
    canonical = Buffer.from(media.base64, "base64");
  } catch {
    return { ok: false, errors: ["response: normalizedMedia.base64 is not decodable"] };
  }
  if (canonical.length === 0) {
    return { ok: false, errors: ["response: canonical bytes are empty"] };
  }
  const sha256 = createHash("sha256").update(canonical).digest("hex");
  if (sha256 !== media.digest.toLowerCase()) {
    return { ok: false, errors: ["response: sha256 of canonical bytes must match digest"] };
  }

  return {
    ok: true,
    errors: [],
    evidence: {
      model: envelope.model,
      mode: "live",
      requestId: envelope.requestId,
      latencyMs: envelope.latencyMs,
      sha256,
      width: media.width,
      height: media.height,
    },
  };
}

// ---------------------------------------------------------------------------
// --self-test (pure, no network, no key required).
// ---------------------------------------------------------------------------

function selfTestEnvelope(overrides = {}) {
  const mediaHash = createHash("sha256").update("canonical-bytes").digest("hex");
  return {
    analysisId: "analysis-selftest-1",
    sessionId: "session-selftest-1",
    itemId: ITEM_ID,
    catalogVersion: "0.2.0-demo.1",
    mediaId: "media-selftest-1",
    mediaHash,
    model: "muse-spark-1.3",
    mode: "live",
    requestId: "req-selftest-1",
    latencyMs: 123,
    draft: {
      observation: "A small white alarm unit is mounted on the ceiling.",
      visibleEvidence: ["round unit on the ceiling"],
      unknowns: ["Whether the alarm sounds cannot be told from the photo."],
      suggestedManualChecks: ["Press the test button and confirm the alarm sounds."],
    },
    ...overrides,
  };
}

function selfTestBody(overrides = {}) {
  const mediaHash = createHash("sha256").update("canonical-bytes").digest("hex");
  const canonicalB64 = Buffer.from("canonical-bytes").toString("base64");
  const envelope = selfTestEnvelope();
  return {
    envelope,
    normalizedMedia: {
      mediaId: envelope.mediaId,
      mime: "image/jpeg",
      width: 800,
      height: 600,
      digest: mediaHash,
      base64: canonicalB64,
      targetWidth: 800,
      targetHeight: 600,
      resampleRequired: false,
      pixelTransposeRequired: false,
    },
    mode: "live",
    model: envelope.model,
    requestId: envelope.requestId,
    latencyMs: envelope.latencyMs,
    ...overrides,
  };
}

function runSelfTest() {
  const results = [];
  const check = (name, fn) => {
    try {
      const detail = fn();
      results.push({ name, pass: detail === true, detail: detail === true ? "" : String(detail) });
    } catch (error) {
      results.push({ name, pass: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };

  // Fail-closed gate: no key (or blank key) blocks; a set key proceeds.
  // Assertions compare gate outcomes only — key values are never printed.
  check("fail-closed: missing key blocks", () => liveBlockedReason({}) === "missing-key");
  check("fail-closed: blank key blocks", () => liveBlockedReason({ META_API_KEY: "   " }) === "missing-key");
  check("fail-closed: non-string key blocks", () => liveBlockedReason({ META_API_KEY: 42 }) === "missing-key");
  check("fail-closed: set key proceeds", () => liveBlockedReason({ META_API_KEY: "k" }) === null);
  check("fail-closed: surrounding whitespace trimmed", () => readLiveKey({ META_API_KEY: "  k  " }) === "k");

  // Shape validation: one valid body plus strict rejections.
  check("shape: valid live body passes", () => {
    const result = validateLiveResponse(selfTestBody());
    return result.ok === true && result.evidence?.mode === "live";
  });
  check("shape: verdict field in draft rejected", () => {
    const envelope = selfTestEnvelope({
      draft: {
        observation: "Unit visible.",
        visibleEvidence: ["unit"],
        unknowns: ["Sound unknown."],
        suggestedManualChecks: ["Press the test button."],
        verdict: "pass",
      },
    });
    const result = validateLiveResponse(selfTestBody({ envelope }));
    return result.ok === false;
  });
  check("shape: verdict field at envelope level rejected", () => {
    const envelope = { ...selfTestEnvelope(), compliant: true };
    const result = validateLiveResponse(selfTestBody({ envelope }));
    return result.ok === false;
  });
  check("shape: unexpected envelope field rejected", () => {
    const envelope = { ...selfTestEnvelope(), extra: 1 };
    const result = validateLiveResponse(selfTestBody({ envelope }));
    return result.ok === false;
  });
  check("shape: fixture mode rejected in live smoke", () => {
    const envelope = selfTestEnvelope({ mode: "fixture" });
    const result = validateLiveResponse(selfTestBody({ envelope, mode: "fixture" }));
    return result.ok === false;
  });
  check("shape: fixtureNotice rejected", () => {
    const result = validateLiveResponse(selfTestBody({ fixtureNotice: "Fixture output." }));
    return result.ok === false;
  });
  check("shape: wrong item rejected", () => {
    const envelope = selfTestEnvelope({ itemId: "demo-water-supply" });
    const result = validateLiveResponse(selfTestBody({ envelope }));
    return result.ok === false;
  });
  check("shape: malformed mediaHash rejected", () => {
    const envelope = selfTestEnvelope({ mediaHash: "not-a-hash" });
    const result = validateLiveResponse(selfTestBody({ envelope }));
    return result.ok === false;
  });
  check("shape: empty draft rejected", () => {
    const envelope = selfTestEnvelope({
      draft: { observation: "Unit visible.", visibleEvidence: [], unknowns: [], suggestedManualChecks: [] },
    });
    const result = validateLiveResponse(selfTestBody({ envelope }));
    return result.ok === false;
  });
  check("shape: oversized observation rejected", () => {
    const envelope = selfTestEnvelope({
      draft: {
        observation: "x".repeat(601),
        visibleEvidence: ["unit"],
        unknowns: ["Sound unknown."],
        suggestedManualChecks: ["Press the test button."],
      },
    });
    const result = validateLiveResponse(selfTestBody({ envelope }));
    return result.ok === false;
  });
  check("shape: digest mismatch rejected", () => {
    const body = selfTestBody();
    const tampered = {
      ...body,
      normalizedMedia: { ...body.normalizedMedia, base64: Buffer.from("other-bytes").toString("base64") },
    };
    const result = validateLiveResponse(tampered);
    return result.ok === false;
  });
  check("shape: mismatched requestId rejected", () => {
    const result = validateLiveResponse(selfTestBody({ requestId: "req-other" }));
    return result.ok === false;
  });
  check("shape: errors never echo untrusted values", () => {
    const sentinel = `sentinel-${"x".repeat(590)}-tail`;
    const envelope = selfTestEnvelope({
      draft: {
        observation: sentinel,
        visibleEvidence: ["unit"],
        unknowns: ["Sound unknown."],
        suggestedManualChecks: ["Press the test button."],
      },
    });
    const result = validateLiveResponse(selfTestBody({ envelope }));
    if (result.ok !== false) return "expected rejection";
    return !result.errors.join(";").includes(sentinel);
  });

  const passed = results.filter((entry) => entry.pass).length;
  for (const entry of results) {
    if (!entry.pass) {
      console.error(`test:live --self-test FAILED: ${entry.name}${entry.detail ? ` (${entry.detail})` : ""}`);
    }
  }
  if (passed === results.length) {
    console.log(`test:live --self-test: ${passed}/${results.length} checks passed (no network, no key required).`);
    process.exit(0);
  } else {
    console.error(`test:live --self-test: ${passed}/${results.length} checks passed.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Live path (coordinator-side only).
// ---------------------------------------------------------------------------

function readCatalogVersion() {
  try {
    const raw = readFileSync(path.join(REPO_ROOT, "src", "data", "catalog.demo.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.version === "string" && VERSION_PATTERN.test(parsed.version)) {
      return parsed.version;
    }
    return null;
  } catch {
    return null;
  }
}

function readImageBytes(imagePath) {
  try {
    const bytes = readFileSync(imagePath);
    return bytes;
  } catch {
    return null;
  }
}

async function waitForServerReady(baseUrl) {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  for (;;) {
    try {
      const response = await fetch(baseUrl, { method: "GET", signal: AbortSignal.timeout(5000) });
      await response.arrayBuffer().catch(() => undefined);
      if (response.ok) return true;
    } catch {
      // Server not up yet; keep polling until the deadline.
    }
    if (Date.now() >= deadline) return false;
    await delay(SERVER_POLL_INTERVAL_MS);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--self-test")) {
    runSelfTest();
    return;
  }

  // Fail closed without credentials: explicit message, exit 1, no fixture
  // fallback, no fixture success claim, no live call attempted.
  if (liveBlockedReason(process.env) !== null) {
    console.error(
      "test:live BLOCKED: META_API_KEY is not set. " +
        "Live Meta smoke requires server-only credentials and rights-cleared media; " +
        "fixture output must never stand in for live inference. " +
        "Set META_API_KEY in the environment (name only on the command line; never commit values) " +
        `and provide a rights-cleared JPEG at SMOKE_IMAGE (default ${DEFAULT_IMAGE_PATH}). ` +
        "No live call was attempted.",
    );
    process.exit(1);
  }

  const imagePath = process.env.SMOKE_IMAGE?.trim() || DEFAULT_IMAGE_PATH;
  const imageBytes = readImageBytes(imagePath);
  if (imageBytes === null || imageBytes.length === 0) {
    console.error(
      `test:live FAILED: smoke image not found or empty at SMOKE_IMAGE path "${imagePath}". ` +
        "Provide a rights-cleared JPEG outside the repo (default /tmp/live-smoke-detector.jpg). " +
        "No fixture substitution was made.",
    );
    process.exit(1);
  }
  if (imageBytes.length > MAX_IMAGE_BYTES) {
    console.error(
      "test:live FAILED: smoke image exceeds the 8 MiB upload bound. Choose a smaller rights-cleared photo.",
    );
    process.exit(1);
  }

  const catalogVersion = readCatalogVersion();
  if (catalogVersion === null) {
    console.error("test:live FAILED: demo catalog version is unreadable; run from the repo root.");
    process.exit(1);
  }

  const port = Number.parseInt(process.env.SMOKE_PORT?.trim() || String(DEFAULT_PORT), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error("test:live FAILED: SMOKE_PORT must be a valid TCP port number.");
    process.exit(1);
  }
  const baseUrl = `http://127.0.0.1:${port}`;

  // Production-build server in live mode. The key travels via process env
  // only and is never printed. Build must already exist (`npm run build`).
  const child = spawn("npx", ["--no-install", "next", "start", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: REPO_ROOT,
    env: { ...process.env, APP_ANALYSIS_MODE: "live", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let tail = "";
  const remember = (chunk) => {
    tail += String(chunk);
    if (tail.length > 4000) tail = tail.slice(-4000);
  };
  child.stdout?.on("data", remember);
  child.stderr?.on("data", remember);
  // A spawn failure surfaces via the readiness timeout (explicit build-first
  // message); never let an unhandled 'error' event crash the runner.
  child.once("error", remember);

  const stopServer = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
      const killTimer = globalThis.setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already exited.
        }
        resolve();
      }, 5000);
      if (typeof killTimer.unref === "function") killTimer.unref();
    });

  let exitCode = 1;
  try {
    const ready = await waitForServerReady(baseUrl);
    if (ready !== true) {
      console.error(
        "test:live FAILED: production server did not become ready. " +
          "Run `npm run build` first, then retry. Server output tail: " +
          (tail.trim().length > 0 ? tail.trim().slice(-1000) : "(no output)"),
      );
      process.exitCode = 1;
      return;
    }

    const sessionId = `live-smoke-${randomUUID()}`;
    const analysisId = `live-smoke-analysis-${randomUUID()}`;
    const form = new FormData();
    form.set("sessionId", sessionId);
    form.set("itemId", ITEM_ID);
    form.set("catalogVersion", catalogVersion);
    form.set("analysisId", analysisId);
    form.set("image", new Blob([imageBytes], { type: "image/jpeg" }), "live-smoke-detector.jpg");

    let response;
    try {
      response = await fetch(`${baseUrl}/api/analyze`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
      });
    } catch {
      console.error("test:live FAILED: analyze request timed out or was unreachable (single attempt, no retry).");
      process.exitCode = 1;
      return;
    }

    if (response.status !== 200) {
      let code = "unknown";
      try {
        const failure = await response.json();
        if (isRecord(failure?.error) && typeof failure.error.code === "string") {
          code = failure.error.code;
        }
      } catch {
        // Error body is not JSON; report the status only.
      }
      console.error(`test:live FAILED: expected HTTP 200, got HTTP ${response.status} (code ${code}).`);
      process.exitCode = 1;
      return;
    }

    let body;
    try {
      body = await response.json();
    } catch {
      console.error("test:live FAILED: analyze response was not JSON.");
      process.exitCode = 1;
      return;
    }

    const checked = validateLiveResponse(body);
    if (checked.ok !== true || !checked.evidence) {
      console.error(`test:live FAILED: strict envelope validation failed: ${checked.errors.join("; ")}`);
      process.exitCode = 1;
      return;
    }

    // Sanitized evidence only: no key material, no key presence, no
    // provider bodies, no image bytes.
    console.log(JSON.stringify(checked.evidence));
    exitCode = 0;
    process.exitCode = 0;
  } finally {
    await stopServer();
    process.exit(exitCode);
  }
}

await main();
