import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

/** The R2 storage adapter is server-only. Its Node crypto dependency also keeps it out of browser bundles. */

export const MAX_R2_VIDEO_BYTES = 60 * 1024 * 1024;
export const MAX_R2_EVIDENCE_BYTES = 512 * 1024;
const DEFAULT_UPLOAD_EXPIRY_SECONDS = 15 * 60;
const MAX_UPLOAD_EXPIRY_SECONDS = 15 * 60;
const DEFAULT_DOWNLOAD_EXPIRY_SECONDS = 3 * 60;
const MAX_DOWNLOAD_EXPIRY_SECONDS = 5 * 60;
const MIN_URL_EXPIRY_SECONDS = 60;
const AWS_REGION = "auto";
const AWS_SERVICE = "s3";
const AWS_TERMINATOR = "aws4_request";
const EXPECTED_CONTENT_TYPE = {
  video: "video/mp4",
  quicktime: "video/quicktime",
  evidence: "image/jpeg",
} as const;

const MEDIA_KEY_PATTERN = /^media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:mp4|mov)$/i;
const EVIDENCE_KEY_PATTERN = /^evidence\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/i;

export interface R2StorageConfig {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional only to allow explicit configuration validation; must be the account's official R2 S3 endpoint. */
  endpoint?: string;
}

export interface R2StorageEnvironment {
  CLOUDFLARE_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ENDPOINT?: string;
}

export interface CreateUploadUrlInput {
  contentType: "video/mp4" | "video/quicktime";
  /** Exact Blob/File byte length; the browser supplies the matching Content-Length header. */
  contentLength: number;
  expiresInSeconds?: number;
}

export interface CreateUploadUrlResult {
  /** Opaque server-generated key. Persist this alongside the complete media identity. */
  objectKey: string;
  contentLength: number;
  /** Short-lived bearer URL for one exact object and PUT operation. Never log or persist it. */
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: Readonly<Record<string, string>>;
}

export interface CreateDownloadUrlInput {
  objectKey: string;
  expiresInSeconds?: number;
}

export interface CreateMediaDownloadUrlInput {
  /** Must be a server-created video object key. */
  objectKey: string;
  expiresInSeconds?: number;
}

export interface CreateDownloadUrlResult {
  /** Short-lived bearer URL for an evidence JPEG only. Never log or persist it. */
  downloadUrl: string;
  expiresAt: string;
}

export interface R2ObjectMetadata {
  objectKey: string;
  contentLength: number;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
}

export interface R2StoredObject extends R2ObjectMetadata {
  /** Bounded stream from the private bucket; callers must hash actual bytes before trusting them. */
  body: ReadableStream<Uint8Array>;
}

export interface PutR2ObjectInput {
  /** Must be an evidence key created by createEvidenceObjectKey(). */
  objectKey: string;
  body: Uint8Array;
  contentType: "image/jpeg";
  /** SHA-256 hex of body, checked against bytes before upload. */
  sha256: string;
}

export interface PutR2ObjectResult {
  objectKey: string;
  contentLength: number;
  etag: string | null;
}

export interface R2Storage {
  createUploadUrl(input: CreateUploadUrlInput): Promise<CreateUploadUrlResult>;
  createEvidenceObjectKey(): string;
  putObject(input: PutR2ObjectInput): Promise<PutR2ObjectResult>;
  createDownloadUrl(input: CreateDownloadUrlInput): Promise<CreateDownloadUrlResult>;
  createMediaDownloadUrl(input: CreateMediaDownloadUrlInput): Promise<CreateDownloadUrlResult>;
  headObject(objectKey: string): Promise<R2ObjectMetadata | null>;
  getObject(objectKey: string): Promise<R2StoredObject | null>;
  deleteObject(objectKey: string): Promise<void>;
}

export interface R2StorageDependencies {
  fetch?: typeof fetch;
  now?: () => Date;
  randomUUID?: () => string;
}

export class R2StorageError extends Error {
  readonly code = "R2_STORAGE_UNAVAILABLE" as const;

  constructor(message = "Private media storage is temporarily unavailable.") {
    super(message);
    this.name = "R2StorageError";
  }
}

export class R2StorageConfigurationError extends Error {
  readonly code = "R2_STORAGE_CONFIGURATION_INVALID" as const;

  constructor() {
    super("Private media storage is not configured correctly.");
    this.name = "R2StorageConfigurationError";
  }
}

/** Read server-only environment values without ever returning the secret in diagnostics. */
export function readR2StorageConfig(
  env: R2StorageEnvironment | NodeJS.ProcessEnv = process.env,
): R2StorageConfig {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const bucketName = env.R2_BUCKET_NAME?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const endpoint = env.R2_ENDPOINT?.trim() || undefined;

  if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
    throw new R2StorageConfigurationError();
  }

  return validateConfig({ accountId, bucketName, accessKeyId, secretAccessKey, endpoint });
}

/**
 * Creates a Cloudflare R2 S3-compatible adapter. All credentials stay in this
 * closure; returned values contain only opaque object keys and short-lived URLs.
 */
export function createR2Storage(
  config: R2StorageConfig = readR2StorageConfig(),
  dependencies: R2StorageDependencies = {},
): R2Storage {
  const validatedConfig = validateConfig(config);
  const fetchImpl = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const uuid = dependencies.randomUUID ?? randomUUID;
  const endpoint = new URL(validatedConfig.endpoint ?? defaultEndpoint(validatedConfig.accountId));

  return {
    async createUploadUrl(input) {
      if (input.contentType !== EXPECTED_CONTENT_TYPE.video && input.contentType !== EXPECTED_CONTENT_TYPE.quicktime) {
        throw new TypeError("Only MP4 or QuickTime walkthrough uploads are supported.");
      }
      if (!Number.isSafeInteger(input.contentLength) || input.contentLength <= 0 || input.contentLength > MAX_R2_VIDEO_BYTES) {
        throw new RangeError("The video upload exceeded the supported size.");
      }
      const expiresInSeconds = validateExpiry(
        input.expiresInSeconds,
        DEFAULT_UPLOAD_EXPIRY_SECONDS,
        MAX_UPLOAD_EXPIRY_SECONDS,
      );
      const extension = input.contentType === EXPECTED_CONTENT_TYPE.quicktime ? "mov" : "mp4";
      const objectKey = `media/${validateUuid(uuid())}.${extension}`;
      const requiredHeaders = Object.freeze({
        "content-type": input.contentType,
        "if-none-match": "*",
      });
      const issuedAt = now();
      const uploadUrl = presignUrl({
        config: validatedConfig,
        endpoint,
        method: "PUT",
        objectKey,
        expiresInSeconds,
        issuedAt,
        extraHeaders: {
          ...requiredHeaders,
          "content-length": String(input.contentLength),
        },
      });

      return {
        objectKey,
        contentLength: input.contentLength,
        uploadUrl,
        expiresAt: new Date(issuedAt.getTime() + expiresInSeconds * 1000).toISOString(),
        requiredHeaders,
      };
    },

    createEvidenceObjectKey() {
      return `evidence/${validateUuid(uuid())}.jpg`;
    },

    async putObject(input) {
      assertEvidenceKey(input.objectKey);
      if (input.contentType !== EXPECTED_CONTENT_TYPE.evidence) {
        throw new TypeError("Only JPEG evidence images are supported.");
      }
      if (input.body.byteLength < 4 || input.body.byteLength > MAX_R2_EVIDENCE_BYTES) {
        throw new RangeError("The evidence image exceeded the supported size.");
      }
      const actualHash = createHash("sha256").update(input.body).digest();
      const expectedHash = parseSha256(input.sha256);
      if (!timingSafeEqual(actualHash, expectedHash)) {
        throw new TypeError("The evidence image hash did not match its bytes.");
      }

      const bytes = Buffer.from(input.body.buffer, input.body.byteOffset, input.body.byteLength);
      const response = await signedRequest({
        config: validatedConfig,
        endpoint,
        method: "PUT",
        objectKey: input.objectKey,
        fetchImpl,
        now: now(),
        contentType: EXPECTED_CONTENT_TYPE.evidence,
        body: bytes,
        payloadHash: actualHash.toString("hex"),
        conditionalCreate: true,
      });
      await requireSuccess(response);
      return {
        objectKey: input.objectKey,
        contentLength: bytes.byteLength,
        etag: cleanEtag(response.headers.get("etag")),
      };
    },

    async createDownloadUrl(input) {
      assertEvidenceKey(input.objectKey);
      const expiresInSeconds = validateExpiry(
        input.expiresInSeconds,
        DEFAULT_DOWNLOAD_EXPIRY_SECONDS,
        MAX_DOWNLOAD_EXPIRY_SECONDS,
      );
      const issuedAt = now();
      const downloadUrl = presignUrl({
        config: validatedConfig,
        endpoint,
        method: "GET",
        objectKey: input.objectKey,
        expiresInSeconds,
        issuedAt,
      });
      return {
        downloadUrl,
        expiresAt: new Date(issuedAt.getTime() + expiresInSeconds * 1000).toISOString(),
      };
    },

    async createMediaDownloadUrl(input) {
      assertMediaKey(input.objectKey);
      const expiresInSeconds = validateExpiry(
        input.expiresInSeconds,
        DEFAULT_DOWNLOAD_EXPIRY_SECONDS,
        MAX_DOWNLOAD_EXPIRY_SECONDS,
      );
      const issuedAt = now();
      const downloadUrl = presignUrl({
        config: validatedConfig,
        endpoint,
        method: "GET",
        objectKey: input.objectKey,
        expiresInSeconds,
        issuedAt,
      });
      return {
        downloadUrl,
        expiresAt: new Date(issuedAt.getTime() + expiresInSeconds * 1000).toISOString(),
      };
    },

    async headObject(objectKey) {
      const kind = validateObjectKey(objectKey);
      const response = await signedRequest({
        config: validatedConfig,
        endpoint,
        method: "HEAD",
        objectKey,
        fetchImpl,
        now: now(),
      });
      if (response.status === 404) return null;
      await requireSuccess(response);
      const contentLength = parseContentLength(response.headers.get("content-length"), kind);
      const contentType = normalizeContentType(response.headers.get("content-type"));
      if (contentType !== expectedContentType(kind)) throw new R2StorageError();
      return {
        objectKey,
        contentLength,
        contentType,
        etag: cleanEtag(response.headers.get("etag")),
        lastModified: safeHttpDate(response.headers.get("last-modified")),
      };
    },

    async getObject(objectKey) {
      const kind = validateObjectKey(objectKey);
      const response = await signedRequest({
        config: validatedConfig,
        endpoint,
        method: "GET",
        objectKey,
        fetchImpl,
        now: now(),
      });
      if (response.status === 404) return null;
      await requireSuccess(response);
      const contentLength = parseContentLength(response.headers.get("content-length"), kind);
      const contentType = normalizeContentType(response.headers.get("content-type"));
      if (contentType !== expectedContentType(kind) || !response.body) throw new R2StorageError();
      return {
        objectKey,
        contentLength,
        contentType,
        etag: cleanEtag(response.headers.get("etag")),
        lastModified: safeHttpDate(response.headers.get("last-modified")),
        body: validateBodyLength(response.body, contentLength),
      };
    },

    async deleteObject(objectKey) {
      validateObjectKey(objectKey);
      const response = await signedRequest({
        config: validatedConfig,
        endpoint,
        method: "DELETE",
        objectKey,
        fetchImpl,
        now: now(),
      });
      await requireSuccess(response);
    },
  };
}

interface SignedRequestInput {
  config: R2StorageConfig;
  endpoint: URL;
  method: "PUT" | "GET" | "HEAD" | "DELETE";
  objectKey: string;
  fetchImpl: typeof fetch;
  now: Date;
  contentType?: string;
  body?: Uint8Array;
  payloadHash?: string;
  conditionalCreate?: boolean;
}

async function signedRequest(input: SignedRequestInput): Promise<Response> {
  const url = objectUrl(input.endpoint, input.config.bucketName, input.objectKey);
  const amzDate = toAmzDate(input.now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = input.payloadHash ?? "UNSIGNED-PAYLOAD";
  const headers = new Headers({
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  });
  if (input.contentType) headers.set("content-type", input.contentType);
  if (input.conditionalCreate) headers.set("if-none-match", "*");

  const signedHeaderNames = [...headers.keys(), "host"].map((name) => name.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => {
    if (name === "host") return `host:${url.host}\n`;
    return `${name}:${headers.get(name)?.trim().replace(/\s+/g, " ")}\n`;
  }).join("");
  const canonicalRequest = [
    input.method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaderNames.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${AWS_REGION}/${AWS_SERVICE}/${AWS_TERMINATOR}`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = signStringToSign(input.config.secretAccessKey, dateStamp, stringToSign);
  headers.set(
    "authorization",
    `AWS4-HMAC-SHA256 Credential=${input.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`,
  );

  try {
    return await input.fetchImpl(url, {
      method: input.method,
      headers,
      ...(input.body ? { body: input.body } : {}),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new R2StorageError();
  }
}

interface PresignInput {
  config: R2StorageConfig;
  endpoint: URL;
  method: "PUT" | "GET";
  objectKey: string;
  expiresInSeconds: number;
  issuedAt: Date;
  extraHeaders?: Readonly<Record<string, string>>;
}

function presignUrl(input: PresignInput): string {
  const url = objectUrl(input.endpoint, input.config.bucketName, input.objectKey);
  const amzDate = toAmzDate(input.issuedAt);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${AWS_REGION}/${AWS_SERVICE}/${AWS_TERMINATOR}`;
  const headers: Record<string, string> = {
    host: url.host,
    ...(input.extraHeaders ?? {}),
  };
  const signedHeaderNames = Object.keys(headers).map((name) => name.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers[name]?.trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const queryEntries: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${input.config.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(input.expiresInSeconds)],
    ["X-Amz-SignedHeaders", signedHeaderNames.join(";")],
  ];
  const canonicalQuery = canonicalizeQuery(queryEntries);
  const canonicalRequest = [
    input.method,
    url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderNames.join(";"),
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = signStringToSign(input.config.secretAccessKey, dateStamp, stringToSign);
  return `${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function canonicalizeQuery(entries: Array<[string, string]>): string {
  return entries
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
        : leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0,
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function objectUrl(endpoint: URL, bucketName: string, objectKey: string): URL {
  const kind = validateObjectKey(objectKey);
  const keyPath = objectKey.split("/").map(awsEncode).join("/");
  const url = new URL(`${endpoint.origin}/${awsEncode(bucketName)}/${keyPath}`);
  const expectedType = expectedContentType(kind);
  if (!expectedType) throw new R2StorageError();
  return url;
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function signStringToSign(secretAccessKey: string, dateStamp: string, stringToSign: string): string {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, AWS_REGION);
  const serviceKey = hmac(regionKey, AWS_SERVICE);
  const signingKey = hmac(serviceKey, AWS_TERMINATOR);
  return createHmac("sha256", signingKey).update(stringToSign).digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateConfig(config: R2StorageConfig): R2StorageConfig {
  const accountId = config.accountId.trim();
  const bucketName = config.bucketName.trim();
  const accessKeyId = config.accessKeyId.trim();
  const secretAccessKey = config.secretAccessKey.trim();
  if (
    !/^[a-f0-9]{32}$/i.test(accountId) ||
    !isValidBucketName(bucketName) ||
    accessKeyId.length < 16 || accessKeyId.length > 128 || /\s/.test(accessKeyId) ||
    secretAccessKey.length < 16 || secretAccessKey.length > 256 || /\s/.test(secretAccessKey)
  ) {
    throw new R2StorageConfigurationError();
  }
  const endpoint = config.endpoint?.trim();
  if (endpoint !== undefined && !isValidEndpoint(endpoint, accountId)) {
    throw new R2StorageConfigurationError();
  }
  return { accountId, bucketName, accessKeyId, secretAccessKey, ...(endpoint ? { endpoint } : {}) };
}

function isValidBucketName(value: string): boolean {
  if (value.length < 3 || value.length > 63 || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value)) return false;
  if (value.includes("..") || value.includes(".-") || value.includes("-.")) return false;
  return !/^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

function defaultEndpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function isValidEndpoint(value: string, accountId: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === `${accountId.toLowerCase()}.r2.cloudflarestorage.com` &&
      parsed.port === "" &&
      (parsed.pathname === "/" || parsed.pathname === "") &&
      parsed.search === "" && parsed.hash === "" && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}

function validateUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new R2StorageError();
  }
  return value.toLowerCase();
}

function assertMediaKey(objectKey: string): void {
  if (!MEDIA_KEY_PATTERN.test(objectKey)) {
    throw new TypeError("The private media object key is invalid.");
  }
}

function validateObjectKey(objectKey: string): "mp4" | "mov" | "evidence" {
  if (MEDIA_KEY_PATTERN.test(objectKey)) return objectKey.endsWith(".mov") ? "mov" : "mp4";
  if (EVIDENCE_KEY_PATTERN.test(objectKey)) return "evidence";
  throw new TypeError("The private media object key is invalid.");
}

function assertEvidenceKey(objectKey: string): void {
  if (!EVIDENCE_KEY_PATTERN.test(objectKey)) {
    throw new TypeError("The private evidence object key is invalid.");
  }
}

function expectedContentType(kind: "mp4" | "mov" | "evidence"): string {
  if (kind === "evidence") return EXPECTED_CONTENT_TYPE.evidence;
  return kind === "mov" ? EXPECTED_CONTENT_TYPE.quicktime : EXPECTED_CONTENT_TYPE.video;
}

function validateExpiry(value: number | undefined, fallback: number, maximum: number): number {
  const seconds = value ?? fallback;
  if (!Number.isSafeInteger(seconds) || seconds < MIN_URL_EXPIRY_SECONDS || seconds > maximum) {
    throw new RangeError("The private object URL lifetime is outside the supported range.");
  }
  return seconds;
}

function parseSha256(value: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new TypeError("The evidence image hash is invalid.");
  return Buffer.from(value, "hex");
}

function parseContentLength(value: string | null, kind: "mp4" | "mov" | "evidence"): number {
  const max = kind === "evidence" ? MAX_R2_EVIDENCE_BYTES : MAX_R2_VIDEO_BYTES;
  const parsed = value === null ? Number.NaN : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) throw new R2StorageError();
  return parsed;
}

function validateBodyLength(
  body: ReadableStream<Uint8Array>,
  expectedLength: number,
): ReadableStream<Uint8Array> {
  let bytesRead = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesRead += chunk.byteLength;
      if (bytesRead > expectedLength) {
        controller.error(new R2StorageError());
        return;
      }
      controller.enqueue(chunk);
    },
    flush(controller) {
      if (bytesRead !== expectedLength) controller.error(new R2StorageError());
    },
  }));
}

function normalizeContentType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function cleanEtag(value: string | null): string | null {
  if (!value || value.length > 256 || /[\r\n]/.test(value)) return null;
  return value;
}

function safeHttpDate(value: string | null): string | null {
  if (!value || value.length > 64 || /[\r\n]/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function requireSuccess(response: Response): Promise<void> {
  if (!response.ok) {
    // Do not include provider response bodies, request URLs, or credentials in errors.
    try { await response.body?.cancel(); } catch { /* ignore transport cleanup */ }
    throw new R2StorageError();
  }
}
