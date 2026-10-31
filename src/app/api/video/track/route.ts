import { handleVideoTrackRequest } from "../../../../server/video/meta-sam";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleVideoTrackRequest(request);
}
