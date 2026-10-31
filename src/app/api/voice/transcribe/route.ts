import { handleTranscribeRequest } from "../../../../server/voice/handlers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleTranscribeRequest(request);
}
