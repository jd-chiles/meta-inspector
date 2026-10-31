import type { NextConfig } from "next";

// Server-only credentials (META_API_KEY) must never appear here or in any
// NEXT_PUBLIC_* variable: client configuration stays secret-free (REQ-012).
// The fixture/live label is read at request time from the non-secret
// APP_ANALYSIS_MODE server env in src/app/page.tsx.
const nextConfig: NextConfig = {
  // Standalone server for container deploys (Azure ACA plan). No behavior
  // change for `next start`; required so the image runs without the repo.
  output: "standalone",
  // Baseline production headers. No CSP here: Mediabunny decodes in
  // blob:/worker contexts and Next inlines runtime scripts, so a strict
  // policy needs per-route tuning after the hosting cutover.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        // The service worker must never be served stale: clients check it
        // for updates on every navigation.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
