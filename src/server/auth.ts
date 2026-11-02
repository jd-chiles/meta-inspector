/**
 * In-app passcode gate (pilot access control).
 *
 * Azure Easy Auth's Entra handshake (form_post intermediate page) does not
 * complete on iOS browsers, so production uses this instead: one shared
 * passcode checked server-side, with a stateless HMAC session cookie.
 * The passcode never enters the browser bundle, logs, or exports.
 *
 * Runtime-agnostic (Web Crypto only) so middleware (edge) and routes
 * (nodejs) share one implementation.
 */

export const AUTH_COOKIE_NAME = "mi_auth";
const COOKIE_LABEL = "metainspect-auth-v1";
const COOKIE_VERSION = "v1";

type EnvLike = { INSPECTION_PASSCODE?: string };

/** The gate is active only when a passcode is configured (prod). Unset in CI/test. */
export function isAuthGateEnabled(env?: EnvLike): boolean {
  const passcode = env?.INSPECTION_PASSCODE ?? process.env.INSPECTION_PASSCODE ?? "";
  return passcode.length > 0;
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Constant-time byte comparison. */
function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Timing-safe passcode comparison; hashes first so lengths never leak. */
export async function verifyPasscode(input: string, passcode: string): Promise<boolean> {
  if (input.length === 0 || passcode.length === 0) return false;
  const a = bytes(await sha256Hex(input));
  const b = bytes(await sha256Hex(passcode));
  return safeEqual(a, b);
}

function toBase64Url(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Stateless session cookie: HMAC(passcode, label). Knowing the cookie does
 * not reveal the passcode, and forging one requires the passcode itself.
 */
export async function signAuthCookie(passcode: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(passcode),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes(COOKIE_LABEL)));
  return `${COOKIE_VERSION}.${toBase64Url(mac)}`;
}

export async function verifyAuthCookie(
  value: string | undefined,
  passcode: string,
): Promise<boolean> {
  if (!value || passcode.length === 0) return false;
  const expected = await signAuthCookie(passcode);
  return safeEqual(bytes(value), bytes(expected));
}

/**
 * Client IP for throttling: the rightmost X-Forwarded-For entry, added by
 * the ingress closest to us. The leftmost entry is client-controlled and
 * must never select the throttle bucket.
 */
export function clientIpFromHeaders(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for") ?? "";
  const entries = forwarded
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? entries[entries.length - 1]! : "unknown";
}

export interface UnlockThrottle {
  throttled(ip: string): boolean;
  size(): number;
}

/**
 * Bounded in-memory attempt throttle. Entries expire by window; when the
 * map is full, expired entries are swept first and oldest-inserted
 * entries are evicted second, so memory can never grow without bound.
 */
export function createUnlockThrottle(options?: {
  maxAttempts?: number;
  windowMs?: number;
  maxEntries?: number;
}): UnlockThrottle {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 10);
  const windowMs = Math.max(1, options?.windowMs ?? 10 * 60 * 1000);
  const maxEntries = Math.max(1, options?.maxEntries ?? 1000);
  const attemptsByIp = new Map<string, { count: number; resetAt: number }>();
  return {
    throttled(ip: string): boolean {
      const now = Date.now();
      const record = attemptsByIp.get(ip);
      if (!record || now >= record.resetAt) {
        if (!record && attemptsByIp.size >= maxEntries) {
          for (const [key, entry] of attemptsByIp) {
            if (entry.resetAt <= now) attemptsByIp.delete(key);
          }
          while (attemptsByIp.size >= maxEntries) {
            const oldest = attemptsByIp.keys().next();
            if (oldest.done) break;
            attemptsByIp.delete(oldest.value);
          }
        }
        attemptsByIp.set(ip, { count: 1, resetAt: now + windowMs });
        return false;
      }
      record.count += 1;
      return record.count > maxAttempts;
    },
    size(): number {
      return attemptsByIp.size;
    },
  };
}
