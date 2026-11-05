#!/usr/bin/env node
/**
 * Live cloud video job smoke (REQ-003, REQ-010, REQ-011).
 *
 * `--self-test` runs before loading Next env, reading files, or importing any
 * application modules. The live path uses only the bundled synthetic MP4,
 * requires explicit live mode plus real Meta/Postgres/R2/worker configuration,
 * uploads directly to the job's signed R2 URL, and always attempts cleanup.
 * This proves connectivity for one cloud job only; it is not a video-quality
 * or Form 1083 evaluation.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VIDEO = path.join(ROOT, "tests/fixtures/synthetic-h264-test-pattern.mp4");
const READY_MS = 30_000;
const POLL_MS = 1_000;
const JOB_TIMEOUT_MS = 180_000;
const SAFE_ERROR_CODES = new Set([
  "INVALID_REQUEST", "INVALID_VIDEO", "OPERATION_BUSY", "PROCESSING_BUSY", "PROVIDER_FAILURE",
  "PROVIDER_TIMEOUT", "SETUP_REQUIRED", "STALE_REQUEST", "UNSUPPORTED_VIDEO", "VIDEO_TOO_LARGE",
]);

function selfTest() {
  const checks = [
    ["bounded port parser", validPort("3107") && !validPort("99999")],
    ["required environment names are explicit", REQUIRED_ENV.every((key) => typeof key === "string")],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name] of failed) console.error(`test:live --self-test FAILED: ${name}`);
  if (failed.length) process.exitCode = 1;
  else console.log(`test:live --self-test: ${checks.length}/${checks.length} checks passed (offline; no env files, media, server, or network).`);
}

const REQUIRED_ENV = [
  "APP_ANALYSIS_MODE", "META_API_KEY or MODEL_API_KEY", "DATABASE_URL", "CLOUDFLARE_ACCOUNT_ID",
  "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "VIDEO_JOB_WAKE_URL", "VIDEO_JOB_WAKE_TOKEN",
];

function validPort(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1024 && number <= 65535;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function missingLiveConfiguration(env) {
  const missing = [];
  if (env.APP_ANALYSIS_MODE !== "live") missing.push("APP_ANALYSIS_MODE=live");
  if (!hasValue(env.META_API_KEY) && !hasValue(env.MODEL_API_KEY)) missing.push("META_API_KEY or MODEL_API_KEY");
  if (!/^postgres(?:ql)?:\/\//i.test(env.DATABASE_URL?.trim() ?? "")) missing.push("PostgreSQL DATABASE_URL");
  for (const name of ["CLOUDFLARE_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "VIDEO_JOB_WAKE_TOKEN"]) {
    if (!hasValue(env[name])) missing.push(name);
  }
  try {
    const wakeUrl = new URL(env.VIDEO_JOB_WAKE_URL);
    if (wakeUrl.protocol !== "https:" || wakeUrl.username || wakeUrl.password || wakeUrl.hash) missing.push("HTTPS VIDEO_JOB_WAKE_URL");
  } catch { missing.push("VIDEO_JOB_WAKE_URL"); }
  if (env.INSPECTION_PASSCODE?.length > 200) missing.push("INSPECTION_PASSCODE (maximum 200 characters)");
  return missing;
}

function safeCode(payload) {
  const code = payload && typeof payload === "object" ? payload.error?.code : null;
  return typeof code === "string" && SAFE_ERROR_CODES.has(code) ? code : "REQUEST_FAILED";
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("PORT_UNAVAILABLE"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitUntilReady(baseUrl, child) {
  const deadline = Date.now() + READY_MS;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error("APP_EXITED");
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2_000), redirect: "manual" });
      if (response.status < 500) return;
    } catch { /* keep waiting for the local server */ }
    await delay(250);
  }
  throw new Error("APP_NOT_READY");
}

async function jsonRequest(url, { method = "GET", body, headers = {}, cookie = "", timeoutMs = 15_000 } = {}) {
  const response = await fetch(url, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "x-walkthrough-client": "habitability-walkthrough/1",
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* sanitized status is sufficient */ }
  if (!response.ok || !payload || payload.ok !== true) {
    const error = new Error(`HTTP_${response.status}_${safeCode(payload)}`);
    error.status = response.status;
    error.code = safeCode(payload);
    throw error;
  }
  return payload;
}

function buildInitialInspection(sessionId, catalogVersion) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 5, catalogVersion, sessionId, createdAt: now, updatedAt: now,
    fundingType: "unknown", pseudonym: "synthetic-smoke", evaluatorName: "",
    voiceChecks: {}, unitType: "1-bedroom", bathCount: 1,
    roomIds: ["kitchen", "bathroom", "bedroom", "living-room", "hallway"],
    selectedRoomId: "kitchen", completedPromptIdsByRoom: {}, clipIdentities: {}, pendingVideoJobsByRoom: {},
    elementClipIdentities: {}, liveProofs: {}, proposals: {}, decisions: {}, pendingAnalysisIntent: null,
    signoff: null, evaluatorAgencyName: "", landlordDiscussion: "", landlordDiscussionDate: "",
    leadershipSignoffRequired: false, leadershipNameAndTitle: "", leadershipSignoff: "", leadershipSignedAt: "",
    inspectionNote: "Synthetic cloud job smoke; no real unit data.",
  };
}

async function run() {
  const require = createRequire(import.meta.url);
  require("@next/env").loadEnvConfig(ROOT);
  const missing = missingLiveConfiguration(process.env);
  if (missing.length) {
    console.error(`test:live BLOCKED: missing required live configuration: ${missing.join(", ")}. No provider request was attempted.`);
    process.exitCode = 1;
    return;
  }
  if (process.env.SMOKE_VIDEO) {
    console.error("test:live BLOCKED: SMOKE_VIDEO is unsupported; only the bundled synthetic MP4 may be used. No provider request was attempted.");
    process.exitCode = 1;
    return;
  }
  if (!validPort(process.env.SMOKE_PORT ?? "3107")) {
    console.error("test:live BLOCKED: SMOKE_PORT must be between 1024 and 65535.");
    process.exitCode = 1;
    return;
  }

  // No file read occurs until all live-service configuration has passed.
  let media;
  try { media = readFileSync(VIDEO); }
  catch {
    console.error("test:live BLOCKED: bundled synthetic MP4 is unavailable. No provider request was attempted.");
    process.exitCode = 1;
    return;
  }
  if (media.length < 16 || media.length > 60 * 1024 * 1024 || media.toString("ascii", 4, 8) !== "ftyp") {
    console.error("test:live BLOCKED: bundled synthetic MP4 failed its local format/size check.");
    process.exitCode = 1;
    return;
  }
  let catalog;
  try { catalog = JSON.parse(readFileSync(path.join(ROOT, "src/data/catalog.demo.json"), "utf8")); }
  catch {
    console.error("test:live BLOCKED: catalog metadata could not be read. No provider request was attempted.");
    process.exitCode = 1;
    return;
  }

  let child = null;
  let baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
  let cookie = "";
  let sessionId = randomUUID();
  let jobId = "";
  let sessionCreated = false;
  let completed = false;
  const metadata = { mode: "live", media: "bundled-synthetic-mp4", bytes: media.length };
  try {
    if (baseUrl) {
      const configured = new URL(baseUrl);
      const loopback = configured.hostname === "localhost" || configured.hostname === "127.0.0.1";
      if ((configured.protocol !== "https:" && !(configured.protocol === "http:" && loopback)) ||
          configured.username || configured.password || configured.search || configured.hash ||
          (configured.pathname !== "/" && configured.pathname !== "")) {
        throw new Error("APP_BASE_URL_INVALID");
      }
      baseUrl = configured.origin;
    } else {
      if (!existsSync(path.join(ROOT, ".next/BUILD_ID"))) throw new Error("BUILD_REQUIRED");
      const port = await freePort();
      baseUrl = `http://127.0.0.1:${port}`;
      child = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
        cwd: ROOT,
        env: { ...process.env, APP_ANALYSIS_MODE: "live", APP_PUBLIC_ORIGIN: baseUrl, PORT: String(port), HOSTNAME: "127.0.0.1" },
        stdio: "ignore",
      });
      await waitUntilReady(baseUrl, child);
    }

    if (hasValue(process.env.INSPECTION_PASSCODE)) {
      const unlocked = await fetch(`${baseUrl}/api/auth/unlock`, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
        headers: { "content-type": "application/json", origin: new URL(baseUrl).origin },
        body: JSON.stringify({ passcode: process.env.INSPECTION_PASSCODE }),
      });
      if (!unlocked.ok) throw new Error(`UNLOCK_HTTP_${unlocked.status}`);
      const setCookie = unlocked.headers.get("set-cookie") ?? "";
      cookie = setCookie.split(";")[0] ?? "";
      if (!cookie) throw new Error("UNLOCK_COOKIE_MISSING");
    }

    const headers = { origin: new URL(baseUrl).origin };
    const inspection = buildInitialInspection(sessionId, catalog.version);
    const created = await jsonRequest(`${baseUrl}/api/inspections/${sessionId}`, {
      method: "PUT", body: { inspection, expectedRevision: 0 }, headers, cookie,
    });
    sessionCreated = true;
    const identitySeed = {
      sessionId, schemaVersion: 5, videoId: randomUUID(), videoRevision: 1,
      analysisId: randomUUID(), attempt: 1, catalogVersion: catalog.version,
    };
    const job = await jsonRequest(`${baseUrl}/api/video/jobs`, {
      method: "POST", body: { room: "kitchen", identity: identitySeed, media: { contentType: "video/mp4", contentLength: media.length } }, headers, cookie,
    });
    jobId = job.jobId;
    if (!job.upload?.url || job.upload.method !== "PUT" || !job.upload.headers || !job.identity) throw new Error("UPLOAD_CONTRACT_INVALID");
    const upload = await fetch(job.upload.url, {
      method: "PUT", headers: job.upload.headers, body: media, redirect: "manual", signal: AbortSignal.timeout(60_000),
    });
    if (!upload.ok) throw new Error(`R2_UPLOAD_HTTP_${upload.status}`);

    const verified = await jsonRequest(`${baseUrl}/api/video/jobs/${jobId}/complete`, {
      method: "POST", headers, cookie, timeoutMs: 120_000,
    });
    if (!verified.media || !/^[a-f0-9]{64}$/.test(verified.media.sha256) || !Number.isFinite(verified.media.durationSeconds)) {
      throw new Error("MEDIA_VERIFICATION_INVALID");
    }
    const revision = created.revision;
    const updatedInspection = {
      ...inspection,
      updatedAt: new Date().toISOString(),
      clipIdentities: {
        kitchen: {
          roomId: "kitchen", schemaVersion: 5, catalogVersion: catalog.version,
          videoId: identitySeed.videoId, videoRevision: 1, videoHash: verified.media.sha256,
          analysisId: identitySeed.analysisId, attempt: 1, jobId,
          capturedAt: new Date().toISOString(), durationSeconds: verified.media.durationSeconds,
          sizeBytes: verified.media.contentLength, evidence: [],
        },
      },
    };
    await jsonRequest(`${baseUrl}/api/inspections/${sessionId}`, {
      method: "PUT", body: { inspection: updatedInspection, expectedRevision: revision }, headers, cookie,
    });
    const processResult = await jsonRequest(`${baseUrl}/api/video/jobs/${jobId}/process`, {
      method: "POST", body: { identity: { ...identitySeed, expectedVideoSha256: verified.media.sha256 } }, headers, cookie,
    });
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    let status = processResult.status;
    while (!(["completed", "ambiguous", "failed", "cancelled"].includes(status)) && Date.now() < deadline) {
      await delay(POLL_MS);
      const current = await jsonRequest(`${baseUrl}/api/video/jobs/${jobId}`, { headers, cookie, timeoutMs: 20_000 });
      status = current.status;
    }
    if (status !== "completed") throw new Error(`JOB_TERMINAL_${status || "TIMEOUT"}`);
    completed = true;
    metadata.status = status;
    metadata.durationSeconds = verified.media.durationSeconds;
    metadata.sourceBytes = verified.media.contentLength;
    metadata.analysis = "completed";
    console.log(JSON.stringify({ ok: true, ...metadata }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const safeMessage = /^[A-Z0-9_.-]{1,100}$/.test(message) ? message : "SMOKE_FAILED";
    console.error(`test:live FAILED: ${safeMessage}; provider result not emitted.`);
    process.exitCode = 1;
  } finally {
    if (baseUrl && jobId) {
      try {
        await jsonRequest(`${baseUrl}/api/video/jobs/${jobId}`, { method: "DELETE", headers: { origin: new URL(baseUrl).origin }, cookie, timeoutMs: 15_000 });
      } catch { console.error("test:live cleanup: job cleanup was not confirmed; retention cleanup will retry."); }
    }
    if (baseUrl && sessionCreated) {
      try {
        await jsonRequest(`${baseUrl}/api/inspections/${sessionId}`, { method: "DELETE", headers: { origin: new URL(baseUrl).origin }, cookie, timeoutMs: 15_000 });
      } catch { console.error("test:live cleanup: synthetic inspection cleanup was not confirmed."); }
    }
    if (child) {
      child.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    if (completed) metadata.cleanupAttempted = true;
  }
}

if (process.argv.includes("--self-test")) selfTest();
else void run();
