import { handleGuideRequest } from "../../../server/guide";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const { status, body } = await handleGuideRequest(request);
  return Response.json(body, { status });
}
