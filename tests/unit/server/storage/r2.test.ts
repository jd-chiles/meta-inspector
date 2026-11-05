import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createR2Storage,
  MAX_R2_EVIDENCE_BYTES,
  MAX_R2_VIDEO_BYTES,
  readR2StorageConfig,
  R2StorageConfigurationError,
  R2StorageError,
  type R2StorageConfig,
} from "../../../../src/server/storage/r2";

const FIXED_DATE = new Date("2026-11-04T05:06:07.000Z");
const TEST_UUID = "123e4567-e89b-42d3-a456-426614174000";
const CONFIG: R2StorageConfig = {
  accountId: "0123456789abcdef0123456789abcdef",
  bucketName: "walkthrough-private-media",
  accessKeyId: "0123456789abcdef0123456789abcdef",
  secretAccessKey: "test-secret-key-that-is-never-returned",
};

describe("private R2 storage adapter", () => {
  it("creates short-lived, object-scoped, write-once MP4 PUT URLs bound to size and MIME", async () => {
    const storage = createR2Storage(CONFIG, { now: () => FIXED_DATE, randomUUID: () => TEST_UUID });

    const result = await storage.createUploadUrl({ contentType: "video/mp4", contentLength: 1024 });
    const url = new URL(result.uploadUrl);

    expect(result.objectKey).toBe(`media/${TEST_UUID}.mp4`);
    expect(result.contentLength).toBe(1024);
    expect(result.expiresAt).toBe("2026-11-04T05:21:07.000Z");
    expect(result.requiredHeaders).toEqual({ "content-type": "video/mp4", "if-none-match": "*" });
    expect(url.origin).toBe(`https://${CONFIG.accountId}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe(`/${CONFIG.bucketName}/${result.objectKey}`);
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host;if-none-match");
    expect(url.searchParams.get("X-Amz-Credential")).toContain("/auto/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(result.uploadUrl).not.toContain(CONFIG.secretAccessKey);
  });

  it("accepts MOV bytes for server-side normalization and signs the QuickTime MIME", async () => {
    const storage = createR2Storage(CONFIG, { now: () => FIXED_DATE, randomUUID: () => TEST_UUID });
    const result = await storage.createUploadUrl({ contentType: "video/quicktime", contentLength: 2048 });
    const url = new URL(result.uploadUrl);

    expect(result.objectKey).toBe(`media/${TEST_UUID}.mov`);
    expect(result.requiredHeaders).toEqual({ "content-type": "video/quicktime", "if-none-match": "*" });
    expect(url.pathname).toBe(`/${CONFIG.bucketName}/${result.objectKey}`);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host;if-none-match");
  });

  it("rejects invalid and oversized browser upload intents before signing", async () => {
    const storage = createR2Storage(CONFIG, { now: () => FIXED_DATE, randomUUID: () => TEST_UUID });
    await expect(storage.createUploadUrl({ contentType: "video/mp4", contentLength: 0 })).rejects.toThrow(RangeError);
    await expect(storage.createUploadUrl({ contentType: "video/mp4", contentLength: MAX_R2_VIDEO_BYTES + 1 })).rejects.toThrow(RangeError);
    await expect(storage.createUploadUrl({ contentType: "video/mp4", contentLength: 12, expiresInSeconds: 901 })).rejects.toThrow(RangeError);
  });

  it("rejects incomplete or endpoint-confused configuration without revealing values", () => {
    expect(() => readR2StorageConfig({ CLOUDFLARE_ACCOUNT_ID: "bad", R2_SECRET_ACCESS_KEY: "private-secret-value" }))
      .toThrow(R2StorageConfigurationError);
    expect(() => createR2Storage({ ...CONFIG, endpoint: "http://127.0.0.1:9000" }))
      .toThrow(R2StorageConfigurationError);
    expect(() => createR2Storage({ ...CONFIG, endpoint: "https://attacker.example" }))
      .toThrow(R2StorageConfigurationError);
    expect(() => createR2Storage({ ...CONFIG, bucketName: "../private" }))
      .toThrow(R2StorageConfigurationError);
  });

  it("generates scoped evidence and source-media URLs and rejects traversal keys", async () => {
    const storage = createR2Storage(CONFIG, { now: () => FIXED_DATE, randomUUID: () => TEST_UUID });
    const evidenceKey = storage.createEvidenceObjectKey();
    const signed = await storage.createDownloadUrl({ objectKey: evidenceKey, expiresInSeconds: 120 });
    const url = new URL(signed.downloadUrl);

    expect(evidenceKey).toBe(`evidence/${TEST_UUID}.jpg`);
    expect(url.pathname).toBe(`/${CONFIG.bucketName}/${evidenceKey}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
    await expect(storage.createDownloadUrl({ objectKey: `media/${TEST_UUID}.mp4` })).rejects.toThrow(TypeError);
    const media = await storage.createMediaDownloadUrl({ objectKey: `media/${TEST_UUID}.mov` });
    expect(new URL(media.downloadUrl).pathname).toBe(`/${CONFIG.bucketName}/media/${TEST_UUID}.mov`);
    await expect(storage.createMediaDownloadUrl({ objectKey: "media/../../private.mov" })).rejects.toThrow(TypeError);
    await expect(storage.headObject("../../etc/passwd")).rejects.toThrow(TypeError);
  });

  it("writes only hash-verified bounded evidence JPEGs with an atomic create-only condition", async () => {
    const frameBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchMock: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(null, { status: 200, headers: { etag: '"frame-etag"' } });
    };
    const storage = createR2Storage(CONFIG, {
      now: () => FIXED_DATE,
      randomUUID: () => TEST_UUID,
      fetch: fetchMock,
    });
    const objectKey = storage.createEvidenceObjectKey();
    const digest = createHash("sha256").update(frameBytes).digest("hex");

    await expect(storage.putObject({ objectKey, body: frameBytes, contentType: "image/jpeg", sha256: "0".repeat(64) }))
      .rejects.toThrow("hash did not match");
    expect(requestInit).toBeUndefined();

    const result = await storage.putObject({ objectKey, body: frameBytes, contentType: "image/jpeg", sha256: digest });
    const headers = new Headers(requestInit?.headers);
    expect(new URL(requestUrl).pathname).toBe(`/${CONFIG.bucketName}/${objectKey}`);
    expect(requestInit?.method).toBe("PUT");
    expect(headers.get("content-type")).toBe("image/jpeg");
    expect(headers.get("if-none-match")).toBe("*");
    expect(headers.get("x-amz-content-sha256")).toBe(digest);
    expect(headers.get("authorization")).toContain(CONFIG.accessKeyId);
    expect(headers.get("authorization")).not.toContain(CONFIG.secretAccessKey);
    expect(result).toEqual({ objectKey, contentLength: frameBytes.byteLength, etag: '"frame-etag"' });

    await expect(storage.putObject({
      objectKey,
      body: new Uint8Array(MAX_R2_EVIDENCE_BYTES + 1),
      contentType: "image/jpeg",
      sha256: digest,
    })).rejects.toThrow(RangeError);
  });

  it("performs scoped HEAD, GET, and DELETE calls and bounds returned metadata", async () => {
    const frameBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const methods: string[] = [];
    const fetchMock: typeof fetch = async (_input, init) => {
      const method = String(init?.method);
      methods.push(method);
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: {
          "content-length": String(frameBytes.length),
          "content-type": "image/jpeg",
          etag: '"evidence-etag"',
          "last-modified": "Tue, 03 Nov 2026 12:00:00 GMT",
        } });
      }
      if (method === "GET") {
        return new Response(frameBytes, { status: 200, headers: {
          "content-length": String(frameBytes.length),
          "content-type": "image/jpeg",
          etag: '"evidence-etag"',
        } });
      }
      return new Response(null, { status: 204 });
    };
    const storage = createR2Storage(CONFIG, { now: () => FIXED_DATE, randomUUID: () => TEST_UUID, fetch: fetchMock });
    const key = storage.createEvidenceObjectKey();
    const head = await storage.headObject(key);
    const object = await storage.getObject(key);
    expect(object).not.toBeNull();
    const bytes = new Uint8Array(await new Response(object!.body).arrayBuffer());
    await storage.deleteObject(key);

    expect(head).toEqual({
      objectKey: key,
      contentLength: 4,
      contentType: "image/jpeg",
      etag: '"evidence-etag"',
      lastModified: "2026-11-03T12:00:00.000Z",
    });
    expect(object?.contentLength).toBe(4);
    expect(bytes).toEqual(frameBytes);
    expect(methods).toEqual(["HEAD", "GET", "DELETE"]);
  });

  it("treats a missing object as absent and sanitizes storage errors", async () => {
    const fetchMock: typeof fetch = async () => new Response("secret-provider-error-with-token", { status: 503 });
    const storage = createR2Storage(CONFIG, { now: () => FIXED_DATE, randomUUID: () => TEST_UUID, fetch: fetchMock });
    const key = storage.createEvidenceObjectKey();

    const missing = createR2Storage(CONFIG, {
      now: () => FIXED_DATE,
      randomUUID: () => TEST_UUID,
      fetch: async () => new Response(null, { status: 404 }),
    });
    expect(await missing.headObject(key)).toBeNull();
    const error = await storage.getObject(key).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(R2StorageError);
    expect((error as Error).message).not.toContain("secret-provider-error-with-token");
  });

  it("rejects a streamed body whose actual byte count differs from private object metadata", async () => {
    const storage = createR2Storage(CONFIG, {
      now: () => FIXED_DATE,
      randomUUID: () => TEST_UUID,
      fetch: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { "content-length": "5", "content-type": "image/jpeg" },
      }),
    });
    const object = await storage.getObject(storage.createEvidenceObjectKey());
    expect(object).not.toBeNull();
    await expect(new Response(object!.body).arrayBuffer()).rejects.toBeInstanceOf(R2StorageError);
  });
});
