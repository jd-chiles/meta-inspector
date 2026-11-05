import { signAuthCookie } from "./server/auth";

const STARTUP_ATTEMPTS = 5;
const STARTUP_RETRY_MS = 1_000;

/**
 * Optionally start the durable queue consumer in the web process. Use a local
 * authenticated HTTP request so Next's instrumentation bundle does not pull
 * Node-only Postgres modules into its runtime bundle.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.APP_ANALYSIS_MODE !== "live" ||
      process.env.VIDEO_WORKER_IN_WEB_PROCESS !== "1" || !process.env.DATABASE_URL?.trim()) return;

  const passcode = process.env.INSPECTION_PASSCODE?.trim() ?? "";
  const token = process.env.VIDEO_JOB_WAKE_TOKEN?.trim() ?? "";
  if (!passcode || token.length < 32) return;

  const port = Number(process.env.PORT ?? "3000");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return;
  const cookie = await signAuthCookie(passcode);
  let attempt = 0;
  const start = async (): Promise<void> => {
    attempt += 1;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/internal/video-worker/start`, {
        method: "POST",
        signal: AbortSignal.timeout(2_000),
        headers: {
          Authorization: `Bearer ${token}`,
          Cookie: `mi_auth=${cookie}`,
          "Cache-Control": "no-store",
        },
      });
      await response.body?.cancel().catch(() => undefined);
      if (response.ok) return;
    } catch {
      // Next may not be listening yet; retry a bounded number of times.
    }
    if (attempt < STARTUP_ATTEMPTS) setTimeout(() => { void start(); }, STARTUP_RETRY_MS).unref?.();
  };
  setTimeout(() => { void start(); }, STARTUP_RETRY_MS).unref?.();
}
