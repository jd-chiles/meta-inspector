/**
 * Shared same-app origin check for JSON API routes. Browsers always send an
 * Origin header on the app's POST calls, so the server must accept the
 * public app origin even though managed ingress (Azure Container Apps)
 * forwards an INTERNAL request URL to the container: comparing against
 * request.url alone rejects every real browser call in production. The fix
 * every route must use: trust the configured public origin (APP_PUBLIC_ORIGIN,
 * set per app) alongside the direct match and loopback equivalence.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHost(hostname: string): string {
  const host = hostname.trim().toLowerCase();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

export interface AppOriginCheck {
  allowed: boolean;
  /** True when APP_PUBLIC_ORIGIN is present but malformed — fail loudly (503), never silently. */
  configError: boolean;
}

/**
 * Allow the request when its Origin matches the request URL, the configured
 * public origin, or loopback equivalence. Missing Origin stays allowed
 * (non-browser callers); anything else is denied.
 */
export function checkAppOrigin(request: Request, configuredPublicOrigin?: string | null): AppOriginCheck {
  const denied = { allowed: false, configError: false };
  const origin = request.headers.get("origin");
  if (origin === null || origin.trim().length === 0) return { allowed: true, configError: false };
  let originUrl: URL;
  let targetUrl: URL;
  try {
    originUrl = new URL(origin);
    targetUrl = new URL(request.url);
  } catch {
    return denied;
  }
  if (originUrl.origin === targetUrl.origin) return { allowed: true, configError: false };
  const configured = (configuredPublicOrigin ?? "").trim().replace(/\/$/, "");
  if (configured.length > 0) {
    let publicUrl: URL;
    try {
      publicUrl = new URL(configured);
    } catch {
      return { allowed: false, configError: true };
    }
    if ((publicUrl.protocol !== "https:" && publicUrl.protocol !== "http:") || publicUrl.origin !== configured) {
      return { allowed: false, configError: true };
    }
    if (originUrl.origin === publicUrl.origin) return { allowed: true, configError: false };
  }
  if (originUrl.protocol !== targetUrl.protocol) return denied;
  if (originUrl.port !== targetUrl.port) return denied;
  if (!LOOPBACK_HOSTS.has(normalizeHost(originUrl.hostname))) return denied;
  if (!LOOPBACK_HOSTS.has(normalizeHost(targetUrl.hostname))) return denied;
  return { allowed: true, configError: false };
}
