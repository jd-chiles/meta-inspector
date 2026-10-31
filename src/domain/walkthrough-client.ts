/**
 * Same-app marker for video API requests (REQ-002, REQ-010).
 *
 * Browsers attach Origin/Referer to same-app POSTs, but some managed
 * ingresses strip both headers. The app also sends this marker header.
 * It is NOT a secret (it ships in the browser bundle); it still proves
 * same-app origin because cross-origin pages cannot set custom headers
 * without a CORS preflight, which the video API does not answer.
 */
export const WALKTHROUGH_CLIENT_HEADER = "x-walkthrough-client";
export const WALKTHROUGH_CLIENT_ID = "habitability-walkthrough/1";
