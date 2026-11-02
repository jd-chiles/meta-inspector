import { AUTH_COOKIE_NAME, clientIpFromHeaders, createUnlockThrottle, isAuthGateEnabled, signAuthCookie, verifyPasscode } from "../../../../server/auth";

export const runtime = "nodejs";

// Tiny in-memory throttle: online guessing gets 10 tries per 10 minutes per IP.
const throttle = createUnlockThrottle();

export async function POST(request: Request): Promise<Response> {
  if (!isAuthGateEnabled()) {
    return Response.json({ ok: false, error: { code: "SETUP_REQUIRED", message: "Access control is not configured." } }, { status: 503 });
  }
  const passcode = process.env.INSPECTION_PASSCODE ?? "";
  const ip = clientIpFromHeaders(request.headers);
  if (throttle.throttled(ip)) {
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
