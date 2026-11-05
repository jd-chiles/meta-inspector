import { AUTH_COOKIE_NAME, isAuthGateEnabled, verifyAuthCookie } from "../auth";
import { WALKTHROUGH_CLIENT_HEADER, WALKTHROUGH_CLIENT_ID } from "../../domain/walkthrough-client";
import { InspectionPersistenceError } from "./store";

function normalizedOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    if (url.hostname.toLowerCase() === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") {
      url.hostname = "localhost";
      return url.origin;
    }
  } catch { /* invalid origins fail closed below */ }
  return origin;
}

export function inspectionJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, private, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function assertInspectionRequest(request: Request): void {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  let supplied = origin;
  if (!supplied && referer) {
    try { supplied = new URL(referer).origin; } catch { supplied = null; }
  }
  if (supplied) {
    const requestOrigin = new URL(request.url).origin;
    const configured = process.env.APP_PUBLIC_ORIGIN?.trim();
    let trustedOrigin = requestOrigin;
    if (configured) {
      try {
        const url = new URL(configured);
        if ((url.protocol !== "https:" && url.protocol !== "http:") ||
            url.origin !== configured.replace(/\/$/, "")) throw new Error("Invalid origin");
        trustedOrigin = url.origin;
      } catch {
        throw new InspectionPersistenceError("SETUP_REQUIRED", 503, "The public app origin is not configured correctly.");
      }
    }
    if (normalizedOrigin(supplied) !== normalizedOrigin(trustedOrigin)) {
      throw new InspectionPersistenceError("INVALID_REQUEST", 400, "Submit this walkthrough from the app.");
    }
  } else if (request.headers.get(WALKTHROUGH_CLIENT_HEADER) !== WALKTHROUGH_CLIENT_ID) {
    throw new InspectionPersistenceError("INVALID_REQUEST", 400, "Submit this walkthrough from the app.");
  }
}

export async function assertInspectionAuth(request: Request): Promise<void> {
  if (!isAuthGateEnabled()) {
    if (process.env.NODE_ENV === "production") {
      throw new InspectionPersistenceError("SETUP_REQUIRED", 503, "Protected access is not configured on this server.");
    }
    return;
  }
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_COOKIE_NAME}=`))?.slice(AUTH_COOKIE_NAME.length + 1);
  if (!await verifyAuthCookie(cookie, process.env.INSPECTION_PASSCODE ?? "")) {
    throw new InspectionPersistenceError("UNAUTHORIZED", 401, "Unlock the walkthrough before continuing.");
  }
}

export async function boundedInspectionJson(request: Request): Promise<unknown> {
  const maxBytes = 1024 * 1024;
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new InspectionPersistenceError("INVALID_REQUEST", 400, "Send the walkthrough as JSON.");
  }
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new InspectionPersistenceError("REQUEST_TOO_LARGE", 413, "The walkthrough is too large to save.");
  }
  if (!request.body) throw new InspectionPersistenceError("INVALID_REQUEST", 400, "The walkthrough JSON is invalid.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new InspectionPersistenceError("REQUEST_TOO_LARGE", 413, "The walkthrough is too large to save.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof InspectionPersistenceError) throw error;
    throw new InspectionPersistenceError("INVALID_REQUEST", 400, "The walkthrough JSON is invalid.");
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; } catch {
    throw new InspectionPersistenceError("INVALID_REQUEST", 400, "The walkthrough JSON is invalid.");
  }
}

export function inspectionFailure(error: unknown): Response {
  if (error instanceof InspectionPersistenceError) {
    return inspectionJson({ ok: false, error: { code: error.code, message: error.message } }, error.status);
  }
  return inspectionJson({ ok: false, error: { code: "INSPECTION_SERVICE_UNAVAILABLE", message: "Cloud walkthrough storage is temporarily unavailable." } }, 503);
}
