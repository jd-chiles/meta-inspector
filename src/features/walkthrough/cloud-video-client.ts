/** Browser client for durable video jobs and ephemeral, direct-to-R2 uploads. */

export interface CloudVideoIdentity {
  sessionId: string;
  schemaVersion: number;
  videoId: string;
  videoRevision: number;
  analysisId: string;
  attempt: number;
  catalogVersion: string;
  expectedVideoSha256: string;
}

export type CloudVideoIdentitySeed = Omit<CloudVideoIdentity, "expectedVideoSha256">;
export type CloudVideoJobIdentity = CloudVideoIdentitySeed & { expectedVideoSha256?: string };

export interface CloudVideoJobSnapshot {
  jobId: string;
  status: string;
  stage?: string;
  retryable?: boolean;
  identity: CloudVideoJobIdentity;
  sourceUrl?: string;
  media?: {
    sourceUrl?: string;
    contentType: "video/mp4" | "video/quicktime";
    contentLength: number;
    sha256: string;
    durationMs?: number;
    durationSeconds?: number;
    width?: number;
    height?: number;
    capturedAt?: string;
    fileName?: string;
  };
  error?: { code?: string; message?: string; retryable?: boolean };
  result?: unknown;
}

export interface CloudVideoJobClient {
  upload(input: {
    sessionId: string;
    roomId: string;
    fileName: string;
    contentType: "video/mp4" | "video/quicktime";
    video: Blob;
    identity: CloudVideoIdentitySeed;
    onUploadJobCreated?: (jobId: string, identity: CloudVideoIdentitySeed) => void | Promise<void>;
    signal?: AbortSignal;
    onProgress?: (progress: CloudVideoUploadProgress) => void;
  }): Promise<CloudVideoJobSnapshot>;
  get(jobId: string, signal?: AbortSignal): Promise<CloudVideoJobSnapshot>;
  process(jobId: string, identity: CloudVideoIdentity, signal?: AbortSignal): Promise<CloudVideoJobSnapshot>;
  retry(jobId: string, signal?: AbortSignal): Promise<CloudVideoJobSnapshot>;
  cancel(jobId: string, signal?: AbortSignal): Promise<void>;
}

/** Commit a replacement before attempting to remove its previous cloud job. */
export async function commitReplacementThenDeletePrevious<T>(input: {
  previousJobId?: string;
  replacementJobId: string;
  commit: () => Promise<{ committed: boolean; value: T }>;
  deletePrevious: (jobId: string) => Promise<void>;
}): Promise<{ value: T; cleanupPending: boolean }> {
  const committed = await input.commit();
  if (!committed.committed || !input.previousJobId || input.previousJobId === input.replacementJobId) {
    return { value: committed.value, cleanupPending: false };
  }
  try {
    await input.deletePrevious(input.previousJobId);
    return { value: committed.value, cleanupPending: false };
  } catch {
    return { value: committed.value, cleanupPending: true };
  }
}

export type CloudVideoUploadProgress =
  | { stage: "preparing"; loadedBytes: 0; totalBytes: number }
  | { stage: "uploading"; loadedBytes: number; totalBytes: number }
  | { stage: "completing"; loadedBytes: number; totalBytes: number };

export interface CloudVideoClientOptions {
  fetchImpl?: typeof fetch;
  uploadImpl?: (input: {
    url: URL;
    headers: Headers;
    video: Blob;
    signal?: AbortSignal;
    onProgress: (loadedBytes: number) => void;
  }) => Promise<void>;
  isUploadUrlAllowed?: (url: URL) => boolean;
}

const JOBS_PATH = "/api/video/jobs";
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

export function createCloudVideoClient(options: CloudVideoClientOptions = {}): CloudVideoJobClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const uploadImpl = options.uploadImpl ?? putBlobWithProgress;
  const isUploadUrlAllowed = options.isUploadUrlAllowed ?? isCloudflareR2UploadUrl;

  return {
    async upload(input) {
      validateUploadInput(input);
      const totalBytes = input.video.size;
      input.onProgress?.({ stage: "preparing", loadedBytes: 0, totalBytes });
      throwIfAborted(input.signal);

      const createResponse = await fetchImpl(JOBS_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          room: input.roomId,
          identity: input.identity,
          media: {
            contentType: input.contentType,
            contentLength: totalBytes,
          },
        }),
        cache: "no-store",
        signal: input.signal,
      });
      if (!createResponse.ok) throw new CloudVideoClientError("JOB_CREATE_FAILED", safeStatus(createResponse.status));
      const created = parseCreatedJob(await readJson(createResponse));
      try {
        await input.onUploadJobCreated?.(created.jobId, input.identity);
      } catch {
        void cancelJob(fetchImpl, created.jobId).catch(() => undefined);
        throw new CloudVideoClientError("JOB_REFERENCE_FAILED", "The walkthrough could not save the pending cloud job reference, so video upload was stopped.");
      }
      const uploadUrl = new URL(created.upload.url);
      if (!isUploadUrlAllowed(uploadUrl)) {
        throw new CloudVideoClientError("INVALID_UPLOAD_URL", "The server returned an unsupported video storage address.");
      }

      try {
        await uploadImpl({
          url: uploadUrl,
          headers: new Headers(created.upload.headers),
          video: input.video,
          signal: input.signal,
          onProgress: (loadedBytes) => input.onProgress?.({
            stage: "uploading",
            loadedBytes: Math.max(0, Math.min(totalBytes, loadedBytes)),
            totalBytes,
          }),
        });
      } catch (error) {
        // An incomplete upload has not created a processable job. Best-effort
        // cancellation releases the pending object and invalidates its URL.
        void cancelJob(fetchImpl, created.jobId).catch(() => undefined);
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw error instanceof CloudVideoClientError
          ? error
          : new CloudVideoClientError("VIDEO_UPLOAD_FAILED", "The video could not be uploaded. Check your connection and try again.");
      }

      throwIfAborted(input.signal);
      input.onProgress?.({ stage: "completing", loadedBytes: totalBytes, totalBytes });
      const completeResponse = await fetchImpl(`${JOBS_PATH}/${encodeURIComponent(created.jobId)}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
        cache: "no-store",
        signal: input.signal,
      });
      if (!completeResponse.ok) {
        throw new CloudVideoClientError(
          "JOB_COMPLETE_UNCONFIRMED",
          "The upload completed, but the cloud job status could not be confirmed. Reload this room to check its status before retrying.",
        );
      }
      const completed = parseJobSnapshot(await readJson(completeResponse));
      if (completed.status === "upload_pending" || typeof completed.identity.expectedVideoSha256 !== "string" || !completed.media ||
          completed.jobId !== created.jobId || !sameIdentitySeed(completed.identity, input.identity) ||
          (completed.media && completed.media.sha256 !== completed.identity.expectedVideoSha256)) {
        throw new CloudVideoClientError("IDENTITY_MISMATCH", "The server saved a different video version. Reload the room and try again.");
      }
      return completed;
    },

    async get(jobId, signal) {
      validateJobId(jobId);
      const response = await fetchImpl(`${JOBS_PATH}/${encodeURIComponent(jobId)}`, {
        method: "GET",
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new CloudVideoClientError("JOB_STATUS_FAILED", safeStatus(response.status));
      return parseJobSnapshot(await readJson(response));
    },

    async process(jobId, identity, signal) {
      validateJobId(jobId);
      const response = await fetchImpl(`${JOBS_PATH}/${encodeURIComponent(jobId)}/process`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identity }),
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new CloudVideoClientError("JOB_PROCESS_FAILED", safeStatus(response.status));
      const snapshot = parseJobSnapshot(await readJson(response));
      if (snapshot.jobId !== jobId || !sameFullIdentity(snapshot.identity, identity)) {
        throw new CloudVideoClientError("IDENTITY_MISMATCH", "The cloud job no longer matches this video. Reload the room before processing.");
      }
      return snapshot;
    },

    async retry(jobId, signal) {
      validateJobId(jobId);
      const response = await fetchImpl(`${JOBS_PATH}/${encodeURIComponent(jobId)}/retry`, {
        method: "POST",
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new CloudVideoClientError("JOB_RETRY_FAILED", safeStatus(response.status));
      const snapshot = parseJobSnapshot(await readJson(response));
      if (snapshot.jobId !== jobId) throw new CloudVideoClientError("IDENTITY_MISMATCH", "The retried cloud job did not match the saved video.");
      return snapshot;
    },

    async cancel(jobId, signal) {
      validateJobId(jobId);
      const response = await fetchImpl(`${JOBS_PATH}/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new CloudVideoClientError("JOB_CANCEL_FAILED", safeStatus(response.status));
      const body = await readJson(response);
      if (!isRecord(body) || body.ok !== true || typeof body.cleanupPending !== "boolean") {
        throw new CloudVideoClientError("JOB_CANCEL_UNCONFIRMED", "The server could not confirm cloud video deletion.");
      }
      if (body.cleanupPending) {
        throw new CloudVideoClientError("JOB_CLEANUP_PENDING", "Cloud video deletion is still pending. Keep this walkthrough open and retry removal.");
      }
    },
  };
}

function sameFullIdentity(actual: CloudVideoJobIdentity, expected: CloudVideoIdentity): boolean {
  return sameIdentitySeed(actual, expected) && actual.expectedVideoSha256 === expected.expectedVideoSha256;
}

export class CloudVideoClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CloudVideoClientError";
    this.code = code;
  }
}

async function putBlobWithProgress(input: {
  url: URL;
  headers: Headers;
  video: Blob;
  signal?: AbortSignal;
  onProgress: (loadedBytes: number) => void;
}): Promise<void> {
  if (typeof XMLHttpRequest === "undefined") {
    const headers = new Headers(input.headers);
    // Browser fetch controls Content-Length from the Blob body. The presigned
    // signature binds the exact byte count and the browser sends that value.
    headers.delete("content-length");
    const response = await fetch(input.url, {
      method: "PUT",
      headers,
      body: input.video,
      cache: "no-store",
      redirect: "error",
      signal: input.signal,
    });
    if (!response.ok) throw new CloudVideoClientError("VIDEO_UPLOAD_FAILED", "The video could not be uploaded. Check your connection and try again.");
    input.onProgress(input.video.size);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", input.url.href);
    request.withCredentials = false;
    for (const [name, value] of input.headers) {
      if (name.toLowerCase() !== "content-length") request.setRequestHeader(name, value);
    }
    const onAbort = () => request.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    request.upload.onprogress = (event) => input.onProgress(event.lengthComputable ? event.loaded : Math.min(input.video.size, event.loaded));
    request.onerror = () => finish(new CloudVideoClientError("VIDEO_UPLOAD_FAILED", "The video could not be uploaded. Check your connection and try again."));
    request.onabort = () => finish(new DOMException("The video upload was cancelled.", "AbortError"));
    request.onload = () => request.status >= 200 && request.status < 300
      ? finish()
      : finish(new CloudVideoClientError("VIDEO_UPLOAD_FAILED", "The video could not be uploaded. Check your connection and try again."));
    function finish(error?: unknown) {
      input.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    }
    if (input.signal?.aborted) onAbort();
    else request.send(input.video);
  });
}

async function cancelJob(fetchImpl: typeof fetch, jobId: string): Promise<void> {
  await fetchImpl(`${JOBS_PATH}/${encodeURIComponent(jobId)}`, { method: "DELETE", cache: "no-store" });
}

function validateUploadInput(input: {
  sessionId: string;
  roomId: string;
  fileName: string;
  contentType: string;
  video: Blob;
  identity: CloudVideoIdentitySeed;
}): void {
  if (!input.sessionId || input.sessionId.length > 128 || !input.roomId || input.roomId.length > 128 ||
      input.identity.sessionId !== input.sessionId) {
    throw new TypeError("A valid walkthrough session and room are required.");
  }
  if ((input.contentType !== "video/mp4" && input.contentType !== "video/quicktime") ||
      input.video.size <= 0 || input.video.size > MAX_VIDEO_BYTES) {
    throw new TypeError("Only a bounded MP4 or MOV video can be uploaded.");
  }
  if (!input.fileName || input.fileName.length > 255 || /[\u0000-\u001f\u007f]/.test(input.fileName)) {
    throw new TypeError("The video filename is invalid.");
  }
  if (!Number.isSafeInteger(input.identity.schemaVersion) || (input.identity.schemaVersion as number) < 1 ||
      !Number.isSafeInteger(input.identity.videoRevision) || input.identity.videoRevision < 1 ||
      !Number.isSafeInteger(input.identity.attempt) || input.identity.attempt < 1) {
    throw new TypeError("The video identity is invalid.");
  }
}

function parseCreatedJob(value: unknown): {
  jobId: string;
  status: "upload_pending";
  upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };
} {
  if (!isRecord(value) || value.ok !== true || typeof value.jobId !== "string" || value.jobId.length > 128 ||
      value.status !== "upload_pending" || !isRecord(value.upload) || typeof value.upload.url !== "string" ||
      value.upload.method !== "PUT" || !isRecord(value.upload.headers) || typeof value.upload.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(value.upload.expiresAt)) || Object.entries(value.upload.headers).some(([name, header]) =>
        !/^[a-z0-9-]{1,64}$/i.test(name) || typeof header !== "string" || header.length > 512)) {
    throw new CloudVideoClientError("INVALID_RESPONSE", "The server returned an invalid upload request.");
  }
  return value as unknown as ReturnType<typeof parseCreatedJob>;
}

function parseJobSnapshot(value: unknown): CloudVideoJobSnapshot {
  if (!isRecord(value) || value.ok !== true || typeof value.jobId !== "string" || value.jobId.length > 128 ||
      typeof value.status !== "string" || value.status.length > 64 || !isRecord(value.identity) || !validIdentity(value.identity, value.status) ||
      (value.stage !== undefined && (typeof value.stage !== "string" || value.stage.length > 80)) ||
      (value.retryable !== undefined && typeof value.retryable !== "boolean") ||
      (value.sourceUrl !== undefined && typeof value.sourceUrl !== "string") ||
      (value.media !== undefined && !isValidJobMedia(value.media)) ||
      (value.error !== undefined && !isValidJobError(value.error)) ||
      (value.result !== undefined && !isBoundedJsonRecord(value.result))) {
    throw new CloudVideoClientError("INVALID_RESPONSE", "The server returned an invalid video job status.");
  }
  return {
    jobId: value.jobId,
    status: value.status,
    identity: value.identity as unknown as CloudVideoJobIdentity,
    ...(typeof value.stage === "string" ? { stage: value.stage } : {}),
    ...(typeof value.retryable === "boolean" ? { retryable: value.retryable } : {}),
    ...(typeof value.sourceUrl === "string"
      ? { sourceUrl: value.sourceUrl }
      : isRecord(value.media) && typeof value.media.sourceUrl === "string"
        ? { sourceUrl: value.media.sourceUrl }
        : {}),
    ...(isRecord(value.media) ? { media: value.media as CloudVideoJobSnapshot["media"] } : {}),
    ...(isRecord(value.error) ? { error: value.error as CloudVideoJobSnapshot["error"] } : {}),
    ...(value.result !== undefined ? { result: value.result } : {}),
  };
}

function isValidJobMedia(value: unknown): boolean {
  if (!isRecord(value) || (value.contentType !== "video/mp4" && value.contentType !== "video/quicktime") ||
      !Number.isSafeInteger(value.contentLength) || (value.contentLength as number) <= 0 ||
      typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) return false;
  if (value.durationSeconds !== undefined && (typeof value.durationSeconds !== "number" || !Number.isFinite(value.durationSeconds) || value.durationSeconds < 0 || value.durationSeconds > 30)) return false;
  if (value.durationMs !== undefined && (!Number.isSafeInteger(value.durationMs) || (value.durationMs as number) < 0 || (value.durationMs as number) > 30_000)) return false;
  if (value.width !== undefined && (!Number.isSafeInteger(value.width) || (value.width as number) < 0 || (value.width as number) > 10_000)) return false;
  if (value.height !== undefined && (!Number.isSafeInteger(value.height) || (value.height as number) < 0 || (value.height as number) > 10_000)) return false;
  if (value.capturedAt !== undefined && (typeof value.capturedAt !== "string" || !Number.isFinite(Date.parse(value.capturedAt)))) return false;
  if (value.sourceUrl !== undefined) {
    if (typeof value.sourceUrl !== "string") return false;
    try {
      const url = new URL(value.sourceUrl);
      if (!isCloudflareR2UploadUrl(url)) return false;
    } catch {
      return false;
    }
  }
  return value.fileName === undefined || (typeof value.fileName === "string" && value.fileName.length <= 255);
}

function isValidJobError(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (value.code === undefined || (typeof value.code === "string" && value.code.length <= 80)) &&
    (value.message === undefined || (typeof value.message === "string" && value.message.length <= 500)) &&
    (value.retryable === undefined || typeof value.retryable === "boolean");
}

function isBoundedJsonRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  try {
    return JSON.stringify(value).length <= 1_000_000;
  } catch {
    return false;
  }
}

function validIdentity(value: Record<string, unknown>, status: string): boolean {
  return typeof value.sessionId === "string" && Number.isSafeInteger(value.schemaVersion) &&
    typeof value.videoId === "string" && Number.isSafeInteger(value.videoRevision) &&
    typeof value.analysisId === "string" && Number.isSafeInteger(value.attempt) &&
    typeof value.catalogVersion === "string" &&
    (status === "upload_pending"
      ? (value.expectedVideoSha256 === undefined || (typeof value.expectedVideoSha256 === "string" && /^[a-f0-9]{64}$/.test(value.expectedVideoSha256)))
      : typeof value.expectedVideoSha256 === "string" && /^[a-f0-9]{64}$/.test(value.expectedVideoSha256));
}

function sameIdentitySeed(left: CloudVideoJobIdentity, right: CloudVideoIdentitySeed): boolean {
  return left.sessionId === right.sessionId && left.schemaVersion === right.schemaVersion &&
    left.videoId === right.videoId && left.videoRevision === right.videoRevision &&
    left.analysisId === right.analysisId && left.attempt === right.attempt &&
    left.catalogVersion === right.catalogVersion;
}

function validateJobId(jobId: string): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(jobId)) throw new TypeError("The video job identifier is invalid.");
}

function isCloudflareR2UploadUrl(url: URL): boolean {
  return url.protocol === "https:" && /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i.test(url.hostname) &&
    url.username === "" && url.password === "" && url.hash === "";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new CloudVideoClientError("INVALID_RESPONSE", "The server returned an unreadable video job response.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The video upload was cancelled.", "AbortError");
}

function safeStatus(status: number): string {
  if (status === 401 || status === 403) return "Your walkthrough access has expired. Reload and try again.";
  if (status === 413) return "This video is too large to upload.";
  if (status === 429) return "Too many video jobs are in progress. Wait briefly and try again.";
  return "The video could not be saved. Check your connection and try again.";
}
