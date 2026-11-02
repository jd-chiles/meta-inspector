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
  if (elapsedMs < 20_000) return `Waking the server — first visit can take ~20 seconds… (${secs}s)`;
  return `Still working (${secs}s) — check your connection. Reload if this persists.`;
}

const READY_SELECTORS = '[data-testid="move-in-ready-app"], [data-testid="unlock-page"]';

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
    return () => {
      window.clearInterval(ticker);
      observer.disconnect();
    };
  }, []);
  return null;
}
