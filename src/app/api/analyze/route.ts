/**
 * Same-origin bounded analysis route (REQ-002, REQ-003, REQ-004, REQ-010).
 *
 * POST /api/analyze accepts multipart form-data only. All validation,
 * normalization, provider, and envelope logic lives in the server-only
 * module src/server/analyze.ts so this route exports only the POST handler
 * plus `runtime` (Next.js route-type gate). See that module for the flow.
 */
import { handleAnalyzeRequest } from "../../../server/analyze";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const { status, body } = await handleAnalyzeRequest(request);
  return Response.json(body, { status });
}
