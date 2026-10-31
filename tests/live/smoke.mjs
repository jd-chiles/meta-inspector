#!/usr/bin/env node
/**
 * Live video API smoke (REQ-003, REQ-010, REQ-011).
 *
 * The default input is the synthetic, rights-cleared MP4 fixture. An explicit
 * SMOKE_VIDEO may point to a regular .mp4 file prepared from staged/mock-unit
 * media with no tenant or personal data. The runner makes exactly one HTTP
 * stage=segment request. It calls stage=map at most once, and only if SAM
 * returns structurally valid candidate evidence; Muse is never retried and
 * the optional Baseten fallback is disabled for this smoke. Unconsumed map
 * leases are released with stage=cancel when possible.
 *
 * This is provider connectivity evidence only. It does not assess video
 * quality, tracking, Form 1083 mapping quality, or the 30-second clip gate.
 *
 * `--self-test` is pure/offline: it does not load .env, read media, start a
 * server, or make any network/provider call.
 */

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NEXT_CLI = path.join(REPO_ROOT, "node_modules", "next", "dist", "bin", "next");
const DEFAULT_VIDEO_PATH = path.join(REPO_ROOT, "tests", "fixtures", "synthetic-h264-test-pattern.mp4");
const DEFAULT_ROOM = "kitchen";
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const SERVER_READY_TIMEOUT_MS = 30_000;
const SERVER_POLL_INTERVAL_MS = 500;
const REQUEST_TIMEOUT_MS = 155_000;
const CANCEL_TIMEOUT_MS = 10_000;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CANDIDATE_ID_PATTERN = /^cand-\d{4}$/;
const TOKEN_MAX_LENGTH = 48 * 1024;
const MAPPING_TTL_MS = 15 * 60 * 1000;
const SAFE_VIDEO_ERROR_CODES = new Set([
  "INVALID_MODEL_OUTPUT", "INVALID_REQUEST", "INVALID_VIDEO", "OPERATION_BUSY", "PROCESSING_BUSY",
  "PROVIDER_FAILURE", "PROVIDER_TIMEOUT", "SETUP_REQUIRED", "STALE_REQUEST", "UNSUPPORTED_VIDEO",
  "VIDEO_TOO_LARGE", "VIDEO_TOO_LONG",
]);
const FORBIDDEN_DRAFT_TEXT = /\b(?:approved|deficient|compliant|noncompliant|pass(?:ed)?|fail(?:ed)?|meets?\s+(?:the\s+)?standards?)\b/i;
const MOVE_IN_READY_SCHEMA_VERSION = 5;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}

function sameIdentity(actual, expected) {
  const keys = [
    "sessionId", "schemaVersion", "videoId", "videoRevision", "analysisId", "attempt", "catalogVersion", "expectedVideoSha256",
  ];
  return exactKeys(actual, keys) &&
    [actual.sessionId, actual.videoId, actual.analysisId].every((value) => typeof value === "string" && APP_ID_PATTERN.test(value)) &&
    actual.schemaVersion === MOVE_IN_READY_SCHEMA_VERSION &&
    typeof actual.catalogVersion === "string" && VERSION_PATTERN.test(actual.catalogVersion) &&
    SHA256_PATTERN.test(actual.expectedVideoSha256) &&
    Number.isSafeInteger(actual.videoRevision) && actual.videoRevision > 0 &&
    Number.isSafeInteger(actual.attempt) && actual.attempt >= 0 &&
    keys.every((key) => actual[key] === expected[key]);
}

function hasLiveKey(env) {
  return [env?.META_API_KEY, env?.MODEL_API_KEY].some((key) => typeof key === "string" && key.trim().length > 0);
}

function resolveSmokeVideoPath(override) {
  const selected = typeof override === "string" && override.trim() ? override.trim() : DEFAULT_VIDEO_PATH;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(selected)) {
    return { ok: false, error: "SMOKE_VIDEO must name a local MP4 file, not a URL." };
  }
  const resolved = path.isAbsolute(selected) ? path.normalize(selected) : path.resolve(REPO_ROOT, selected);
  if (path.extname(resolved).toLowerCase() !== ".mp4") {
    return { ok: false, error: "SMOKE_VIDEO must name an MP4 file." };
  }
  return { ok: true, path: resolved, isDefault: !override?.trim() };
}

function readSmokeVideo(override) {
  const selected = resolveSmokeVideoPath(override);
  if (!selected.ok) return selected;
  try {
    const stat = lstatSync(selected.path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { ok: false, error: "SMOKE_VIDEO must be a regular, non-symlink file." };
    }
    if (stat.size < 16 || stat.size > MAX_VIDEO_BYTES) {
      return { ok: false, error: "SMOKE_VIDEO must be between 16 bytes and 60 MiB." };
    }
    const bytes = readFileSync(selected.path);
    if (bytes.length !== stat.size || bytes.toString("ascii", 4, 8) !== "ftyp") {
      return { ok: false, error: "SMOKE_VIDEO is not a readable ISO BMFF MP4 file." };
    }
    return { ok: true, bytes, isDefault: selected.isDefault };
  } catch {
    return { ok: false, error: "SMOKE_VIDEO could not be read." };
  }
}

function readCatalogInfo() {
  try {
    const raw = readFileSync(path.join(REPO_ROOT, "src", "data", "catalog.demo.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.version !== "string" || !VERSION_PATTERN.test(parsed.version) || !Array.isArray(parsed.items)) {
      return null;
    }
    const elementIds = new Set(parsed.items.map((item) => item?.id).filter((id) => typeof id === "string"));
    if (elementIds.size !== 11) return null;
    return { version: parsed.version, elementIds };
  } catch {
    return null;
  }
}

function validateVideoCandidate(candidate, elementIds) {
  if (!exactKeys(candidate, ["candidateId", "elementId", "concept", "evidence"]) ||
      !CANDIDATE_ID_PATTERN.test(candidate.candidateId) || !elementIds.has(candidate.elementId) ||
      typeof candidate.concept !== "string" || candidate.concept.trim().length === 0 || candidate.concept.length > 80) {
    return false;
  }
  const evidence = candidate.evidence;
  if (!isRecord(evidence)) return false;
  const evidenceKeys = evidence.samConfidence === undefined
    ? ["frameIndex", "timestampMs", "objectOrdinal", "box"]
    : ["frameIndex", "timestampMs", "objectOrdinal", "box", "samConfidence"];
  const box = evidence.box;
  return exactKeys(evidence, evidenceKeys) &&
    Number.isSafeInteger(evidence.frameIndex) && evidence.frameIndex >= 0 &&
    Number.isSafeInteger(evidence.timestampMs) && evidence.timestampMs >= 0 && evidence.timestampMs <= 30_000 &&
    Number.isSafeInteger(evidence.objectOrdinal) && evidence.objectOrdinal >= 0 &&
    exactKeys(box, ["left", "top", "right", "bottom"]) &&
    [box.left, box.top, box.right, box.bottom].every((coordinate) =>
      typeof coordinate === "number" && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 100_000) &&
    box.right > box.left && box.bottom > box.top &&
    (evidence.samConfidence === undefined ||
      (typeof evidence.samConfidence === "number" && Number.isFinite(evidence.samConfidence) && evidence.samConfidence >= 0 && evidence.samConfidence <= 1));
}

function validateSegmentResponse(body, { identity, videoSha256, elementIds, now = Date.now() }) {
  const errors = [];
  const responseKeys = [
    "ok", "stage", "models", "room", "media", "identity", "candidates", "sampleTimestampsMs",
    "candidateToken", "mappingExpiresAt", "mappingRequired", "humanReviewRequired", "conditionAssessment",
  ];
  const emptyCandidates = isRecord(body) && Array.isArray(body.candidates) && body.candidates.length === 0;
  if (!isRecord(body) || Object.keys(body).some((key) => !responseKeys.includes(key)) ||
      responseKeys.filter((key) => key !== "candidateToken" && key !== "mappingExpiresAt").some((key) => !Object.hasOwn(body, key)) ||
      (emptyCandidates ? (Object.hasOwn(body, "candidateToken") || Object.hasOwn(body, "mappingExpiresAt")) :
        (!Object.hasOwn(body, "candidateToken") || !Object.hasOwn(body, "mappingExpiresAt")))) {
    return { ok: false, errors: ["segment response has an unexpected shape"] };
  }
  if (body.ok !== true || body.stage !== "segmented") errors.push("segment response status is invalid");
  if (!exactKeys(body.models, ["segmentation"]) || body.models.segmentation !== "sam-3.1") errors.push("segmentation model is invalid");
  if (body.room !== DEFAULT_ROOM) errors.push("segment room is invalid");
  if (!exactKeys(body.media, ["container", "sourceVideoSha256"]) || body.media.container !== "mp4" || body.media.sourceVideoSha256 !== videoSha256) {
    errors.push("segment media identity is invalid");
  }
  if (!sameIdentity(body.identity, identity)) errors.push("segment request identity changed");
  if (body.mappingRequired !== (Array.isArray(body.candidates) && body.candidates.length > 0) || body.humanReviewRequired !== true || body.conditionAssessment !== "not_assessed") {
    errors.push("segment review boundary is invalid");
  }
  if (!Array.isArray(body.candidates) || body.candidates.length > 12) {
    errors.push("segment candidates are invalid");
  } else {
    const candidateIds = new Set();
    for (const candidate of body.candidates) {
      if (!validateVideoCandidate(candidate, elementIds) || candidateIds.has(candidate.candidateId)) {
        errors.push("segment candidate evidence is invalid");
        break;
      }
      candidateIds.add(candidate.candidateId);
    }
  }
  const samples = body.sampleTimestampsMs;
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > 30 ||
      samples.some((timestamp, index) => !Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 30_000 ||
        (index > 0 && timestamp <= samples[index - 1]))) {
    errors.push("segment context schedule is invalid");
  }
  if (!emptyCandidates) {
    if (typeof body.candidateToken !== "string" || body.candidateToken.length < 16 || body.candidateToken.length > TOKEN_MAX_LENGTH) {
      errors.push("segment mapping token is invalid");
    }
    if (!Number.isSafeInteger(body.mappingExpiresAt) || body.mappingExpiresAt <= now || body.mappingExpiresAt > now + MAPPING_TTL_MS + 5_000) {
      errors.push("segment lease expiry is invalid");
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    candidateCount: body.candidates.length,
    candidateToken: body.candidateToken ?? null,
    mappingExpiresAt: body.mappingExpiresAt,
    candidates: body.candidates,
  };
}

function validateMappedEvidence(evidence, candidatesById) {
  if (!exactKeys(evidence, ["candidateId", "elementId", "concept", "evidence", "still"])) return false;
  const candidate = candidatesById.get(evidence.candidateId);
  if (!candidate || evidence.elementId !== candidate.elementId || evidence.concept !== candidate.concept ||
      JSON.stringify(evidence.evidence) !== JSON.stringify(candidate.evidence)) return false;
  return exactKeys(evidence.still, ["sha256", "mimeType"]) && SHA256_PATTERN.test(evidence.still.sha256) &&
    (evidence.still.mimeType === "image/jpeg" || evidence.still.mimeType === "image/png");
}

function validateMappedResponse(body, { identity, videoSha256, candidates, elementIds }) {
  const errors = [];
  const responseKeys = ["ok", "stage", "models", "room", "media", "identity", "proposals", "humanReviewRequired", "conditionAssessment"];
  if (!exactKeys(body, responseKeys)) return { ok: false, errors: ["mapping response has an unexpected shape"] };
  if (body.ok !== true || body.stage !== "mapped") errors.push("mapping response status is invalid");
  if (!exactKeys(body.models, ["segmentation", "mapping"]) || body.models.segmentation !== "sam-3.1" || body.models.mapping !== "muse-spark-1.3") {
    errors.push("mapping model is invalid");
  }
  if (body.room !== DEFAULT_ROOM || !sameIdentity(body.identity, identity) ||
      !exactKeys(body.media, ["container", "sourceVideoSha256"]) || body.media.container !== "mp4" || body.media.sourceVideoSha256 !== videoSha256) {
    errors.push("mapping media identity is invalid");
  }
  if (body.humanReviewRequired !== true || body.conditionAssessment !== "not_assessed") errors.push("mapping review boundary is invalid");
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  if (!Array.isArray(body.proposals) || body.proposals.length > 11) {
    errors.push("mapping proposals are invalid");
  } else {
    const proposalElementIds = new Set();
    for (const proposal of body.proposals) {
      const keys = ["elementId", "state", "modelSuggestion", "observation", "confidence", "evidenceCandidateIds", "evidence"];
      if (proposal?.modelSuggestion === "D") keys.push("deficiencySuggestion");
      if (!exactKeys(proposal, keys) || !elementIds.has(proposal.elementId) || proposalElementIds.has(proposal.elementId) ||
          proposal.state !== "draft-proposal" || (proposal.modelSuggestion !== "A" && proposal.modelSuggestion !== "D") ||
          typeof proposal.observation !== "string" || proposal.observation.trim().length === 0 || proposal.observation.length > 600 ||
          FORBIDDEN_DRAFT_TEXT.test(proposal.observation) ||
          typeof proposal.confidence !== "number" || !Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 100 ||
          !Array.isArray(proposal.evidenceCandidateIds) || proposal.evidenceCandidateIds.length < 1 || proposal.evidenceCandidateIds.length > 5 ||
          !Array.isArray(proposal.evidence) || proposal.evidence.length !== proposal.evidenceCandidateIds.length) {
        errors.push("mapping proposal is invalid");
        break;
      }
      const usedCandidateIds = new Set();
      let evidenceValid = true;
      for (let index = 0; index < proposal.evidenceCandidateIds.length; index += 1) {
        const candidateId = proposal.evidenceCandidateIds[index];
        const evidence = proposal.evidence[index];
        if (typeof candidateId !== "string" || usedCandidateIds.has(candidateId) || evidence?.candidateId !== candidateId ||
            evidence?.elementId !== proposal.elementId || !validateMappedEvidence(evidence, candidatesById)) {
          evidenceValid = false;
          break;
        }
        usedCandidateIds.add(candidateId);
      }
      if (!evidenceValid) {
        errors.push("mapping evidence is invalid");
        break;
      }
      if (proposal.modelSuggestion === "D") {
        const deficiency = proposal.deficiencySuggestion;
        if (!exactKeys(deficiency, ["deficientArea", "correction", "completionDate", "reinspectionDate"]) ||
            typeof deficiency.deficientArea !== "string" || deficiency.deficientArea.trim().length === 0 || deficiency.deficientArea.length > 300 ||
            typeof deficiency.correction !== "string" || deficiency.correction.trim().length === 0 || deficiency.correction.length > 600 ||
            !/^\d{4}-\d{2}-\d{2}$/.test(deficiency.completionDate) || !/^\d{4}-\d{2}-\d{2}$/.test(deficiency.reinspectionDate)) {
          errors.push("mapping correction suggestion is invalid");
          break;
        }
      }
      proposalElementIds.add(proposal.elementId);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, proposalCount: body.proposals.length };
}

function liveBlockedReason(env) {
  return hasLiveKey(env) ? null : "missing-key";
}

async function readJsonBody(response, maxBytes = MAX_JSON_BYTES) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function safeFailureCode(body) {
  const code = isRecord(body) && isRecord(body.error) ? body.error.code : null;
  return typeof code === "string" && SAFE_VIDEO_ERROR_CODES.has(code) ? code : "UNKNOWN";
}

function makeIdentity(catalogVersion, videoSha256) {
  return {
    sessionId: `live-smoke-${randomUUID()}`,
    schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
    videoId: `live-smoke-video-${randomUUID()}`,
    videoRevision: 1,
    analysisId: `live-smoke-analysis-${randomUUID()}`,
    attempt: 0,
    catalogVersion,
    expectedVideoSha256: videoSha256,
  };
}

function fillIdentity(form, identity) {
  for (const [key, value] of Object.entries(identity)) form.set(key, String(value));
}

async function requestJson(url, form, origin, timeoutMs) {
  const response = await fetch(url, {
    method: "POST",
    body: form,
    headers: { origin },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await readJsonBody(response);
  return { response, body };
}

async function releasePendingLease(baseUrl, identity, candidateToken) {
  const form = new FormData();
  form.set("stage", "cancel");
  fillIdentity(form, identity);
  if (typeof candidateToken === "string" && candidateToken.length <= TOKEN_MAX_LENGTH) {
    form.set("candidateToken", candidateToken);
  }
  try {
    const { response, body } = await requestJson(
      `${baseUrl}/api/video/segment?stage=cancel`, form, baseUrl, CANCEL_TIMEOUT_MS,
    );
    if (!response.ok || !isRecord(body) || body.ok !== true || body.stage !== "cancelled" || typeof body.released !== "boolean") return null;
    return body.released;
  } catch {
    return null;
  }
}

function reserveSmokePort(requestedPort) {
  const parsed = requestedPort === undefined || requestedPort.trim() === "" ? 0 : Number(requestedPort);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) return Promise.reject(new Error("invalid-port"));
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error("port-unavailable")));
    server.listen(parsed, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error || typeof port !== "number") reject(new Error("port-unavailable"));
        else resolve(port);
      });
    });
  });
}

async function waitForServerReady(baseUrl, child, didSpawnFail) {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline && child.exitCode === null && !didSpawnFail()) {
    try {
      const response = await fetch(baseUrl, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(3_000),
      });
      await response.body?.cancel().catch(() => undefined);
      if (response.ok) return true;
    } catch {
      // Poll only the locally spawned production server until it is ready.
    }
    await delay(SERVER_POLL_INTERVAL_MS);
  }
  return false;
}

function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function runSelfTest() {
  const results = [];
  const check = (name, fn) => {
    try {
      results.push({ name, pass: fn() === true });
    } catch {
      results.push({ name, pass: false });
    }
  };
  const expected = {
    sessionId: "live-smoke-session",
    schemaVersion: MOVE_IN_READY_SCHEMA_VERSION,
    videoId: "live-smoke-video",
    videoRevision: 1,
    analysisId: "live-smoke-analysis",
    attempt: 0,
    catalogVersion: "0.3.0-demo.3",
    expectedVideoSha256: "a".repeat(64),
  };
  const elementIds = new Set(["demo-water-supply"]);
  const candidate = {
    candidateId: "cand-0001",
    elementId: "demo-water-supply",
    concept: "water faucet",
    evidence: {
      frameIndex: 1,
      timestampMs: 1_000,
      objectOrdinal: 0,
      box: { left: 10, top: 12, right: 80, bottom: 90 },
      samConfidence: 0.9,
    },
  };
  const segmentBody = (overrides = {}) => ({
    ok: true,
    stage: "segmented",
    models: { segmentation: "sam-3.1" },
    room: "kitchen",
    media: { container: "mp4", sourceVideoSha256: expected.expectedVideoSha256 },
    identity: expected,
    candidates: [candidate],
    sampleTimestampsMs: [500, 1_500, 2_500, 3_500],
    candidateToken: "signed-candidate-token-for-self-test",
    mappingExpiresAt: Date.now() + 60_000,
    mappingRequired: true,
    humanReviewRequired: true,
    conditionAssessment: "not_assessed",
    ...overrides,
  });

  check("fail-closed: missing key blocks", () => liveBlockedReason({}) === "missing-key");
  check("fail-closed: blank key blocks", () => liveBlockedReason({ META_API_KEY: "  " }) === "missing-key");
  check("fail-closed: non-string key blocks", () => liveBlockedReason({ META_API_KEY: 5 }) === "missing-key");
  check("fail-closed: configured key permits runner", () => liveBlockedReason({ META_API_KEY: "secret" }) === null);
  check("provider key alias permits runner", () => liveBlockedReason({ MODEL_API_KEY: "secret" }) === null);
  check("default media is the synthetic H.264 MP4 fixture", () =>
    resolveSmokeVideoPath(undefined).path === DEFAULT_VIDEO_PATH && resolveSmokeVideoPath(undefined).isDefault);
  check("explicit MP4 media path is accepted", () => resolveSmokeVideoPath("/tmp/staged-mock-unit.mp4").ok);
  check("non-video photo paths are rejected", () => resolveSmokeVideoPath("/tmp/photo.jpg").ok === false);
  check("remote media URLs are rejected", () => resolveSmokeVideoPath("https://example.invalid/video.mp4").ok === false);
  check("valid SAM segment candidate enables mapping", () => {
    const result = validateSegmentResponse(segmentBody(), {
      identity: expected,
      videoSha256: expected.expectedVideoSha256,
      elementIds,
    });
    return result.ok && result.candidateCount === 1 && typeof result.candidateToken === "string";
  });
  check("empty SAM result is valid without an unused lease", () => {
    const base = segmentBody({ candidates: [], mappingRequired: false });
    delete base.candidateToken;
    delete base.mappingExpiresAt;
    const result = validateSegmentResponse(base, {
      identity: expected,
      videoSha256: expected.expectedVideoSha256,
      elementIds,
    });
    return result.ok && result.candidateCount === 0 && result.candidateToken === null;
  });
  check("segment identity mismatch rejected", () => {
    const result = validateSegmentResponse(segmentBody({ media: { container: "mp4", sourceVideoSha256: "b".repeat(64) } }), {
      identity: expected,
      videoSha256: expected.expectedVideoSha256,
      elementIds,
    });
    return !result.ok;
  });
  check("invalid SAM candidate evidence rejected", () => {
    const result = validateSegmentResponse(segmentBody({ candidates: [{ ...candidate, evidence: { ...candidate.evidence, frameIndex: -1 } }] }), {
      identity: expected,
      videoSha256: expected.expectedVideoSha256,
      elementIds,
    });
    return !result.ok;
  });
  check("mapped response remains an unreviewed proposal", () => {
    const stillSha256 = "c".repeat(64);
    const evidence = { ...candidate, still: { sha256: stillSha256, mimeType: "image/jpeg" } };
    const body = {
      ok: true,
      stage: "mapped",
      models: { segmentation: "sam-3.1", mapping: "muse-spark-1.3" },
      room: "kitchen",
      media: { container: "mp4", sourceVideoSha256: expected.expectedVideoSha256 },
      identity: expected,
      proposals: [{
        elementId: "demo-water-supply",
        state: "draft-proposal",
        modelSuggestion: "A",
        observation: "A faucet is visible in the frame.",
        confidence: 82,
        evidenceCandidateIds: ["cand-0001"],
        evidence: [evidence],
      }],
      humanReviewRequired: true,
      conditionAssessment: "not_assessed",
    };
    return validateMappedResponse(body, {
      identity: expected,
      videoSha256: expected.expectedVideoSha256,
      candidates: [candidate],
      elementIds,
    }).ok;
  });
  check("mapped final verdict field rejected", () => {
    const body = {
      ok: true,
      stage: "mapped",
      models: { segmentation: "sam-3.1", mapping: "muse-spark-1.3" },
      room: "kitchen",
      media: { container: "mp4", sourceVideoSha256: expected.expectedVideoSha256 },
      identity: expected,
      proposals: [{
        elementId: "demo-water-supply",
        state: "draft-proposal",
        modelSuggestion: "A",
        observation: "A faucet is visible in the frame.",
        confidence: 82,
        evidenceCandidateIds: ["cand-0001"],
        evidence: [],
        approved: true,
      }],
      humanReviewRequired: true,
      conditionAssessment: "not_assessed",
    };
    return !validateMappedResponse(body, {
      identity: expected,
      videoSha256: expected.expectedVideoSha256,
      candidates: [candidate],
      elementIds,
    }).ok;
  });

  const passed = results.filter((result) => result.pass).length;
  for (const result of results) {
    if (!result.pass) console.error(`test:live --self-test FAILED: ${result.name}`);
  }
  if (passed === results.length) {
    console.log(`test:live --self-test: ${passed}/${results.length} checks passed (offline; no key, media, server, or network).`);
    process.exitCode = 0;
  } else {
    console.error(`test:live --self-test: ${passed}/${results.length} checks passed.`);
    process.exitCode = 1;
  }
}

async function runLiveSmoke() {
  const result = { exitCode: 1, failure: null, summary: null, leaseReleased: null };
  let child = null;
  let spawnFailed = false;
  let segmentRequested = false;
  let mappingCompleted = false;
  let candidateToken = null;
  let identity = null;
  let baseUrl = null;
  const startedAt = Date.now();

  try {
    // Next's environment loader respects shell values, loads local .env files,
    // and is given a silent logger so neither keys nor parsed values are printed.
    loadEnvConfig(REPO_ROOT, false, { info() {}, error() {} });
    if (liveBlockedReason(process.env) !== null) {
      result.failure = "test:live BLOCKED: META_API_KEY is not set in the process or local Next.js environment. No provider call was attempted.";
      return result;
    }

    const video = readSmokeVideo(process.env.SMOKE_VIDEO);
    if (!video.ok) {
      result.failure = `test:live BLOCKED: ${video.error} No provider call was attempted.`;
      return result;
    }
    const catalog = readCatalogInfo();
    if (!catalog) {
      result.failure = "test:live FAILED: the bundled demo catalog could not be validated. No provider call was attempted.";
      return result;
    }
    const videoSha256 = createHash("sha256").update(video.bytes).digest("hex");
    identity = makeIdentity(catalog.version, videoSha256);

    let port;
    try {
      port = await reserveSmokePort(process.env.SMOKE_PORT);
    } catch {
      result.failure = "test:live FAILED: SMOKE_PORT is invalid or already in use. No provider call was attempted.";
      return result;
    }
    baseUrl = `http://127.0.0.1:${port}`;
    const childEnv = {
      ...process.env,
      APP_ANALYSIS_MODE: "live",
      // Next normalizes its internal request URL to the local server origin;
      // explicitly trust the runner's loopback origin for this isolated smoke.
      APP_PUBLIC_ORIGIN: baseUrl,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
    };
    // Prevent the optional mapping fallback from making a second provider call.
    // An explicitly empty value prevents Next's child from restoring the
    // optional fallback key from .env after this process removes it.
    childEnv.BASETEN_API_KEY = "";
    child = spawn(process.execPath, [NEXT_CLI, "start", "--port", String(port), "--hostname", "127.0.0.1"], {
      cwd: REPO_ROOT,
      env: childEnv,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => { spawnFailed = true; });
    if (!await waitForServerReady(baseUrl, child, () => spawnFailed)) {
      result.failure = "test:live FAILED: the local production server did not become ready. Run npm run build first. No provider request was sent.";
      return result;
    }

    const segmentForm = new FormData();
    segmentForm.set("stage", "segment");
    segmentForm.set("room", DEFAULT_ROOM);
    fillIdentity(segmentForm, identity);
    segmentForm.set("video", new Blob([video.bytes], { type: "video/mp4" }), "live-smoke.mp4");
    segmentRequested = true;

    let segmentResponse;
    let segmentBody;
    try {
      ({ response: segmentResponse, body: segmentBody } = await requestJson(
        `${baseUrl}/api/video/segment?stage=segment`, segmentForm, baseUrl, REQUEST_TIMEOUT_MS,
      ));
    } catch {
      result.failure = "test:live FAILED: the single video segment request timed out or was unreachable. No retry was attempted.";
      return result;
    }
    if (isRecord(segmentBody) && typeof segmentBody.candidateToken === "string" && segmentBody.candidateToken.length <= TOKEN_MAX_LENGTH) {
      candidateToken = segmentBody.candidateToken;
    }
    if (!segmentResponse.ok) {
      const code = safeFailureCode(segmentBody);
      result.failure = `test:live FAILED: video segment returned HTTP ${segmentResponse.status} (code ${code}). No retry was attempted.`;
      return result;
    }
    const checkedSegment = validateSegmentResponse(segmentBody, {
      identity,
      videoSha256,
      elementIds: catalog.elementIds,
    });
    if (!checkedSegment.ok) {
      result.failure = `test:live FAILED: video segment response validation failed: ${checkedSegment.errors.join("; ")}.`;
      return result;
    }
    candidateToken = checkedSegment.candidateToken;

    let mappingStatus = "skipped-no-candidates";
    let mappingModel = null;
    let proposalCount = null;
    let mappingRequests = 0;
    if (checkedSegment.candidateCount > 0) {
      mappingStatus = "pending";
      const mapForm = new FormData();
      mapForm.set("stage", "map");
      mapForm.set("room", DEFAULT_ROOM);
      fillIdentity(mapForm, identity);
      mapForm.set("candidateToken", checkedSegment.candidateToken);
      mappingRequests = 1;
      let mapResponse;
      let mapBody;
      try {
        ({ response: mapResponse, body: mapBody } = await requestJson(
          `${baseUrl}/api/video/segment?stage=map`, mapForm, baseUrl, REQUEST_TIMEOUT_MS,
        ));
      } catch {
        result.failure = "test:live FAILED: the single eligible mapping request timed out or was unreachable. No retry was attempted.";
        return result;
      }
      if (!mapResponse.ok) {
        const code = safeFailureCode(mapBody);
        result.failure = `test:live FAILED: eligible mapping returned HTTP ${mapResponse.status} (code ${code}). No retry was attempted.`;
        return result;
      }
      const checkedMap = validateMappedResponse(mapBody, {
        identity,
        videoSha256,
        candidates: checkedSegment.candidates,
        elementIds: catalog.elementIds,
      });
      if (!checkedMap.ok) {
        result.failure = `test:live FAILED: eligible mapping response validation failed: ${checkedMap.errors.join("; ")}.`;
        return result;
      }
      mappingStatus = "completed";
      mappingModel = mapBody.models.mapping;
      proposalCount = checkedMap.proposalCount;
      mappingCompleted = true;
    } else {
      mappingCompleted = true;
    }

    result.summary = {
      mode: "live",
      route: "/api/video/segment",
      room: DEFAULT_ROOM,
      segmentationModel: "sam-3.1",
      videoSha256,
      videoBytes: video.bytes.length,
      segmentRequests: 1,
      mappingRequests,
      mapping: mappingStatus,
      mappingModel,
      proposalCount,
      videoQuality: "not-assessed",
      latencyMs: Date.now() - startedAt,
    };
    result.exitCode = 0;
    return result;
  } catch {
    result.failure = "test:live FAILED: local smoke setup failed. No provider response or secret was logged.";
    return result;
  } finally {
    if (segmentRequested && identity && !mappingCompleted) {
      if (baseUrl) result.leaseReleased = await releasePendingLease(baseUrl, identity, candidateToken);
    }
    if (child) await stopServer(child);
  }
}

async function main() {
  if (process.argv.slice(2).includes("--self-test")) {
    runSelfTest();
    return;
  }
  const result = await runLiveSmoke();
  if (result.exitCode !== 0) {
    console.error(result.failure ?? "test:live FAILED: the video smoke did not complete.");
    process.exitCode = result.exitCode;
    return;
  }
  // `summary` is populated before teardown. The only emitted fields are
  // sanitized operational metadata; provider bodies, IDs/tokens, paths,
  // candidate/model text and secrets are never printed.
  const output = result.summary;
  if (!output) {
    console.error("test:live FAILED: sanitized evidence was unavailable.");
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ...output, pendingLeaseReleased: result.leaseReleased }));
  process.exitCode = 0;
}

await main();
