import { handlePolishCaseNoteRequest } from "../../../../server/exports/polish-case-note";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const { status, body } = await handlePolishCaseNoteRequest(request);
  return Response.json(body, { status });
}
