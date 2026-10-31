import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, isAuthGateEnabled, verifyAuthCookie } from "./server/auth";

export async function middleware(request: NextRequest): Promise<Response> {
  if (!isAuthGateEnabled()) return NextResponse.next();
  const passcode = process.env.INSPECTION_PASSCODE ?? "";
  const cookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (await verifyAuthCookie(cookie, passcode)) return NextResponse.next();
  return NextResponse.redirect(new URL("/unlock", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|fonts|forms|icons|unlock|api/auth/unlock).*)"],
};
