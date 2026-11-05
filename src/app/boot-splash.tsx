"use client";

/**
 * Boot splash controller. The splash node itself is inline HTML in the root
 * layout so it paints before scripts parse; this component stages its
 * status line (elapsed time since navigation start, so a cold container
 * boot shows as "waking the server" instead of a dead screen) and removes
 * the node once the app or unlock page renders.
 */
import { useEffect } from "react";

export function splashStatus(elapsedMs: number): string {
  if (elapsedMs < 3000) return "Loading…";
  const secs = Math.max(1, Math.round(elapsedMs / 1000));
  if (elapsedMs < 12_000) return `Loading this device’s saved work… (${secs}s)`;
  return `Taking longer than usual (${secs}s). Tap to reload.`;
}

const READY_SELECTORS =
  '[data-testid="move-in-ready-app"], [data-testid="unlock-page"], [data-testid="landing-page"], main, .move-in-ready-flow_app__mn9UZ, [class*="move-in-ready-flow_app"]';

/**
 * A stale service worker can serve an old HTML shell that references JS
 * chunks a deploy has already replaced. The page then never hydrates and the
 * splash stays up forever. Recover once by reloading, and make the splash
 * itself tappable so a stuck user is never trapped.
 */
const RETRY_KEY = "walkthrough-kit-boot-retry-v2";
const CHUNK_ERROR = /Loading chunk|ChunkLoadError|Importing a module script failed|error loading dynamically imported module|ChunkLoadError: Loading chunk/i;

function reloadOnce(force = false): void {
  try {
    const seen = sessionStorage.getItem(RETRY_KEY);
    if (seen === "2" && !force) return;
    if (seen === "1" && !force) {
      sessionStorage.setItem(RETRY_KEY, "2");
    } else if (!seen) {
      sessionStorage.setItem(RETRY_KEY, "1");
    } else if (force) {
      sessionStorage.setItem(RETRY_KEY, "2");
    }
  } catch {
    // ignore
  }
  // Hard reload to bypass SW cache
  window.location.reload();
}

export default function BootSplash(): null {
  useEffect(() => {
    const node = document.getElementById("app-splash");
    if (!node) return;
    const statusEl = document.getElementById("app-splash-status");
    const t0 = typeof performance === "undefined" ? Date.now() : performance.timeOrigin;
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      window.clearInterval(ticker);
      observer.disconnect();
      node.setAttribute("aria-hidden", "true");
      node.style.pointerEvents = "none";
      node.classList.add("app-splash-hide");
      window.setTimeout(() => node.remove(), 400);
    };
    const tick = () => {
      // Compare before writing: the observer watches this subtree, so an
      // unconditional write would retrigger it into an infinite cascade.
      if (statusEl) {
        const next = splashStatus(Date.now() - t0);
        if (statusEl.textContent !== next) statusEl.textContent = next;
      }
      if (document.querySelector(READY_SELECTORS)) dismiss();
    };
    const observer = new MutationObserver(tick);
    observer.observe(document.body, { childList: true, subtree: true });
    const ticker = window.setInterval(tick, 500);
    tick();

    // Never strand a user on the splash: aggressive reload on stuck/chunk errors
    const forceDismiss = window.setTimeout(() => {
      if (dismissed) return;
      dismiss();
    }, 4000);
    const stuckTimer1 = window.setTimeout(() => {
      if (dismissed || document.querySelector(READY_SELECTORS)) return;
      reloadOnce();
    }, 5000);
    const stuckTimer2 = window.setTimeout(() => {
      if (dismissed || document.querySelector(READY_SELECTORS)) return;
      reloadOnce(true);
    }, 9000);
    const escape = () => {
      node.style.cursor = "pointer";
      node.title = "Tap to reload";
      node.addEventListener("click", () => window.location.reload());
    };
    const escapeTimer = window.setTimeout(escape, 5000);
    const onChunkError = (event: ErrorEvent) => {
      const msg = String(event.message ?? "");
      if (CHUNK_ERROR.test(msg)) reloadOnce(true);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const msg = String(event.reason?.message ?? event.reason ?? "");
      if (CHUNK_ERROR.test(msg)) reloadOnce(true);
    };
    window.addEventListener("error", onChunkError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.clearInterval(ticker);
      window.clearTimeout(forceDismiss);
      window.clearTimeout(stuckTimer1);
      window.clearTimeout(stuckTimer2);
      window.clearTimeout(escapeTimer);
      window.removeEventListener("error", onChunkError);
      window.removeEventListener("unhandledrejection", onRejection);
      observer.disconnect();
    };
  }, []);
  return null;
}
