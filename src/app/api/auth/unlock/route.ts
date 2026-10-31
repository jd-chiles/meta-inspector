import { AUTH_COOKIE_NAME, isAuthGateEnabled, signAuthCookie, verifyPasscode } from "../../../../server/auth";

export const runtime = "nodejs";

// Tiny in-memory throttle: online guessing gets 10 tries per 10 minutes per IP.
const attemptsByIp = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;

function throttled(ip: string): boolean {
  const now = Date.now();
  const record = attemptsByIp.get(ip);
  if (!record || now >= record.resetAt) {
    attemptsByIp.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  record.count += 1;
  return record.count > MAX_ATTEMPTS;
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthGateEnabled()) {
    return Response.json({ ok: false, error: { code: "SETUP_REQUIRED", message: "Access control is not configured." } }, { status: 503 });
  }
  const passcode = process.env.INSPECTION_PASSCODE ?? "";
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  if (throttled(ip)) {
    return Response.json({ ok: false, error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." } }, { status: 429 });
  }
  let input = "";
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && typeof (body as { passcode?: unknown }).passcode === "string") {
      input = (body as { passcode: string }).passcode;
    }
  } catch {
    input = "";
  }
  if (input.length > 200 || !(await verifyPasscode(input, passcode))) {
    return Response.json({ ok: false, error: { code: "INVALID_REQUEST", message: "Wrong passcode." } }, { status: 401 });
  }
  const cookie = await signAuthCookie(passcode);
  const response = Response.json({ ok: true }, { status: 200 });
  response.headers.set(
    "Set-Cookie",
    `${AUTH_COOKIE_NAME}=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
  );
  return response;
}
