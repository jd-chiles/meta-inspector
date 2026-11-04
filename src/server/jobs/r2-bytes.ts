import { createHash, timingSafeEqual } from "node:crypto";
import type { R2Storage, R2StoredObject } from "../storage/r2";

export async function readBoundedObject(
  object: R2StoredObject,
  maxBytes: number,
  expectedLength?: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(object.contentLength) || object.contentLength <= 0 || object.contentLength > maxBytes ||
      (expectedLength !== undefined && object.contentLength !== expectedLength)) {
    try { await object.body.cancel(); } catch { /* Ignore an already closed stream. */ }
    throw new Error("Stored media exceeded the expected size.");
  }
  const reader = object.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      byteLength += next.value.byteLength;
      if (byteLength > maxBytes || byteLength > object.contentLength) {
        await reader.cancel();
        throw new Error("Stored media exceeded the expected size.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (byteLength !== object.contentLength || (expectedLength !== undefined && byteLength !== expectedLength)) {
    throw new Error("Stored media did not match its recorded size.");
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function matchesSha256(bytes: Uint8Array, expectedHex: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(expectedHex)) return false;
  const actual = createHash("sha256").update(bytes).digest();
  const expected = Buffer.from(expectedHex, "hex");
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

export async function getVerifiedR2Bytes(
  storage: R2Storage,
  objectKey: string,
  maxBytes: number,
  expected: { contentLength?: number; contentType: string; sha256?: string },
): Promise<Uint8Array> {
  const object = await storage.getObject(objectKey);
  if (!object || object.contentType.toLowerCase() !== expected.contentType.toLowerCase()) {
    throw new Error("Stored media could not be verified.");
  }
  const bytes = await readBoundedObject(object, maxBytes, expected.contentLength);
  if (expected.sha256 && !matchesSha256(bytes, expected.sha256)) {
    throw new Error("Stored media did not match the expected hash.");
  }
  return bytes;
}
