import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, isAuthGateEnabled, verifyAuthCookie } from "./server/auth";

export async function middleware(request: NextRequest): Promise<Response> {
  // Landing + prescreen lead capture stay public even when the walkthrough app is passcode-gated.
  // This lets walkthroughkit.com collect contacts and demonstrate live records without exposing the full app + billable video pipeline.
  const pathname = request.nextUrl.pathname;
  if (pathname === "/" || pathname === "/api/prescreen" || pathname === "/api/leads" || pathname.startsWith("/api/prescreen/") || pathname.startsWith("/api/leads/")) {
    return NextResponse.next();
  }
  if (!isAuthGateEnabled()) return NextResponse.next();
  const passcode = process.env.INSPECTION_PASSCODE ?? "";
  const cookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (await verifyAuthCookie(cookie, passcode)) return NextResponse.next();
  return NextResponse.redirect(new URL("/unlock", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|fonts|forms|icons|unlock|api/auth/unlock).*)"],
};
