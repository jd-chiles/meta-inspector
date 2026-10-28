import type { NextConfig } from "next";

// Server-only credentials (META_API_KEY) must never appear here or in any
// NEXT_PUBLIC_* variable: client configuration stays secret-free (REQ-012).
// The fixture/live label is read at request time from the non-secret
// APP_ANALYSIS_MODE server env in src/app/page.tsx.
const nextConfig: NextConfig = {};

export default nextConfig;
