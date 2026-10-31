import { handleVideoSegmentRequest } from "../../../../server/video/meta-sam";

export const runtime = "nodejs";
export const maxDuration = 160;

export async function POST(request: Request): Promise<Response> {
  return handleVideoSegmentRequest(request);
}
