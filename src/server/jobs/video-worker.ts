import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WALKTHROUGH_CLIENT_HEADER, WALKTHROUGH_CLIENT_ID } from "../../domain/walkthrough-client";
import { createR2Storage, MAX_R2_EVIDENCE_BYTES, MAX_R2_VIDEO_BYTES, type R2Storage } from "../storage/r2";
import { handleVideoSegmentRequest } from "../video/meta-sam";
import { restoreAwaitingVideoMapping, type PendingMappingStills } from "../video/operation-guard";
import { VideoSegmentError } from "../video/errors";
import { decodeSourceFrames } from "../video/source-stills";
import { validateVideoBytes } from "../video/validate";
import { enqueueVideoProcessing } from "./queue";
import {
  claimMuseStage, claimSamStage, finishVideoJobCancelled, getVideoJob,
  isVideoJobCancellationRequested, markProviderStarted, markVideoJobAmbiguous,
  markVideoJobFailed, markVideoJobObjectDeleted, persistCompletedStage, persistSegmentStage,
  registerJobObject, setNormalizedVideoHash, type DurableVideoIdentity, type VideoJobObject, type VideoJobRow,
} from "./video-job-store";
import { wakeVideoWorker } from "./wakeup";

const NORMALIZE_TIMEOUT_MS = 45_000;
const MAX_STDERR_BYTES = 16 * 1024;
export type VideoWorkerResult = "processed" | "busy" | "terminal" | "cancelled";
export interface VideoWorkerDependencies {
  storage?: R2Storage;
  ffmpegPath?: string;
  requestTimeoutMs?: number;
}

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function readBounded(body: ReadableStream<Uint8Array>, max: number, expected?: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max || (expected !== undefined && length > expected)) throw new Error("Stored media exceeded its recorded size.");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (expected !== undefined && length !== expected) throw new Error("Stored media length did not match its record.");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function ffmpeg(args: string[], ffmpegPath?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath || process.env.FFMPEG_PATH?.trim() || "ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderrBytes = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes = Math.min(MAX_STDERR_BYTES, stderrBytes + chunk.byteLength); });
    child.once("error", () => finish(new Error("Server-side video normalization is unavailable.")));
    child.once("close", (code) => finish(code === 0 ? undefined : new Error("The uploaded MOV could not be normalized.")));
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new Error("Server-side video normalization timed out.")); }, NORMALIZE_TIMEOUT_MS);
    timer.unref();
  });
}

async function normalize(bytes: Uint8Array, job: VideoJobRow, ffmpegPath?: string): Promise<Uint8Array> {
  const parsed = validateVideoBytes(bytes);
  if (parsed.mimeType !== job.mediaContentType) throw new Error("Stored video format did not match its declared type.");
  if (parsed.mimeType === "video/mp4") return bytes;
  const directory = await mkdtemp(join(tmpdir(), "walkthrough-"));
  const input = join(directory, "source.mov");
  const output = join(directory, "normalized.mp4");
  try {
    await writeFile(input, bytes, { flag: "wx", mode: 0o600 });
    await ffmpeg(["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-map", "0:v:0", "-c:v", "copy", "-an", "-movflags", "+faststart", output], ffmpegPath);
    const result = await readFile(output);
    if (result.byteLength < 1 || result.byteLength > MAX_R2_VIDEO_BYTES) throw new Error("Normalized MP4 exceeded the supported size.");
    if (validateVideoBytes(result).mimeType !== "video/mp4") throw new Error("FFmpeg did not produce a supported MP4.");
    return new Uint8Array(result);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function identityFields(identity: DurableVideoIdentity): Array<[string, string]> {
  return [
    ["sessionId", identity.sessionId], ["schemaVersion", String(identity.schemaVersion)],
    ["videoId", identity.videoId], ["videoRevision", String(identity.videoRevision)],
    ["analysisId", identity.analysisId], ["attempt", String(identity.attempt)],
    ["catalogVersion", identity.catalogVersion], ...(identity.expectedVideoSha256 ? [["expectedVideoSha256", identity.expectedVideoSha256] as [string, string]] : []),
    ...(identity.normalizedVideoSha256 ? [["normalizedVideoSha256", identity.normalizedVideoSha256] as [string, string]] : []),
  ];
}

function stageRequest(stage: "segment" | "map", job: VideoJobRow, identity: DurableVideoIdentity, bytes?: Uint8Array): Request {
  const form = new FormData();
  form.set("stage", stage);
  form.set("room", job.roomId);
  for (const [key, value] of identityFields(identity)) form.set(key, value);
  if (stage === "segment") {
    if (!bytes) throw new Error("Normalized video bytes are unavailable.");
    form.set("video", new File([bytes], "room.mp4", { type: "video/mp4" }));
  } else {
    if (!job.candidateToken) throw new Error("Mapping token is unavailable.");
    form.set("candidateToken", job.candidateToken);
  }
  return new Request("https://worker.invalid/api/video/segment?stage=" + stage, {
    method: "POST", headers: { origin: "https://worker.invalid", [WALKTHROUGH_CLIENT_HEADER]: WALKTHROUGH_CLIENT_ID }, body: form,
  });
}

async function invokeStage(
  request: Request,
  dependencies: VideoWorkerDependencies,
  onProviderStart: (stage: "sam" | "muse") => Promise<void>,
  onSegmentReady?: (value: { segment: unknown; candidateToken: string | null; pendingStills?: PendingMappingStills }) => Promise<void>,
): Promise<Record<string, unknown>> {
  const response = await handleVideoSegmentRequest(request, {
    requestTimeoutMs: dependencies.requestTimeoutMs, onProviderStart, onSegmentReady,
  });
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Video processing returned an invalid response.");
  return value as Record<string, unknown>;
}

async function downloadMedia(job: VideoJobRow, storage: R2Storage): Promise<Uint8Array> {
  const object = await storage.getObject(job.mediaObjectKey);
  if (!object || object.contentLength !== job.mediaContentLength || object.contentType !== job.mediaContentType) throw new Error("Source video is unavailable.");
  const bytes = await readBounded(object.body, MAX_R2_VIDEO_BYTES, job.mediaContentLength);
  if (!job.identity.expectedVideoSha256 || digest(bytes) !== job.identity.expectedVideoSha256) throw new Error("Source video failed integrity verification.");
  return bytes;
}

async function storePendingStills(jobId: string, storage: R2Storage, pending?: PendingMappingStills): Promise<VideoJobObject[]> {
  if (!pending) return [];
  const stills = [
    ...pending.candidates.map((still) => ({ ...still, kind: "candidate" as const })),
    ...pending.samples.map((still) => ({ ...still, kind: "context" as const })),
  ];
  const stored: VideoJobObject[] = [];
  for (const still of stills) {
    if (!still.bytes.byteLength || still.bytes.byteLength > MAX_R2_EVIDENCE_BYTES) throw new Error("Generated still exceeded the evidence size limit.");
    const objectKey = storage.createEvidenceObjectKey();
    const sha256 = digest(still.bytes);
    try {
      await storage.putObject({ objectKey, body: still.bytes, contentType: "image/jpeg", sha256 });
      await registerJobObject(jobId, { objectKey, kind: still.kind, sha256, byteLength: still.bytes.byteLength });
    } catch (error) {
      await storage.deleteObject(objectKey).catch(() => undefined);
      throw error;
    }
    stored.push({
      objectKey, kind: still.kind, ...(still.candidateId ? { candidateId: still.candidateId } : {}),
      frameIndex: still.frameIndex, timestampMs: still.timestampMs, sha256, byteLength: still.bytes.byteLength,
      width: still.width ?? 0, height: still.height ?? 0,
    });
  }
  return stored;
}

async function failStage(job: VideoJobRow, leaseId: string, stage: "sam" | "muse", code: string, message: string, retryable: boolean): Promise<void> {
  const fresh = await getVideoJob(job.id);
  if (!fresh) return;
  const started = stage === "sam" ? fresh.samStartedAt : fresh.museStartedAt;
  if (started) await markVideoJobAmbiguous(job.id, leaseId, stage);
  else await markVideoJobFailed(job.id, leaseId, stage, code, message, retryable);
}

async function cleanupTerminalSource(jobId: string, storage?: R2Storage): Promise<void> {
  try {
    const current = await getVideoJob(jobId);
    if (!current || current.retryable || !["completed", "ambiguous", "failed", "cancelled"].includes(current.status)) return;
    const target = storage ?? createR2Storage();
    await target.deleteObject(current.mediaObjectKey);
    await markVideoJobObjectDeleted(jobId, current.mediaObjectKey);
  } catch {
    // Terminal-source cleanup is retried by the durable maintenance scanner.
  }
}

export async function processVideoSamStage(jobId: string, dependencies: VideoWorkerDependencies = {}): Promise<VideoWorkerResult> {
  const leaseId = randomUUID();
  const claim = await claimSamStage(jobId, leaseId);
  if (claim.kind === "busy") return "busy";
  if (claim.kind === "terminal") return "terminal";
  if (claim.kind === "sam-complete") {
    await enqueueVideoProcessing(jobId, "muse");
    await wakeVideoWorker(jobId, "muse");
    return "processed";
  }
  const job = claim.job;
  const storage = dependencies.storage ?? createR2Storage();
  let uploaded: VideoJobObject[] = [];
  let candidateToken: string | null = null;
  try {
    if (await isVideoJobCancellationRequested(jobId)) {
      await finishVideoJobCancelled(jobId, leaseId);
      await cleanupTerminalSource(jobId, storage);
      return "cancelled";
    }
    const source = await downloadMedia(job, storage);
    const bytes = await normalize(source, job, dependencies.ffmpegPath);
    const metadata = validateVideoBytes(bytes);
    if (metadata.mimeType !== "video/mp4" || !metadata.frameTimestampsMs?.length) {
      throw new VideoSegmentError(422, "INVALID_VIDEO", "The normalized video has no supported frame timing data.");
    }
    await decodeSourceFrames(bytes, [0], [metadata.frameTimestampsMs[0]!], AbortSignal.timeout(60_000), {
      ffmpegPath: dependencies.ffmpegPath,
      timeoutMs: 60_000,
    });
    const normalizedHash = digest(bytes);
    await setNormalizedVideoHash(jobId, leaseId, normalizedHash);
    const identity = { ...job.identity, normalizedVideoSha256: normalizedHash };
    const result = await invokeStage(stageRequest("segment", job, identity, bytes), dependencies, async (stage) => {
      if (await isVideoJobCancellationRequested(jobId)) throw new Error("Video job cancelled.");
      await markProviderStarted(jobId, leaseId, stage);
    }, async ({ pendingStills }) => { uploaded = await storePendingStills(jobId, storage, pendingStills); });
    if (result.ok !== true || result.stage !== "segmented") {
      const error = typeof result.error === "object" && result.error !== null ? result.error as Record<string, unknown> : {};
      await failStage(job, leaseId, "sam", String(error.code ?? "VIDEO_PROCESSING_FAILED"), String(error.message ?? "Video processing could not be completed."), false);
      await cleanupTerminalSource(jobId, storage);
      return "terminal";
    }
    candidateToken = typeof result.candidateToken === "string" ? result.candidateToken : null;
    const { candidateToken: _candidateToken, ...publicSegment } = result;
    void _candidateToken;
    await persistSegmentStage(jobId, leaseId, publicSegment, candidateToken, uploaded);
    await cleanupTerminalSource(jobId, storage);
  } catch (error) {
    const terminalInputError = error instanceof VideoSegmentError &&
      ["INVALID_VIDEO", "UNSUPPORTED_VIDEO", "VIDEO_TOO_LONG", "VIDEO_TOO_LARGE"].includes(error.code);
    await failStage(job, leaseId, "sam",
      error instanceof VideoSegmentError ? error.code : "VIDEO_PROCESSING_FAILED",
      error instanceof VideoSegmentError ? error.message : "Video processing could not be completed.",
      !terminalInputError);
    await cleanupTerminalSource(jobId, storage);
    return "terminal";
  }
  // Dispatch is outside the provider-stage catch. If pg-boss or the ACA wake
  // gateway is unavailable, this SAM message may safely retry; its next claim
  // sees the persisted SAM result and only re-dispatches Muse.
  if (candidateToken) {
    await enqueueVideoProcessing(jobId, "muse");
    await wakeVideoWorker(jobId, "muse");
  }
  return "processed";
}

async function loadPendingStills(job: VideoJobRow, storage: R2Storage): Promise<PendingMappingStills> {
  const values = await Promise.all(job.stillObjects.map(async (item) => {
    const object = await storage.getObject(item.objectKey);
    if (!object || object.contentType !== "image/jpeg" || object.contentLength !== item.byteLength) throw new Error("Stored evidence was unavailable.");
    const bytes = await readBounded(object.body, MAX_R2_EVIDENCE_BYTES, item.byteLength);
    if (digest(bytes) !== item.sha256) throw new Error("Stored evidence failed integrity verification.");
    return { ...(item.candidateId ? { candidateId: item.candidateId } : {}), frameIndex: item.frameIndex, timestampMs: item.timestampMs, bytes, width: item.width, height: item.height };
  }));
  return {
    candidates: values.filter((item) => item.candidateId),
    samples: values.filter((item) => !item.candidateId),
    byteLength: values.reduce((sum, item) => sum + item.bytes.byteLength, 0),
  };
}

export async function processVideoMuseStage(jobId: string, dependencies: VideoWorkerDependencies = {}): Promise<VideoWorkerResult> {
  const leaseId = randomUUID();
  const claim = await claimMuseStage(jobId, leaseId);
  if (claim.kind === "busy") return "busy";
  if (claim.kind === "terminal" || claim.kind === "sam-complete") return "terminal";
  const job = claim.job;
  const storage = dependencies.storage ?? createR2Storage();
  try {
    if (await isVideoJobCancellationRequested(jobId)) {
      await finishVideoJobCancelled(jobId, leaseId);
      await cleanupTerminalSource(jobId, storage);
      return "cancelled";
    }
    const expiresAt = job.segmentResult?.mappingExpiresAt;
    const sourceHash = job.identity.expectedVideoSha256;
    if (!job.candidateToken || !sourceHash || !Number.isSafeInteger(expiresAt)) throw new Error("Stored mapping identity is incomplete.");
    const mappingIdentity = { ...job.identity, expectedVideoSha256: sourceHash,
      ...(job.normalizedVideoSha256 ? { normalizedVideoSha256: job.normalizedVideoSha256 } : {}) };
    restoreAwaitingVideoMapping(mappingIdentity, job.candidateToken, Number(expiresAt), await loadPendingStills(job, storage));
    const result = await invokeStage(stageRequest("map", job, mappingIdentity), dependencies, async (stage) => {
      if (await isVideoJobCancellationRequested(jobId)) throw new Error("Video job cancelled.");
      await markProviderStarted(jobId, leaseId, stage);
    });
    if (result.ok !== true || result.stage !== "mapped" || !Array.isArray(result.proposals)) {
      const error = typeof result.error === "object" && result.error !== null ? result.error as Record<string, unknown> : {};
      await failStage(job, leaseId, "muse", String(error.code ?? "VIDEO_MAPPING_FAILED"), String(error.message ?? "Video mapping could not be completed."), false);
      await cleanupTerminalSource(jobId, storage);
      return "terminal";
    }
    const proposals = result.proposals as Array<Record<string, unknown>>;
    const objects = new Map(job.stillObjects.filter((item) => item.kind === "candidate" && item.candidateId).map((item) => [item.candidateId!, item]));
    const usedIds = [...new Set(proposals.flatMap((proposal) => Array.isArray(proposal.evidence)
      ? (proposal.evidence as Array<Record<string, unknown>>).map((item) => item.candidateId).filter((value): value is string => typeof value === "string")
      : []))].sort();
    const ordinals = new Map(usedIds.map((value, index) => [value, index]));
    const evidenceObjects: Array<{ objectKey: string; stillId: string; sha256: string; byteLength: number }> = [];
    const publicProposals = proposals.map((proposal) => ({
      ...proposal,
      evidence: (Array.isArray(proposal.evidence) ? proposal.evidence : []).map((value) => {
        const item = value as Record<string, unknown>;
        const id = item.candidateId;
        const still = typeof item.still === "object" && item.still !== null ? item.still as Record<string, unknown> : {};
        if (typeof id !== "string" || typeof still.base64 !== "string" || typeof still.sha256 !== "string") throw new Error("Mapped evidence was incomplete.");
        const stored = objects.get(id);
        const bytes = Buffer.from(still.base64, "base64");
        if (!stored || digest(bytes) !== stored.sha256 || still.sha256 !== stored.sha256 || bytes.byteLength !== stored.byteLength) throw new Error("Mapped evidence did not match the registered R2 object.");
        evidenceObjects.push({ objectKey: stored.objectKey, stillId: id, sha256: stored.sha256, byteLength: stored.byteLength });
        const { base64: omitted, ...stillMetadata } = still;
        void omitted;
        return { ...item, still: { ...stillMetadata, url: "/api/video/jobs/" + jobId + "/evidence/" + ordinals.get(id) } };
      }),
    }));
    const segment = job.segmentResult ?? {};
    await persistCompletedStage(jobId, leaseId, { segment, mapped: { ...result, proposals: publicProposals } }, evidenceObjects);
    await cleanupTerminalSource(jobId, storage);
    return "processed";
  } catch {
    await failStage(job, leaseId, "muse", "VIDEO_MAPPING_FAILED", "Video mapping could not be completed.", true);
    await cleanupTerminalSource(jobId, storage);
    return "terminal";
  }
}
