"use client";

import { useEffect } from "react";

import { registerAppServiceWorker } from "../features/walkthrough/offline";

/** Install the same app-shell worker from the real root layout. */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    // Next's development server relies on uncached, changing chunks. Install
    // the PWA worker for the production app users actually run.
    if (process.env.NODE_ENV !== "production") return;
    void registerAppServiceWorker();
  }, []);

  return null;
}
