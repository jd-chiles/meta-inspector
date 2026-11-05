import { handlePrescreenRequest } from "../../../server/prescreen/pipeline";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const { status, body } = await handlePrescreenRequest(request);
  return Response.json(body, { status });
}
